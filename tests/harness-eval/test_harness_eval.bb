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
      (is (every? #(= ["claude-policy-prompt" "ai-ops-decision-prompt" "provider-quota-prompt" "delegation-prompt" "append-note-instruction" "lane-contract"] (:harness-contract-fns %))
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

(deftest committed-or-hidden-disallowed-changes-are-detected
  (testing "許可外の変更を commit しても、削除を commit しても、exclude で隠しても fail にする"
    (doseq [mode ["commit-break" "commit-delete" "hidden-extra"]]
      (let [out (tmp)]
        (is (zero? (:exit (plan! out :reps 1 :only "T01" :arms "A"))))
        (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" mode}))))
        (let [[t] (trials out)]
          (is (= "fail" (:outcome t)) mode)
          (is (pos? (:disallowed-changes t)) mode)
          (is (nil? (:accept-exit t)) mode)))))
  (testing "許可内の変更の commit は合格のまま、commit の事実を metadata に残す"
    (let [out (tmp)]
      (is (zero? (:exit (plan! out :reps 1 :only "T01" :arms "A"))))
      (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "commit-allowed"}))))
      (let [[t] (trials out)]
        (is (= "pass" (:outcome t)))
        (is (= 0 (:disallowed-changes t)))
        (is (= 1 (:commits-added t)))))))

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

(deftest stop-file-removal-resumes-aborted-trials
  (let [out (tmp) stop (fs/path out "STOP")]
    (is (zero? (:exit (plan! out :only "T01" :arms "A" :reps 3))))
    (spit (str stop) "")
    (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})
    (is (every? #(= "aborted" (:outcome %)) (trials out)))
    (fs/delete stop)
    (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})
    (is (= ["pass" "pass" "pass"] (map :outcome (trials out))) "STOP を外すと aborted を実行する")
    (let [a (arm (compare! out) "A")]
      (is (= 3 (:trials a)))
      (is (= 0 (:aborted a))))))

