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
;; error) is counted in `<root>/ai-ops/ledger-stats.edn` (and leaves a body-less
;; `ledger_dropped` marker in the day file for the aggregation) and exported through
;; `<root>/ai-ops/metrics.prom` (low-cardinality labels only, no IDs).

(ns ai-ops-ledger
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.java.io :as io]
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
   :runtime #{"codex-cli" "claude-cli" "localllm" "localllm-coder" "unknown"}
   :agent #{"codex" "codex-terra" "codex-sol" "codex-full" "codex-mini" "codex-astra"
            "claude-fable" "claude-opus" "claude-sonnet" "fable" "localllm" "localllm-coder"}
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

(def reasoning-suffix-re #"(.+)-(minimal|low|medium|high|xhigh)")
;; Claude model IDs (e.g. `claude-opus-5-5`) used in place of the route name.
(def claude-model-re #"(claude-(?:fable|opus|sonnet))-\d+(?:-\d+)*")

(defn normalize-agent
  "Map a runner assignee with a reasoning-level suffix (e.g. `codex-sol-xhigh`)
  or a versioned Claude model ID (e.g. `claude-opus-5-5`) to its allowlisted
  base assignee so per-agent analysis keeps the value."
  [agent]
  (if (and (string? agent) (not (contains? (:agent enum-values) agent)))
    (let [unsuffixed (or (second (re-matches reasoning-suffix-re agent)) agent)
          base (or (second (re-matches claude-model-re unsuffixed)) unsuffixed)]
      (if (contains? (:agent enum-values) base) base agent))
    agent))

(defn gate
  "Apply the source privacy gate. Returns [event-or-nil redacted-count]."
  [event]
  (let [selected (cond-> (select-keys event allowed-keys)
                   (contains? event :agent) (update :agent normalize-agent))
        kept (into {} (filter (fn [[k v]] (and (some? v) (valid-value? k v)))) selected)
        redacted (- (count (filter (comp some? val) selected)) (count kept))]
    [(when (and (valid-ids? kept) (contains? kept :event_type)) kept) redacted]))

;; ---------------------------------------------------------------------------
;; storage

(def ledger-mutex (java.util.concurrent.locks.ReentrantLock.))
;; Write errors that could not be persisted to stats (e.g. lock timeout); rendered into metrics.
(def unrecorded-write-errors (atom 0))
;; Subset of those that lost a ledger event (not just a gate count), keyed by
;; the UTC date of the loss: the next lock holder must also leave a lost marker
;; in that date's day file (not the flush date's) for them.
(def unrecorded-lost-events (atom {}))

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

(defn utc-date [] (str (java.time.LocalDate/now java.time.ZoneOffset/UTC)))

(defn day-file
  ([root] (day-file root (utc-date)))
  ([root date] (fs/path (ledger-dir root) (str "events-" date ".jsonl"))))

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

;; Write errors that happen while the lock is unavailable are spooled as one
;; empty marker file each under `<root>/ai-ops/pending-write-errors/`. Creating
;; a uniquely named file needs no lock, so the loss survives a short-lived
;; process (manual `tick`, helper command) that exits before any flush, and the
;; next lock holder in any process folds it into the stats.
(defn pending-write-errors-dir [root] (fs/path (ai-ops-dir root) "pending-write-errors"))

(def lost-event-spool-prefix "event-")

(defn lost-event-spool-date
  "UTC date (yyyy-MM-dd) of the loss recorded in a lost-event spool name
  (`event-<date>-...`); nil for a gate spool. Legacy names without a date fall
  back to the flush date."
  [name]
  (when (str/starts-with? name lost-event-spool-prefix)
    (or (second (re-find #"^event-(\d{4}-\d{2}-\d{2})-" name)) (utc-date))))

(defn spool-write-error!
  "Record one write error that could not be persisted to stats. Never throws;
  falls back to the in-process counter when the spool file cannot be created.
  `kind` :event marks a lost ledger event, so the flush also appends the lost
  marker to the day file under the lock (never outside it)."
  ([root] (spool-write-error! root :gate))
  ([root kind] (spool-write-error! root kind (utc-date)))
  ([root kind date]
   (try
     (fs/create-dirs (pending-write-errors-dir root))
     (fs/create-file (fs/path (pending-write-errors-dir root)
                              (str (when (= :event kind) (str lost-event-spool-prefix date "-"))
                                   (.pid (java.lang.ProcessHandle/current)) "-" (System/nanoTime) "-" (random-uuid))))
     (catch Exception _
       (swap! unrecorded-write-errors inc)
       (when (= :event kind) (swap! unrecorded-lost-events update date (fnil inc 0)))))))

(declare append-lost-marker!)

;; A lost-event marker that could not be appended during a flush is kept as one
;; persistent obligation file per loss date under
;; `<root>/ai-ops/pending-lost-markers/<date>`, so the marker is still written
;; by a later lock holder even if this (short-lived) process exits first. The
;; write-error count is tracked separately and is not affected.
(defn pending-lost-markers-dir [root] (fs/path (ai-ops-dir root) "pending-lost-markers"))

(defn- pending-marker-dates [root]
  (let [dir (pending-lost-markers-dir root)]
    (if (fs/exists? dir)
      (->> (fs/list-dir dir)
           (map #(str (fs/file-name %)))
           (filter #(re-matches #"\d{4}-\d{2}-\d{2}" %))
           set)
      #{})))

(defn- keep-pending-marker! [root date]
  (try
    (fs/create-dirs (pending-lost-markers-dir root))
    (let [f (fs/path (pending-lost-markers-dir root) date)]
      (when-not (fs/exists? f) (fs/create-file f)))
    (catch Exception _
      (swap! unrecorded-lost-events update date (fnil inc 0)))))

(defn- drop-pending-marker! [root date]
  (try (fs/delete-if-exists (fs/path (pending-lost-markers-dir root) date))
       (catch Exception _ nil)))

(defn flush-unrecorded-write-errors!
  "Persist write errors counted while the lock was unavailable (spool files from
  any process plus this process's fallback counter). Call with the ledger lock
  held. Crash-safe and exactly-once: the stats update atomically adds the count
  of not-yet-consumed spool files and records their names in
  `:consumed-write-error-spool`; files are deleted only afterwards. A crash
  before the stats update leaves the files to be counted by the next flush, and
  a crash (or delete failure) after it leaves files already listed as consumed,
  which are deleted without being counted again."
  [root]
  (let [dir (pending-write-errors-dir root)
        files (if (fs/exists? dir) (vec (fs/list-dir dir)) [])
        names (set (map #(str (fs/file-name %)) files))
        consumed (set (:consumed-write-error-spool (read-stats root)))
        fresh-names (remove consumed names)
        fresh (count fresh-names)
        fresh-lost (frequencies (keep lost-event-spool-date fresh-names))
        [pending _] (reset-vals! unrecorded-write-errors 0)
        [pending-lost _] (reset-vals! unrecorded-lost-events {})
        total (+ pending fresh)]
    ;; Lost events recorded outside the lock get their marker here, with the
    ;; lock held, so it never races a normal append. A crash before the stats
    ;; update may repeat the marker; one marker is enough and counts stay exact.
    ;; Each marker goes to the day file of the loss date so that aggregating
    ;; only that day still sees the gap.
    ;; A failed append keeps a persistent obligation (pending-lost-markers)
    ;; before the spool files are deleted below, so the marker is not lost when
    ;; this process exits before the write recovers.
    (doseq [date (into (pending-marker-dates root)
                       (keys (into {} (filter (comp pos? val))
                                   (merge-with + pending-lost fresh-lost))))]
      (if (append-lost-marker! (day-file root date))
        (drop-pending-marker! root date)
        (keep-pending-marker! root date)))
    (when (or (pos? total) (not= consumed names))
      (try (update-stats! root #(-> %
                                    (update :write-errors (fnil + 0) total)
                                    (assoc :consumed-write-error-spool names)))
           (catch Exception e (swap! unrecorded-write-errors + pending) (throw e))))
    (doseq [f files] (try (fs/delete-if-exists f) (catch Exception _ nil)))))

(defn append-line! [path m]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (json/generate-string m) "\n") :append true))

;; A lost event (cap reached / write error) leaves one body-less marker line
;; `{"collection_lost":"ledger_dropped"}` in the day file so that aggregating
;; the ledger (ai_ops_sli.bb) sees the gap and reports affected SLIs as unknown
;; instead of complete. Markers may exceed the cap only by a bounded headroom;
;; one marker is enough to make the day unknown and exact counts stay in stats.
(def lost-marker {:collection_lost "ledger_dropped"})
(def marker-headroom-bytes 65536)

(def lost-marker-line (json/generate-string lost-marker))

(defn- has-lost-marker? [path]
  (with-open [r (io/reader (str path))]
    (boolean (some #(= lost-marker-line %) (line-seq r)))))

(defn append-lost-marker!
  "Best-effort marker append. Never throws; returns true when written (or when
  the headroom is used up and a marker is verifiably present in the file) and
  false when the append failed. The headroom alone is not proof of a marker:
  lowering the cap can leave a marker-less file above cap + headroom, so the
  file is checked and the marker is appended (one line past the headroom) when
  missing."
  [path]
  (try
    (when (or (not (fs/exists? path))
              (< (fs/size path) (+ (max-bytes) marker-headroom-bytes))
              (not (has-lost-marker? path)))
      (append-line! path lost-marker))
    true
    (catch Exception _ false)))

(defn- mark-lost!
  "Append the lost-event marker for `date` (call with the lock held). A failed
  append leaves a pending-lost-markers obligation so a later flush retries it,
  even when the stats update that follows succeeds."
  [root date]
  (when-not (append-lost-marker! (day-file root date))
    (keep-pending-marker! root date)))

(defn emit!
  "Append one gated event. Never throws; returns the written event or nil."
  [root event]
  (when (enabled?)
    (try
      (with-ledger-lock
       root
       (fn []
        (let [_ (flush-unrecorded-write-errors! root)
              now (str (java.time.Instant/now))
              [e redacted] (gate (merge {:schema_version schema-version
                                         :source "task-board-runner"
                                         :occurred_at now
                                         :occurred_precision "ns"
                                         :cost_source "unknown"}
                                        event
                                        {:observed_at now}))
              date (utc-date)
              path (day-file root date)
              full? (and (fs/exists? path) (>= (fs/size path) (max-bytes)))]
          (cond
            full?
            (do (mark-lost! root date)
                (update-stats! root #(-> % (count-in [:dropped-full])
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
      ;; The marker is appended only while holding the lock; if the lock is
      ;; unavailable the loss is spooled and the next lock holder writes it.
      (catch Exception _
        (let [date (utc-date)]
          (try (with-ledger-lock root (fn []
                                        (mark-lost! root date)
                                        (update-stats! root #(count-in % [:write-errors]))))
               (catch Exception _ (spool-write-error! root :event date))))
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
      ;; A lost gate count (lock timeout / stats write failure) must not look
      ;; like normal collection: count it as a write error like emit! does.
      (catch Exception _
        (try (with-ledger-lock root #(update-stats! root (fn [s] (count-in s [:write-errors]))))
             (catch Exception _ (spool-write-error! root)))
        nil))))

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

;; Prometheus cannot see the zero before a series first appears, so increase()
;; would miss the first event of a rarely seen label pair. Publish every
;; allowlisted pair from zero; observed pairs outside the allowlist are kept.
(defn zero-filled [xs ys m]
  (merge (into {} (for [x xs y ys] [[x y] 0])) m))

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
                     (for [[[rt st] n] (sorted (zero-filled (:runtime enum-values) (:status enum-values) (:run-finished stats)))] [{:runtime rt :status st} n]))
       (metric-lines "ai_ops_review_gate_total" "counter" "Review gate evaluations by gate and result."
                     (for [[[g r] n] (sorted (zero-filled gate-names gate-results (:gate stats)))] [{:gate g :result r} n]))
       (metric-lines "ai_ops_corrections_total" "counter" "Rule-classified corrections (provisional) by origin and class."
                     (for [[[o c] n] (sorted (zero-filled (:correction_origin enum-values) (:correction_class enum-values) (:corrections stats)))] [{:origin o :class c} n]))
       (when-let [s (some-> (:last-emit-at stats) instant-seconds)]
         (metric-lines "ai_ops_ledger_last_emit_timestamp_seconds" "gauge" "Time of the last ledger write." [[{} s]]))
       (metric-lines "ai_ops_metrics_generated_timestamp_seconds" "gauge" "Time this exposition was generated."
                     [[{} now-seconds]])))
     "\n")))

;; Review-gate corrections, collection_lost and privacy_rejected markers exist only in the runner
;; ledger, so deleting an expired day file would make all-history SLIs undercount
;; corrections or turn back into determined values. Before deleting, the SLI-relevant
;; lines are copied into the SLI archive; a day file whose archive copy fails is kept.
;; - Only metadata the source gate reproduces unchanged is copied verbatim (clean
;;   corrections and the known body-less markers). Any other unclean line (unparsable,
;;   `{}`, invalid IDs, values the gate would redact) is replaced by a body-less marker
;;   so no expired raw content is retained: unparsable/non-object lines become
;;   `{"collection_lost":"input_unreadable"}`, the rest `{"privacy_rejected":"upstream"}`
;;   (keeping only an allowlisted event_type). Both keep the SLIs unknown.
;; - Each day file is archived to its own file named by date, the hash and the length of
;;   the archived day file content, written atomically. A day file is only appended to,
;;   so an archive whose source is a prefix of the current day file content is a subset
;;   of it (crash between archive and delete, or appends between retries) and is
;;   superseded. An archive whose source is not a prefix came from an earlier
;;   incarnation of the same date (the day file was pruned and later recreated, e.g. by
;;   a pending ledger_dropped marker) and is kept alongside, so pruning the recreated
;;   file never drops earlier archived corrections. Known limit: an incarnation whose
;;   content is identical to a prefix of the earlier one (only ID-less markers) is
;;   folded into it; the SLIs stay unknown but the lost-event count may be lower.
(defn sli-archive-dir [root] (fs/path (ledger-dir root) "sli-archive"))
(def archived-lost-markers
  #{{:collection_lost "ledger_dropped"} {:collection_lost "buffer_dropped"}
    {:collection_lost "undelivered"} {:collection_lost "input_unreadable"}})
(defn- rejected-marker [e]
  (cond-> {:privacy_rejected "upstream"}
    (contains? (:event_type enum-values) (:event_type e)) (assoc :event_type (:event_type e))))
(defn sli-archive-entry
  "Body-less archive form of one expired ledger line, or nil when it is not needed."
  [line]
  (let [e (try (json/parse-string line true) (catch Exception _ ::unparsable))]
    (cond
      (or (= ::unparsable e) (not (map? e))) {:collection_lost "input_unreadable"}
      (contains? archived-lost-markers e) e
      (or (contains? e :collection_lost) (contains? e :privacy_rejected)) (rejected-marker e)
      :else (let [[kept redacted] (gate e)]
              (if (and kept (zero? redacted) (= kept e))
                (when (= "correction" (:event_type e)) e)
                (rejected-marker e))))))
(defn- sha256-hex [^String s]
  (let [d (.digest (java.security.MessageDigest/getInstance "SHA-256") (.getBytes s "UTF-8"))]
    (apply str (map #(format "%02x" (bit-and % 0xff)) d))))
(defn- source-hash [^String content] (subs (sha256-hex content) 0 16))
(defn sli-archive-file [root date content]
  (fs/path (sli-archive-dir root) (str "events-" date "-" (source-hash content) "-" (count content) ".jsonl")))
(defn archive-superseded?
  "True when archive file a was written from a prefix of day file content."
  [a ^String content]
  (when-let [[_ h n] (re-matches #"events-\d{4}-\d{2}-\d{2}-([0-9a-f]{16})-(\d+)\.jsonl" (str (fs/file-name a)))]
    (let [n (parse-long n)]
      (and (<= n (count content)) (= h (source-hash (subs content 0 n)))))))
(defn sli-archive-files [root]
  (if (fs/exists? (sli-archive-dir root)) (fs/glob (sli-archive-dir root) "events-*.jsonl") []))
(defn sli-archive-files-for [root date]
  (if (fs/exists? (sli-archive-dir root)) (fs/glob (sli-archive-dir root) (str "events-" date "-*.jsonl")) []))

(defn prune! [root]
  (let [cutoff (.minusDays (java.time.LocalDate/now java.time.ZoneOffset/UTC) (retention-days))]
    (doseq [f (sort (map str (fs/glob (ledger-dir root) "events-*.jsonl")))
            :let [d (second (re-matches #"events-(\d{4}-\d{2}-\d{2})\.jsonl" (str (fs/file-name f))))]
            :when (and d (.isBefore (java.time.LocalDate/parse d) cutoff))]
      (try
        (let [content (slurp f)
              entries (keep sli-archive-entry (remove str/blank? (str/split-lines content)))]
          (when (seq entries)
            (fs/create-dirs (sli-archive-dir root))
            (atomic-spit! (sli-archive-file root d content)
                          (str (str/join "\n" (map json/generate-string entries)) "\n")))
          ;; Archives of earlier attempts on this same day file (its prefixes) are
          ;; superseded; archives of earlier incarnations of the date are kept.
          (let [keep-name (str (fs/file-name (sli-archive-file root d content)))]
            (doseq [a (sli-archive-files-for root d)
                    :when (and (not= keep-name (str (fs/file-name a))) (archive-superseded? a content))]
              (fs/delete-if-exists a)))
          (fs/delete-if-exists f))
        (catch Exception _ nil)))))

(def sli-script (str (fs/path (fs/parent (fs/absolutize *file*)) "ai_ops_sli.bb")))
(def sli-limit (* 256 1024))
;; correction-rules/v1 (内部 gate 再作業と Owner 可視是正の分離) は runs/ の summary.edn だけから集計する。
;; SLI v0 の export が成功した後に連結し、v1 側の失敗は ai_ops_v1_export_ok=0 として出す (v0 の出力は止めない)。
(def insight-script (str (fs/path (fs/parent (fs/absolutize *file*)) "ai_ops_insight.bb")))
(defn sli-status-path [root] (fs/path (ai-ops-dir root) "sli-export-status.edn"))
(defn sli-path [root] (fs/path (ai-ops-dir root) "sli.prom"))
(defn sli-interval [] (env-long "CODEX_TASK_BOARD_AI_OPS_SLI_INTERVAL_SECONDS" 900))
(defn sli-timeout [] (env-long "CODEX_TASK_BOARD_AI_OPS_SLI_TIMEOUT_SECONDS" 120))
(defn sli-enabled? [] (and (enabled?) (pos? (sli-interval)) (not (str/blank? (System/getenv "CODEX_TASK_BOARD_VAULT")))))
(defn read-sli-status [root]
  (try (or (some-> (sli-status-path root) str slurp edn/read-string) {}) (catch Exception _ {})))

(defn run-sli-command! [args output deadline]
  (let [process (-> (ProcessBuilder. ^java.util.List (vec args))
                    (.redirectOutput (java.io.File. (str output)))
                    (.redirectError java.lang.ProcessBuilder$Redirect/DISCARD)
                    (.start))]
    (try
      (let [remaining (max 0 (- deadline (System/currentTimeMillis)))]
        (if (and (pos? remaining) (.waitFor process remaining java.util.concurrent.TimeUnit/MILLISECONDS))
          (zero? (.exitValue process))
          false))
      (finally
        (when (.isAlive process)
          (let [children (vec (iterator-seq (.iterator (.descendants (.toHandle process)))))]
            (doseq [child (reverse children)] (.destroyForcibly child))
            (.destroyForcibly process)))))))

;; extract only reads runs/outbox/tickets; review-gate corrections and
;; ledger_dropped markers exist only in the runner ledger. Append every ledger
;; day file so ai_ops_sli.bb merges them (merge-ledger-events) and turns
;; collection_lost markers into unknown SLIs. A line still being appended has no
;; trailing newline yet and is left out instead of being counted as malformed.
(defn- file-date [f]
  (second (re-matches #"events-(\d{4}-\d{2}-\d{2})(?:-[0-9a-f]+-\d+)?\.jsonl" (str (fs/file-name f)))))
(defn- read-ledger-date
  "Text for one ledger date. prune! writes the archive before deleting the day file
  and this runs without the ledger lock, so both may exist (or the deletion may have
  failed). Archives written from a prefix of the current day file are subsets of it
  and skipped; archives of earlier incarnations of the date are read in addition, so
  markers are never counted twice and earlier corrections are never dropped."
  [root date]
  (let [unreadable (str (json/generate-string {:collection_lost "input_unreadable"}) "\n")
        ;; A file that vanished (pruned meanwhile) is fine; one that still exists but
        ;; cannot be read (permissions, I/O) may hide corrections or loss markers, so
        ;; it becomes a body-less input_unreadable marker and the SLIs stay unknown.
        read-file (fn [f] (try (slurp (str f))
                               (catch java.io.IOException e
                                 (if (or (instance? java.nio.file.NoSuchFileException e) (not (fs/exists? f)))
                                   nil
                                   ::unreadable))))
        day (fs/path (ledger-dir root) (str "events-" date ".jsonl"))
        day-text (read-file day)
        text (when (string? day-text) day-text)
        archives (->> (sli-archive-files-for root date)
                      (remove #(and text (archive-superseded? % text)))
                      (sort-by str)
                      (keep read-file)
                      (map #(cond (= ::unreadable %) unreadable
                                  (or (str/blank? %) (str/ends-with? % "\n")) %
                                  :else (str % "\n"))))]
    (apply str (concat archives [(cond (= ::unreadable day-text) unreadable :else (or text ""))]))))
(defn append-ledger-events! [root target]
  (with-open [w (java.io.FileWriter. (str target) true)]
    (doseq [d (sort (distinct (keep file-date (if (fs/exists? (ledger-dir root)) (concat (fs/glob (ledger-dir root) "events-*.jsonl") (sli-archive-files root)) []))))
            :let [text (read-ledger-date root d) end (inc (or (str/last-index-of text "\n") -1))]
            :when (pos? end)]
      (.write w (subs text 0 end))))
  true)

;; ---------------------------------------------------------------------------
;; Hermes ledger mirror (BOXP-360 第 1 段階の join)
;; hermes-agent pod の metadata-only ledger (/opt/data/ai-ops/ledger/events-*.jsonl、本文なし・opaque ID) を、
;; codex-workspace の既存 ServiceAccount 権限 (hermes-agent namespace の Role codex-workspace-debug: pods/exec) で
;; read-only に取り込み、SLI 集計入力へ join する。opt-in: CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_COMMAND に
;; 取り込みコマンド (sh -c で実行、stdout が JSONL) を置いたときだけ動く。取り込みは上限付き (時間・バイト数) で、
;; 失敗しても前回成功時の snapshot を使い、その場合は本文なしの {source_stale: hermes-observer} marker を集計入力に
;; 付けて Hermes 会話の coverage を partial/stale にする (0 件や接続済みに見せない)。runner を止めない。
(defn hermes-mirror-command []
  (let [c (System/getenv "CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_COMMAND")] (when-not (str/blank? c) c)))
(defn hermes-mirror-max-bytes [] (env-long "CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_MAX_BYTES" 8388608))
(defn hermes-mirror-timeout [] (env-long "CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_TIMEOUT_SECONDS" 30))
(defn hermes-mirror-dir [root] (fs/path (ai-ops-dir root) "hermes-ledger"))
(defn hermes-mirror-path [root] (fs/path (hermes-mirror-dir root) "snapshot.jsonl"))
(defn hermes-mirror-status-path [root] (fs/path (hermes-mirror-dir root) "status.edn"))
;; 有効 event 0 件で失敗した取り込み (no_events) が出した本文・ID なしの欠落 marker (privacy_rejected / input_unreadable)。
;; 前回 snapshot を置き換えない代わりにここへ残し、次の成功まで集計入力へ付けて関連 SLI を確定させない
(defn hermes-mirror-failed-markers-path [root] (fs/path (hermes-mirror-dir root) "failed-pull-markers.jsonl"))
;; 連続して no_events で失敗した場合、marker は上書きせず積み上げる (前回の是正拒否が今回の承認拒否で消えると、
;; 完全な取り込みが成功する前に是正 SLI が確定してしまう)。無制限に増えないよう行数上限を置く。上限到達後は
;; 件数が下限になるだけで、1 件でも残っていれば関連 SLI は unknown のまま
(def input-unreadable-marker-line (json/generate-string {:collection_lost "input_unreadable"}))
(defn hermes-mirror-failed-markers-max-lines [] (env-long "CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_FAILED_MARKER_MAX_LINES" 10000))
(defn keep-hermes-failed-markers!
  "Merge `new-lines` (body-less marker lines from a no_events pull) into the
  failed-pull marker file without discarding the markers of earlier failed pulls.
  An existing file that cannot be read is replaced by a single input_unreadable
  marker followed by the new lines (lost input stays visible). The file is capped
  at the configured line count; when the cap is exceeded an input_unreadable
  marker (affecting every SLI) is kept first and one line per distinct marker is
  kept before any duplicate, so no marker kind is hidden. Returns the number of
  lines that did not fit."
  [root new-lines]
  (let [fp (hermes-mirror-failed-markers-path root)
        existing (when (fs/exists? fp)
                   (try (remove str/blank? (str/split-lines (slurp (str fp))))
                        (catch java.io.IOException _ [input-unreadable-marker-line])))
        all (concat existing new-lines)
        cap (max 1 (hermes-mirror-failed-markers-max-lines))
        ;; 上限超過時は先着順に切り捨てない: 承認拒否で上限に達した後の是正拒否が捨てられると、是正 SLI が確定し得る。
        ;; 全種別の SLI に効く input_unreadable marker を先頭に置き (切り捨てた行の欠落そのもの)、続けて種別ごとに
        ;; 1 行ずつ (distinct)、残りを重複分で埋める。集計側は種別ごとの有無で unknown を決めるため、件数は下限でよい
        kept (if (> (count all) cap)
               (let [others (remove #{input-unreadable-marker-line} all)
                     distinct-lines (distinct others)
                     duplicates (mapcat (fn [[line n]] (repeat (dec n) line)) (frequencies others))]
                 (take cap (concat [input-unreadable-marker-line] distinct-lines duplicates)))
               all)]
    (atomic-spit! fp (str/join "" (map #(str % "\n") kept)))
    (max 0 (- (count all) cap))))
(defn read-hermes-mirror-status [root]
  (try (or (some-> (hermes-mirror-status-path root) str slurp edn/read-string) {}) (catch Exception _ {})))
(def hermes-stale-marker-line (json/generate-string {:source_stale "hermes-observer"}))

;; snapshot に保存する key は集計側 (ai_ops_sli.bb) の allowlist と同じ。本文・引数・header 等の未知 key は
;; 取り込み時点で落とし (永続 snapshot に残さない)、値は scalar/短い文字列だけを許す。値の形式検証は集計側 gate が行う
(def hermes-allowed-keys
  #{:schema_version :event_id :request_id :task_id :run_id :attempt :parent_event_id
    :source :runtime :agent :event_type :occurred_at :observed_at :occurred_precision
    :lane_from :lane_to :status :result :action :exit_code :idle_timeout :blocker_category
    :correction_class :correction_origin :classifier :classifier_version :confidence
    :evidence_event_ids :stratum :delegation_kind :tokens_in :tokens_out :cost_source
    :severity :effect_key :approval_key :redelivery :coverage_target :snapshot})
;; 値の形式検証は集計側 (ai_ops_sli.bb の本番モード privacy gate) と同じ規則を保存前にも適用する。
;; 許可 key でも enum 外・ID 形式外・token 形状の値 (本文や秘密値が入り得る) は snapshot に残さず "redacted" に置換し、
;; event_id / task_id / request_id / run_id が形式外の event は本文・ID なしの {privacy_rejected: upstream} marker に置換する
;; (集計側は upstream 拒否として計数し、是正に影響し得る種別なら SLI を unknown にする)。
(def hermes-enum-values
  {:snapshot #{"current"} :schema_version #{"ai-ops-event/v0"} :classifier_version #{"correction-rules/v0"}
   :event_type #{"request.received" "run.started" "run.finished" "run.interrupted" "task.accepted" "task.reopened" "task.state" "task.cancelled" "run.unreadable" "lane.changed" "notify.run-finished" "correction" "owner.rescue" "approval.requested" "approval.resolved" "effect.applied" "coverage.connected"}
   :source #{"hermes-observer"}
   :runtime #{"codex-cli" "claude-cli" "localllm" "localllm-coder" "hermes" "unknown"}
   :agent #{"codex" "codex-terra" "codex-sol" "codex-sol-xhigh" "codex-full" "codex-mini" "codex-astra" "claude-opus" "claude-fable" "claude-sonnet" "fable" "localllm" "localllm-coder"}
   :action #{"implement" "groom" "review-fix" "blocked-retry" "docs-edit" "docs-groom"}
   :status #{"done" "closed" "succeeded" "retrying" "accepted" "blocked" "interrupted" "review" "ready" "backlog" "failed" "in-progress" "running" "duplicate" "hold" "cancelled" "superseded"}
   :result #{"review" "blocked" "done" "ready"}
   :lane_from #{"ready" "review" "blocked" "backlog" "in-progress" "done"}
   :lane_to #{"ready" "review" "blocked" "backlog" "in-progress" "done"}
   :correction_class #{"gate_defect" "unknown" "done_claim_without_execution" "instruction_violation" "source_mismatch" "assignee_regression" "preference_adjustment" "scope_addition" "unavoidable_safety_decision" "external_failure"}
   :correction_origin #{"agent-system" "non-agent" "unknown"} :classifier #{"rule" "human" "model"}
   :confidence #{"high" "medium" "low"} :severity #{"critical" "high" "medium" "low"}
   :cost_source #{"unknown"} :occurred_precision #{"day" "second" "ns"}
   :delegation_kind #{"delegated" "exempt" "failed" "unparsable"}
   :stratum #{"assistant-or-research" "assistant" "research" "creative" "dev" "infra"}
   :blocker_category #{"external" "agent-reported-blocked" "agent-process-error" "pr-gate-pr-url"}
   :coverage_target #{"duplicate-effects" "critical-safety-events" "acceptance-history" "hermes-conversation"}})
(def hermes-token-pattern #"(?i)(?:^|[^a-z0-9])(ghp_|gho_|github_pat_|xox[bp]-|AKIA|sk-|glpat-)[a-z0-9_-]+|[a-z0-9]{32,}")
(def hermes-id-words
  ["frontmatter-unreadable" "ticket-missing" "accepted-again" "in-progress" "interrupted" "unreadable"
   "correction" "requested" "cancelled" "finished" "approval" "coverage" "critical" "reopened" "accepted"
   "request" "started" "running" "blocked" "backlog" "pending" "review" "rescue" "effect" "reopen"
   "safety" "cancel" "accept" "failed" "state" "event" "start" "ready" "lane" "done" "corr" "fin" "req" "run" "rule" "human" "model" "ledger" "lane-start"])
(def hermes-run-id-re "\\d{8}T\\d{6}Z(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-[0-9a-f]{1,8})?(?:-groom)?")
(def hermes-id-segment-re (str "(?:" hermes-run-id-re "|(?:" (str/join "|" hermes-id-words) ")\\d{0,3}|[0-9a-f]{8,16}|\\d{1,6}|[a-z]\\d{0,3})"))
(def hermes-conv-id-re "(?:req|conv)-[0-9a-f]{8}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{12})?")
(def hermes-event-id-re
  (re-pattern (str "(?:[A-Z]+-\\d+(?:[/:-]" hermes-id-segment-re "){0,4}"
                   "|cov-(?:acceptance|effects|safety|hermes|approvals)-[0-9a-f]{8}"
                   "|" hermes-conv-id-re "(?:[/:]" hermes-id-segment-re "){0,3})")))
(def hermes-task-id-re (re-pattern (str "(?:[A-Z]+-\\d+|" hermes-conv-id-re ")")))
(def hermes-request-id-re (re-pattern (str "(?:req:[A-Z]+-\\d+|" hermes-conv-id-re ")")))
(def hermes-run-id-pattern (re-pattern hermes-run-id-re))
(def hermes-key-re #"(?:op|pr|merge|deploy|notify|lane|approval|effect):[0-9a-f]{8,16}")
(def hermes-numeric-ranges {:attempt [0 1000] :redelivery [0 1000] :exit_code [-255 255] :tokens_in [0 100000000] :tokens_out [0 100000000]})
(defn- hermes-event-id? [s] (and (string? s) (<= (count s) 128) (not (re-find hermes-token-pattern s)) (boolean (re-matches hermes-event-id-re s))))
(defn hermes-valid-value?
  "Same acceptance rules as the aggregate's production-mode privacy gate."
  [k v]
  (cond
    (nil? v) true
    (and (string? v) (re-find hermes-token-pattern v)) false
    (contains? hermes-enum-values k) (and (string? v) (contains? (hermes-enum-values k) v))
    (contains? hermes-numeric-ranges k) (let [[lo hi] (hermes-numeric-ranges k)] (and (integer? v) (<= lo v hi)))
    (= k :idle_timeout) (boolean? v)
    (#{:occurred_at :observed_at} k) (instant-string? v)
    (#{:event_id :parent_event_id} k) (hermes-event-id? v)
    (= k :evidence_event_ids) (and (sequential? v) (<= (count v) 16) (every? hermes-event-id? v))
    (= k :task_id) (and (string? v) (boolean (re-matches hermes-task-id-re v)))
    (= k :request_id) (and (string? v) (boolean (re-matches hermes-request-id-re v)))
    (= k :run_id) (and (string? v) (boolean (re-matches hermes-run-id-pattern v)))
    (#{:effect_key :approval_key} k) (and (string? v) (boolean (re-matches hermes-key-re v)))
    :else false))
(defn hermes-gate
  "Allowlist and validate a Hermes event for the snapshot. Returns
  {:event m :dropped n :redacted n} or, when an identifier is invalid,
  {:rejected marker :dropped n} where marker carries no body or ID."
  [m]
  (let [selected (select-keys m hermes-allowed-keys)
        dropped (- (count m) (count selected))
        invalid (set (for [[k v] selected :when (not (hermes-valid-value? k v))] k))
        rejected? (or (nil? (:event_id m)) (invalid :event_id)
                      (some #(and (some? (get m %)) (invalid %)) [:task_id :request_id :run_id]))]
    (if rejected?
      {:rejected (cond-> {:privacy_rejected "upstream"}
                   (contains? (:event_type hermes-enum-values) (:event_type m)) (assoc :event_type (:event_type m)))
       :dropped dropped}
      {:event (reduce (fn [acc k] (assoc acc k "redacted")) selected invalid)
       :dropped dropped :redacted (count invalid)})))
(defn- hermes-snapshot-lines
  "Keep only lines whose JSON `source` is hermes-observer, re-serialised with the
  allowlisted keys and validated values only (no body/argument keys or free-form
  values reach the persistent snapshot). A line that is not a JSON object becomes a
  body-less input_unreadable marker and an event with an invalid identifier a
  body-less privacy_rejected marker (the aggregate turns both into unknown SLIs
  instead of silently dropping them); a JSON line from another source means the
  command is misconfigured, so it is dropped and counted. :hermes counts the events
  kept as events (markers excluded)."
  [text]
  (reduce (fn [acc line]
            (let [m (try (json/parse-string line true) (catch Exception _ nil))]
              (cond (not (map? m)) (-> acc (update :lines conj input-unreadable-marker-line) (update :malformed inc))
                    (= "hermes-observer" (:source m))
                    (let [{:keys [event rejected dropped redacted]} (hermes-gate m)]
                      (if rejected
                        (-> acc (update :lines conj (json/generate-string rejected)) (update :rejected inc) (update :dropped-keys + dropped))
                        (-> acc (update :lines conj (json/generate-string event)) (update :hermes inc)
                            (update :dropped-keys + dropped) (update :redacted-values + redacted))))
                    :else (update acc :foreign inc))))
          {:lines [] :hermes 0 :malformed 0 :foreign 0 :rejected 0 :dropped-keys 0 :redacted-values 0}
          (remove str/blank? (str/split-lines text))))

(defn- run-bounded-command!
  "Run `args`, reading stdout into memory up to `max-bytes` (+1 so an overflow is
  detectable) and no longer than `deadline`. Returns {:status :ok :text s},
  {:status :too_large}, {:status :timeout} or {:status :failed}. The process is
  destroyed on overflow/timeout so it never fills the runner's disk or blocks."
  [args max-bytes deadline]
  (let [process (-> (ProcessBuilder. ^java.util.List (vec args))
                    (.redirectError java.lang.ProcessBuilder$Redirect/DISCARD)
                    (.start))
        in (.getInputStream process)
        buf (java.io.ByteArrayOutputStream.)
        chunk (byte-array 65536)
        overflow (atom false)
        reader (future (try (loop []
                              (let [n (.read in chunk)]
                                (when (pos? n)
                                  (.write buf chunk 0 n)
                                  (if (> (.size buf) max-bytes) (reset! overflow true) (recur)))))
                            (catch Exception _ nil)))
        remaining (max 0 (- deadline (System/currentTimeMillis)))
        finished (try (deref reader remaining ::timeout) (catch Exception _ ::timeout))
        kill! (fn [] (when (.isAlive process)
                       (doseq [c (reverse (vec (iterator-seq (.iterator (.descendants (.toHandle process))))))] (.destroyForcibly c))
                       (.destroyForcibly process)))]
    (try
      (cond @overflow (do (kill!) {:status :too_large})
            (= finished ::timeout) (do (kill!) {:status :timeout})
            :else (let [exited (.waitFor process (max 0 (- deadline (System/currentTimeMillis))) java.util.concurrent.TimeUnit/MILLISECONDS)]
                    (cond (not exited) (do (kill!) {:status :timeout})
                          (zero? (.exitValue process)) {:status :ok :text (String. (.toByteArray buf) "UTF-8")}
                          :else {:status :failed})))
      (finally (kill!) (future-cancel reader) (try (.close in) (catch Exception _))))))

;; mirror は SLI refresh 全体の deadline のうち、後続の prom / v1 export に残す時間 (reserve) を差し引いた範囲でしか
;; 待たない。先行の extract が時間を使い切っていれば取り込みを試みず前回 snapshot (stale) で続ける。
(defn hermes-mirror-reserve [] (env-long "CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_RESERVE_SECONDS" 45))
(defn hermes-mirror-budget
  "Deadline for the pull: at most the mirror timeout from now and never past
  `deadline` minus the reserve kept for the aggregate/export steps that follow."
  [deadline]
  (min (- deadline (* 1000 (max 0 (hermes-mirror-reserve))))
       (+ (System/currentTimeMillis) (* 1000 (max 1 (hermes-mirror-timeout))))))

(defn mirror-hermes-ledger!
  "Run the configured command (bounded by `deadline` minus the reserve and by the
  mirror timeout) and replace `<root>/ai-ops/hermes-ledger/snapshot.jsonl`
  atomically on success. When the output ended in an unterminated line (a write in
  progress) the snapshot is still replaced but the pull is recorded as partial
  (stale until a complete pull), the failed-pull markers are kept, and false is
  returned. On any failure (no time left, command error, timeout,
  empty output, output over the byte cap, or output without a single valid
  hermes-observer event) the previous snapshot is kept and the failure is recorded
  in status.edn. Returns true on success, false on failure, nil when not
  configured. Never throws."
  [root deadline]
  (when-let [cmd (hermes-mirror-command)]
    (let [now (quot (System/currentTimeMillis) 1000)
          attempt (assoc (read-hermes-mirror-status root) :last-attempt now)
          budget (hermes-mirror-budget deadline)
          failed-marker-overflow (atom 0)
          fail! (fn [reason] (try (atomic-spit! (hermes-mirror-status-path root)
                                                (pr-str (cond-> (-> attempt (update :failures (fnil inc 0)) (assoc :last-failure reason :last-result "fail"))
                                                          (pos? @failed-marker-overflow) (update :failed-markers-overflow (fnil + 0) @failed-marker-overflow))))
                                  (catch Exception _)) false)]
      (try
        (fs/create-dirs (hermes-mirror-dir root))
        (atomic-spit! (hermes-mirror-status-path root) (pr-str attempt))
        (if (<= budget (System/currentTimeMillis))
          (fail! "no_time")
          (let [{:keys [status text]} (run-bounded-command! ["sh" "-c" cmd] (hermes-mirror-max-bytes) budget)]
            (cond (= status :too_large) (fail! "too_large")
                  (= status :timeout) (fail! "timeout")
                  (not= status :ok) (fail! "command")
                  (str/blank? text) (fail! "empty")
                  :else
                  (let [;; 追記途中の末尾行 (改行なし) は落とす。落とした場合は snapshot が不完全 (末尾の承認等が欠け得る) なので
                        ;; "partial" として記録し、集計入力には stale marker を付けて関連 SLI を確定させない (次の完全な取り込みで解消)
                        end (inc (or (str/last-index-of text "\n") -1))
                        truncated (if (str/blank? (subs text end)) 0 1)
                        {:keys [lines hermes malformed foreign rejected dropped-keys redacted-values]} (hermes-snapshot-lines (subs text 0 end))]
                    ;; 有効な hermes-observer event が 1 件もない出力 (途中行だけ・他 source だけ・全行破損/拒否) は
                    ;; 収集結果として信用せず、前回 snapshot を置き換えない (stale として扱う)
                    (if (zero? hermes)
                      ;; 検出した拒否・破損 marker は捨てず残す (全行の ID が不正になった等、是正に影響し得る拒否を
                      ;; 集計側が認識できないまま SLI を確定させない)。marker が無い出力 (途中行だけ等) は前回の marker を残す
                      ;; 前回の失敗で残した marker (別種別の拒否かもしれない) は消さず積み上げる
                      (do (when (seq lines)
                            (try (let [over (keep-hermes-failed-markers! root lines)]
                                   (when (pos? over) (swap! failed-marker-overflow + over)))
                                 (catch Exception _)))
                          (fail! "no_events"))
                      (do
                        (atomic-spit! (hermes-mirror-path root) (str/join "" (map #(str % "\n") lines)))
                        ;; 完全な取り込みに成功した snapshot は ledger 全体を読み直したものなので、失敗時の marker は不要になる。
                        ;; 末尾行を落とした partial pull では消さない (落とした行が前回検出した是正拒否だった場合、stale marker は
                        ;; 是正 SLI を unknown にしないため、完全な取り込み前に是正率が確定してしまう)
                        (when (zero? truncated)
                          (fs/delete-if-exists (hermes-mirror-failed-markers-path root)))
                        (atomic-spit! (hermes-mirror-status-path root)
                                      (pr-str (cond-> (assoc attempt :last-success now :last-result (if (pos? truncated) "partial" "ok") :lines (count lines) :bytes end
                                                             :hermes-lines hermes :malformed-lines malformed :foreign-lines foreign :truncated-tail-lines truncated
                                                             :rejected-lines rejected :dropped-keys dropped-keys :redacted-values redacted-values)
                                                (pos? truncated) (update :partial-pulls (fnil inc 0)))))
                        (zero? truncated)))))))
        (catch Exception _ (fail! "exception"))))))

(defn hermes-mirror-stale?
  "True when the latest pull did not succeed (the SLI input is using the previous
  snapshot) or succeeded only partially (an unterminated tail line was dropped, so
  the newest event may be missing). Uses the recorded result of the last attempt;
  attempts within the same second as the last success are not mistaken for fresh."
  [status]
  (if (contains? status :last-result)
    (not= "ok" (:last-result status))
    (> (:last-attempt status 0) (:last-success status 0))))

(defn append-hermes-mirror!
  "Append the Hermes snapshot to the SLI input. When the latest pull failed the
  snapshot is still appended (it is the last good copy) followed by the
  source_stale marker, so the aggregate reports partial/stale coverage. A snapshot
  that exists but cannot be read becomes an input_unreadable marker. The body-less
  markers kept from a `no_events` pull are appended too (an unreadable marker file
  counts as lost input) so the aggregate does not settle the affected SLIs. When
  the mirror is configured but no snapshot has ever been obtained (the first pull
  timed out / failed / never ran) only the source_stale marker is appended: the
  Hermes approval history is missing from the input, so the aggregate must not
  settle the approval SLI from the other sources. No-op when not configured."
  [root target]
  (when (hermes-mirror-command)
    (let [p (hermes-mirror-path root) fp (hermes-mirror-failed-markers-path root) status (read-hermes-mirror-status root)
          read-lines (fn [path] (let [text (try (slurp (str path)) (catch java.io.IOException _ ::unreadable))]
                                  (if (string? text)
                                    (let [end (inc (or (str/last-index-of text "\n") -1))] (when (pos? end) (subs text 0 end)))
                                    (str input-unreadable-marker-line "\n"))))]
      (with-open [w (java.io.FileWriter. (str target) true)]
        (if (fs/exists? p)
          (do (some->> (read-lines p) (.write w))
              (when (hermes-mirror-stale? status) (.write w (str hermes-stale-marker-line "\n"))))
          ;; snapshot が一度も取得できていない: 前回分すら無いので stale marker だけを出す (初回失敗を集計側へ伝える)
          (.write w (str hermes-stale-marker-line "\n")))
        (when (fs/exists? fp)
          (some->> (read-lines fp) (.write w))))))
  true)

(defn hermes-mirror-failed-marker-lines
  "Marker lines accumulated from no_events pulls since the last success (0 when none; an unreadable file counts as 1)."
  [root]
  (let [fp (hermes-mirror-failed-markers-path root)]
    (if (fs/exists? fp)
      (try (count (remove str/blank? (str/split-lines (slurp (str fp))))) (catch java.io.IOException _ 1))
      0)))

(defn hermes-mirror-metrics [root]
  (let [s (read-hermes-mirror-status root) configured (some? (hermes-mirror-command))]
    (str (str/join "\n" (concat
          (metric-lines "ai_ops_hermes_mirror_enabled" "gauge" "Hermes ledger mirror command is configured." [[{} (if configured 1 0)]])
          (when-let [v (:last-success s)] (metric-lines "ai_ops_hermes_mirror_last_success_timestamp_seconds" "gauge" "Last successful Hermes ledger pull." [[{} v]]))
          (metric-lines "ai_ops_hermes_mirror_last_attempt_timestamp_seconds" "gauge" "Last Hermes ledger pull attempt, or zero if never attempted." [[{} (:last-attempt s 0)]])
          (metric-lines "ai_ops_hermes_mirror_failures_total" "counter" "Failed Hermes ledger pulls (previous snapshot kept)." [[{} (:failures s 0)]])
          (metric-lines "ai_ops_hermes_mirror_failed_pull_marker_lines" "gauge" "Body-less lost-input markers accumulated from no_events pulls since the last successful pull and still appended to the SLI input (0 once a complete pull succeeds; a partial pull keeps them; capped with an input_unreadable marker kept first, see _failed_pull_markers_overflow_total)." [[{} (hermes-mirror-failed-marker-lines root)]])
          (metric-lines "ai_ops_hermes_mirror_failed_pull_markers_overflow_total" "counter" "Marker lines from no_events pulls that did not fit the failed-pull marker cap (the kept count is a lower bound; affected SLIs stay unknown)." [[{} (:failed-markers-overflow s 0)]])
          (metric-lines "ai_ops_hermes_mirror_partial_pulls_total" "counter" "Hermes ledger pulls whose output ended in an unterminated line: the snapshot was replaced but kept stale until a complete pull." [[{} (:partial-pulls s 0)]])
          (metric-lines "ai_ops_hermes_mirror_stale" "gauge" "1 when the latest Hermes ledger pull failed or was partial: the SLI input uses the previous/incomplete snapshot plus a source_stale marker, or only a source_stale marker when no snapshot was ever obtained." [[{} (if (and configured (pos? (:last-attempt s 0)) (hermes-mirror-stale? s)) 1 0)]])
          ;; 成功した snapshot が無ければ件数を出さない (未取得と空の snapshot を区別する)
          (when (:last-success s)
            (metric-lines "ai_ops_hermes_mirror_snapshot_lines" "gauge" "Lines in the last successful Hermes ledger snapshot." [[{:kind "hermes"} (:hermes-lines s (:lines s 0))] [{:kind "malformed"} (:malformed-lines s 0)] [{:kind "foreign_source"} (:foreign-lines s 0)] [{:kind "rejected"} (:rejected-lines s 0)] [{:kind "truncated_tail"} (:truncated-tail-lines s 0)] [{:kind "dropped_keys"} (:dropped-keys s 0)] [{:kind "redacted_values"} (:redacted-values s 0)]]))))
         "\n")))

(defn sli-lock-path [root] (fs/path (ai-ops-dir root) "sli.lock"))

(defn with-sli-lock
  "Run f while holding an exclusive FileLock on `<root>/ai-ops/sli.lock`, so the
  resident `loop` and a manual `tick` never both run an SLI refresh (due check
  through saving sli.prom and the export status). Non-blocking: when another
  process or thread holds it, return nil without running f."
  [root f]
  (fs/create-dirs (ai-ops-dir root))
  (with-open [file (java.io.RandomAccessFile. (str (sli-lock-path root)) "rw")
              channel (.getChannel file)]
    ;; tryLock returns nil when another process holds it and throws when this
    ;; JVM already does; both mean a refresh is running, so skip.
    (when-let [_lock (try (.tryLock channel) (catch Exception _ nil))]
      (f))))

(defn- utf8-length [^String s] (alength (.getBytes s "UTF-8")))
(defn v1-export-text
  "Run the v1 export into `tmp` and return the text to append to sli.prom: the v1
  series plus `ai_ops_v1_export_ok`, which is 0 when the export failed, timed out,
  produced nothing or would push sli.prom past `budget` bytes. The limit is checked
  on the exact bytes that will be appended (body + the export_ok lines), so a v1
  failure near the limit never pushes the v0 output over sli-limit. When even the
  export_ok lines do not fit, nothing is appended and the v0 output stands alone."
  [root tmp deadline budget]
  (let [tail (fn [ok?] (str "# HELP ai_ops_v1_export_ok correction-rules/v1 export succeeded in the last SLI refresh (0 = v1 series are stale or absent).\n"
                            "# TYPE ai_ops_v1_export_ok gauge\n"
                            "ai_ops_v1_export_ok " (if ok? 1 0) "\n"))
        body (try (when (and (run-sli-command! ["bb" insight-script "prom" (str root)] tmp deadline)
                             (pos? (.length tmp)))
                    (let [s (slurp tmp)] (if (str/ends-with? s "\n") s (str s "\n"))))
                  (catch Exception _ nil))
        ok-text (when body (str body (tail true)))
        fail-text (tail false)]
    (cond (and ok-text (<= (utf8-length ok-text) budget)) ok-text
          (<= (utf8-length fail-text) budget) fail-text
          :else "")))
(defn- refresh-sli-locked! [root vault]
  (let [now (quot (System/currentTimeMillis) 1000) status (read-sli-status root) interval (sli-interval)]
      (when (and (enabled?) (pos? interval) (not (str/blank? vault))
                 (>= (- now (get status :last-attempt 0)) interval))
        (let [attempt (assoc status :last-attempt now) tmp (atom nil) output (atom nil) v1 (atom nil)
              deadline (+ (System/currentTimeMillis) (* 1000 (max 0 (sli-timeout))))]
          (try
            (atomic-spit! (sli-status-path root) (pr-str attempt))
            (reset! tmp (java.io.File/createTempFile "ai-ops-sli-" ".jsonl"))
            (reset! output (java.io.File/createTempFile "ai-ops-sli-" ".prom"))
            (reset! v1 (java.io.File/createTempFile "ai-ops-v1-" ".prom"))
            (if (and (run-sli-command! ["bb" sli-script "extract" (str root) (str vault)] @tmp deadline)
                     (append-ledger-events! root @tmp)
                     ;; Hermes ledger の取り込み失敗は SLI refresh を失敗にしない (前回 snapshot + stale marker で続ける)
                     (do (mirror-hermes-ledger! root deadline) (append-hermes-mirror! root @tmp))
                     (run-sli-command! ["bb" sli-script "prom" (str @tmp)] @output deadline)
                     (pos? (.length @output)) (<= (.length @output) sli-limit))
              (let [v1-text (v1-export-text root @v1 deadline (- sli-limit (.length @output)))]
                (atomic-spit! (sli-path root) (str (slurp @output) v1-text))
                (atomic-spit! (sli-status-path root) (pr-str (assoc attempt :last-success now))) true)
              (do (atomic-spit! (sli-status-path root) (pr-str (update attempt :failures (fnil inc 0)))) false))
            (catch Exception _
              (try (atomic-spit! (sli-status-path root) (pr-str (update attempt :failures (fnil inc 0)))) (catch Exception _)) false)
            (finally (doseq [f [@tmp @output @v1]] (when f (fs/delete-if-exists f)))))))))

(defn refresh-sli! [root vault]
  (try
    ;; Check the cheap preconditions first: a disabled ledger must not even
    ;; create ai-ops/ for the lock file.
    (when (and (enabled?) (pos? (sli-interval)) (not (str/blank? vault)))
      (with-sli-lock root #(refresh-sli-locked! root vault)))
    (catch Exception _ nil)))

;; The extract/prom subprocesses may take up to sli-timeout; never block the
;; runner poll loop on them. At most one refresh runs at a time.
(def sli-refresh-running (atom false))
(defn refresh-sli-async! [root vault]
  (when (compare-and-set! sli-refresh-running false true)
    (future (try (refresh-sli! root vault) (finally (reset! sli-refresh-running false))))
    true))

(defn sli-export-metrics [root]
  (let [s (read-sli-status root)]
    (str (str/join "\n" (concat
          (when-let [v (:last-success s)] (metric-lines "ai_ops_sli_export_last_success_timestamp_seconds" "gauge" "Last successful SLI export." [[{} v]]))
          (metric-lines "ai_ops_sli_export_last_attempt_timestamp_seconds" "gauge" "Last SLI export attempt, or zero if never attempted." [[{} (:last-attempt s 0)]])
          (metric-lines "ai_ops_sli_export_failures_total" "counter" "Failed SLI export attempts." [[{} (:failures s 0)]])
          (metric-lines "ai_ops_sli_export_enabled" "gauge" "SLI export is enabled and configured." [[{} (if (sli-enabled?) 1 0)]]))) "\n"
         (hermes-mirror-metrics root))))

(defn sli-snapshot [root]
  (try (let [p (sli-path root)] (if (and (fs/regular-file? p) (<= (fs/size p) sli-limit)) (slurp (str p)) "")) (catch Exception _ "")))

(defn write-metrics!
  "Write `<root>/ai-ops/metrics.prom` from the stats and prune old ledger files.
  Never throws; returns true on success."
  [root]
  (when (enabled?)
    (try
      (with-ledger-lock
       root
       (fn []
         ;; Losses from lock timeouts are reflected even when no emit! follows.
         (flush-unrecorded-write-errors! root)
         (when (fs/exists? (ledger-dir root)) (prune! root))
         (atomic-spit! (metrics-path root)
                       (str (metrics-text (read-stats root) (quot (System/currentTimeMillis) 1000))
                            (sli-export-metrics root) (sli-snapshot root)))
         true))
      (catch Exception _ nil))))
