(ns autonomy-policy
  "Pure, fail-closed validators for the proposed Task Board autonomy schemas.

  These functions validate structure and policy bounds only. They do not
  authorize execution, authenticate a writer/owner, or perform I/O."
  (:require [clojure.string :as str])
  (:import [java.security MessageDigest]
           [java.time Instant]))

(def ^:private result-categories
  #{:ok :invalid-schema :unsupported-version :invalid-context :expired :scope-mismatch
    :unsupported-route :unsupported-probe :unsafe-scope :unsafe-operation
    :invalid-digest :invalid-head :invalid-issuance :invalid-value :exception})

(def ^:private diagnostic-codes
  {:ok "ok"
   :invalid-schema "invalid-schema"
   :unsupported-version "unsupported-version"
   :invalid-context "invalid-context"
   :expired "expired"
   :scope-mismatch "scope-mismatch"
   :unsupported-route "unsupported-route"
   :unsupported-probe "unsupported-probe"
   :unsafe-scope "unsafe-scope"
   :unsafe-operation "unsafe-operation"
   :invalid-digest "invalid-digest"
   :invalid-head "invalid-head"
   :invalid-issuance "invalid-issuance"
   :invalid-value "invalid-value"
   :exception "invalid-schema"})

(def ^:private control-keys
  #{:schema_version :ticket :revision :writer_generation :objective :intent
    :agent_route :scope :policy_version :budget})
