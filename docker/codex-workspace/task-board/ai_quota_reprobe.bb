#!/usr/bin/env bb

;; BOXP-708: re-observe a held provider usage limit.
;;
;; A route held by a rejected limit starts no run, and only a run produced the
;; next rate_limit_event, so a limit restored before its reset (a reset ticket)
;; was never seen and the hold lasted until the old reset time (BOXP-707).
;; While a route is held, this sends one minimal request on the official claude
;; CLI (no tools, no MCP, no hooks, no session, empty temp dir) and records the
;; rate_limit_event with the same function as a run. Never hand-written: the
;; snapshot changes only through ai-subscription-usage/record-claude-run-rate-limit!.
;;
;; The current spec is Projects/task-board-provider-quota/spec.md in the vault.
;; Frequency is finite: per hold key (route + limits + reset) the attempts back
;; off as min(base * 2^n, cap) from the later of the last attempt and the
;; rejection's own observation, stop at max-attempts, and stop within margin of
;; the reset. The claim is written under a file lock before the CLI starts, so
;; several runner processes start at most one probe. The Owner entry (force?)
;; skips the interval, the budget and the margin, but still needs a hold, a 60s
;; gap and no probe in flight.

(ns ai-quota-reprobe
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def probe-prompt "Reply with OK only.")
(def probe-timeout-ms 120000)
;; A claim still marked running after this long belongs to a process that died.
(def running-stale-seconds 600)
(def result-enums #{"allowed" "rejected" "no_event" "failed" "timeout" "missing" "running"})
;; Variables that could move the probe off the subscription login onto an API
;; key or another provider (same list as the model-update canary).
(def stripped-env-keys ["ANTHROPIC_API_KEY" "ANTHROPIC_AUTH_TOKEN" "ANTHROPIC_BASE_URL" "ANTHROPIC_CUSTOM_HEADERS"
                        "CLAUDE_CODE_USE_BEDROCK" "CLAUDE_CODE_USE_VERTEX" "CLAUDE_CODE_USE_FOUNDRY"])

(defn probe-env [env] (apply dissoc (into {} env) stripped-env-keys))

(defn- env-long [env k default floor]
  (let [v (some-> (get env k) str/trim parse-long)]
    (if (number? v) (max floor v) default)))

(defn config-from-env
  ([] (config-from-env (into {} (System/getenv))))
  ([env]
   {:enabled? (not= "off" (get env "CODEX_TASK_BOARD_QUOTA_REPROBE" "on"))
    :base-s (env-long env "CODEX_TASK_BOARD_QUOTA_REPROBE_BASE_SECONDS" 1800 600)
    :cap-s 21600
    :max-attempts (env-long env "CODEX_TASK_BOARD_QUOTA_REPROBE_MAX_ATTEMPTS" 40 1)
    :margin-s 900
    :force-gap-s 60}))

(defn hold-key
  "Route + the limits that hold it + its reset. A new key restarts the count."
  [{:keys [route limits resets-at]}]
  (str route "/" (str/join "," (sort limits)) "/" (or resets-at "unknown")))

(defn hold-observed-at
  "When the rejection that holds the route was observed, or nil."
  [{:keys [windows]}]
  (some->> windows (filter #(= :exhausted (:state %))) (keep :observed-at) seq (apply max)))

(defn decide
  "{:decision :probe|:wait|:skip :reason kw}. entry is this route's record in the
  state file. Pure: the clock and the config come in as arguments."
  [{:keys [status entry now-s config force?]}]
  (let [{:keys [enabled? base-s cap-s max-attempts margin-s force-gap-s]} config
        k (when status (hold-key status))
        same? (and entry (= k (:hold_key entry)))
        attempts (if same? (or (:attempts entry) 0) 0)
        last-at (:last_attempt_at entry)
        running? (and (= "running" (:last_result entry)) (number? last-at)
                      (< (- now-s last-at) running-stale-seconds))
        resets-at (:resets-at status)
        out (fn [d r] {:decision d :reason r :hold-key k :attempts attempts})]
    (cond
      (and (not force?) (not enabled?)) (out :skip :disabled)
      (not= :hold (:decision status)) (out :skip :not-held)
      running? (out :skip :in-flight)
      force? (if (and (number? last-at) (< (- now-s last-at) force-gap-s))
               (out :skip :too-soon)
               (out :probe :forced))
      (and (number? resets-at) (<= (- resets-at now-s) margin-s)) (out :skip :near-reset)
      (>= attempts max-attempts) (out :skip :budget-spent)
      :else
      (let [since (->> [(when same? last-at) (hold-observed-at status)] (filter number?) seq)
            interval (min cap-s (* base-s (bit-shift-left 1 (min attempts 20))))]
        (if (and since (< (- now-s (apply max since)) interval))
          (out :wait :interval)
          (out :probe :due))))))

(defn probe-args [bin model]
  [bin "--print" "--output-format" "stream-json" "--verbose"
   "--model" model
   "--tools" ""
   "--strict-mcp-config"
   "--disable-slash-commands"
   "--no-session-persistence"
   "--settings" "{\"disableAllHooks\":true}"])

(defn call-cli
  "Run the probe once. Returns {:exit :out}, {:timeout true} or {:missing true}."
  [args]
  (if-not (fs/which (first args))
    {:missing true}
    (let [dir (fs/create-temp-dir {:prefix "quota-reprobe-"})]
      (try
        (let [proc (p/process args {:in probe-prompt :out :string :err :string :dir (str dir)
                                    :env (probe-env (System/getenv))})
              done (deref proc probe-timeout-ms ::timeout)]
          (if (= ::timeout done)
            (do (p/destroy-tree proc) {:timeout true})
            {:exit (:exit done) :out (:out done)}))
        (finally (fs/delete-tree dir))))))

(defn rate-limit-events [out]
  (->> (str/split-lines (or out ""))
       (filter #(str/includes? % "rate_limit_event"))
       (keep #(try (let [e (json/parse-string % true)] (when (= "rate_limit_event" (:type e)) e))
                   (catch Exception _ nil)))))

(defn classify
  "One enum from the probe output: the status of its last rate_limit_event."
  [{:keys [timeout missing out exit]}]
  (cond
    timeout "timeout"
    missing "missing"
    :else (let [status (some-> (rate-limit-events out) last :rate_limit_info :status)]
            (cond
              (#{"allowed" "allowed_warning"} status) "allowed"
              (= "rejected" status) "rejected"
              (and (nil? status) (= 0 exit)) "no_event"
              :else "failed"))))

(defn state-path [root] (fs/path root "ai-ops/subscription/claude-reprobe.json"))

(defn read-state [root]
  (let [path (state-path root)]
    (or (when (fs/exists? path)
          (try (let [v (json/parse-string (slurp (str path)) true)] (when (map? v) v))
               (catch Exception _ nil)))
        {})))

(defn write-state! [root state]
  ((resolve 'ai-subscription-usage/atomic-write!) (state-path root) (json/generate-string state)))

(defn- with-state-lock [root thunk]
  ((resolve 'ai-subscription-usage/with-snapshot-file-lock) (state-path root) thunk))

(defn claim!
  "Decide under the file lock; on :probe write the attempt before the CLI starts."
  [root route status now-s config force?]
  (with-state-lock root
    (fn []
      (let [state (read-state root)
            entry (get-in state [:routes (keyword route)])
            d (decide {:status status :entry entry :now-s now-s :config config :force? force?})]
        (when (= :probe (:decision d))
          (write-state! root (assoc-in state [:routes (keyword route)]
                                       {:hold_key (:hold-key d) :attempts (inc (:attempts d))
                                        :last_attempt_at now-s :last_result "running"})))
        d))))

(defn- finish! [root route hold-key now-s result]
  (with-state-lock root
    (fn []
      (let [state (read-state root)
            entry (get-in state [:routes (keyword route)])]
        (when (and (= hold-key (:hold_key entry)) (= now-s (:last_attempt_at entry)))
          (write-state! root (assoc-in state [:routes (keyword route) :last_result]
                                       (if (result-enums result) result "failed"))))))))

(defn reprobe!
  "Claim, probe once and record. Returns the decision, with :result when probed.
  scope is the login fixed before the CLI starts, as for a run."
  [{:keys [root route model status now-s config force? scope call bin]}]
  (let [d (claim! root route status now-s config force?)]
    (if-not (= :probe (:decision d))
      d
      (let [out (try ((or call call-cli) (probe-args (or bin "claude") model))
                     (catch Exception _ {:exit -1 :out ""}))
            recorded (doall (for [e (rate-limit-events (:out out))]
                              (try ((resolve 'ai-subscription-usage/record-claude-run-rate-limit!)
                                    root e (System/currentTimeMillis) scope)
                                   (catch Exception _ false))))
            result (if (and (seq recorded) (not-any? true? recorded)) "failed" (classify out))]
        (finish! root route (:hold-key d) now-s result)
        (assoc d :result result :attempts (inc (:attempts d)))))))
