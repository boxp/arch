#!/usr/bin/env bb
;; BOXP-673: replay the operation sequences generated from the Lean model of the PR gate
;; failure budget (tests/codex-workspace/gate-budget-model/) against the runner's real
;; budget functions and compare, after every operation, what the operation returned, each
;; ticket's used/limit/PR count/exhaustion/live reservation and each PR's audit count.
;; Needs only bb: the sequences are a committed file.
;;
;;   bb tests/codex-workspace/task-board-gate-budget-trace-test.bb [--traces FILE] [--runner FILE] [--max-report N]
;;
;; Every file is written under a fresh temporary directory. The process environment is
;; not consulted by the loaded runner (`env` is replaced), so a real root or vault that
;; happens to be configured in the shell is never touched.
(require '[babashka.fs :as fs] '[clojure.string :as str])

(def args (vec *command-line-args*))
(defn arg [flag default] (or (second (drop-while #(not= flag %) args)) default))
(def here (-> *file* fs/canonicalize fs/parent))
(def traces-file (arg "--traces" (str (fs/path here "gate-budget-model" "gate-budget-traces.txt.gz"))))

(defn read-traces [path]
  (if (str/ends-with? (str path) ".gz")
    (with-open [in (java.util.zip.GZIPInputStream. (java.io.FileInputStream. (str path)))]
      (slurp in))
    (slurp path)))
(def runner-file (arg "--runner" (str (fs/path (fs/parent (fs/parent here)) "docker" "codex-workspace" "task-board" "task_board_runner.bb"))))
(def max-report (parse-long (arg "--max-report" "5")))

(when-let [hooks (seq (filter #(str/starts-with? % "CODEX_TASK_BOARD_TEST_") (keys (System/getenv))))]
  (binding [*out* *err*] (println "refusing to run with runner test hooks in the environment:" hooks))
  (System/exit 2))

(System/setProperty "babashka.file" "/nonexistent/load-runner.bb")
(load-file runner-file)

;; ---------------------------------------------------------------------------
;; The world the runner functions see: a temporary root, a clock that moves one
;; second per operation (so every record has its own time, as the model assumes)
;; and the budget unit tightened to the model's 2 through the only setting the
;; runner accepts for it.

(def tmp (str (fs/create-temp-dir {:prefix "task-board-gate-budget-trace-"})))
(def base (java.time.Instant/parse "2026-01-01T00:00:00Z"))
(def clock (atom 0))
(def tickets {"1" "BOXP-1" "2" "BOXP-2"})
(def prs {"a" "o/r#1" "b" "o/r#2"})
(def pr-urls {"a" "https://github.com/o/r/pull/1" "b" "https://github.com/o/r/pull/2"})
(def runs "ticket key -> the lock of its run that has started and not finished." (atom {}))

(alter-var-root #'env (constantly (fn [k default]
                                    (if (= k "CODEX_TASK_BOARD_GATE_FAILURE_BUDGET") "2" default))))
(alter-var-root #'root (constantly (fn [] (str tmp "/root"))))
(alter-var-root #'vault (constantly (fn [] (str tmp "/vault"))))
(alter-var-root #'now (constantly (fn [] (.plusSeconds base @clock))))
(alter-var-root #'log! (constantly (fn [& _] nil)))
(alter-var-root #'owner-id (constantly (fn [] "A")))

(defn start!
  "The start of a run as `tick!` does it: the cheap pre-check, the ticket lock, then the
  reservation under the budget lock; a refused reservation gives the lock back."
  [k]
  (let [ticket (tickets k)]
    (if (and (fs/exists? (gate-failure-budget-path)) (gate-budget-exhausted-for-ticket? ticket ""))
      0
      (if-let [lock (acquire-lock! ticket :implement "In Progress")]
        (if (reserve-gate-budget-run! ticket (:run-id lock) "")
          (do (swap! runs assoc k lock) 1)
          (do (release-lock! ticket lock) 0))
        0))))

(defn add-legacy-grant!
  "A ticket grant as the runner wrote it before BOXP-448: no :kind."
  [ticket]
  (with-gate-failure-budget-lock
   (fn []
     (write-gate-failure-budget!
      (update (read-gate-failure-budget) :grants (fnil conj [])
              {:scope :ticket :key ticket :amount 1 :granted-by "owner" :granted-at (now-str)})))))

(defn apply-ev!
  "Run one operation and return its result as the model counts it: 1 when a run started,
  or when the ticket is exhausted after a failure was processed, otherwise 0."
  [ev]
  (swap! clock inc)
  (let [op (first ev) k (subs ev 1 2) p (when (> (count ev) 2) (subs ev 2 3))
        ticket (tickets k) lock (get @runs k)]
    (case op
      \s (start! k)
      \e (do (when lock (release-lock! ticket lock) (swap! runs dissoc k)) 0)
      \p (do (when lock
               (record-gate-pr-registrations! ticket (:run-id lock) {:ok? true :checked-pr-urls [(pr-urls p)]}))
             0)
      ;; The order of the two calls is the one at the end of a run in `tick!`.
      \f (if lock
           (let [gate {:ok? false :retryable? true :gate :ci :url (pr-urls p)}]
             (record-gate-pr-registrations! ticket (:run-id lock) gate)
             (if (:exhausted? (record-gate-failure-budget! ticket (:run-id lock) "agent" gate)) 1 0))
           0)
      \g (do (gate-budget-grant! :ticket ticket 1 "owner") 0)
      \l (do (add-legacy-grant! ticket) 0)
      \x (do (gate-budget-exclude-pr! ticket (prs p) "owner") 0))))

(defn observe-ticket [budget k]
  (let [ticket (tickets k)
        {:keys [used limit n exhausted?]} (gate-budget-status budget :ticket ticket)
        reservation (get-in budget [:reservations ticket])]
    (str used "/" limit "/" n (when exhausted? "x")
         (when (and reservation (gate-budget-reservation-live? reservation))
           (str "r" (str/join (keep (fn [[c id]] (when (some #{id} (:prs reservation)) c)) (sort prs))))))))

(defn observe-pr [budget p]
  (let [{:keys [used legacy-limit-reached? exhausted?]} (gate-budget-status budget :pr (prs p))]
    ;; A PR never reports exhaustion (BOXP-450); if it did, the line would not match.
    (str used (when legacy-limit-reached? "L") (when exhausted? "!"))))

(defn observe [result]
  (let [budget (read-gate-failure-budget)]
    (str result ";" (observe-ticket budget "1") ";" (observe-ticket budget "2")
         ";" (observe-pr budget "a") ";" (observe-pr budget "b"))))

(defn reset-world! []
  (assert (str/starts-with? (str (root)) tmp))
  (fs/delete-tree (root))
  (reset! clock 0)
  (reset! runs {})
  (ensure-root!)
  (activate-owner!))

(defn replay-line
  "nil when the implementation agrees with every expected observation of the line."
  [line]
  (let [[evs exp] (str/split line #"\|")
        evs (str/split evs #",") exp (str/split exp #",")]
    (assert (= (count evs) (count exp)) (str "malformed line: " line))
    (reset-world!)
    (loop [i 0]
      (when (< i (count evs))
        (let [o (try (observe (apply-ev! (nth evs i)))
                     (catch Exception e (str "exception: " (.getMessage e))))]
          (if (= o (nth exp i))
            (recur (inc i))
            {:trace (str/join "," (take (inc i) evs)) :expected (nth exp i) :actual o}))))))

(let [lines (remove str/blank? (str/split-lines (read-traces traces-file)))
      t0 (System/currentTimeMillis)
      bad (vec (keep replay-line lines))
      steps (reduce + (map #(inc (count (filter #{\,} (first (str/split % #"\|"))))) lines))]
  (fs/delete-tree tmp)
  (assert (seq lines) "no traces")
  (doseq [b (take max-report (sort-by (comp count :trace) bad))]
    (println "MISMATCH" (pr-str b)))
  (println (pr-str {:traces (count lines) :steps steps :mismatches (count bad)
                    :seconds (/ (- (System/currentTimeMillis) t0) 1000.0)}))
  (System/exit (if (seq bad) 1 0)))
