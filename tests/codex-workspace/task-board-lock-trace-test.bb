#!/usr/bin/env bb
;; BOXP-650: replay the operation sequences generated from the Lean lock model
;; (tests/codex-workspace/lock-model/) against the runner's real lock functions and
;; compare, after every operation, what the operation returned, the lock file, the
;; owner state files, the planned-shutdown markers and the runs each process still has. Needs only bb: the sequences are a committed file.
;;
;;   bb tests/codex-workspace/task-board-lock-trace-test.bb [--traces FILE] [--runner FILE] [--max-report N]
;;
;; Every file is written under a fresh temporary directory. The process environment is
;; not consulted by the loaded runner (`env` is replaced), so a real root or vault that
;; happens to be configured in the shell is never touched.
(require '[babashka.fs :as fs] '[clojure.edn :as edn] '[clojure.string :as str])

(def args (vec *command-line-args*))
(defn arg [flag default] (or (second (drop-while #(not= flag %) args)) default))
(def here (-> *file* fs/absolutize fs/parent))
(def traces-file (arg "--traces" (str (fs/path here "lock-model" "lock-traces.txt"))))
(def runner-file (arg "--runner" (str (fs/path (fs/parent (fs/parent here)) "docker" "codex-workspace" "task-board" "task_board_runner.bb"))))
(def max-report (parse-long (arg "--max-report" "5")))

(when-let [hooks (seq (filter #(str/starts-with? % "CODEX_TASK_BOARD_TEST_") (keys (System/getenv))))]
  (binding [*out* *err*] (println "refusing to run with runner test hooks in the environment:" hooks))
  (System/exit 2))

(System/setProperty "babashka.file" "/nonexistent/load-runner.bb")
(load-file runner-file)

;; ---------------------------------------------------------------------------
;; The world the runner functions see: a temporary root, a clock moved by the
;; sequence, and "which runner process is calling" switched per operation.

(def tmp (str (fs/create-temp-dir {:prefix "task-board-lock-trace-"})))
(def base (java.time.Instant/parse "2026-01-01T00:00:00Z"))
(def clock (atom 0))
(def ticket "BOXP-1")
(def procs "owner -> {:gen n :held [lock ...]}: the live runner process of each owner and
  the runs it started and has not finished, oldest first." (atom {}))
(def grants "run-id -> order of the grant, the model's run number." (atom {}))

(alter-var-root #'env (constantly (fn [_ default] default)))
(alter-var-root #'root (constantly (fn [] (str tmp "/root"))))
(alter-var-root #'vault (constantly (fn [] (str tmp "/vault"))))
(alter-var-root #'now (constantly (fn [] (.plusSeconds base @clock))))
(alter-var-root #'log! (constantly (fn [& _] nil)))

(defn as-runner
  "Call f as the current process of owner r (owner id and instance id are what a
  real process reads from its environment once, at start)."
  [r f]
  (alter-var-root #'owner-id (constantly (fn [] r)))
  (alter-var-root #'runner-instance-id (constantly (str (get-in @procs [r :gen]))))
  (f))

(defn apply-ev!
  "Run one operation and return its result as the model counts it: 1 when a lock was
  granted, a heartbeat was written or the run's own lock was deleted, otherwise 0."
  [ev]
  (let [k (first ev) r (subs ev 1)
        held (get-in @procs [r :held])]
    (case k
      \t (do (swap! clock + (parse-long r)) 0)
      \a (as-runner r #(if-let [l (acquire-lock! ticket :implement "Ready")]
                         (do (swap! grants assoc (:run-id l) (count @grants))
                             (swap! procs update-in [r :held] conj l)
                             1)
                         0))
      ;; Every unfinished run of the process beats once, as its heartbeat threads do.
      \b (as-runner r #(count (filterv true? (mapv (fn [l] (heartbeat-once! ticket l)) held))))
      ;; The oldest unfinished run of the process ends and releases its lock.
      \r (as-runner r #(if-let [l (first held)]
                         (let [deleted? (release-lock! ticket l)]
                           (swap! procs update-in [r :held] (comp vec rest))
                           (if deleted? 1 0))
                         0))
      \c (do (as-runner r #(recover-locks!)) 0)
      \s (do (as-runner r prepare-shutdown!) 0)
      ;; A new process of the same owner: the old one is gone with what it held.
      ;; The two calls are the start of `loop!`, in its order.
      \R (do (swap! procs update r (fn [p] {:gen (inc (:gen p)) :held []}))
             (as-runner r #(do (recover-locks! true) (activate-owner!)))
             0))))

(defn observe-owner [r]
  (let [state (read-edn-file (owner-state-path r) nil)
        marker (read-edn-file (shutdown-marker-path r) nil)]
    (str (:instance-id state "?")
         (case (:status state) :active "a" :terminating "t" :terminated "x" "?")
         (if marker (str "m" (:instance-id marker)) "-")
         (if-let [held (seq (get-in @procs [r :held]))]
           (str/join "+" (map #(get @grants (:run-id %) "?") held))
           "-"))))

(defn observe [result]
  (let [l (read-edn-file (lock-path ticket) nil)]
    (str result ";"
         (if l
           (str (:owner-id l) (:owner-instance-id l) "." (get @grants (:run-id l) "?") "."
                (.getSeconds (java.time.Duration/between base (java.time.Instant/parse (:heartbeat-at l)))))
           "-")
         ";" (observe-owner "A") ";" (observe-owner "B"))))

(defn reset-world! []
  (assert (str/starts-with? (str (root)) tmp))
  (fs/delete-tree (root))
  (reset! clock 0)
  (reset! grants {})
  (reset! procs {"A" {:gen 0 :held []} "B" {:gen 0 :held []}})
  ;; The model starts with both owners running: state files active, no marker.
  (doseq [r ["A" "B"]] (as-runner r #(do (ensure-root!) (activate-owner!)))))

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

(let [lines (remove str/blank? (str/split-lines (slurp traces-file)))
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