(deftest default-harness-version-identifies-content-without-git
  (let [image (tmp)
        tb (fs/path image "opt/task-board")
        plan-version (fn []
                       (let [out (tmp)
                             r @(p/process ["bb" (str (fs/path tb "harness_eval.bb")) "plan" "--out" out
                                            "--tasks-dir" tasks-dir "--only" "T01"]
                                           {:out :string :err :string})]
                         (is (zero? (:exit r)) (:err r))
                         (:harness-version (edn/read-string (slurp (str (fs/path out "budget.edn")))))))]
    (fs/create-dirs tb)
    (doseq [n ["harness_eval.bb" "task_board_runner.bb"]] (fs/copy (fs/path task-board-dir n) (fs/path tb n)))
    (let [v1 (plan-version)]
      (is (re-matches #"tb-[0-9a-f]{12}" v1) "Git repository の外でも unknown にならない")
      (is (= v1 (plan-version)) "内容が同じなら同じ版")
      (spit (str (fs/path tb "task_board_runner.bb")) "\n;; changed\n" :append true)
      (is (not= v1 (plan-version)) "runner が変われば別の版"))))

(deftest run-refuses-when-content-differs-from-the-plan
  (let [setup (fn [plan-args]
                (let [image (tmp)
                      tb (fs/path image "opt" "task-board")
                      out (tmp)
                      tool' (str (fs/path tb "harness_eval.bb"))
                      exec (fn [& args] @(p/process (into ["bb" tool'] (map str args)) {:out :string :err :string}))]
                  (fs/create-dirs (fs/parent tb))
                  (fs/copy-tree task-board-dir tb)
                  (let [r (apply exec "plan" "--out" out "--only" "T01,T02" "--arms" "A" plan-args)]
                    (is (zero? (:exit r)) (:err r)))
                  {:tb tb :out out :resume #(exec "run" "--out" out "--agent-cmd" fake-agent)}))
        refused? (fn [{:keys [out resume]} expected]
                   (let [r (resume)]
                     (is (= 2 (:exit r)))
                     (is (str/includes? (:err r) expected))
                     (is (str/includes? (:err r) "新しい --out"))
                     (is (empty? (fs/list-dir (fs/path out "trials"))) "拒否したら試行を記録しない")))]
    (testing "内容が同じなら実行する"
      (let [{:keys [out resume]} (setup [])]
        (is (zero? (:exit (resume))))
        (is (= 2 (count (trials out))))))
    (testing "runner が変われば再開しない"
      (let [{:keys [tb] :as ctx} (setup [])]
        (spit (str (fs/path tb "task_board_runner.bb")) "\n;; changed\n" :append true)
        (refused? ctx "ハーネス")))
    (testing "--harness-version を明示していても内容の変更を見逃さない"
      (let [{:keys [tb] :as ctx} (setup ["--harness-version" "pinned"])]
        (spit (str (fs/path tb "harness_eval.bb")) "\n;; changed\n" :append true)
        (refused? ctx "ハーネス")))
    (doseq [[what rel] [["受入手順" "T01/accept.sh"] ["課題定義" "T02/task.edn"]]]
      (testing (str what "が変われば再開しない")
        (let [{:keys [tb] :as ctx} (setup [])]
          (spit (str (fs/path tb "harness-eval-tasks" rel)) "\n;; changed\n" :append true)
          (refused? ctx "課題"))))
    (testing "課題の base が変われば再開しない"
      (let [{:keys [tb] :as ctx} (setup [])
            base (first (filter fs/regular-file? (file-seq (fs/file (fs/path tb "harness-eval-tasks" "T01" "base")))))]
        (spit (str base) "\n" :append true)
        (refused? ctx "課題")))
    (testing "計画に含まない課題の変更は影響しない"
      (let [{:keys [tb out resume]} (setup [])]
        (spit (str (fs/path tb "harness-eval-tasks" "T03" "accept.sh")) "\n# changed\n" :append true)
        (is (zero? (:exit (resume))))
        (is (= 2 (count (trials out))))))
    (testing "途中まで実行した DIR でも、変更後は残りを旧版として記録しない"
      (let [{:keys [tb out resume]} (setup [])]
        (spit (str (fs/path out "STOP")) "")
        (is (zero? (:exit (resume))))
        (is (every? #(= "aborted" (:outcome %)) (trials out)))
        (fs/delete (fs/path out "STOP"))
        (spit (str (fs/path tb "task_board_runner.bb")) "\n;; changed\n" :append true)
        (is (= 2 (:exit (resume))))
        (is (every? #(= "aborted" (:outcome %)) (trials out)))))))

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

(defn run-status [out] (edn/read-string (slurp (str (fs/path out "run-status.edn")))))
(defn attempt-lines [out] (->> (str/split-lines (slurp (str (fs/path out "attempts.log")))) (remove str/blank?) (map edn/read-string) vec))

(deftest agent-does-not-receive-task-board-or-claude-session-env
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01" :arms "A"))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "env-probe"
                                 "CODEX_TASK_BOARD_VAULT" "/nonexistent" "CLAUDECODE" "1"
                                 "CLAUDE_CODE_SESSION_ID" "x" "GH_TOKEN" "x"}))))
    (is (= "pass" (:outcome (first (trials out)))))))

(deftest quota-rejection-stops-without-recording-a-trial
  (testing "拒否の観測で止まり、残りを実行せず、reset 前の再開も拒否する"
    (let [out (tmp)]
      (is (zero? (:exit (plan! out :reps 3 :only "T01,T02"))))
      (let [r (run! out {"HARNESS_EVAL_FAKE_MODE" "quota"})]
        (is (= 3 (:exit r)) (:err r)))
      (is (empty? (trials out)))
      (let [st (run-status out)]
        (is (= "stopped_quota" (:status st)))
        (is (= "seven_day" (:limit st)))
        (is (= 4102444800 (:resets-at st))))
      (is (= 2 (count (attempt-lines out))) "開始と終了の 1 組だけ")
      (let [r (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})]
        (is (= 3 (:exit r)))
        (is (str/includes? (:err r) "まで試行しない")))
      (is (empty? (trials out)) "reset 前は試行しない")
      (is (= 2 (count (attempt-lines out))))))
  (testing "reset が過ぎれば完了していない試行から続ける"
    (let [out (tmp)]
      (is (zero? (:exit (plan! out :only "T01" :arms "A"))))
      (is (= 3 (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "quota"}))))
      (spit (str (fs/path out "run-status.edn")) (pr-str {:status "stopped_quota" :resets-at 1 :at 1}))
      (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"}))))
      (is (= ["pass"] (map :outcome (trials out))))))
  (testing "reset 不明の 429 は観測から 1 時間止める"
    (let [out (tmp)]
      (is (zero? (:exit (plan! out :only "T01" :arms "A"))))
      (is (= 3 (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "quota-no-reset"}))))
      (is (nil? (:resets-at (run-status out))))
      (is (= 3 (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})))))))

(deftest interrupted-trial-is-rerun-and-charged-and-completed-ones-are-not
  (let [out (tmp) now (quot (System/currentTimeMillis) 1000)]
    (is (zero? (:exit (plan! out :reps 1 :only "T01" :timeout 60))))
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"}))))
    (let [before (count (attempt-lines out))
          t-a (fs/path out "trials" "T01-A-1.edn")
          t-b (fs/path out "trials" "T01-B-1.edn")
          stamp (slurp (str t-a))]
      ;; arm B の試行が途中で殺された状態: 開始の記録だけがあり、試行の記録がない。
      (fs/delete t-b)
      (spit (str (fs/path out "attempts.log")) (str (pr-str {:event "start" :trial "T01-B-1" :at (- now 1000)}) "\n") :append true)
      (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"}))))
      (is (= stamp (slurp (str t-a))) "完了済みは再実行しない")
      (is (fs/exists? t-b))
      (let [cmp (compare! out)]
        (is (= 2 (:trials_completed cmp)))
        (is (= 1 (:interrupted_attempts cmp)))
        (is (>= (:spent_seconds cmp) 180) "中断分を上限 (60+120 秒) まで計上する")
        (is (= (+ 2 (quot before 2) ) (:attempts cmp)) "開始の回数")))))

(deftest half-written-attempt-line-does-not-hide-the-next-attempt
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :only "T01" :arms "A"))))
    (spit (str (fs/path out "attempts.log")) "{:event \"start\" :tri")
    (is (zero? (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"}))))
    (is (= 1 (:attempts (compare! out))))))

(deftest cumulative-wall-budget-stops-new-trials
  (let [out (tmp) now (quot (System/currentTimeMillis) 1000)]
    (is (zero? (:exit (he {} "plan" "--out" out "--tasks-dir" tasks-dir "--only" "T01" "--arms" "A" "--trial-timeout-seconds" "60" "--max-wall-seconds" "200"))))
    (spit (str (fs/path out "attempts.log"))
          (str (pr-str {:event "start" :trial "T01-A-1" :at (- now 100)}) "\n"
               (pr-str {:event "end" :trial "T01-A-1" :at (- now 50)}) "\n"))
    (let [r (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})]
      (is (= 4 (:exit r)) (:err r)))
    (is (= "stopped_budget" (:status (run-status out))))
    (is (empty? (trials out)))
    (testing "6 時間を超える計画は作らない"
      (let [o2 (tmp) r (he {} "plan" "--out" o2 "--tasks-dir" tasks-dir "--max-wall-seconds" "21601")]
        (is (= 2 (:exit r)))))))

(deftest concurrent-run-on-the-same-dir-is-refused
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :only "T01" :arms "A"))))
    (let [first-run (p/process ["bb" tool "run" "--out" out "--agent-cmd" fake-agent]
                               {:out :string :err :string
                                :extra-env {"HARNESS_EVAL_FAKE_MODE" "sleep" "HARNESS_EVAL_FAKE_SLEEP_SECONDS" "6"}})]
      (loop [i 0] (when (and (< i 100) (not (fs/exists? (fs/path out "attempts.log")))) (Thread/sleep 100) (recur (inc i))))
      (let [r (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})]
        (is (= 5 (:exit r)) (:err r)))
      (is (zero? (:exit @first-run)))
      (is (= 2 (count (attempt-lines out))) "二重の run は試行を始めない"))))

