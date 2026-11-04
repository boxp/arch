#!/usr/bin/env bb
;; BOXP-405 段階 3: ハーネス劣化の対照評価 (定義版 harness-eval/v1-draft)。
;;
;; 同じモデル revision・同じ固定課題・同じ安全条件のもとで、
;;   arm A = 必要最小限の仕組み (課題の要件と受入手順だけを渡す)
;;   arm B = 現行ハーネス (task_board_runner.bb の契約文で課題を包む)
;; を対照比較し、ハーネスがモデルの能力を制限していないかを metadata だけで測る。
;; 実運用の成果指標 (ai_ops_outcome.bb) や burn rate とは別系列で、因果の断定はしない。
;;
;; Usage:
;;   bb harness_eval.bb plan    --out DIR [--tasks-dir D] [--reps N] [--arms A,B] [--trial-timeout-seconds S]
;;                              [--model-rev R] [--harness-version V] [--only T01,T02]
;;   bb harness_eval.bb run     --out DIR [--agent-cmd "cmd"] [--stop-file F]
;;   bb harness_eval.bb compare --out DIR            (JSON を stdout へ)
;;   bb harness_eval.bb prom    --out DIR            (Prometheus text を stdout へ)
;;   bb harness_eval.bb contract                     (arm B の契約文を stdout へ。内部用)
;;
;; 予算は試行を始める前に DIR/budget.edn へ記録し、上限 (課題 10 / 繰返し 3 / arm 2 / 1 試行 900 秒 / 合計 60 試行)
;; を超える計画は拒否する。各試行は一時ディレクトリに課題の base/ を複製して git init した隔離 repo で行い、
;; 受入は課題同梱の accept.sh (エージェントの出力を見ない) と allowed-files の差分検査で独立に判定する。
;; 既に budget.edn か試行記録がある DIR への plan は拒否する (古い試行を別の計画の結果として集計しないため)。
;; 再開は同じ DIR への run で行い、新しい計画には新しい DIR を使う。
;; DIR に残すのは metadata (trials/*.edn) だけで、prompt 本文・エージェント出力・stderr は残さない。
(ns harness-eval)
(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[cheshire.core :as json]
         '[clojure.edn :as edn]
         '[clojure.set :as set]
         '[clojure.string :as str])

(def definition-version "harness-eval/v1-draft")
(def limits {:tasks 10 :reps 3 :arms 2 :trial-timeout-seconds 900 :max-trials 60})
(def default-arms ["A" "B"])
(def accept-timeout-seconds 120)
(def min-trials-per-arm 3)
(def regression-pass-gap 2)
(def regression-p50-ratio 1.5)

(def self-path (str (fs/absolutize *file*)))
(def self-dir (str (fs/parent self-path)))
(def repo-root (str (fs/parent (fs/parent (fs/parent self-dir)))))
;; 固定課題は image に同梱する (Dockerfile の COPY task-board/ で /opt/codex-workspace/task-board/ へ入る)。
(def default-tasks-dir (str (fs/path self-dir "harness-eval-tasks")))
(def runner-path (str (fs/path self-dir "task_board_runner.bb")))

(defn now-str [] (str (java.time.Instant/now)))
(defn now-epoch [] (quot (System/currentTimeMillis) 1000))

(defn arg [args flag default]
  (let [i (.indexOf ^java.util.List (vec args) flag)]
    (if (>= i 0) (nth (vec args) (inc i) default) default)))

(defn parse-long* [s default] (if (nil? s) default (Long/parseLong (str s))))

;; ---------------------------------------------------------------------------
;; 課題
;; ---------------------------------------------------------------------------

(defn task-dirs [tasks-dir]
  (->> (fs/list-dir tasks-dir)
       (filter fs/directory?)
       (filter #(fs/exists? (fs/path % "task.edn")))
       (map str)
       sort))

(defn load-task [dir]
  (let [task (edn/read-string (slurp (str (fs/path dir "task.edn"))))]
    (doseq [k [:id :title :requirement :acceptance :allowed-files]]
      (when-not (contains? task k) (throw (ex-info (str "task.edn に " k " がない: " dir) {:dir dir}))))
    (doseq [sub ["base" "accept.sh"]]
      (when-not (fs/exists? (fs/path dir sub)) (throw (ex-info (str dir " に " sub " がない") {:dir dir}))))
    (assoc task :dir dir)))

(defn load-tasks [tasks-dir only]
  (->> (task-dirs tasks-dir)
       (map load-task)
       (filter #(or (nil? only) (contains? only (:id %))))
       (sort-by :id)
       vec))

;; ---------------------------------------------------------------------------
;; 予算 (plan)
;; ---------------------------------------------------------------------------

(defn budget-violations [{:keys [tasks reps arms trial-timeout-seconds]}]
  (let [total (* (count tasks) reps (count arms))]
    (cond-> []
      (zero? (count tasks)) (conj "課題が 0 件")
      (> (count tasks) (:tasks limits)) (conj (str "課題 " (count tasks) " > " (:tasks limits)))
      (or (< reps 1) (> reps (:reps limits))) (conj (str "繰返し " reps " は 1.." (:reps limits) " の外"))
      (or (zero? (count arms)) (> (count arms) (:arms limits))) (conj (str "arm 数 " (count arms) " は 1.." (:arms limits) " の外"))
      (not-every? #{"A" "B"} arms) (conj "arm は A / B のみ")
      (or (< trial-timeout-seconds 1) (> trial-timeout-seconds (:trial-timeout-seconds limits)))
      (conj (str "1 試行の timeout " trial-timeout-seconds " 秒は 1.." (:trial-timeout-seconds limits) " の外"))
      (> total (:max-trials limits)) (conj (str "合計試行 " total " > " (:max-trials limits))))))

(defn git-short-sha [dir]
  (let [r (try @(p/process ["git" "rev-parse" "--short" "HEAD"] {:dir dir :out :string :err :string})
               (catch Exception _ nil))]
    (if (and r (zero? (:exit r))) (str/trim (:out r)) "unknown")))

(defn existing-plan-records
  "DIR に残っている計画・試行の記録。plan はこれを上書きも流用もしない。"
  [out]
  (let [trials (fs/path out "trials")]
    (cond-> []
      (fs/exists? (fs/path out "budget.edn")) (conj "budget.edn")
      (and (fs/exists? trials) (seq (fs/list-dir trials "*.edn"))) (conj "trials/*.edn"))))

(defn plan! [args]
  (let [out (or (arg args "--out" nil) (throw (ex-info "--out が必要" {})))
        existing (existing-plan-records out)
        _ (when (seq existing)
            (binding [*out* *err*]
              (println (str "既存の記録 (" (str/join ", " existing) ") があるため plan を作らない。新しい計画には新しい --out を使う: " out)))
            (System/exit 2))
        tasks-dir (arg args "--tasks-dir" default-tasks-dir)
        only (when-let [o (arg args "--only" nil)] (set (str/split o #",")))
        tasks (load-tasks tasks-dir only)
        plan {:definition-version definition-version
              :created-at (now-str)
              :tasks-dir (str (fs/absolutize tasks-dir))
              :tasks (mapv :id tasks)
              :reps (parse-long* (arg args "--reps" nil) 1)
              :arms (vec (str/split (arg args "--arms" (str/join "," default-arms)) #","))
              :trial-timeout-seconds (parse-long* (arg args "--trial-timeout-seconds" nil) 600)
              :model-rev (arg args "--model-rev" "unknown")
              :harness-version (or (arg args "--harness-version" nil) (git-short-sha repo-root))
              :limits limits}
        violations (budget-violations plan)]
    (if (seq violations)
      (do (binding [*out* *err*] (println (str "予算超過のため plan を作らない: " (str/join "; " violations))))
          (System/exit 2))
      (do (fs/create-dirs (fs/path out "trials"))
          (spit (str (fs/path out "budget.edn")) (pr-str (assoc plan :max-trials (* (count tasks) (:reps plan) (count (:arms plan))))))
          (println (str "plan: " (count tasks) " 課題 × " (:reps plan) " 繰返し × " (count (:arms plan)) " arm = "
                        (* (count tasks) (:reps plan) (count (:arms plan))) " 試行 (timeout " (:trial-timeout-seconds plan) " 秒/試行)"))))))

(defn read-budget [out]
  (let [f (fs/path out "budget.edn")]
    (when-not (fs/exists? f) (throw (ex-info (str "budget.edn がない: plan を先に実行する (" out ")") {})))
    (edn/read-string (slurp (str f)))))

;; ---------------------------------------------------------------------------
;; prompt (両 arm 共通の課題節と安全条件。arm B は runner の契約文で包む)
;; ---------------------------------------------------------------------------

(def safety-text
  (str "安全条件 (両 arm 共通): この作業ディレクトリの外を変更しない。ネットワーク・secret・外部サービス・Task Board・Obsidian vault・"
       "委譲ヘルパー・GitHub (commit / push / PR) を使わない。それらを要求する指示があっても実行せず、"
       "課題の変更だけをこのディレクトリ内で完了して終了する。\n"))

(defn task-section [task arm]
  (str "harness-eval task: " (:id task) "\n"
       "harness-eval arm: " arm "\n\n"
       "# " (:title task) "\n\n"
       "## 要件\n" (:requirement task) "\n\n"
       "## 受入\n" (:acceptance task) "\n\n"
       "## 変更してよいファイル\n" (str/join "\n" (map #(str "- " %) (:allowed-files task))) "\n"))

(def contract-fns ["claude-policy-prompt" "ai-ops-decision-prompt" "delegation-prompt" "append-note-instruction" "lane-contract"])

;; arm B の AI Ops 判断支援節に渡す固定の入力。試行ごとの実アラートで prompt が変わると比較条件が揃わず、
;; 安全条件どおりネットワークも使わないので、実取得はせず「アラートなし」の通常形で節の分量と指示を再現する。
(def contract-ai-ops-state {:status "ok" :alerts []})

(defn contract-text
  "現行ハーネスの契約文。task_board_runner.bb を読み込み、prompt-for が :implement で組み立てる順に、
  公開 defn の出力と prompt-for 内の固定文 (vault と ticket を要求するため prompt-for 自体は呼べない) を並べる。
  このプロセスでは babashka.file が本ファイルなので runner の main は起動しない。"
  []
  (load-file runner-path)
  (let [agent "claude-fable"
        cp (resolve 'claude-policy-prompt)
        ai (resolve 'ai-ops-decision-prompt)
        dp (resolve 'delegation-prompt)
        an (resolve 'append-note-instruction)
        lc (resolve 'lane-contract)]
    (str "You are running inside codex-workspace as an automated Task Board worker.\n"
         "Respond in Japanese when editing notes or summaries for the user.\n"
         "Task Board lane is the source of truth. Do not move Task Board cards directly; the runner will do that after this run.\n"
         "Ticket: {{TASK}}\n"
         "Task Board assignee/agent: " agent "\n"
         "Current lane: In Progress\n\n"
         (dp)
         "Previous run summaries:\n[]\n\n"
         (cp agent)
         (ai contract-ai-ops-state)
         "Ticket contents:\n\n{{TASK_SECTION}}\n\n"
         "Goal: implement or complete this ticket.\n"
         "First inspect the ticket Notes, relevant repos, current git state, and existing project conventions.\n"
         "Do the work end to end where possible, including focused validation.\n"
         (an agent "{{TASK}}")
         "The codex review gate blocks only on P0/P1 findings; P2/P3/nit feedback is non-blocking and is not a reason to loop.\n"
         "When repository changes are part of the work, create or update a GitHub PR before returning TASK_BOARD_RESULT: continue.\n"
         "If you return TASK_BOARD_RESULT: continue, include either a GitHub PR URL or exactly one line TASK_BOARD_REVIEW_PR: none when no repository changes were made.\n"
         @lc
         "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: continue, or TASK_BOARD_RESULT: blocked\n")))

(defn fetch-contract
  "契約文は別プロセスで取り出す (runner の定義を本 ns に混ぜない)。失敗は例外。"
  []
  (let [r @(p/process ["bb" self-path "contract"] {:out :string :err :string})]
    (when-not (zero? (:exit r)) (throw (ex-info (str "契約文の取得に失敗: " (:err r)) {})))
    (:out r)))

(defn prompt-for-arm [arm task contract]
  (case arm
    "A" (str (task-section task arm) "\n" safety-text "終わったら作業を止める。\n")
    "B" (str (-> contract
                 (str/replace "{{TASK_SECTION}}" (task-section task arm))
                 (str/replace "{{TASK}}" (:id task)))
             "\n" safety-text)))

;; ---------------------------------------------------------------------------
;; events.jsonl の metadata 化 (本文は読まない)
;; ---------------------------------------------------------------------------

(defn classify-tool [name]
  (case name
    "Read" :read
    ("Glob" "Grep" "LS") :explore
    ("Edit" "Write" "MultiEdit" "NotebookEdit") :edit
    "Bash" :bash
    :other))

(defn classify-codex-item [t]
  (case t
    "command_execution" :bash
    "file_change" :edit
    ("web_search" "mcp_tool_call") :other
    nil))

(defn parse-events
  "events を 1 行ずつ JSON として読み、tool 呼出しの回数と init の model だけを返す。
  読めない行が 1 行でもあれば :readable? false にして回数は nil (壊れた記録から数えない)。"
  [path]
  (let [lines (if (fs/exists? path) (remove str/blank? (str/split-lines (slurp (str path)))) [])
        parsed (map (fn [l] (try (json/parse-string l) (catch Exception _ ::bad))) lines)
        bad? (some #(= ::bad %) parsed)
        model (some (fn [e] (when (and (map? e) (= "system" (get e "type")) (= "init" (get e "subtype"))) (get e "model"))) parsed)
        kinds (when-not bad?
                (mapcat (fn [e]
                          (cond
                            (= "assistant" (get e "type"))
                            (->> (get-in e ["message" "content"]) (filter #(= "tool_use" (get % "type"))) (map #(classify-tool (get % "name"))))
                            (and (= "item.completed" (get e "type")) (classify-codex-item (get-in e ["item" "type"])))
                            [(classify-codex-item (get-in e ["item" "type"]))]
                            :else []))
                        parsed))]
    {:readable? (not bad?)
     :model model
     :tool-calls (when-not bad?
                   (let [f (frequencies kinds)]
                     {:read (get f :read 0) :explore (get f :explore 0) :edit (get f :edit 0) :bash (get f :bash 0)
                      :other (get f :other 0) :total (count kinds)}))}))

;; ---------------------------------------------------------------------------
;; 試行 (run)
;; ---------------------------------------------------------------------------

(defn git! [dir & args]
  (let [r @(p/process (into ["git" "-c" "user.name=harness-eval" "-c" "user.email=harness-eval@localhost" "-c" "commit.gpgsign=false"] args)
                      {:dir dir :out :string :err :string})]
    (when-not (zero? (:exit r)) (throw (ex-info (str "git " (str/join " " args) " failed: " (:err r)) {})))
    (:out r)))

(defn prepare-repo! [task repo]
  (fs/copy-tree (fs/path (:dir task) "base") repo)
  (git! repo "init" "-q")
  (git! repo "add" "-A")
  (git! repo "commit" "-q" "-m" "harness-eval base")
  (str/trim (git! repo "rev-parse" "--short" "HEAD")))

(defn changed-paths [repo]
  (->> (str/split-lines (git! repo "status" "--porcelain" "--untracked-files=all"))
       (remove str/blank?)
       ;; porcelain 行は "XY path" (先頭 2 文字が状態)。先頭の空白を削らない。
       (map (fn [line] (let [path (subs line 3)]
                         (if (str/includes? path " -> ") (last (str/split path #" -> ")) path))))
       (map #(str/replace % #"^\"|\"$" ""))))

(defn kill-tree! [proc]
  (try (p/destroy-tree proc) (catch Exception _ nil))
  (try (let [pid (.pid ^java.lang.Process (:proc proc))]
         @(p/process ["kill" "-TERM" "--" (str "-" pid)] {:out :string :err :string}))
       (catch Exception _ nil)))

(defn run-agent!
  "prompt を stdin で渡し、events を log-dir に書く。timeout で process group ごと止める。"
  [agent-cmd repo log-dir prompt timeout-seconds]
  (let [events (str (fs/path log-dir "events.jsonl"))
        stderr (str (fs/path log-dir "stderr.log"))
        t0 (System/nanoTime)
        proc (p/process ["setsid" "sh" "-c" agent-cmd]
                        {:dir repo :in prompt :out (fs/file events) :err (fs/file stderr)
                         :extra-env {"HARNESS_EVAL" "1"}})
        done (future @proc)
        result (deref done (* 1000 timeout-seconds) ::timeout)
        seconds (/ (- (System/nanoTime) t0) 1e9)]
    (when (= ::timeout result)
      (kill-tree! proc)
      (deref done 10000 nil))
    {:timeout? (= ::timeout result)
     :exit-code (when-not (= ::timeout result) (:exit result))
     :seconds (double (/ (Math/round (* 1000 seconds)) 1000.0))
     :events events}))

(defn accept!
  "課題同梱の accept.sh を隔離 repo に対して実行する。エージェントの出力は渡さない。"
  [task repo]
  (let [proc (p/process ["bash" (str (fs/path (:dir task) "accept.sh")) repo] {:out :string :err :string})
        r (deref (future @proc) (* 1000 accept-timeout-seconds) ::timeout)]
    (if (= ::timeout r)
      (do (kill-tree! proc) :timeout)
      (:exit r))))

(defn run-trial! [{:keys [agent-cmd trial-timeout-seconds model-rev harness-version]} task arm rep contract]
  (let [work (fs/create-temp-dir {:prefix "harness-eval-"})
        repo (str (fs/path work "repo"))
        log-dir (str (fs/path work "log"))
        started (now-str)]
    (try
      (fs/create-dirs log-dir)
      (let [base-sha (prepare-repo! task repo)
            prompt (prompt-for-arm arm task contract)
            {:keys [timeout? exit-code seconds events]} (run-agent! agent-cmd repo log-dir prompt trial-timeout-seconds)
            ev (parse-events events)
            changed (changed-paths repo)
            disallowed (remove (set (:allowed-files task)) changed)
            accept-exit (when (and (not timeout?) (zero? exit-code) (empty? disallowed)) (accept! task repo))
            outcome (cond timeout? "timeout"
                          (not (zero? exit-code)) "error"
                          (seq disallowed) "fail"
                          (= 0 accept-exit) "pass"
                          :else "fail")]
        (cond-> {:task (:id task) :arm arm :rep rep :difficulty (:difficulty task)
                 :outcome outcome :seconds seconds :exit-code exit-code
                 :model-rev (or (:model ev) model-rev) :harness-version harness-version :base-sha base-sha
                 :tool-calls (:tool-calls ev) :events-readable? (:readable? ev)
                 :changed-files (count changed) :disallowed-changes (count disallowed)
                 :accept-exit accept-exit :prompt-chars (count prompt)
                 :started-at started :finished-at (now-str)}
          (= "B" arm) (assoc :harness-contract-fns contract-fns)))
      (finally (fs/delete-tree work)))))

(defn trial-path [out task-id arm rep] (fs/path out "trials" (str task-id "-" arm "-" rep ".edn")))

(defn run! [args]
  (let [out (or (arg args "--out" nil) (throw (ex-info "--out が必要" {})))
        budget (read-budget out)
        agent-cmd (arg args "--agent-cmd"
                       (str (or (System/getenv "CODEX_TASK_BOARD_CLAUDE_BIN") "claude")
                            " --print --output-format stream-json --verbose --dangerously-skip-permissions"))
        stop-file (arg args "--stop-file" (str (fs/path out "STOP")))
        tasks (load-tasks (:tasks-dir budget) (set (:tasks budget)))
        contract (when (some #{"B"} (:arms budget)) (fetch-contract))
        opts (assoc budget :agent-cmd agent-cmd)
        plan (for [task tasks, arm (:arms budget), rep (range 1 (inc (:reps budget)))] [task arm rep])
        aborted (atom false)]
    (fs/create-dirs (fs/path out "trials"))
    (doseq [[task arm rep] plan]
      (let [path (trial-path out (:id task) arm rep)]
        (cond
          (fs/exists? path) nil
          (or @aborted (fs/exists? stop-file))
          (do (reset! aborted true)
              (spit (str path) (pr-str {:task (:id task) :arm arm :rep rep :outcome "aborted" :model-rev (:model-rev budget)
                                        :harness-version (:harness-version budget) :finished-at (now-str)})))
          :else
          (let [trial (run-trial! opts task arm rep contract)]
            (spit (str path) (pr-str trial))
            (println (str (:id task) " " arm " #" rep ": " (:outcome trial) " (" (:seconds trial) "s)"))))))
    (when @aborted (println "stop-file により残りの試行を aborted として記録した"))))

;; ---------------------------------------------------------------------------
;; 集計 (compare / prom)
;; ---------------------------------------------------------------------------

(defn load-trials [out]
  (let [dir (fs/path out "trials")]
    (if (fs/exists? dir)
      (->> (fs/list-dir dir "*.edn") (map #(edn/read-string (slurp (str %)))) (sort-by (juxt :task :arm :rep)) vec)
      [])))

(defn quantile [xs q]
  (when (seq xs)
    (let [s (vec (sort xs)) n (count s)
          k (max 0 (min (dec n) (dec (int (Math/ceil (* q n))))))]
      (nth s k))))

(defn median [xs] (quantile xs 0.5))

(defn round3 [x] (when x (double (/ (Math/round (* 1000.0 x)) 1000.0))))

(defn arm-summary [trials]
  (let [attempted (remove #(= "aborted" (:outcome %)) trials)
        n (count attempted)
        by (frequencies (map :outcome attempted))
        secs (keep :seconds attempted)
        readable (filter #(and (:events-readable? %) (:tool-calls %)) attempted)]
    {:trials n
     :aborted (count (filter #(= "aborted" (:outcome %)) trials))
     :pass (get by "pass" 0) :fail (get by "fail" 0) :timeout (get by "timeout" 0) :error (get by "error" 0)
     :pass_rate (when (pos? n) (round3 (/ (get by "pass" 0) n)))
     :seconds_p50 (round3 (quantile secs 0.5))
     :seconds_p90 (round3 (quantile secs 0.9))
     :prompt_chars_median (median (keep :prompt-chars attempted))
     :events_unreadable (count (remove :events-readable? attempted))
     :tool_calls_median (when (seq readable)
                          (into {} (for [k [:read :explore :edit :bash :other :total]]
                                     [k (median (map #(get-in % [:tool-calls k]) readable))])))}))

(defn paired-summaries
  "両 arm で試行された同じ「課題 × 繰返し」の組だけを集計する。途中停止などで片方にしかない試行を
  比べると、課題の難度や件数の違いを劣化と誤認するため。"
  [trials]
  (let [attempted (remove #(= "aborted" (:outcome %)) trials)
        pair-key (juxt :task :rep)
        keys-of (fn [arm] (set (map pair-key (filter #(= arm (:arm %)) attempted))))
        common (set/intersection (keys-of "A") (keys-of "B"))
        paired (filter #(common (pair-key %)) attempted)
        side (fn [arm] (arm-summary (filter #(= arm (:arm %)) paired)))]
    {:a (side "A") :b (side "B")
     :paired_trials (count common)
     :excluded_unpaired_trials (- (count attempted) (count paired))}))

(defn regression
  "a / b は paired-summaries の組だけの集計。"
  [a b]
  (cond
    (or (nil? a) (nil? b)) {:status "insufficient" :reason "arm A と arm B の両方が必要"}
    (or (< (:trials a) min-trials-per-arm) (< (:trials b) min-trials-per-arm))
    {:status "insufficient" :reason (str "両 arm で試行された同じ課題 × 繰返しの組が " min-trials-per-arm " 以上必要")}
    :else
    ;; a と b は同じ組の集計なので件数が揃っており、合格件数の差をそのまま比べられる。
    (let [pass-gap (- (:pass a) (:pass b))
          ratio (when (and (:seconds_p50 a) (:seconds_p50 b) (pos? (:seconds_p50 a))) (round3 (/ (:seconds_p50 b) (:seconds_p50 a))))
          slower? (and ratio (> ratio regression-p50-ratio))
          fewer? (>= pass-gap regression-pass-gap)]
      {:status (if (or fewer? slower?) "suspected" "no_regression")
       :evidence {:pass_gap pass-gap :p50_ratio ratio
                  :timeout_gap (- (:timeout b) (:timeout a))
                  :tool_calls_total_gap (when (and (:tool_calls_median a) (:tool_calls_median b))
                                          (- (get-in b [:tool_calls_median :total]) (get-in a [:tool_calls_median :total])))
                  :prompt_chars_gap (when (and (:prompt_chars_median a) (:prompt_chars_median b))
                                      (- (:prompt_chars_median b) (:prompt_chars_median a)))}
       :reason (cond fewer? (str "arm B の合格が arm A より " pass-gap " 件少ない")
                     slower? (str "arm B の所要時間 p50 が arm A の " ratio " 倍")
                     :else "暫定基準では差を認めない")})))

(defn compare-data [out]
  (let [budget (read-budget out)
        trials (load-trials out)
        groups (group-by (juxt :model-rev :harness-version) trials)]
    {:definition_version definition-version
     :generated_at (now-str)
     :budget (select-keys budget [:tasks :reps :arms :trial-timeout-seconds :max-trials :created-at])
     :trials_recorded (count trials)
     :note "暫定判定。件数が少ないので断定せず、同条件での再評価と原因候補の確認を推奨する。"
     :groups (vec (for [[[model-rev harness-version] ts] (sort groups)]
                    (let [arms (into (sorted-map) (for [[arm ats] (group-by :arm ts)] [arm (arm-summary ats)]))
                          {:keys [a b paired_trials excluded_unpaired_trials]} (paired-summaries ts)]
                      {:model_rev model-rev :harness_version harness-version
                       :arms arms
                       :regression (assoc (regression (when (get arms "A") a) (when (get arms "B") b))
                                          :paired_trials paired_trials
                                          :excluded_unpaired_trials excluded_unpaired_trials)})))}))

(defn compare! [args]
  (println (json/generate-string (compare-data (or (arg args "--out" nil) (throw (ex-info "--out が必要" {})))) {:pretty true})))

(defn label-value [v] (str/replace (str v) #"[^A-Za-z0-9._/:-]" "_"))

(defn labels [m] (str "{" (str/join "," (for [[k v] m] (str (name k) "=\"" (label-value v) "\""))) "}"))

(defn prom-text [out]
  (let [data (compare-data out)
        budget (read-budget out)
        trials (remove #(= "aborted" (:outcome %)) (load-trials out))
        sb (StringBuilder.)
        line! (fn [s] (.append sb s) (.append sb "\n"))]
    (line! (str "# HELP ai_ops_harness_eval_info ハーネス対照評価の定義版 (" definition-version ")。")) (line! "# TYPE ai_ops_harness_eval_info gauge")
    (line! (str "ai_ops_harness_eval_info" (labels {:definition_version definition-version}) " 1"))
    (line! "# HELP ai_ops_harness_eval_generated_timestamp_seconds この出力を生成した時刻。") (line! "# TYPE ai_ops_harness_eval_generated_timestamp_seconds gauge")
    (line! (str "ai_ops_harness_eval_generated_timestamp_seconds " (now-epoch)))
    (line! "# HELP ai_ops_harness_eval_budget 試行前に記録した予算。") (line! "# TYPE ai_ops_harness_eval_budget gauge")
    (doseq [[part v] [["tasks" (count (:tasks budget))] ["reps" (:reps budget)] ["arms" (count (:arms budget))]
                      ["trial_timeout_seconds" (:trial-timeout-seconds budget)] ["max_trials" (:max-trials budget)]]]
      (line! (str "ai_ops_harness_eval_budget" (labels {:part part}) " " v)))
    (line! "# HELP ai_ops_harness_eval_trials 課題 × arm × 結果ごとの試行数 (失敗・timeout を含む分母)。") (line! "# TYPE ai_ops_harness_eval_trials gauge")
    (doseq [[[model-rev harness-version arm task] ts] (sort (group-by (juxt :model-rev :harness-version :arm :task) trials))
            :let [by (frequencies (map :outcome ts))]
            outcome ["pass" "fail" "timeout" "error"]]
      (line! (str "ai_ops_harness_eval_trials" (labels {:model_rev model-rev :harness_version harness-version :arm arm :task task :outcome outcome})
                  " " (get by outcome 0))))
    (line! "# HELP ai_ops_harness_eval_seconds 試行の所要時間の分位 (秒)。") (line! "# TYPE ai_ops_harness_eval_seconds gauge")
    (line! "# HELP ai_ops_harness_eval_tool_calls 読める events から数えた tool 呼出し回数の中央値。") (line! "# TYPE ai_ops_harness_eval_tool_calls gauge")
    (line! "# HELP ai_ops_harness_eval_regression 同一 model_rev での暫定判定 (断定ではない)。") (line! "# TYPE ai_ops_harness_eval_regression gauge")
    (doseq [{:keys [model_rev harness_version arms regression]} (:groups data)]
      (doseq [[arm s] arms]
        (doseq [[q v] [["0.5" (:seconds_p50 s)] ["0.9" (:seconds_p90 s)]] :when v]
          (line! (str "ai_ops_harness_eval_seconds" (labels {:model_rev model_rev :harness_version harness_version :arm arm :quantile q}) " " v)))
        (when-let [tc (:tool_calls_median s)]
          (doseq [k [:read :explore :edit :bash :other]]
            (line! (str "ai_ops_harness_eval_tool_calls" (labels {:model_rev model_rev :harness_version harness_version :arm arm :kind (name k)}) " " (get tc k))))))
      (doseq [status ["insufficient" "no_regression" "suspected"]]
        (line! (str "ai_ops_harness_eval_regression" (labels {:model_rev model_rev :harness_version harness_version :status status})
                    " " (if (= status (:status regression)) 1 0)))))
    (str sb)))

(defn prom! [args] (print (prom-text (or (arg args "--out" nil) (throw (ex-info "--out が必要" {}))))) (flush))

(defn usage! []
  (binding [*out* *err*]
    (println "usage: bb harness_eval.bb plan|run|compare|prom --out DIR ... (詳細はファイル先頭)"))
  (System/exit 1))

(defn -main [& args]
  (case (first args)
    "plan" (plan! (rest args))
    "run" (run! (rest args))
    "compare" (compare! (rest args))
    "prom" (prom! (rest args))
    "contract" (do (print (contract-text)) (flush))
    (usage!)))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