(def ^:private objective-keys
  #{:id :ticket_version :requirements :requirements_sha256})
(def ^:private scope-keys #{:repos :paths :operations})
(def ^:private budget-keys #{:max_steps :max_wall_minutes})
(def ^:private decision-keys
  #{:schema_version :issuance :id :ticket :control_revision :question
    :recommended_option :options :evidence_refs :impact :rollback :scope
    :artifact_head :owner :expires_at :status})
(def ^:private option-keys #{:id :effect})
(def ^:private retry-keys
  #{:schema_version :ticket :control_revision :category :reason :retry_condition
    :retry_owner :next_check :deadline :attempts :max_attempts :backoff_seconds
    :resume_action :scope_ref :last_probe_event})
(def ^:private retry-condition-keys
  #{:probe :resource_ref :expected_head :success})
(def ^:private notification-keys
  #{:schema_version :policy_id :wip :fairness :budget :notifications})
(def ^:private wip-keys #{:global :per_repo :per_ticket :probe_global})
(def ^:private notification-budget-keys
  #{:max_steps :max_wall_minutes :max_retry_attempts})
(def ^:private notification-detail-keys
  #{:digest_minutes :dedupe_key :immediate :reminder_hours :max_reminders})

(def ^:private routes
  ;; This is the v2 schema registry, not execution authorization. It deliberately
  ;; does not inherit additional routes from legacy runner configuration.
  #{"codex" "codex-sol" "codex-full" "codex-terra" "codex-mini" "claude-fable"})
(def ^:private reasoning-levels #{"minimal" "low" "medium" "high" "xhigh"})
(def ^:private route-reasoning-levels
  {"codex" reasoning-levels
   "codex-terra" reasoning-levels
   "codex-mini" reasoning-levels
   "codex-sol" #{"low" "medium" "high" "xhigh"}
   "codex-full" #{"low" "medium" "high" "xhigh"}})
(def ^:private operations #{"read" "edit" "test" "commit" "push" "draft-pr"})
(def ^:private probes #{"github-checks"})
(def ^:private retry-categories
  #{"transient-agent" "dependency" "auth" "human-decision" "scope-unknown"
    "ci-pending"})
(def ^:private notification-kinds #{"new-human-decision" "policy-violation"})

(declare fail! require!)

(defn- normalize-keys [value]
  (cond
    (map? value)
    (reduce-kv (fn [out k v]
                 (let [key (cond
                             (and (keyword? k) (nil? (namespace k))) k
                            (string? k) (keyword k)
                             :else (fail! :invalid-schema))]
                   (require! (nil? (namespace key)) :invalid-schema)
                   (require! (not (contains? out key)) :invalid-schema)
                   (assoc out key (normalize-keys v))))
               {} value)
    (vector? value) (mapv normalize-keys value)
    (or (set? value) (sequential? value)) (fail! :invalid-schema)
    :else value))

(defn sha256
  "Return the lowercase SHA-256 hex digest of a UTF-8 string."
  [value]
  (when-not (string? value)
    (throw (ex-info "sha256 expects a string" {})))
  (let [digest (.digest (MessageDigest/getInstance "SHA-256")
                        (.getBytes ^String value "UTF-8"))]
    (apply str (map #(format "%02x" (bit-and 0xff %)) digest))))

(defn- canonical-edn [x]
  (cond
    (map? x) (into (sorted-map-by #(compare (pr-str %1) (pr-str %2)))
                   (map (fn [[k v]] [k (canonical-edn v)]) x))
    (set? x) (vec (sort-by pr-str (map canonical-edn x)))
    (sequential? x) (mapv canonical-edn x)
    :else x))

(defn scope-digest
  "Hash a scope map using stable EDN ordering."
  [scope]
  (sha256 (pr-str (canonical-edn (normalize-keys scope)))))

(defn- diagnostic [category]
  (let [category (if (contains? result-categories category) category :invalid-schema)]
    {:category category :code (get diagnostic-codes category "invalid-schema")}))

(defn public-diagnostic
  "Create a fixed-shape public diagnostic from registry values only.

  Free-form messages, exception objects, URLs, and arbitrary input are ignored."
  ([category] (public-diagnostic category {}))
  ([category _attrs]
   (diagnostic category)))

(defn- result [valid? category]
  {:valid? valid? :diagnostic (diagnostic category)})

(defn- fail! [category]
  (throw (ex-info "policy validation failed" {:category category})))

(defn- require! [condition category]
  (when-not condition (fail! category)))

(defn- exact-keys! [m expected]
  (require! (and (map? m) (= expected (set (keys m)))) :invalid-schema))

(defn- safe-token? [s]
  (and (string? s) (<= 1 (count s) 160)
       (re-matches #"[A-Za-z0-9][A-Za-z0-9._/-]*" s)
       (not (str/includes? s ".."))))

(defn- supported-route? [route]
  (or (contains? routes route)
      (when (string? route)
        (when-let [[_ base effort] (re-matches #"(codex(?:-sol|-full|-terra|-mini)?)-([^-]+)" route)]
          (contains? (get route-reasoning-levels base #{}) effort)))))

(defn- safe-resource-ref? [value repos]
  (and (string? value)
       (re-matches #"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]{0,8}" value)
       (contains? (set repos) (first (str/split value #"#")))))

(defn- parse-utc-instant [value]
  (try
    (when (and (string? value)
               (re-matches #"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z" value))
      (Instant/parse value))
    (catch Exception _ nil)))

(defn- context-instant [context]
  (parse-utc-instant (:now context)))

(defn- valid-context? [context]
  (and (map? context)
       (some? (context-instant context))
       (or (set? (:allowed-repos context)) (vector? (:allowed-repos context)))
       (or (set? (:allowed-paths context)) (vector? (:allowed-paths context)))))

(defn- no-placeholder? [s]
  (and (string? s) (not (re-find #"(?i)(<[^>]*>|placeholder|example|template|todo)" s))))

(defn- safe-path? [path allowed-prefixes]
  (and (string? path)
       (not (str/blank? path))
       (not (str/starts-with? path "/"))
       (re-matches #"[A-Za-z0-9._/-]+" path)
       (not (str/includes? path "//"))
       (not (str/ends-with? path ".."))
       (every? #(and (not (str/blank? %)) (not= % ".") (not= % ".."))
               (str/split path #"/"))
       (some (fn [prefix]
               (and (string? prefix)
                    (not (str/starts-with? prefix "/"))
                    (re-matches #"[A-Za-z0-9._/-]+" prefix)
                    (not (str/includes? prefix "//"))
                    (every? #(and (not (str/blank? %)) (not= % ".") (not= % ".."))
                            (str/split prefix #"/"))
                    (or (= path prefix)
                        (str/starts-with? path (if (str/ends-with? prefix "/")
                                                 prefix (str prefix "/"))))))
             allowed-prefixes)))

(defn- validate-scope! [scope context]
  (exact-keys! scope scope-keys)
  (require! (and (vector? (:repos scope)) (seq (:repos scope))) :unsafe-scope)
  (require! (and (vector? (:paths scope)) (seq (:paths scope))) :unsafe-scope)
  (require! (and (vector? (:operations scope)) (seq (:operations scope))) :unsafe-operation)
  (let [allowed-repos (set (:allowed-repos context))
        allowed-paths (:allowed-paths context)]
    (require! (and (every? #(and (string? %)
                                 (re-matches #"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" %))
                             (:repos scope))
                   (every? allowed-repos (:repos scope))) :unsafe-scope)
    (require! (every? #(safe-path? % allowed-paths) (:paths scope)) :unsafe-scope)
    (require! (every? operations (:operations scope)) :unsafe-operation))
  scope)

(defn- validate-control! [input context]
  (exact-keys! input control-keys)
  (require! (= 2 (:schema_version input)) :unsupported-version)
  (require! (and (safe-token? (:ticket input))
                 (integer? (:revision input)) (pos? (:revision input))
                 (integer? (:writer_generation input)) (pos? (:writer_generation input)))
            :invalid-value)
  (let [objective (:objective input)]
    (exact-keys! objective objective-keys)
    (require! (and (safe-token? (:id objective))
                   (integer? (:ticket_version objective)) (pos? (:ticket_version objective))
                   (string? (:requirements objective)) (not (str/blank? (:requirements objective)))
                 (<= (count (:requirements objective)) 20000)) :invalid-value)
    (require! (and (string? (:requirements_sha256 objective))
                   (re-matches #"[a-f0-9]{64}" (:requirements_sha256 objective))
                   (= (:requirements_sha256 objective) (sha256 (:requirements objective))))
              :invalid-digest))
  (require! (contains? #{"run" "pause" "cancel" "wait-human"} (:intent input)) :invalid-value)
  (require! (supported-route? (:agent_route input)) :unsupported-route)
  (require! (= "autonomy-v1" (:policy_version input)) :unsupported-version)
  (validate-scope! (:scope input) context)
  (exact-keys! (:budget input) budget-keys)
  (require! (and (integer? (get-in input [:budget :max_steps]))
                 (<= 1 (get-in input [:budget :max_steps]) 6)
                 (integer? (get-in input [:budget :max_wall_minutes]))
                 (<= 1 (get-in input [:budget :max_wall_minutes]) 60)) :invalid-value)
  input)

(defn validate-control
  "Validate the v2 control object. Result never includes input or exception text."
  [input context]
  (try
    (require! (valid-context? context) :invalid-context)
    (validate-control! (normalize-keys input) context)
    (result true :ok)
    (catch clojure.lang.ExceptionInfo e
      (result false (or (:category (ex-data e)) :invalid-schema)))
    (catch Exception _ (result false :exception))))

(defn- validate-decision! [input context]
  (exact-keys! input decision-keys)
  (require! (= 1 (:schema_version input)) :unsupported-version)
  (require! (= "issued" (:issuance input)) :invalid-issuance)
  (require! (and (safe-token? (:id input)) (safe-token? (:ticket input))
                 (= (:ticket input) (get-in context [:control :ticket]))
                 (= (:control_revision input) (get-in context [:control :revision]))) :scope-mismatch)
  (require! (and (string? (:question input)) (not (str/blank? (:question input)))
                 (vector? (:options input)) (<= 1 (count (:options input)) 8)
                 (every? (fn [option]
                           (and (map? option) (= option-keys (set (keys option)))
                                (safe-token? (:id option)) (no-placeholder? (:effect option))
                                (string? (:effect option)) (not (str/blank? (:effect option)))))
                         (:options input))) :invalid-value)
  (require! (and (safe-token? (:recommended_option input))
                 (some #(= (:recommended_option input) (:id %)) (:options input))) :invalid-value)
  (require! (and (vector? (:evidence_refs input))
                 (every? safe-token? (:evidence_refs input))) :invalid-value)
  (doseq [field [:impact :rollback :scope]]
    (require! (and (string? (get input field)) (not (str/blank? (get input field)))
                   (<= (count (get input field)) 2000) (no-placeholder? (get input field))) :invalid-value))
  (require! (and (string? (:artifact_head input))
                 (re-matches #"[a-f0-9]{40}" (:artifact_head input))
                 (not (re-matches #"0{40}" (:artifact_head input)))) :invalid-head)
  (when-let [current-head (:artifact-head context)]
    (require! (= (:artifact_head input) current-head) :scope-mismatch))
  (require! (= (count (map :id (:options input)))
               (count (distinct (map :id (:options input))))) :invalid-value)
  (require! (and (safe-token? (:owner input))
                 (contains? #{"pending" "resolved" "expired" "superseded"} (:status input))) :invalid-value)
  (let [expires (parse-utc-instant (:expires_at input))]
    (require! (and expires (.isAfter ^Instant expires (context-instant context))) :expired))
  ;; I1's concrete issued representation stores the scope digest in this field.
  (require! (= (:scope input) (scope-digest (get-in context [:control :scope]))) :scope-mismatch)
  input)

(defn validate-decision
  "Validate an issued decision packet against a valid control object's identity."
  [input context]
  (try
    (let [context (if (contains? context :control)
                    (assoc context :control (normalize-keys (:control context)))
                    context)]
      (require! (and (valid-context? context)
                     (= true (:valid? (validate-control (:control context) context)))) :invalid-context)
      (validate-decision! (normalize-keys input) context))
    (result true :ok)
    (catch clojure.lang.ExceptionInfo e
      (result false (or (:category (ex-data e)) :invalid-schema)))
    (catch Exception _ (result false :exception))))

(defn- validate-retry! [input context]
  (exact-keys! input retry-keys)
  (require! (= 1 (:schema_version input)) :unsupported-version)
  (let [control (:control context)
        condition (:retry_condition input)]
    (require! (and (= (:ticket input) (:ticket control))
                   (= (:control_revision input) (:revision control))) :scope-mismatch)
    (require! (contains? retry-categories (:category input)) :invalid-value)
    (require! (contains? #{"runner" "dependency-owner" "boxp"} (:retry_owner input)) :invalid-value)
    (exact-keys! condition retry-condition-keys)
    (require! (contains? probes (:probe condition)) :unsupported-probe)
    (require! (and (safe-resource-ref? (:resource_ref condition) (:repos (:scope control)))
                   (string? (:reason input)) (not (str/blank? (:reason input)))
                   (<= (count (:reason input)) 1000)
                   (string? (:expected_head condition))
                   (re-matches #"[a-f0-9]{40}" (:expected_head condition))
                   (not (re-matches #"0{40}" (:expected_head condition)))
                   (= "checks-completed" (:success condition))) :invalid-value)
    (when-let [current-head (:artifact-head context)]
      (require! (= (:expected_head condition) current-head) :scope-mismatch))
    (let [now (context-instant context)
          next-check (parse-utc-instant (:next_check input))
          deadline (parse-utc-instant (:deadline input))]
      (require! (and next-check deadline
                     (.isAfter ^Instant deadline now)
                     (.isBefore ^Instant next-check deadline)
                     (not (.isAfter ^Instant deadline (.plusSeconds ^Instant now 86400)))) :expired))
    (require! (and (integer? (:attempts input)) (<= 0 (:attempts input))
                   (integer? (:max_attempts input)) (<= 1 (:max_attempts input) 3)
                   (< (:attempts input) (:max_attempts input))) :invalid-value)
    (require! (and (vector? (:backoff_seconds input))
                   (= (:max_attempts input) (count (:backoff_seconds input)))
                   (every? #(and (integer? %) (<= 1 % 86400)) (:backoff_seconds input))
                   (= (:backoff_seconds input) (vec (sort (:backoff_seconds input))))) :invalid-value)
    (require! (and (= "ci-pending" (:category input))
                   (= "inspect-ci" (:resume_action input))) :invalid-value)
    (require! (= (:scope_ref input) (scope-digest (:scope control))) :scope-mismatch)
    (require! (or (nil? (:last_probe_event input)) (safe-token? (:last_probe_event input))) :invalid-value))
  input)

(defn validate-retry
  "Validate a bounded retry contract against the current control object."
  [input context]
  (try
    (let [context (if (contains? context :control)
                    (assoc context :control (normalize-keys (:control context)))
                    context)]
      (require! (and (valid-context? context)
                     (= true (:valid? (validate-control (:control context) context)))) :invalid-context)
      (validate-retry! (normalize-keys input) context))
    (result true :ok)
    (catch clojure.lang.ExceptionInfo e
      (result false (or (:category (ex-data e)) :invalid-schema)))
    (catch Exception _ (result false :exception))))

(defn- validate-notification! [input]
  (exact-keys! input notification-keys)
  (require! (= 1 (:schema_version input)) :unsupported-version)
  (require! (= "autonomy-v1" (:policy_id input)) :unsupported-version)
  (require! (= "priority-with-aging" (:fairness input)) :invalid-value)
  (exact-keys! (:wip input) wip-keys)
  (doseq [[key max-value] [[:global 2] [:per_repo 1] [:per_ticket 1] [:probe_global 1]]]
    (let [value (get-in input [:wip key])]
      (require! (and (integer? value) (<= 1 value max-value)) :invalid-value)))
  (exact-keys! (:budget input) notification-budget-keys)
  (require! (and (integer? (get-in input [:budget :max_steps]))
                 (<= 1 (get-in input [:budget :max_steps]) 6)
                 (integer? (get-in input [:budget :max_wall_minutes]))
                 (<= 1 (get-in input [:budget :max_wall_minutes]) 60)
                 (integer? (get-in input [:budget :max_retry_attempts]))
                 (<= 1 (get-in input [:budget :max_retry_attempts]) 3)) :invalid-value)
  (exact-keys! (:notifications input) notification-detail-keys)
  (let [notifications (:notifications input)]
    (require! (and (integer? (:digest_minutes notifications))
                   (<= 1 (:digest_minutes notifications) 1440)
                   (vector? (:dedupe_key notifications))
                   (= 3 (count (:dedupe_key notifications)))
                   (= #{"ticket" "category" "condition_version"}
                      (set (:dedupe_key notifications)))
                   (vector? (:immediate notifications))
                   (every? notification-kinds (:immediate notifications))
                   (integer? (:reminder_hours notifications))
                   (<= 1 (:reminder_hours notifications) 720)
                   (integer? (:max_reminders notifications))
                   (<= 0 (:max_reminders notifications) 1)) :invalid-value))
  input)

(defn validate-notification
  "Validate the versioned WIP and notification policy."
  [input _context]
  (try
    (validate-notification! (normalize-keys input))
    (result true :ok)
    (catch clojure.lang.ExceptionInfo e
      (result false (or (:category (ex-data e)) :invalid-schema)))
    (catch Exception _ (result false :exception))))
