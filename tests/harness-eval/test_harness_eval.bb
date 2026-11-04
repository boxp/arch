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
(def task-board-dir (str (fs/path repo "docker/codex-workspace/task-board")))
(def tasks-dir (str (fs/path task-board-dir "harness-eval-tasks")))

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
      (is (every? #(= ["claude-policy-prompt" "ai-ops-decision-prompt" "delegation-prompt" "append-note-instruction" "lane-contract"] (:harness-contract-fns %))
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

(defn write-trial! [out task a rep outcome seconds]
  (spit (str (fs/path out "trials" (str task "-" a "-" rep ".edn")))
        (pr-str (cond-> {:task task :arm a :rep rep :outcome outcome :model-rev "m" :harness-version "h"}
                  seconds (assoc :seconds seconds)))))

(deftest plan-refuses-a-dir-with-existing-records
  (testing "budget.edn があれば別の計画で上書きしない"
    (let [out (tmp)]
      (is (zero? (:exit (plan! out :reps 1 :only "T01" :arms "A"))))
      (let [before (slurp (str (fs/path out "budget.edn")))
            r (plan! out :reps 2)]
        (is (= 2 (:exit r)))
        (is (str/includes? (:err r) "新しい --out"))
        (is (= before (slurp (str (fs/path out "budget.edn"))))))))
  (testing "budget.edn が無くても試行記録があれば拒否する"
    (let [out (tmp)]
      (fs/create-dirs (fs/path out "trials"))
      (write-trial! out "T01" "A" 1 "pass" 10)
      (is (= 2 (:exit (plan! out))))
      (is (not (fs/exists? (fs/path out "budget.edn"))))))
  (testing "古いモデルの試行が新しい計画の評価に混ざらない"
    (let [out (tmp)]
      (is (zero? (:exit (he {} "plan" "--out" out "--tasks-dir" tasks-dir "--only" "T01" "--arms" "A" "--model-rev" "old"))))
      (is (zero? (:exit (run! out {}))))
      (is (= 2 (:exit (he {} "plan" "--out" out "--tasks-dir" tasks-dir "--only" "T01" "--arms" "A" "--model-rev" "new"))))
      (is (str/includes? (slurp (str (fs/path out "budget.edn"))) "\"old\"")))))

(deftest regression-compares-only-trials-both-arms-attempted
  (let [ids ["T01" "T02" "T03" "T04" "T05" "T06"]
        setup (fn [a-outcomes b-outcomes]
                (let [out (tmp)]
                  (is (zero? (:exit (plan! out))))
                  (doseq [[id o] (map vector ids a-outcomes)] (write-trial! out id "A" 1 o (when (not= "aborted" o) 10)))
                  (doseq [[id o] (map vector ids b-outcomes)] (write-trial! out id "B" 1 o (when (not= "aborted" o) 10)))
                  (get-in (compare! out) [:groups 0 :regression])))
        pass3 (repeat 3 "pass") abort3 (repeat 3 "aborted")]
    (testing "A 6 件全合格・B が途中停止で 3 件全合格なら劣化としない"
      (let [reg (setup (repeat 6 "pass") (concat pass3 abort3))]
        (is (= "no_regression" (:status reg)))
        (is (= 3 (:paired_trials reg)))
        (is (= 3 (:excluded_unpaired_trials reg)))
        (is (= 0 (get-in reg [:evidence :pass_gap])))))
    (testing "同じ組で B が落ちていれば途中停止があっても検知する"
      (let [reg (setup (repeat 6 "pass") (concat ["pass" "fail" "fail"] abort3))]
        (is (= "suspected" (:status reg)))
        (is (= 2 (get-in reg [:evidence :pass_gap])))))
    (testing "B の方が多く走っていても件数差で劣化を見逃さない"
      (let [reg (setup (concat pass3 abort3) (concat ["pass" "fail" "fail"] pass3))]
        (is (= "suspected" (:status reg)))
        (is (= 3 (:paired_trials reg)))))
    (testing "組の外の遅い試行は所要時間の比に入れない"
      (let [out (tmp)]
        (is (zero? (:exit (plan! out))))
        (doseq [id (take 3 ids)] (write-trial! out id "A" 1 "pass" 10) (write-trial! out id "B" 1 "pass" 10))
        (doseq [id (drop 3 ids)] (write-trial! out id "B" 1 "pass" 100))
        (let [reg (get-in (compare! out) [:groups 0 :regression])]
          (is (= "no_regression" (:status reg)))
          (is (= 1.0 (get-in reg [:evidence :p50_ratio]))))))
    (testing "重なる組が 3 未満なら判定しない"
      (let [reg (setup (concat ["pass" "pass"] (repeat 4 "aborted")) (repeat 6 "pass"))]
        (is (= "insufficient" (:status reg)))
        (is (= 2 (:paired_trials reg)))))))

(deftest default-tasks-dir-works-from-the-image-layout
  ;; Dockerfile の COPY task-board/ /opt/codex-workspace/task-board/ と同じ配置で、--tasks-dir なしの plan が通ること。
  (let [root (tmp) installed (fs/path root "opt" "codex-workspace" "task-board") out (tmp)]
    (is (str/includes? (slurp (str (fs/path repo "docker/codex-workspace/Dockerfile")))
                       "COPY task-board/ /opt/codex-workspace/task-board/"))
    (fs/create-dirs (fs/parent installed))
    (fs/copy-tree task-board-dir installed)
    (let [r (p/shell {:out :string :err :string :continue true}
                     "bb" (str (fs/path installed "harness_eval.bb")) "plan" "--out" out)
          budget (edn/read-string (slurp (str (fs/path out "budget.edn"))))]
      (is (zero? (:exit r)) (:err r))
      (is (= ["T01" "T02" "T03" "T04" "T05" "T06"] (:tasks budget)))
      (is (= (str (fs/path installed "harness-eval-tasks")) (:tasks-dir budget))))))

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
    (testing "通常の runner と同じ AI Ops 判断支援節を、実取得せず固定の入力で含む"
      (is (str/includes? (:out r) "AI Ops decision support"))
      (is (str/includes? (:out r) "no AiOps alerts are firing or pending."))
      (is (< (str/index-of (:out r) "AI Ops decision support") (str/index-of (:out r) "Ticket contents:"))))
    (is (str/includes? (:out r) "{{TASK_SECTION}}"))
    (is (not (str/includes? (:out r) "harness-eval arm:")) "契約文自体は課題を含まない")))

(let [{:keys [fail error]} (run-tests)] (System/exit (if (pos? (+ fail error)) 1 0)))
