#!/usr/bin/env bb
;; harness_eval.bb (harness-eval/v1-draft) の fixture テスト。実モデルは呼ばず、fake_agent.bb だけを使う。
;; 実行: bb tests/harness-eval/test_harness_eval.bb
(require '[babashka.fs :as fs] '[babashka.process :as p] '[cheshire.core :as json]
         '[clojure.edn :as edn] '[clojure.string :as str]
         '[clojure.test :refer [deftest is run-tests testing]])

(def here (str (fs/parent (fs/absolutize *file*))))
(def repo (str (fs/parent (fs/parent here))))
(def tool (str (fs/path repo "docker/codex-workspace/task-board/harness_eval.bb")))
(def fake-agent (str "bb " (fs/path here "fake_agent.bb")))
(def tasks-dir (str (fs/path here "tasks")))

(defn he
  "harness_eval.bb を別プロセスで実行する (本番と同じ入口)。"
  [env & args]
  (let [r @(p/process (into ["bb" tool] (map str args)) {:out :string :err :string :extra-env env})]
    {:exit (:exit r) :out (:out r) :err (:err r)}))

(defn tmp [] (str (fs/create-temp-dir {:prefix "harness-eval-test-"})))

(defn plan! [out & {:keys [reps timeout only arms env] :or {reps 1 timeout 60 env {}}}]
  (apply he env "plan" "--out" out "--tasks-dir" tasks-dir "--reps" reps "--trial-timeout-seconds" timeout
         (concat (when only ["--only" only]) (when arms ["--arms" arms]))))

(defn run! [out env & args] (apply he env "run" "--out" out "--agent-cmd" fake-agent args))
(defn compare! [out] (json/parse-string (:out (he {} "compare" "--out" out)) true))
(defn prom! [out] (:out (he {} "prom" "--out" out)))
(defn trials [out] (->> (fs/list-dir (fs/path out "trials") "*.edn") (map #(edn/read-string (slurp (str %)))) (sort-by (juxt :task :arm :rep)) vec))
(defn arm [cmp a] (get-in cmp [:groups 0 :arms (keyword a)]))

(deftest budget-is-recorded-before-trials-and-overspend-is-refused
  (let [out (tmp)]
    (testing "上限内は budget.edn を作る"
      (let [r (plan! out :reps 2)]
        (is (zero? (:exit r)) (:err r))
        (let [b (edn/read-string (slurp (str (fs/path out "budget.edn"))))]
          (is (= "harness-eval/v1-draft" (:definition-version b)))
          (is (= 2 (:reps b)))
          (is (= ["A" "B"] (:arms b)))
          (is (= 24 (:max-trials b)))
          (is (= 60 (:trial-timeout-seconds b)))
          (is (string? (:harness-version b))))))
    (testing "繰返し 4 / timeout 901 秒は拒否し、何も作らない"
      (doseq [[k v] [[:reps 4] [:timeout 901]]]
        (let [out2 (tmp) r (plan! out2 k v)]
          (is (= 2 (:exit r)))
          (is (str/includes? (:err r) "予算超過"))
          (is (not (fs/exists? (fs/path out2 "budget.edn")))))))
    (testing "arm は A/B だけ"
      (let [out3 (tmp) r (plan! out3 :arms "A,C")]
        (is (= 2 (:exit r)))))
    (testing "plan なしの run は失敗する"
      (is (not (zero? (:exit (run! (tmp) {}))))))))

(deftest both-arms-solve-means-no-regression
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 3))))
    (let [r (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})]
      (is (zero? (:exit r)) (:err r)))
    (let [ts (trials out) cmp (compare! out)]
      (is (= 36 (count ts)))
      (is (every? #(= "pass" (:outcome %)) ts))
      (is (= 18 (:pass (arm cmp "A"))))
      (is (= 18 (:pass (arm cmp "B"))))
      (is (= "no_regression" (get-in cmp [:groups 0 :regression :status])))
      (is (= "fake-model-1" (get-in cmp [:groups 0 :model_rev])) "model_rev は init イベントから取る")
      (is (pos? (get-in cmp [:groups 0 :regression :evidence :prompt_chars_gap])) "arm B の prompt は契約文の分だけ長い")
      (is (= 5 (get-in (arm cmp "A") [:tool_calls_median :total])))
      (is (every? #(= ["claude-policy-prompt" "delegation-prompt" "append-note-instruction" "lane-contract"] (:harness-contract-fns %))
                  (filter #(= "B" (:arm %)) ts)))
      (is (every? #(nil? (:harness-contract-fns %)) (filter #(= "A" (:arm %)) ts))))
    (testing "prom は劣化なしを 1、他を 0 で出し、分母に全結果を並べる"
      (let [text (prom! out)]
        (is (str/includes? text "ai_ops_harness_eval_regression{model_rev=\"fake-model-1\",harness_version=\""))
        (is (re-find #"status=\"no_regression\"\} 1" text))
        (is (re-find #"status=\"suspected\"\} 0" text))
        (is (re-find #"arm=\"B\",task=\"T06\",outcome=\"pass\"\} 3" text))
        (is (re-find #"arm=\"B\",task=\"T06\",outcome=\"timeout\"\} 0" text))
        (is (re-find #"ai_ops_harness_eval_budget\{part=\"max_trials\"\} 36" text))
        (is (re-find #"ai_ops_harness_eval_info\{definition_version=\"harness-eval/v1-draft\"\} 1" text))))))

(deftest arm-b-noop-is-a-suspected-regression
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "solve" "HARNESS_EVAL_FAKE_ARM_B_MODE" "noop"}))))
    (let [cmp (compare! out) reg (get-in cmp [:groups 0 :regression])]
      (is (= 6 (:pass (arm cmp "A"))))
      (is (= 0 (:pass (arm cmp "B"))))
      (is (= 6 (:fail (arm cmp "B"))))
      (is (= "suspected" (:status reg)))
      (is (= 6 (get-in reg [:evidence :pass_gap])))
      (is (str/includes? (:note cmp) "断定") "断定しない注記を付ける")
      (is (re-find #"status=\"suspected\"\} 1" (prom! out))))))

(deftest too-few-trials-per-arm-is-insufficient
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01,T02"))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_ARM_B_MODE" "noop"}))))
    (let [cmp (compare! out)]
      (is (= 2 (:trials (arm cmp "A"))))
      (is (= "insufficient" (get-in cmp [:groups 0 :regression :status])) "各 arm 3 試行未満では判定しない")
      (is (re-find #"status=\"insufficient\"\} 1" (prom! out))))))

(deftest timeout-counts-in-the-denominator
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01" :arms "A" :timeout 1))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "sleep" "HARNESS_EVAL_FAKE_SLEEP_SECONDS" "20"}))))
    (let [[t] (trials out) cmp (compare! out)]
      (is (= "timeout" (:outcome t)))
      (is (nil? (:exit-code t)))
      (is (< (:seconds t) 10) "timeout で process を止める")
      (is (= 1 (:timeout (arm cmp "A"))))
      (is (= 1 (:trials (arm cmp "A"))))
      (is (= 0.0 (:pass_rate (arm cmp "A"))))
      (is (re-find #"outcome=\"timeout\"\} 1" (prom! out))))))

(deftest disallowed-changes-fail-even-if-accept-passes
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T06" :arms "A"))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "break"}))))
    (let [[t] (trials out)]
      (is (= "fail" (:outcome t)))
      (is (pos? (:disallowed-changes t)))
      (is (nil? (:accept-exit t)) "許可外の変更があれば accept は走らせない"))))

(deftest agent-error-exit-is-error-not-fail
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01" :arms "A"))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "error"}))))
    (let [[t] (trials out)]
      (is (= "error" (:outcome t)))
      (is (= 3 (:exit-code t))))))

(deftest unreadable-events-keep-the-accept-outcome
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T02" :arms "A"))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "garbage"}))))
    (let [[t] (trials out) cmp (compare! out)]
      (is (= "pass" (:outcome t)) "受入は events と独立")
      (is (false? (:events-readable? t)))
      (is (nil? (:tool-calls t)) "壊れた記録から回数を数えない")
      (is (= 1 (:events_unreadable (arm cmp "A"))))
      (is (nil? (:tool_calls_median (arm cmp "A"))))
      (is (not (str/includes? (prom! out) "ai_ops_harness_eval_tool_calls{")) "読める試行が無ければ tool_calls を 0 で埋めない"))))

(deftest stop-file-aborts-the-rest
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01,T02,T03" :arms "A"))))
    (spit (str (fs/path out "STOP")) "")
    (is (zero? (:exit (run! out {}))))
    (let [ts (trials out) cmp (compare! out)]
      (is (= 3 (count ts)))
      (is (every? #(= "aborted" (:outcome %)) ts))
      (is (= 0 (:trials (arm cmp "A"))) "aborted は試行数に入れない")
      (is (= 3 (:aborted (arm cmp "A"))))
      (is (not (re-find #"outcome=\"aborted\"" (prom! out)))))))

(deftest run-is-resumable-and-skips-recorded-trials
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01,T02" :arms "A"))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "noop"}))))
    (let [before (map :finished-at (trials out))]
      (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"}))))
      (is (= before (map :finished-at (trials out))) "記録済みの試行はやり直さない")
      (is (every? #(= "fail" (:outcome %)) (trials out))))))

(deftest no-prompt-or-task-text-leaves-the-out-dir
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01"))))
    (is (zero? (:exit (run! out {}))))
    (let [files (map str (fs/glob out "**"))
          text (str/join "\n" (map #(when (fs/regular-file? %) (slurp %)) files))
          task (edn/read-string (slurp (str (fs/path tasks-dir "T01" "task.edn"))))
          prom (prom! out)
          cmp (:out (he {} "compare" "--out" out))]
      (is (not (str/includes? text "harness-eval arm:")) "prompt の固定行が出力 DIR に無い")
      (is (not (str/includes? text (:requirement task))) "課題文が出力 DIR に無い")
      (is (not (str/includes? text "Task Board contract")) "契約文が出力 DIR に無い")
      (is (not (some #(str/ends-with? % "events.jsonl") files)))
      (is (not (some #(str/ends-with? % "stderr.log") files)))
      (is (not (str/includes? prom (:title task))))
      (is (not (str/includes? cmp (:title task))))
      (is (re-find #"task=\"T01\"" prom) "課題 ID だけを label に出す"))))

(deftest contract-text-comes-from-the-runner
  (let [r (he {} "contract")]
    (is (zero? (:exit r)) (:err r))
    (is (str/includes? (:out r) "Task Board contract"))
    (is (str/includes? (:out r) "Delegation contract"))
    (is (str/includes? (:out r) "{{TASK_SECTION}}"))
    (is (not (str/includes? (:out r) "harness-eval arm:")) "契約文自体は課題を含まない")))

(let [{:keys [fail error]} (run-tests)] (System/exit (if (pos? (+ fail error)) 1 0)))
