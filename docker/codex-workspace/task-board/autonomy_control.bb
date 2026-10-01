(ns autonomy-control
  "Local mock of the Task Board autonomy v2 control store (BOXP-201 I3).

  It fixes the interface and the actor/revision/generation contract that the
  real, separately deployed control API must satisfy (I7). The mock resolves the
  actor from a credential registered in its own trust configuration, never from
  a self-declared name or from vault projections. It is not an authentication
  system and must only back temporary fixtures. Results carry a fixed-shape
  diagnostic and never include requirements, credentials or exception text."
  (:require [babashka.fs :as fs]
            [clojure.edn :as edn]
            [clojure.string :as str])
  (:import [java.time Instant]))

;; Sibling .bb scripts are loaded explicitly; they are not classpath libraries.
(let [dir (fs/parent *file*)]
  (doseq [[lib file] [['autonomy-policy "autonomy_policy.bb"]
                      ['vault-writer "vault_writer.bb"]]]
    (when-not (find-ns lib)
      (load-file (str (fs/path dir file))))))
(in-ns 'autonomy-control)
(alias 'policy 'autonomy-policy)
(alias 'writer 'vault-writer)

(def events-file-name "control-events.log")
(def ^:private lock-file-name "control-store.lock")

(def ^:private diagnostic-codes
  {:ok "ok"
   :unauthenticated "unauthenticated"
   :forbidden "forbidden"
   :conflict "conflict"
   :stale-generation "stale-generation"
   :rollback-detected "rollback-detected"
   :unavailable "unavailable"
   :invalid-request "invalid-request"
   :budget-exceeded "budget-exceeded"
   :not-found "not-found"})

(defn- diagnostic [category]
  (let [category (if (contains? diagnostic-codes category) category :unavailable)]
    {:category category :code (get diagnostic-codes category)}))

(defn- ok [extra]
  (merge extra {:ok? true :diagnostic (diagnostic :ok)}))

(defn- failed [category]
  {:ok? false :diagnostic (diagnostic category)})

(defn- reject! [category]
  (throw (ex-info "control request rejected" {::category category})))

(defn- guarded [f]
  (try
    (f)
    (catch clojure.lang.ExceptionInfo e
      (failed (or (::category (ex-data e)) :unavailable)))
    (catch Exception _ (failed :unavailable))))

(defn open-store
  "principals maps a credential to {:subject string :role :owner|:runner|:agent}.
  allowed-repos/allowed-paths are the owner-side bounds every stored control must
  satisfy; they are never taken from a request."
  [{:keys [dir principals allowed-repos allowed-paths now]}]
  {:dir (str dir)
   :principals principals
   :allowed-repos allowed-repos
   :allowed-paths allowed-paths
   :now (or now #(str (Instant/now)))})

(declare events-path)

(defn init-store!
  "Provision an empty event log. Reads and requests never create one, so a
  missing original is unavailable rather than silently empty."
  [store]
  (fs/create-dirs (:dir store))
  (when-not (fs/exists? (events-path store))
    (spit (str (events-path store)) ""))
  store)

;; --- event log --------------------------------------------------------------

(def ^:private empty-state {:generation 0 :tickets {} :seq 0 :chain ""})

(defn- chain-hash [previous body]
  (writer/sha256 (str previous "\n" body)))

(defn- apply-event
  "Fold one event into the state, enforcing the append-only contract: contiguous
  sequence, generation +1, and per-ticket revisions that never skip or go back."
  [state event]
  (let [ticket (:ticket event)
        current-revision (get-in state [:tickets ticket :control :revision] 0)]
    (when-not (= (:seq event) (inc (:seq state))) (reject! :unavailable))
    (case (:op event)
      :issue-writer-generation
      (do (when-not (= (:generation event) (inc (:generation state))) (reject! :unavailable))
          (assoc state :generation (:generation event) :seq (:seq event)))

      (:issue-control :update-control :restrict-intent :consume-budget)
      (let [step (if (= :consume-budget (:op event)) 0 1)
            entry (:entry event)]
        (when-not (and (string? ticket)
                       (= (:previous-revision event) current-revision)
                       (= (:revision event) (+ current-revision step))
                       (= (:revision event) (get-in entry [:control :revision])))
          (reject! :unavailable))
        (-> state
            (assoc-in [:tickets ticket] entry)
            (assoc :seq (:seq event))))

      (reject! :unavailable))))

(defn- events-path [store]
  (fs/path (:dir store) events-file-name))

(defn- load-log
  "Replay the hash-chained log. Any damage fails closed as :unavailable."
  [store]
  (let [path (events-path store)
        _ (when-not (fs/regular-file? path) (reject! :unavailable))
        text (slurp (str path))
        lines (if (str/blank? text) [] (str/split-lines text))]
    (reduce (fn [{:keys [state events]} line]
              (let [[_ digest body] (or (re-matches #"([a-f0-9]{64}) (.*)" line)
                                        (reject! :unavailable))
                    _ (when-not (= digest (chain-hash (:chain state) body))
                        (reject! :unavailable))
                    event (try (edn/read-string body)
                               (catch Exception _ (reject! :unavailable)))]
                {:state (assoc (apply-event state event) :chain digest)
                 :events (conj events event)
                 :text text}))
            {:state empty-state :events [] :text text}
            lines)))

(defn- append-event! [store {:keys [state text]} event]
  (let [event (assoc event :seq (inc (:seq state)) :at ((:now store)))
        event (assoc event :event-id (str "control-event-" (:seq event)))
        ;; Reject an event the replay would refuse before it becomes durable.
        _ (apply-event state event)
        body (pr-str event)
        line (str (chain-hash (:chain state) body) " " body "\n")]
    (writer/atomic-write! (events-path store) (str text line))
    event))

(defn- locked [store f]
  (guarded (fn []
             ;; Taking the lock must not recreate a missing store directory.
             (when-not (fs/directory? (:dir store)) (reject! :unavailable))
             (writer/with-file-lock (:dir store) lock-file-name f))))

;; --- actors and request validation -------------------------------------------

(defn- actor! [store credential]
  (let [principal (when (string? credential) (get (:principals store) credential))]
    (when-not (and (map? principal) (string? (:subject principal))
                   (contains? #{:owner :runner :agent} (:role principal)))
      (reject! :unauthenticated))
    principal))

(defn- require-role! [actor roles]
  (when-not (contains? roles (:role actor)) (reject! :forbidden)))

(defn- require-keys! [request required optional]
  (let [present (set (keys request))]
    (when-not (and (every? present required)
                   (every? (into required optional) present))
      (reject! :invalid-request))))

(defn- safe-token? [value]
  (and (string? value) (some? (re-matches #"[A-Za-z0-9][A-Za-z0-9._/-]{0,159}" value))
       (not (str/includes? value ".."))))

(defn- entry! [state ticket]
  (or (get-in state [:tickets ticket]) (reject! :not-found)))

(defn- validated-control! [store control]
  (let [result (policy/validate-control control {:now ((:now store))
                                                 :allowed-repos (:allowed-repos store)
                                                 :allowed-paths (:allowed-paths store)})]
    (when-not (true? (:valid? result)) (reject! :invalid-request))
    control))

(defn- current-writer! [state entry generation]
  (when-not (and (pos-int? generation)
                 (= generation (:generation state))
                 (= generation (get-in entry [:control :writer_generation])))
    (reject! :stale-generation)))

(defn- expected-revision! [entry expected]
  (when-not (= expected (get-in entry [:control :revision])) (reject! :conflict)))

(defn- event-for [actor op ticket previous-revision entry]
  {:op op
   :ticket ticket
   :actor-subject (:subject actor)
   :actor-role (:role actor)
   :previous-revision previous-revision
   :revision (get-in entry [:control :revision])
   :entry entry})

;; --- operations ---------------------------------------------------------------

(defmulti ^:private handle (fn [_store _state _actor request] (:op request)))

(defmethod handle :default [_ _ _ _] (reject! :invalid-request))

(defmethod handle :issue-writer-generation [_ state actor request]
  (require-role! actor #{:owner})
  (require-keys! request #{:op :expected-generation} #{})
  (when-not (= (:expected-generation request) (:generation state)) (reject! :conflict))
  {:op :issue-writer-generation
   :actor-subject (:subject actor)
   :actor-role (:role actor)
   :generation (inc (:generation state))})

(defmethod handle :issue-control [store state actor request]
  (require-role! actor #{:owner})
  (require-keys! request #{:op :ticket :objective-id :requirements :intent :agent_route
                           :scope :budget} #{})
  (let [{:keys [ticket requirements]} request]
    (when-not (and (safe-token? ticket) (string? requirements)) (reject! :invalid-request))
    (when (get-in state [:tickets ticket]) (reject! :conflict))
    (when-not (pos? (:generation state)) (reject! :stale-generation))
    (let [control (validated-control!
                   store
                   {:schema_version 2
                    :ticket ticket
                    :revision 1
                    :writer_generation (:generation state)
                    :objective {:id (:objective-id request)
                                :ticket_version 1
                                :requirements requirements
                                :requirements_sha256 (policy/sha256 requirements)}
                    :intent (:intent request)
                    :agent_route (:agent_route request)
                    :scope (:scope request)
                    :policy_version "autonomy-v1"
                    :budget (:budget request)})]
      (event-for actor :issue-control ticket 0
                 {:control control
                  :budget-epoch 1
                  :consumed {:steps 0 :wall_minutes 0}
                  :idempotency-keys #{}}))))

(defmethod handle :update-control [store state actor request]
  (require-role! actor #{:owner})
  (require-keys! request #{:op :ticket :expected-revision}
                 #{:intent :agent_route :scope :budget :requirements :new-budget-epoch})
  (let [{:keys [ticket requirements]} request
        changes (select-keys request [:intent :agent_route :scope :budget])
        new-epoch? (:new-budget-epoch request)]
    (when-not (and (safe-token? ticket)
                   (or (seq changes) (contains? request :requirements) new-epoch?)
                   (or (nil? new-epoch?) (true? new-epoch?))
                   (or (not (contains? request :requirements)) (string? requirements)))
      (reject! :invalid-request))
    (let [entry (entry! state ticket)
          _ (expected-revision! entry (:expected-revision request))
          _ (when-not (pos? (:generation state)) (reject! :stale-generation))
          control (:control entry)
          ;; A new requirements snapshot is a new ticket version. Decisions and
          ;; retry contracts pin control_revision, so the bump invalidates them.
          objective (if (and (contains? request :requirements)
                             (not= requirements (get-in control [:objective :requirements])))
                      (-> (:objective control)
                          (update :ticket_version inc)
                          (assoc :requirements requirements
                                 :requirements_sha256 (policy/sha256 requirements)))
                      (:objective control))
          control (validated-control!
                   store
                   (-> (merge control changes)
                       (assoc :objective objective
                              :revision (inc (:revision control))
                              :writer_generation (:generation state))))]
      (event-for actor :update-control ticket (dec (:revision control))
                 (cond-> (assoc entry :control control)
                   ;; Only an explicit owner request starts a new budget epoch;
                   ;; a revision bump alone never resets consumption.
                   new-epoch? (-> (update :budget-epoch inc)
                                  (assoc :consumed {:steps 0 :wall_minutes 0})))))))

(def ^:private restrictive-intents #{"pause" "cancel" "wait-human"})

(defmethod handle :restrict-intent [store state actor request]
  (require-role! actor #{:runner})
  (require-keys! request #{:op :ticket :expected-revision :writer-generation :intent} #{})
  (let [{:keys [ticket intent]} request]
    (when-not (safe-token? ticket) (reject! :invalid-request))
    (let [entry (entry! state ticket)
          control (:control entry)]
      (current-writer! state entry (:writer-generation request))
      (expected-revision! entry (:expected-revision request))
      ;; The runner identity may only tighten: never back to run, never out of
      ;; an owner-visible cancel.
      (when-not (contains? restrictive-intents intent) (reject! :forbidden))
      (when (= "cancel" (:intent control)) (reject! :forbidden))
      (when (= intent (:intent control)) (reject! :invalid-request))
      (let [control (validated-control!
                     store (assoc control :intent intent :revision (inc (:revision control))))]
        (event-for actor :restrict-intent ticket (dec (:revision control))
                   (assoc entry :control control))))))

(defmethod handle :consume-budget [_ state actor request]
  (require-role! actor #{:runner})
  (require-keys! request #{:op :ticket :writer-generation :idempotency-key :steps :wall_minutes}
                 #{:expected-revision})
  (let [{:keys [ticket steps wall_minutes]} request
        key (:idempotency-key request)]
    (when-not (and (safe-token? ticket) (safe-token? key)
                   (integer? steps) (<= 0 steps 6)
                   (integer? wall_minutes) (<= 0 wall_minutes 1440)
                   (pos? (+ steps wall_minutes)))
      (reject! :invalid-request))
    (let [entry (entry! state ticket)
          control (:control entry)
          consumed (:consumed entry)]
      (current-writer! state entry (:writer-generation request))
      (if (contains? (:idempotency-keys entry) key)
        ::duplicate
        (do
          ;; Reserving a step is a start decision: it is bound to the revision
          ;; snapshot, a run intent and the remaining budget. Elapsed wall time
          ;; of an already started step is always recorded.
          (when (pos? steps)
            (expected-revision! entry (:expected-revision request))
            (when-not (= "run" (:intent control)) (reject! :forbidden))
            (when (or (> (+ (:steps consumed) steps) (get-in control [:budget :max_steps]))
                      (>= (:wall_minutes consumed) (get-in control [:budget :max_wall_minutes])))
              (reject! :budget-exceeded)))
          (event-for actor :consume-budget ticket (:revision control)
                     (-> entry
                         (update-in [:consumed :steps] + steps)
                         (update-in [:consumed :wall_minutes] + wall_minutes)
                         (update :idempotency-keys conj key))))))))

(defn request!
  "Apply one authenticated mutation with CAS semantics. request is a map with
  :op and the op's exact keys; unknown keys are rejected."
  [store credential request]
  (locked
   store
   (fn []
     (let [log (load-log store)
           state (:state log)
           actor (actor! store credential)
           _ (when-not (and (map? request) (keyword? (:op request))) (reject! :invalid-request))
           event (handle store state actor request)]
       (if (= ::duplicate event)
         (ok {:duplicate? true
              :revision (get-in state [:tickets (:ticket request) :control :revision])
              :generation (:generation state)})
         (let [event (append-event! store log event)]
           (ok {:event-id (:event-id event)
                :revision (:revision event)
                :generation (or (:generation event) (:generation state))})))))))

;; --- reads --------------------------------------------------------------------

(defn- high-water! [observed minimum]
  ;; A client that has seen a newer value refuses a store that reports less.
  (when (and (some? minimum) (< observed minimum)) (reject! :rollback-detected)))

(defn read-control
  "The control original for ticket. min-revision/min-generation are the caller's
  persisted high-water marks."
  ([store credential ticket] (read-control store credential ticket {}))
  ([store credential ticket {:keys [min-revision min-generation]}]
   (locked
    store
    (fn []
      (let [state (:state (load-log store))]
        (actor! store credential)
        (high-water! (:generation state) min-generation)
        (let [entry (entry! state ticket)]
          (high-water! (get-in entry [:control :revision]) min-revision)
          (ok {:control (:control entry)
               :revision (get-in entry [:control :revision])
               :generation (:generation state)
               :budget-epoch (:budget-epoch entry)
               :consumed (:consumed entry)})))))))

(defn verify-writer
  "True only when generation is the store's current writer generation."
  [store credential {:keys [generation min-generation]}]
  (locked
   store
   (fn []
     (let [state (:state (load-log store))]
       (require-role! (actor! store credential) #{:owner :runner})
       (high-water! (:generation state) min-generation)
       (when-not (and (pos-int? generation) (= generation (:generation state)))
         (reject! :stale-generation))
       (ok {:generation (:generation state)})))))

(defn authorize-write
  "Fencing check before a start or a vault write for ticket: current generation
  and an unchanged control revision. It reads the original, not a projection."
  [store credential {:keys [ticket expected-revision writer-generation
                            min-revision min-generation]}]
  (locked
   store
   (fn []
     (let [state (:state (load-log store))]
       (require-role! (actor! store credential) #{:owner :runner})
       (high-water! (:generation state) min-generation)
       (let [entry (entry! state ticket)]
         (high-water! (get-in entry [:control :revision]) min-revision)
         (current-writer! state entry writer-generation)
         (expected-revision! entry expected-revision)
         (ok {:revision (get-in entry [:control :revision])
              :generation (:generation state)}))))))

(def ^:private audit-keys
  [:seq :event-id :at :op :ticket :actor-subject :actor-role
   :previous-revision :revision :generation])

(defn events
  "Audit read of the append-only event log (owner and runner identities only).
  Only attribution metadata is returned; the stored control, including the
  requirements snapshot, is never part of the audit view."
  [store credential]
  (locked
   store
   (fn []
     (let [log (load-log store)]
       (require-role! (actor! store credential) #{:owner :runner})
       (ok {:events (mapv #(select-keys % audit-keys) (:events log))})))))

;; --- projection and objective checks -------------------------------------------

(defn verify-projection
  "Compare the agent-writable ticket frontmatter projection with the control
  original. A match grants nothing; a mismatch must stop a start."
  [control frontmatter]
  (if (and (map? control) (map? frontmatter)
           (= "2" (get frontmatter "autonomy_version"))
           (= (:intent control) (get frontmatter "execution_intent"))
           (= (str (:revision control)) (get frontmatter "control_revision")))
    (ok {})
    (failed :conflict)))

(defn objective-matches?
  "True when requirements is byte-identical to the owner's snapshot."
  [control requirements]
  (and (string? requirements)
       (= requirements (get-in control [:objective :requirements]))
       (= (policy/sha256 requirements) (get-in control [:objective :requirements_sha256]))))
