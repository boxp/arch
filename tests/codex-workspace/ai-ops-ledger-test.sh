#!/usr/bin/env bash
# BOXP-360: AI ops ledger (docker/codex-workspace/task-board/ai_ops_ledger.bb).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
module="${repo_root}/docker/codex-workspace/task-board/ai_ops_ledger.bb"
tmp="$(mktemp -d)"
trap 'chmod -R u+w "${tmp}" 2>/dev/null || true; rm -rf "${tmp}"' EXIT

AI_OPS_REPO="${repo_root}" AI_OPS_MODULE="${module}" AI_OPS_TMP="${tmp}" bb -e '
(require (quote [babashka.fs :as fs]) (quote [cheshire.core :as json]) (quote [clojure.string :as str]))
(load-file (System/getenv "AI_OPS_MODULE"))
(def tmp (System/getenv "AI_OPS_TMP"))
(def failures (atom []))
(defn check [label ok] (println (if ok "ok" "FAIL") label) (when-not ok (swap! failures conj label)))
(defn lines [root] (->> (fs/glob (fs/path root "ai-ops" "ledger") "events-*.jsonl")
                        (mapcat #(str/split-lines (slurp (str %))))
                        (remove str/blank?)))
(defn events [root] (map #(json/parse-string % true) (lines root)))
(defn stats [root] (ai-ops-ledger/read-stats root))
(def run "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57")
(defn ev [root word m]
  (ai-ops-ledger/emit! root (merge {:event_id (ai-ops-ledger/event-id "BOXP-1" run word)
                                    :task_id "BOXP-1" :request_id "req:BOXP-1" :run_id run
                                    :agent "codex" :runtime "codex-cli" :action "implement"} m)))

;; allowlist and enum gate
(let [root (str (fs/path tmp "a"))
      e (ev root "started" {:event_type "run.started" :lane_from "ready" :lane_to "in-progress"
                            :title "secret title" :pr_url "https://github.com/x/y/pull/1"
                            :result "password=hunter2-not-an-enum"})
      [line] (lines root)]
  (check "event written" (some? e))
  (check "non-allowlisted keys dropped" (and (not (str/includes? line "title")) (not (str/includes? line "http"))))
  (check "non-enum value dropped" (and (not (str/includes? line "hunter2")) (nil? (:result (first (events root))))))
  (check "redacted value counted" (= 1 (:redacted-values (stats root))))
  (check "schema and source added" (= ["ai-ops-event/v0" "task-board-runner"]
                                      ((juxt :schema_version :source) (first (events root))))))

;; reasoning-level assignees (runner accepts e.g. codex-sol-xhigh) keep their base agent
(let [root (str (fs/path tmp "h"))]
  (ev root "started" {:event_type "run.started" :agent "codex-sol-xhigh"})
  (ev root "finished" {:event_type "run.finished" :agent "codex-terra-minimal" :status "succeeded"})
  (ev root "lane" {:event_type "lane.changed" :agent "unknown-high"})
  (ev root "correction" {:event_type "correction" :agent "claude-opus-5-5"})
  (ev root "interrupted" {:event_type "run.interrupted" :agent "claude-sonnet-5-5-high"})
  (check "reasoning suffix and Claude model version normalized to base agent"
         (= ["codex-sol" "codex-terra" nil "claude-opus" "claude-sonnet"] (mapv :agent (events root))))
  (check "normalized agent not counted as redaction" (= 1 (:redacted-values (stats root)))))

;; invalid IDs are rejected with a body-less marker
(let [root (str (fs/path tmp "b"))]
  (ai-ops-ledger/emit! root {:event_id "BOXP-1:password-hunter2" :task_id "BOXP-1" :request_id "req:BOXP-1"
                             :run_id run :event_type "run.started"})
  (ai-ops-ledger/emit! root {:event_id (ai-ops-ledger/event-id "boxp-1" run "started") :task_id "boxp-1"
                             :request_id "req:boxp-1" :run_id run :event_type "run.started"})
  (check "invalid ids rejected" (= 2 (:rejected-privacy (stats root))))
  (check "marker lines only" (= [{:privacy_rejected "upstream" :event_type "run.started"}
                                 {:privacy_rejected "upstream" :event_type "run.started"}] (vec (events root))))
  (check "no secret in marker" (not-any? #(str/includes? % "hunter2") (lines root))))

;; day file cap
(let [root (str (fs/path tmp "c"))
      f (ai-ops-ledger/day-file root)]
  (fs/create-dirs (fs/parent f))
  (spit (str f) (apply str (repeat 64 "x")))
  (with-redefs [ai-ops-ledger/max-bytes (constantly 32)]
    (check "emit returns nil when full" (nil? (ev root "started" {:event_type "run.started"}))))
  (check "dropped-full counted" (= 1 (:dropped-full (stats root))))
  (check "only a body-less loss marker appended"
         (= (str (apply str (repeat 64 "x")) "{\"collection_lost\":\"ledger_dropped\"}\n") (slurp (str f)))))

;; a lowered cap can leave a marker-less file above cap + headroom: the marker
;; must still be written once (headroom alone is not proof of a marker)
(let [root (str (fs/path tmp "c1"))
      f (ai-ops-ledger/day-file root)
      body (str (apply str (repeat 200 "x")) "\n")
      marker "{\"collection_lost\":\"ledger_dropped\"}\n"]
  (fs/create-dirs (fs/parent f))
  (spit (str f) body)
  (with-redefs [ai-ops-ledger/max-bytes (constantly 32)
                ai-ops-ledger/marker-headroom-bytes 16]
    (ev root "started" {:event_type "run.started"})
    (ev root "finished" {:event_type "run.finished" :status "succeeded"}))
  (check "lowered cap: marker appended once to marker-less file past headroom"
         (= (str body marker) (slurp (str f))))
  (check "lowered cap: both drops counted" (= 2 (:dropped-full (stats root)))))

;; a loss in the ledger reaches the aggregation: SLIs over the ledger become unknown
(let [root (str (fs/path tmp "c2"))
      sli (str (fs/path (System/getenv "AI_OPS_REPO") "docs" "project_docs" "BOXP-360" "tools" "ai_ops_sli.bb"))]
  (load-file sli)
  (ev root "started" {:event_type "run.started"})
  (ev root "finished" {:event_type "run.finished" :status "succeeded" :result "review"})
  (let [f (ai-ops-ledger/day-file root)
        before ((resolve (quote ai-ops-sli/aggregate*)) (events root))]
    (with-redefs [ai-ops-ledger/max-bytes (constantly (fs/size f))]
      (check "cap drop returns nil" (nil? (ev root "correction" {:event_type "correction" :correction_origin "agent-system"}))))
    (with-redefs [ai-ops-ledger/update-stats! (fn [& _] (throw (ex-info "disk" {})))]
      (ev root "lane" {:event_type "lane.changed" :lane_to "review"}))
    (let [r ((resolve (quote ai-ops-sli/aggregate*)) (events root))]
      (check "ledger without loss is determinable"
             (not= "unknown" (get-in before [:sli :agent-system-correction-task-ratio :status])))
      (check "ledger markers counted as collection loss"
             (= 2 (get-in r [:coverage :collection-lost :ledger-dropped])))
      (check "ledger loss makes correction SLI unknown"
             (= "unknown" (get-in r [:sli :agent-system-correction-task-ratio :status])))
      (check "ledger loss makes zero-tolerance unknown"
             (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status]))))))

;; concurrent emits
(let [root (str (fs/path tmp "d"))
      fs* (doall (for [_ (range 40)] (future (ev root "finished" {:event_type "run.finished" :status "succeeded"}))))]
  (run! deref fs*)
  (check "concurrent lines are valid json" (= 40 (count (events root))))
  (check "concurrent counters" (and (= 40 (:emitted (stats root)))
                                    (= 40 (get-in (stats root) [:run-finished ["codex-cli" "succeeded"]])))))

;; unwritable root never throws
(let [root (str (fs/path tmp "e"))]
  (fs/create-dirs root)
  (fs/set-posix-file-permissions root "r-xr-xr-x")
  (check "unwritable root returns nil" (nil? (ev root "started" {:event_type "run.started"})))
  (check "write-metrics on unwritable root returns nil" (nil? (ai-ops-ledger/write-metrics! root))))

;; disabled
(with-redefs [ai-ops-ledger/enabled? (constantly false)]
  (let [root (str (fs/path tmp "f"))]
    (ev root "started" {:event_type "run.started"})
    (check "disabled writes nothing" (not (fs/exists? (fs/path root "ai-ops"))))))

;; metrics exposition
(let [root (str (fs/path tmp "d"))]
  (ev root "correction" {:event_type "correction" :correction_class "gate_defect" :correction_origin "agent-system"
                         :classifier "rule" :classifier_version "correction-rules/v0" :confidence "high"
                         :evidence_event_ids [(ai-ops-ledger/event-id "BOXP-1" run "started")]})
  (ai-ops-ledger/record-gate! root "codex-review" false)
  (ai-ops-ledger/record-gate! root "https://evil" false)
  (ai-ops-ledger/record-gate! root "all" true)
  (ai-ops-ledger/record-gate! root "all" "skip")
  (check "write-metrics ok" (true? (ai-ops-ledger/write-metrics! root)))
  (let [m (slurp (str (ai-ops-ledger/metrics-path root)))]
    (doseq [s ["ai_ops_ledger_events_total{event_type=\"run.finished\"} 40"
               "ai_ops_ledger_lost_events_total{reason=\"file_full\"} 0"
               "ai_ops_runs_finished_total{runtime=\"codex-cli\",status=\"succeeded\"} 40"
               "ai_ops_review_gate_total{gate=\"codex-review\",result=\"fail\"} 1"
               "ai_ops_review_gate_total{gate=\"other\",result=\"fail\"} 1"
               "ai_ops_review_gate_total{gate=\"all\",result=\"pass\"} 1"
               "ai_ops_review_gate_total{gate=\"all\",result=\"skip\"} 1"
               "ai_ops_corrections_total{origin=\"agent-system\",class=\"gate_defect\"} 1"
               "ai_ops_ledger_info{schema_version=\"ai-ops-event/v0\",definition_version=\"ledger/v1\"} 1"
               "# TYPE ai_ops_ledger_events_total counter"]]
      (check (str "metrics contain " s) (str/includes? m s)))
    (check "metrics carry no ids or urls" (not (re-find #"BOXP-|evil|http" m)))))

;; retention
(let [root (str (fs/path tmp "g"))
      old (fs/path root "ai-ops" "ledger" "events-2000-01-01.jsonl")]
  (fs/create-dirs (fs/parent old))
  (spit (str old) "{}\n")
  (ev root "started" {:event_type "run.started"})
  (ai-ops-ledger/write-metrics! root)
  (check "old ledger file pruned" (not (fs/exists? old)))
  (check "current ledger file kept" (fs/exists? (ai-ops-ledger/day-file root))))

(if (seq @failures)
  (do (println "failures:" @failures) (System/exit 1))
  (println "ai-ops-ledger-test: all checks passed"))
'

# Separate processes (runner loop + manual tick) share one root: the stats
# read-modify-write and the temp file must not lose counts across processes.
concurrent_root="${tmp}/concurrent"
procs=4
per_proc=25
for i in $(seq 1 "${procs}"); do
  AI_OPS_MODULE="${module}" AI_OPS_ROOT="${concurrent_root}" AI_OPS_N="${per_proc}" bb -e '
(load-file (System/getenv "AI_OPS_MODULE"))
(def run "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57")
(dotimes [_ (Long/parseLong (System/getenv "AI_OPS_N"))]
  (ai-ops-ledger/emit! (System/getenv "AI_OPS_ROOT")
                       {:event_id (ai-ops-ledger/event-id "BOXP-1" run "started") :task_id "BOXP-1"
                        :request_id "req:BOXP-1" :run_id run :event_type "run.started"})
  (ai-ops-ledger/record-gate! (System/getenv "AI_OPS_ROOT") "all" "pass"))
' &
done
wait
AI_OPS_MODULE="${module}" AI_OPS_ROOT="${concurrent_root}" AI_OPS_EXPECTED="$((procs * per_proc))" bb -e '
(require (quote [babashka.fs :as fs]) (quote [clojure.string :as str]))
(load-file (System/getenv "AI_OPS_MODULE"))
(def root (System/getenv "AI_OPS_ROOT"))
(def expected (Long/parseLong (System/getenv "AI_OPS_EXPECTED")))
(def s (ai-ops-ledger/read-stats root))
(def n-lines (count (remove str/blank? (str/split-lines (slurp (str (ai-ops-ledger/day-file root)))))))
(def checks [["concurrent emitted count" (= expected (:emitted s))]
             ["concurrent gate count" (= expected (get-in s [:gate ["all" "pass"]]))]
             ["concurrent ledger lines" (= expected n-lines)]
             ["no stray temp files" (empty? (fs/glob (ai-ops-ledger/ai-ops-dir root) ".*.tmp"))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (println "stats:" s "lines:" n-lines) (System/exit 1))
(println "ai-ops-ledger-test: concurrent checks passed")
'

# A process holding the ledger lock (hung writer) must not block runner
# lifecycle work: emit! gives up within the bounded wait, returns nil, and the
# lost write is counted once the lock is free again.
held_root="${tmp}/held"
mkdir -p "${held_root}/ai-ops"
AI_OPS_LOCK="${held_root}/ai-ops/ledger.lock" bb -e '
(with-open [f (java.io.RandomAccessFile. (System/getenv "AI_OPS_LOCK") "rw")]
  (.lock (.getChannel f))
  (spit (str (System/getenv "AI_OPS_LOCK") ".held") "1")
  (Thread/sleep 4000))
' &
holder=$!
for _ in $(seq 1 100); do [ -f "${held_root}/ai-ops/ledger.lock.held" ] && break; sleep 0.05; done
CODEX_TASK_BOARD_AI_OPS_LEDGER_LOCK_TIMEOUT_MS=300 AI_OPS_MODULE="${module}" AI_OPS_ROOT="${held_root}" bb -e '
(load-file (System/getenv "AI_OPS_MODULE"))
(def root (System/getenv "AI_OPS_ROOT"))
(def run "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57")
(defn ev [] (ai-ops-ledger/emit! root {:event_id (ai-ops-ledger/event-id "BOXP-1" run "started") :task_id "BOXP-1"
                                       :request_id "req:BOXP-1" :run_id run :event_type "run.started"}))
(def t0 (System/currentTimeMillis))
(def r (ev))
(def elapsed (- (System/currentTimeMillis) t0))
;; While another process holds the lock nothing may be appended to the day file.
(def day-written-while-held? (clojure.java.io/.exists (clojure.java.io/file (str (ai-ops-ledger/day-file root)))))
(def gate-r (ai-ops-ledger/record-gate! root "all" "pass"))
(def metrics-r (ai-ops-ledger/write-metrics! root))
(Thread/sleep 4500)
;; No emit! follows the lost write: write-metrics! alone must expose it.
(def metrics-r2 (ai-ops-ledger/write-metrics! root))
(def m (slurp (str (ai-ops-ledger/metrics-path root))))
(def s-before-emit (ai-ops-ledger/read-stats root))
(def day-lines (clojure.string/split-lines (slurp (str (ai-ops-ledger/day-file root)))))
(def r2 (ev))
(def s (ai-ops-ledger/read-stats root))
(def checks [["held lock: emit returns nil" (nil? r)]
             ["held lock: emit gives up within bound" (< elapsed 2500)]
             ["held lock: record-gate/write-metrics do not throw" (and (nil? gate-r) (nil? metrics-r))]
             ["after release: write-metrics succeeds" (true? metrics-r2)]
             ["after release: loss exported without a later emit"
              ;; one lost emit + one lost gate count
              (and (= 2 (:write-errors s-before-emit))
                   (clojure.string/includes? m "ai_ops_ledger_lost_events_total{reason=\"write_error\"} 2"))]
             ["held lock: no lost marker appended outside the lock" (not day-written-while-held?)]
             ["after release: lost event marker written by next lock holder (gate loss adds none)"
              (= ["{\"collection_lost\":\"ledger_dropped\"}"] day-lines)]
             ["after release: emit succeeds" (some? r2)]
             ["after release: lost write and gate counted" (= 2 (:write-errors s))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (println "stats:" s "elapsed:" elapsed) (System/exit 1))
(println "ai-ops-ledger-test: held-lock checks passed")
'
wait "${holder}"

# A short-lived process (manual tick) that loses a write to a lock timeout and
# exits without flushing must not lose the count: another process's
# write-metrics! exports it.
spool_root="${tmp}/spool"
mkdir -p "${spool_root}/ai-ops"
AI_OPS_LOCK="${spool_root}/ai-ops/ledger.lock" bb -e '
(with-open [f (java.io.RandomAccessFile. (System/getenv "AI_OPS_LOCK") "rw")]
  (.lock (.getChannel f))
  (spit (str (System/getenv "AI_OPS_LOCK") ".held") "1")
  (Thread/sleep 2500))
' &
holder=$!
for _ in $(seq 1 100); do [ -f "${spool_root}/ai-ops/ledger.lock.held" ] && break; sleep 0.05; done
CODEX_TASK_BOARD_AI_OPS_LEDGER_LOCK_TIMEOUT_MS=200 AI_OPS_MODULE="${module}" AI_OPS_ROOT="${spool_root}" bb -e '
(load-file (System/getenv "AI_OPS_MODULE"))
(def run "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57")
(assert (nil? (ai-ops-ledger/emit! (System/getenv "AI_OPS_ROOT")
                                   {:event_id (ai-ops-ledger/event-id "BOXP-1" run "started") :task_id "BOXP-1"
                                    :request_id "req:BOXP-1" :run_id run :event_type "run.started"})))
'
wait "${holder}"
AI_OPS_MODULE="${module}" AI_OPS_ROOT="${spool_root}" bb -e '
(require (quote [babashka.fs :as fs]))
(load-file (System/getenv "AI_OPS_MODULE"))
(def root (System/getenv "AI_OPS_ROOT"))
(def ok (ai-ops-ledger/write-metrics! root))
(def m (slurp (str (ai-ops-ledger/metrics-path root))))
(def ok2 (ai-ops-ledger/write-metrics! root))
(def s (ai-ops-ledger/read-stats root))
(def checks [["exited process loss: write-metrics succeeds" (and (true? ok) (true? ok2))]
             ["exited process loss: exported by another process"
              (clojure.string/includes? m "ai_ops_ledger_lost_events_total{reason=\"write_error\"} 1")]
             ["exited process loss: counted once" (= 1 (:write-errors s))]
             ["exited process loss: marker written once by next lock holder"
              (= "{\"collection_lost\":\"ledger_dropped\"}\n" (slurp (str (ai-ops-ledger/day-file root))))]
             ["exited process loss: spool drained" (empty? (fs/list-dir (ai-ops-ledger/pending-write-errors-dir root)))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (println "stats:" s) (System/exit 1))
(println "ai-ops-ledger-test: exited-process loss checks passed")
'

# Spool consumption must survive a crash between the stats update and the spool
# deletion (no double count) and a crash before the stats update (no loss).
crash_root="${tmp}/crash"
AI_OPS_MODULE="${module}" AI_OPS_ROOT="${crash_root}" bb -e '
(require (quote [babashka.fs :as fs]))
(load-file (System/getenv "AI_OPS_MODULE"))
(def root (System/getenv "AI_OPS_ROOT"))
(def spool-dir (ai-ops-ledger/pending-write-errors-dir root))
(fs/create-dirs spool-dir)
;; crash after the stats update: a and b already counted and listed as consumed
(fs/create-file (fs/path spool-dir "a")) (fs/create-file (fs/path spool-dir "b"))
(ai-ops-ledger/update-stats! root (constantly {:write-errors 2 :consumed-write-error-spool #{"a" "b"}}))
;; crash before the stats update: c spooled but not yet counted
(fs/create-file (fs/path spool-dir "c"))
(def ok (ai-ops-ledger/write-metrics! root))
(def s (ai-ops-ledger/read-stats root))
(def ok2 (ai-ops-ledger/write-metrics! root))
(def s2 (ai-ops-ledger/read-stats root))
(def checks [["crash recovery: write-metrics succeeds" (and (true? ok) (true? ok2))]
             ["crash recovery: consumed spool not counted twice, fresh spool counted" (= 3 (:write-errors s))]
             ["crash recovery: spool drained" (empty? (fs/list-dir spool-dir))]
             ["crash recovery: stable on next flush" (and (= 3 (:write-errors s2)) (empty? (:consumed-write-error-spool s2)))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (println "stats:" s s2) (System/exit 1))
(println "ai-ops-ledger-test: spool crash-recovery checks passed")
'

# A loss spooled before the UTC date change and flushed afterwards must leave
# its marker in the loss date's day file, not the flush date's.
midnight_root="${tmp}/midnight"
AI_OPS_MODULE="${module}" AI_OPS_ROOT="${midnight_root}" bb -e '
(require (quote [babashka.fs :as fs]) (quote [clojure.string :as str]))
(load-file (System/getenv "AI_OPS_MODULE"))
(def root (System/getenv "AI_OPS_ROOT"))
(def today (ai-ops-ledger/utc-date))
(def yesterday (str (.minusDays (java.time.LocalDate/parse today) 1)))
(def before (str (.minusDays (java.time.LocalDate/parse today) 2)))
;; spooled loss from another (exited) process, recorded yesterday
(ai-ops-ledger/spool-write-error! root :event yesterday)
;; in-process fallback counter for a loss two days ago
(swap! ai-ops-ledger/unrecorded-lost-events update before (fnil inc 0))
(swap! ai-ops-ledger/unrecorded-write-errors inc)
(def spool-name (str (fs/file-name (first (fs/list-dir (ai-ops-ledger/pending-write-errors-dir root))))))
(def ok (ai-ops-ledger/write-metrics! root))
(defn markers [date] (let [p (ai-ops-ledger/day-file root date)]
                       (if (fs/exists? p) (count (filter #(str/includes? % "collection_lost") (str/split-lines (slurp (str p))))) 0)))
(def checks [["midnight: write-metrics succeeds" (true? ok)]
             ["midnight: spool name carries loss date" (= yesterday (ai-ops-ledger/lost-event-spool-date spool-name))]
             ["midnight: spooled loss marker in loss-date file" (= 1 (markers yesterday))]
             ["midnight: in-process loss marker in loss-date file" (= 1 (markers before))]
             ["midnight: no marker in flush-date file" (zero? (markers today))]
             ["midnight: both losses counted" (= 2 (:write-errors (ai-ops-ledger/read-stats root)))]
             ["midnight: legacy undated spool falls back to flush date" (= today (ai-ops-ledger/lost-event-spool-date "event-123-456-abc"))]
             ["midnight: gate spool has no date" (nil? (ai-ops-ledger/lost-event-spool-date "123-456-abc"))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (System/exit 1))
(println "ai-ops-ledger-test: date-change loss checks passed")
'

# A marker append that fails during a flush must stay pending on disk, so a
# later process still writes it after the first (short-lived) one exits.
marker_root="${tmp}/marker-retry"
AI_OPS_MODULE="${module}" AI_OPS_ROOT="${marker_root}" bb -e '
(require (quote [babashka.fs :as fs]) (quote [clojure.string :as str]))
(load-file (System/getenv "AI_OPS_MODULE"))
(def root (System/getenv "AI_OPS_ROOT"))
(def today (ai-ops-ledger/utc-date))
(ai-ops-ledger/spool-write-error! root :event today)
(def ok1 (with-redefs [ai-ops-ledger/append-lost-marker! (fn [_] false)]
           (ai-ops-ledger/write-metrics! root)))
;; simulate the first process exiting: in-process state is gone
(reset! ai-ops-ledger/unrecorded-lost-events {})
(reset! ai-ops-ledger/unrecorded-write-errors 0)
(defn markers [] (let [p (ai-ops-ledger/day-file root today)]
                   (if (fs/exists? p) (count (filter #(str/includes? % "collection_lost") (str/split-lines (slurp (str p))))) 0)))
(def before (markers))
(def ok2 (ai-ops-ledger/write-metrics! root))
(def after (markers))
(def ok3 (ai-ops-ledger/write-metrics! root))
(def checks [["marker retry: write-metrics succeeds" (and (true? ok1) (true? ok2) (true? ok3))]
             ["marker retry: no marker while append fails" (zero? before)]
             ["marker retry: marker written by a later process" (= 1 after)]
             ["marker retry: marker not repeated" (= 1 (markers))]
             ["marker retry: obligation cleared" (empty? (fs/list-dir (ai-ops-ledger/pending-lost-markers-dir root)))]
             ["marker retry: loss counted once" (= 1 (:write-errors (ai-ops-ledger/read-stats root)))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (System/exit 1))
(println "ai-ops-ledger-test: pending marker retry checks passed")
'

# emit! write errors: when only the marker append fails (the stats update
# succeeds), the obligation must still be kept so a later flush writes it.
emit_marker_root="${tmp}/emit-marker-retry"
AI_OPS_MODULE="${module}" AI_OPS_ROOT="${emit_marker_root}" bb -e '
(require (quote [babashka.fs :as fs]) (quote [clojure.string :as str]))
(load-file (System/getenv "AI_OPS_MODULE"))
(def root (System/getenv "AI_OPS_ROOT"))
(def today (ai-ops-ledger/utc-date))
(def ev {:event_type "run.started" :task_id "BOXP-1" :run_id "20261029T000000Z-00000000-0000-0000-0000-000000000001"})
(def r1 (with-redefs [ai-ops-ledger/append-line! (fn [_ _] (throw (ex-info "disk" {})))]
          (ai-ops-ledger/emit! root ev)))
(def obligation? (fs/exists? (fs/path (ai-ops-ledger/pending-lost-markers-dir root) today)))
(reset! ai-ops-ledger/unrecorded-lost-events {})
(reset! ai-ops-ledger/unrecorded-write-errors 0)
(defn markers [] (let [p (ai-ops-ledger/day-file root today)]
                   (if (fs/exists? p) (count (filter #(str/includes? % "collection_lost") (str/split-lines (slurp (str p))))) 0)))
(def ok (ai-ops-ledger/write-metrics! root))
(def checks [["emit marker retry: emit returns nil" (nil? r1)]
             ["emit marker retry: obligation kept after failed marker" obligation?]
             ["emit marker retry: write-metrics succeeds" (true? ok)]
             ["emit marker retry: marker written by later flush" (= 1 (markers))]
             ["emit marker retry: obligation cleared" (empty? (fs/list-dir (ai-ops-ledger/pending-lost-markers-dir root)))]
             ["emit marker retry: loss counted once" (= 1 (:write-errors (ai-ops-ledger/read-stats root)))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (System/exit 1))
(println "ai-ops-ledger-test: emit marker retry checks passed")
'
