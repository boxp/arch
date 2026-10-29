#!/usr/bin/env bb

;; AI ops ledger (BOXP-360 Plan A stage 1).
;;
;; The runner appends one metadata-only `ai-ops-event/v0` JSON line per run
;; lifecycle fact (start / review-gate correction / finish / lane / planned
;; interruption) to `<root>/ai-ops/ledger/events-YYYY-MM-DD.jsonl`. The schema
;; and the aggregation live in docs/project_docs/BOXP-360/tools/ai_ops_sli.bb.
;;
;; Privacy gate at the source: only allowlisted keys with enum-bounded values,
;; fixed-format IDs and bounded integers are written. Titles, PR URLs, paths,
;; messages, diagnostics, prompts and credentials never reach this module's
;; output. An event with an invalid ID is replaced by a body-less marker line.
;;
;; Observation must never stop work: `emit!` and `write-metrics!` swallow every
;; exception, the day file is capped, and every loss (cap / privacy / write
;; error) is counted in `<root>/ai-ops/ledger-stats.edn` and exported through
;; `<root>/ai-ops/metrics.prom` (low-cardinality labels only, no IDs).

(ns ai-ops-ledger
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.string :as str]))

(def schema-version "ai-ops-event/v0")
(def definition-version "ledger/v1")

(def allowed-keys
  #{:schema_version :event_id :request_id :task_id :run_id :source :runtime :agent
    :event_type :occurred_at :observed_at :occurred_precision :lane_from :lane_to
    :status :result :action :exit_code :idle_timeout :blocker_category
    :correction_class :correction_origin :classifier :classifier_version :confidence
    :evidence_event_ids :cost_source})