(deftest quota-hold-is-read-after-taking-the-lock
  (testing "ロックを持つ run がある間は停止状態を読まない。読むのはロックの後なので、先行 run が記録した拒否を見落とさない"
    (let [out (tmp)]
      (is (zero? (:exit (plan! out :only "T01" :arms "A"))))
      (let [first-run (p/process ["bb" tool "run" "--out" out "--agent-cmd" fake-agent]
                                 {:out :string :err :string
                                  :extra-env {"HARNESS_EVAL_FAKE_MODE" "sleep" "HARNESS_EVAL_FAKE_SLEEP_SECONDS" "6"}})]
        (loop [i 0] (when (and (< i 100) (not (fs/exists? (fs/path out "attempts.log")))) (Thread/sleep 100) (recur (inc i))))
        ;; 先行 run がロックを持ったまま拒否を記録した瞬間の状態。
        (spit (str (fs/path out "run-status.edn")) (pr-str {:status "stopped_quota" :resets-at 4102444800 :at 1}))
        (let [r (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})]
          (is (= 5 (:exit r)) (:err r)))
        @first-run)))
  (testing "ロックを取った後の確認で拒否すれば、停止状態を上書きせず試行も始めない"
    (let [out (tmp)]
      (is (zero? (:exit (plan! out :only "T01" :arms "A"))))
      (is (= 3 (:exit (run! out {"HARNESS_EVAL_FAKE_MODE" "quota"}))))
      (let [before (slurp (str (fs/path out "run-status.edn")))
            r (run! out {"HARNESS_EVAL_FAKE_MODE" "solve"})]
        (is (= 3 (:exit r)) (:err r))
        (is (= before (slurp (str (fs/path out "run-status.edn")))))
        (is (= 2 (count (attempt-lines out))))))))

(deftest real-model-run-requires-a-pinned-model
  (let [out (tmp)]
    (is (zero? (:exit (plan! out :only "T01" :arms "A"))))
    (let [r (he {} "run" "--out" out)]
      (is (= 2 (:exit r)))
      (is (str/includes? (:err r) "--model-rev"))
      (is (not (fs/exists? (fs/path out "attempts.log")))))))

(deftest contract-uses-the-evaluated-route
  (doseq [agent ["claude-opus" "claude-sonnet"]]
    (let [r (he {} "contract" "--agent" agent)]
      (is (zero? (:exit r)) (:err r))
      (is (str/includes? (:out r) (str "Task Board assignee/agent: " agent))))))

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
