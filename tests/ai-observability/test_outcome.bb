#!/usr/bin/env bb
(require '[babashka.fs :as fs] '[babashka.process :refer [shell]] '[cheshire.core :as json] '[clojure.string :as str] '[clojure.test :refer [deftest is run-tests]])
(def repo (fs/parent (fs/parent (fs/parent (fs/absolutize *file*)))))
(def tool (str (fs/path repo "docker/codex-workspace/task-board/ai_ops_outcome.bb")))
(load-file tool)
(def now (java.time.Instant/parse "2026-11-01T00:00:00Z"))
(defn fixture [d]
  (let [root (fs/path d "root") vault (fs/path d "vault")]
    (doseq [p [(fs/path root "runs") (fs/path vault "Tickets") (fs/path vault "Boards")]] (fs/create-dirs p))
    (spit (str (fs/path vault "Boards" "Task Board.md")) "## In Progress\n")
    [root vault]))
(defn add-run [root vault n start end result & [status wait closed unreadable]]
  (let [ticket (str "BOXP-" n) id (str/replace start #"[-:]" "") dir (fs/path root "runs" ticket id)]
    (fs/create-dirs dir)
    (when-not unreadable
      (spit (str (fs/path dir "summary.edn")) (pr-str (cond-> {:ticket ticket :run-id id :action "implement" :status (or status "succeeded") :result result :started-at start :finished-at end} wait (assoc :wait-reason wait)))))
    (spit (str (fs/path vault "Tickets" (str ticket ".md"))) (str "---\ntitle: SECRETTITLE\nassignee: boxp\n" (when closed (str "closed: " closed "\n")) "---\n## Notes\nSECRETBODY\n"))))
(defn card [vault lane n assignee]
  (spit (str (fs/path vault "Boards" "Task Board.md")) (str "## " lane "\n- [ ] [[Tickets/BOXP-" n "|SECRETTITLE]] assignee::" assignee "\n") :append true))
(deftest classifications
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d) add #(apply add-run root vault %)]
      (add [1 "2026-10-25T00:00:00Z" "2026-10-26T00:00:00Z" "done"])
      (add [2 "2026-10-24T00:00:00Z" "2026-11-01T00:00:00Z" "done"])
      (add [3 "2026-10-24T00:00:00Z" "2026-10-24T01:00:00Z" "continue"])
      (add [4 "2026-10-24T00:00:00Z" "2026-10-24T01:00:00Z" "blocked" "blocked" "owner-decision"])
      (add [5 "2026-10-24T00:00:00Z" "2026-10-24T01:00:00Z" "review"])
      (add [6 "2026-10-24T00:00:00Z" "2026-10-24T01:00:00Z" "blocked" "blocked" "agent-recoverable"])
      (add [7 "2026-10-30T00:00:00Z" "2026-10-30T01:00:00Z" "review"])
      (add [8 "2026-10-30T00:00:00Z" nil nil nil nil nil true])
      (add [9 "2026-10-29T00:00:00Z" "2026-10-29T01:00:00Z" "continue" nil nil "2026-10-28"])
      (add [10 "2026-09-22T00:00:00Z" "2026-09-22T01:00:00Z" "done"])
      (card vault "Blocked" 4 "codex") (card vault "Ready" 5 "boxp") (card vault "Blocked" 6 "codex")
      (let [s (ai-ops-outcome/snapshot root vault now) w (get-in s [:windows "28d"]) w7 (get-in s [:windows "7d"]) p (ai-ops-outcome/prom root vault now) j (json/generate-string s)]
        (is (= (select-keys w [:started :determined :reached_in_budget :reached_over_budget :not_reached :pending :excluded_legitimate_wait :unevaluated])
               {:started 9 :determined 5 :reached_in_budget 2 :reached_over_budget 1 :not_reached 2 :pending 1 :excluded_legitimate_wait 2 :unevaluated 1}))
        (is (= 4 (:started w7)))
        (is (= "insufficient" (:status w)))
        (is (= 2 (get-in w [:duration :measured])))
        (is (= 1 (get-in w [:duration :reached_without_run_outcome])))
        (is (str/includes? p "ai_ops_outcome_hours{window=\"28d\""))
        (doseq [x [p j]] (is (not (str/includes? x "SECRET"))) (is (not (str/includes? x "BOXP-"))))))))