(def enum-values
  {:schema_version #{schema-version}
   :source #{"task-board-runner"}
   :event_type #{"run.started" "run.finished" "run.interrupted" "lane.changed" "correction"}
   :runtime #{"codex-cli" "claude-cli" "localllm" "unknown"}
   :agent #{"codex" "codex-terra" "codex-sol" "codex-full" "codex-mini" "codex-astra"
            "claude-fable" "claude-opus" "claude-sonnet" "fable" "localllm"}
   :action #{"implement" "groom" "review-fix" "blocked-retry" "docs-edit" "docs-groom"}
   :status #{"succeeded" "retrying" "blocked" "interrupted" "failed" "running" "superseded"}
   :result #{"review" "blocked" "done" "ready"}
   :lane_from #{"ready" "review" "blocked" "backlog" "in-progress" "done"}
   :lane_to #{"ready" "review" "blocked" "backlog" "in-progress" "done"}
   :occurred_precision #{"ns"}
   :blocker_category #{"external" "agent-reported-blocked" "agent-process-error" "pr-gate-pr-url"}
   :correction_class #{"gate_defect" "unknown"}
   :correction_origin #{"agent-system" "unknown"}
   :classifier #{"rule"}
   :classifier_version #{"correction-rules/v0"}
   :confidence #{"high" "medium" "low"}
   :cost_source #{"unknown"}})

(def gate-names #{"all" "ci" "mergeability" "conflict" "codex-review" "pr-url" "pr-gate"})

(def task-id-re #"[A-Z]+-\d+")
(def run-id-re
  #"\d{8}T\d{6}Z(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-[0-9a-f]{1,8})?(?:-groom)?")
(def event-words #{"started" "finished" "interrupted" "correction" "lane" "lane-start"})

(defn event-id [task-id run-id word]
  (str task-id "/" run-id ":ledger:" word))

(defn valid-event-id? [{:keys [event_id task_id run_id]}]
  (and (string? event_id)
       (some (fn [w] (= event_id (event-id task_id run_id w))) event-words)))

(defn valid-ids? [{:keys [task_id run_id request_id] :as e}]
  (and (string? task_id) (re-matches task-id-re task_id)
       (string? run_id) (re-matches run-id-re run_id)
       (= request_id (str "req:" task_id))
       (valid-event-id? e)
       (every? #(and (string? %) (some (fn [w] (= % (event-id task_id run_id w))) event-words))
               (:evidence_event_ids e))))

(defn instant-string? [v]
  (and (string? v) (try (java.time.Instant/parse v) true (catch Exception _ false))))

(defn valid-value? [k v]
  (cond
    (contains? enum-values k) (contains? (enum-values k) v)
    (#{:occurred_at :observed_at} k) (instant-string? v)
    (= :exit_code k) (and (integer? v) (<= -255 v 255))
    (= :idle_timeout k) (boolean? v)
    ;; IDs are checked as a whole by `valid-ids?`.
    (#{:event_id :request_id :task_id :run_id :evidence_event_ids} k) true
    :else false))

(defn gate
  "Apply the source privacy gate. Returns [event-or-nil redacted-count]."
  [event]
  (let [selected (select-keys event allowed-keys)
        kept (into {} (filter (fn [[k v]] (and (some? v) (valid-value? k v)))) selected)
        redacted (- (count (filter (comp some? val) selected)) (count kept))]
    [(when (and (valid-ids? kept) (contains? kept :event_type)) kept) redacted]))

;; ---------------------------------------------------------------------------
;; storage

(def ledger-mutex (java.util.concurrent.locks.ReentrantLock.))
;; Write errors that could not be persisted to stats (e.g. lock timeout); rendered into metrics.
(def unrecorded-write-errors (atom 0))

(defn ai-ops-dir [root] (fs/path root "ai-ops"))
(defn lock-path [root] (fs/path (ai-ops-dir root) "ledger.lock"))

(defn lock-timeout-ms []
  (try (Long/parseLong (or (System/getenv "CODEX_TASK_BOARD_AI_OPS_LEDGER_LOCK_TIMEOUT_MS") ""))
       (catch Exception _ 2000)))

(defn with-ledger-lock
  "Serialize ledger/stats/metrics writes across threads (ReentrantLock) and
  across processes sharing the root (runner `loop`, manual `tick`, helper
  commands) with an exclusive FileLock on `<root>/ai-ops/ledger.lock`. Both
  waits are bounded by `lock-timeout-ms`; on timeout this throws ex-info."
  [root f]
  (when-not (.tryLock ledger-mutex (lock-timeout-ms) java.util.concurrent.TimeUnit/MILLISECONDS)
    (throw (ex-info "ai-ops ledger lock timeout" {:root (str root)})))
  (try
    (fs/create-dirs (ai-ops-dir root))
    (with-open [file (java.io.RandomAccessFile. (str (lock-path root)) "rw")
                channel (.getChannel file)]
      ;; Bounded wait: a holder that hangs must not stall runner lifecycle
      ;; work. On timeout we throw and callers count it as a write error / drop.
      (let [deadline (+ (System/currentTimeMillis) (lock-timeout-ms))
            _file-lock (loop []
                         (or (.tryLock channel)
                             (if (< (System/currentTimeMillis) deadline)
                               (do (Thread/sleep 20) (recur))
                               (throw (ex-info "ai-ops ledger lock timeout" {:root (str root)})))))]
        ;; Closing the channel releases the lock.
        (f)))
    (finally (.unlock ledger-mutex))))
(defn ledger-dir [root] (fs/path (ai-ops-dir root) "ledger"))
(defn stats-path [root] (fs/path (ai-ops-dir root) "ledger-stats.edn"))
(defn metrics-path [root] (fs/path (ai-ops-dir root) "metrics.prom"))

(defn env-long [k default]
  (try (Long/parseLong (or (System/getenv k) "")) (catch Exception _ default)))

(defn enabled? []
  (not= "false" (System/getenv "CODEX_TASK_BOARD_AI_OPS_LEDGER_ENABLED")))

(defn max-bytes [] (env-long "CODEX_TASK_BOARD_AI_OPS_LEDGER_MAX_BYTES" 8388608))
(defn retention-days [] (env-long "CODEX_TASK_BOARD_AI_OPS_LEDGER_RETENTION_DAYS" 90))

(defn day-file [root]
  (fs/path (ledger-dir root) (str "events-" (java.time.LocalDate/now java.time.ZoneOffset/UTC) ".jsonl")))

(defn read-stats [root]
  (let [p (stats-path root)]
    (or (try (when (fs/exists? p) (edn/read-string (slurp (str p)))) (catch Exception _ nil)) {})))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path)
                 (str "." (fs/file-name path) "." (.pid (java.lang.ProcessHandle/current))
                      "." (.getId (Thread/currentThread)) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn update-stats! [root f]
  (atomic-spit! (stats-path root) (str (pr-str (f (read-stats root))) "\n")))

(defn count-in [stats ks] (update-in stats ks (fnil inc 0)))

(defn record-written [stats e]
  (cond-> (-> stats
              (count-in [:emitted])
              (count-in [:by-type (:event_type e)])
              (assoc :last-emit-at (str (java.time.Instant/now))))
    (= "run.finished" (:event_type e))
    (count-in [:run-finished [(:runtime e "unknown") (:status e "unknown")]])
    (= "correction" (:event_type e))
    (count-in [:corrections [(:correction_origin e "unknown") (:correction_class e "unknown")]])))

(defn append-line! [path m]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (json/generate-string m) "\n") :append true))

(defn emit!
  "Append one gated event. Never throws; returns the written event or nil."
  [root event]
  (when (enabled?)
    (try
      (with-ledger-lock
       root
       (fn []
        (let [[pending _] (reset-vals! unrecorded-write-errors 0)
              _ (when (pos? pending)
                  (update-stats! root #(update % :write-errors (fnil + 0) pending)))
              now (str (java.time.Instant/now))
              [e redacted] (gate (merge {:schema_version schema-version
                                         :source "task-board-runner"
                                         :occurred_at now
                                         :occurred_precision "ns"
                                         :cost_source "unknown"}
                                        event
                                        {:observed_at now}))
              path (day-file root)
              full? (and (fs/exists? path) (>= (fs/size path) (max-bytes)))]
          (cond
            full?
            (do (update-stats! root #(-> % (count-in [:dropped-full])
                                         (update :redacted-values (fnil + 0) redacted)))
                nil)

            (nil? e)
            (do (append-line! path (cond-> {:privacy_rejected "upstream"}
                                     (contains? (:event_type enum-values) (:event_type event))
                                     (assoc :event_type (:event_type event))))
                (update-stats! root #(-> % (count-in [:rejected-privacy])
                                         (update :redacted-values (fnil + 0) redacted)))
                nil)

            :else
            (do (append-line! path e)
                (update-stats! root #(-> (record-written % e)
                                         (update :redacted-values (fnil + 0) redacted)))
                e)))))
      (catch Exception _
        (try (with-ledger-lock root #(update-stats! root (fn [s] (count-in s [:write-errors]))))
             (catch Exception _ (swap! unrecorded-write-errors inc)))
        nil))))

(def gate-results #{"pass" "fail" "skip"})

(defn record-gate!
  "Count one review-gate evaluation by gate name and result (pass / fail /
  skip; a boolean is read as pass / fail). Never throws."
  [root gate-name result]
  (when (enabled?)
    (try
      (with-ledger-lock
       root
       #(update-stats! root (fn [s]
                              (count-in s [:gate [(if (contains? gate-names gate-name) gate-name "other")
                                                  (cond (true? result) "pass"
                                                        (contains? gate-results result) result
                                                        :else "fail")]]))))
      (catch Exception _ nil))))

;; ---------------------------------------------------------------------------
;; metrics

(defn label-value [s] (str/replace (str s) #"[\\\"\n]" "_"))

(defn labels [m]
  (str "{" (str/join "," (map (fn [[k v]] (str (name k) "=\"" (label-value v) "\"")) m)) "}"))

(defn metric-lines [name type help samples]
  (concat [(str "# HELP " name " " help) (str "# TYPE " name " " type)]
          (map (fn [[ls v]] (str name (when (seq ls) (labels ls)) " " v)) samples)))

(defn instant-seconds [s]
  (try (quot (.toEpochMilli (java.time.Instant/parse s)) 1000) (catch Exception _ nil)))

(defn metrics-text [stats now-seconds]
  (let [sorted (fn [m] (sort-by (comp str key) m))]
    (str
     (str/join
      "\n"
      (concat
       (metric-lines "ai_ops_ledger_info" "gauge" "AI ops ledger schema and definition versions."
                     [[{:schema_version schema-version :definition_version definition-version} 1]])
       (metric-lines "ai_ops_ledger_events_total" "counter" "Ledger events written by event type."
                     (for [t (sort (:event_type enum-values))] [{:event_type t} (get-in stats [:by-type t] 0)]))
       (metric-lines "ai_ops_ledger_lost_events_total" "counter" "Events not written to the ledger by reason."
                     [[{:reason "file_full"} (:dropped-full stats 0)]
                      [{:reason "privacy_rejected"} (:rejected-privacy stats 0)]
                      [{:reason "write_error"} (:write-errors stats 0)]])
       (metric-lines "ai_ops_ledger_redacted_values_total" "counter" "Field values removed by the source privacy gate."
                     [[{} (:redacted-values stats 0)]])
       (metric-lines "ai_ops_runs_finished_total" "counter" "Finished runs by runtime and summary status."
                     (for [[[rt st] n] (sorted (:run-finished stats))] [{:runtime rt :status st} n]))
       (metric-lines "ai_ops_review_gate_total" "counter" "Review gate evaluations by gate and result."
                     (for [[[g r] n] (sorted (:gate stats))] [{:gate g :result r} n]))
       (metric-lines "ai_ops_corrections_total" "counter" "Rule-classified corrections (provisional) by origin and class."
                     (for [[[o c] n] (sorted (:corrections stats))] [{:origin o :class c} n]))
       (when-let [s (some-> (:last-emit-at stats) instant-seconds)]
         (metric-lines "ai_ops_ledger_last_emit_timestamp_seconds" "gauge" "Time of the last ledger write." [[{} s]]))
       (metric-lines "ai_ops_metrics_generated_timestamp_seconds" "gauge" "Time this exposition was generated."
                     [[{} now-seconds]])))
     "\n")))

(defn prune! [root]
  (let [cutoff (.minusDays (java.time.LocalDate/now java.time.ZoneOffset/UTC) (retention-days))]
    (doseq [f (fs/glob (ledger-dir root) "events-*.jsonl")
            :let [d (second (re-matches #"events-(\d{4}-\d{2}-\d{2})\.jsonl" (str (fs/file-name f))))]
            :when (and d (.isBefore (java.time.LocalDate/parse d) cutoff))]
      (fs/delete-if-exists f))))

(defn write-metrics!
  "Write `<root>/ai-ops/metrics.prom` from the stats and prune old ledger files.
  Never throws; returns true on success."
  [root]
  (when (enabled?)
    (try
      (with-ledger-lock
       root
       (fn []
         (when (fs/exists? (ledger-dir root)) (prune! root))
         (atomic-spit! (metrics-path root)
                       (metrics-text (read-stats root) (quot (System/currentTimeMillis) 1000)))
         true))
      (catch Exception _ nil))))
