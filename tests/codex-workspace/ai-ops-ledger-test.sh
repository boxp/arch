#!/usr/bin/env bash
# BOXP-360: AI ops ledger (docker/codex-workspace/task-board/ai_ops_ledger.bb).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
module="${repo_root}/docker/codex-workspace/task-board/ai_ops_ledger.bb"
tmp="$(mktemp -d)"
trap 'chmod -R u+w "${tmp}" 2>/dev/null || true; rm -rf "${tmp}"' EXIT

AI_OPS_MODULE="${module}" AI_OPS_TMP="${tmp}" bb -e '
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
  (check "nothing appended" (= 64 (fs/size f))))

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
(def gate-r (ai-ops-ledger/record-gate! root "all" "pass"))
(def metrics-r (ai-ops-ledger/write-metrics! root))
(Thread/sleep 4500)
(def r2 (ev))
(def s (ai-ops-ledger/read-stats root))
(def checks [["held lock: emit returns nil" (nil? r)]
             ["held lock: emit gives up within bound" (< elapsed 2500)]
             ["held lock: record-gate/write-metrics do not throw" (and (nil? gate-r) (nil? metrics-r))]
             ["after release: emit succeeds" (some? r2)]
             ["after release: lost write counted" (= 1 (:write-errors s))]])
(doseq [[l ok] checks] (println (if ok "ok" "FAIL") l))
(when-not (every? second checks) (println "stats:" s "elapsed:" elapsed) (System/exit 1))
(println "ai-ops-ledger-test: held-lock checks passed")
'
wait "${holder}"