(deftest statuses-and-rework
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      (is (= "no_observations" (get-in (ai-ops-outcome/snapshot root vault now) [:windows "7d" :status])))
      (is (not (str/includes? (ai-ops-outcome/prom root vault now) "ai_ops_outcome_hours")))
      (doseq [n (range 20 30)] (add-run root vault n "2026-10-26T00:00:00Z" "2026-10-26T01:00:00Z" "done"))
      (add-run root vault 40 "2026-10-10T00:00:00Z" "2026-10-10T01:00:00Z" "done")
      (add-run root vault 40 "2026-10-12T00:00:00Z" "2026-10-12T01:00:00Z" "continue")
      (let [s (ai-ops-outcome/snapshot root vault now)]
        (is (= "measuring" (get-in s [:windows "7d" :status])))
        (is (= {:matured 1 :rework 1 :pending 10} (get-in s [:windows "28d" :rework])))))))
(deftest closed-only-and-unreadable-before-outcome
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      (add-run root vault 50 "2026-10-29T00:00:00Z" "2026-10-29T01:00:00Z" "review" nil nil "2026-10-30")
      (let [s (ai-ops-outcome/snapshot root vault now)]
        (is (= 1 (get-in s [:windows "7d" :duration :reached_without_run_outcome])))
        (is (nil? (get-in s [:windows "7d" :duration :p50_h])))
        (is (not (str/includes? (ai-ops-outcome/prom root vault now) "ai_ops_outcome_hours"))))
      (add-run root vault 51 "2026-10-28T00:00:00Z" "2026-10-28T01:00:00Z" "continue")
      (add-run root vault 51 "2026-10-29T00:00:00Z" nil nil nil nil nil true)
      (add-run root vault 51 "2026-10-30T00:00:00Z" "2026-10-30T01:00:00Z" "done")
      (is (= 1 (get-in (ai-ops-outcome/snapshot root vault now) [:windows "7d" :unevaluated]))))))
(deftest unreadable-run-overlapping-outcome-run
  ;; 成果 run の開始後・終了前に始まった読めない run は run ID 順では成果 run の後に並ぶが、より早く成果に達した
  ;; 可能性があるので unevaluated にする。成果の終了後に始まった読めない run はやり直しにだけ数える。
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      (add-run root vault 90 "2026-10-10T00:00:00Z" "2026-10-10T03:00:00Z" "done")
      (add-run root vault 90 "2026-10-10T01:00:00Z" nil nil nil nil nil true)
      (add-run root vault 91 "2026-10-10T00:00:00Z" "2026-10-10T03:00:00Z" "done")
      (add-run root vault 91 "2026-10-10T04:00:00Z" nil nil nil nil nil true)
      (let [w (get-in (ai-ops-outcome/snapshot root vault now) [:windows "28d"])]
        (is (= 1 (:unevaluated w)))
        (is (= 1 (:reached_in_budget w)))
        (is (= {:matured 1 :rework 1 :pending 0} (:rework w)))))))
(deftest closed-earlier-than-run-outcome-wins
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      ;; 70: closed 10-12 が run の done (10-15) より前の日 → closed を成果とし (48h、分位には入れない)、10-15 の run はやり直し
      (add-run root vault 70 "2026-10-10T00:00:00Z" "2026-10-10T01:00:00Z" "continue" nil nil "2026-10-12")
      (add-run root vault 70 "2026-10-15T00:00:00Z" "2026-10-15T01:00:00Z" "done" nil nil "2026-10-12")
      ;; 71: closed と done が同じ日 → run の done (秒精度) を成果とし、分位に入れる
      (add-run root vault 71 "2026-10-10T00:00:00Z" "2026-10-10T01:00:00Z" "continue" nil nil "2026-10-15")
      (add-run root vault 71 "2026-10-15T10:00:00Z" "2026-10-15T11:00:00Z" "done" nil nil "2026-10-15")
      (let [w (get-in (ai-ops-outcome/snapshot root vault now) [:windows "28d"])]
        (is (= 2 (:reached_in_budget w)))
        (is (= 0 (:unevaluated w)))
        (is (= {:measured 1 :reached_without_run_outcome 1 :p50_h 131.0 :p90_h 131.0} (:duration w)))
        (is (= {:matured 2 :rework 1 :pending 0} (:rework w)))))))
(deftest unreadable-run-after-closed-only-outcome
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      ;; 80: closed 10-29 で到達した後の読めない run (10-31) は到達を覆さない (やり直しには数える)
      (add-run root vault 80 "2026-10-20T00:00:00Z" "2026-10-20T01:00:00Z" "continue" nil nil "2026-10-29")
      (add-run root vault 80 "2026-10-31T00:00:00Z" nil nil nil nil "2026-10-29" true)
      ;; 81: closed 10-29 より前に読めない run (10-21) がある → 最初の成果時刻が分からず unevaluated
      (add-run root vault 81 "2026-10-20T00:00:00Z" "2026-10-20T01:00:00Z" "continue" nil nil "2026-10-29")
      (add-run root vault 81 "2026-10-21T00:00:00Z" nil nil nil nil "2026-10-29" true)
      (let [w (get-in (ai-ops-outcome/snapshot root vault now) [:windows "28d"])]
        (is (= 2 (:started w)))
        (is (= 1 (:reached_over_budget w)))
        (is (= 1 (:unevaluated w)))
        (is (= 1 (get-in w [:duration :reached_without_run_outcome])))))))
(deftest closed-only-rework-uses-day-precision
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      ;; 60: closed 10-10、同じ日の run は やり直しではない。61: closed 10-10、翌日の run は やり直し
      (add-run root vault 60 "2026-10-09T00:00:00Z" "2026-10-09T01:00:00Z" "continue" nil nil "2026-10-10")
      (add-run root vault 60 "2026-10-10T05:00:00Z" "2026-10-10T06:00:00Z" "continue" nil nil "2026-10-10")
      (add-run root vault 61 "2026-10-09T00:00:00Z" "2026-10-09T01:00:00Z" "continue" nil nil "2026-10-10")
      (add-run root vault 61 "2026-10-11T00:00:00Z" "2026-10-11T01:00:00Z" "continue" nil nil "2026-10-10")
      (is (= {:matured 2 :rework 1 :pending 0} (get-in (ai-ops-outcome/snapshot root vault now) [:windows "28d" :rework]))))))
(deftest window-uses-decision-time
  ;; 判定の確定時刻で窓に入れる。予算 7 日と 7 日窓では、開始時刻で入れると失敗が常に 0 件になる。
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      ;; 100: 9 日前に開始して成果なし → 2 日前に予算切れ。7d / 28d の not_reached
      (add-run root vault 100 "2026-10-23T00:00:00Z" "2026-10-23T01:00:00Z" "continue")
      ;; 101: 10 日前に開始して 1 日前に成果 → 3 日前に予算切れの遅延。7d / 28d の reached_over_budget
      (add-run root vault 101 "2026-10-22T00:00:00Z" "2026-10-31T00:00:00Z" "done")
      ;; 102: 10 日前に開始して 9 日前に成果 → 成果は 7d の外。28d の reached_in_budget
      (add-run root vault 102 "2026-10-22T00:00:00Z" "2026-10-23T00:00:00Z" "done")
      ;; 103: 30 日前に開始して成果なし → 23 日前に予算切れ。28d にだけ入り、開始は 28d の外
      (add-run root vault 103 "2026-10-02T00:00:00Z" "2026-10-02T01:00:00Z" "continue")
      ;; 104: 36 日前に開始して成果なし → 29 日前に予算切れ。どの窓にも入らない
      (add-run root vault 104 "2026-09-26T00:00:00Z" "2026-09-26T01:00:00Z" "continue")
      ;; 105: 1 日前に開始して成果なし → pending は開始時刻で入れる
      (add-run root vault 105 "2026-10-31T00:00:00Z" "2026-10-31T01:00:00Z" "continue")
      (let [s (ai-ops-outcome/snapshot root vault now)
            part #(select-keys % [:started :determined :reached_in_budget :reached_over_budget :not_reached :pending])]
        (is (= {:started 1 :determined 2 :reached_in_budget 0 :reached_over_budget 1 :not_reached 1 :pending 1}
               (part (get-in s [:windows "7d"]))))
        (is (= {:started 4 :determined 4 :reached_in_budget 1 :reached_over_budget 1 :not_reached 2 :pending 1}
               (part (get-in s [:windows "28d"]))))))))
(deftest cli-usage
  (let [p (shell {:out :string :err :string :continue true} "bb" tool)]
    (is (= 2 (:exit p))) (is (str/includes? (:err p) "usage:"))))
(let [{:keys [fail error]} (run-tests)] (System/exit (if (pos? (+ fail error)) 1 0)))
