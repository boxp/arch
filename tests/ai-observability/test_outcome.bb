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
(deftest closed-only-rework-uses-day-precision
  (fs/with-temp-dir [d {}]
    (let [[root vault] (fixture d)]
      ;; 60: closed 10-10、同じ日の run は やり直しではない。61: closed 10-10、翌日の run は やり直し
      (add-run root vault 60 "2026-10-09T00:00:00Z" "2026-10-09T01:00:00Z" "continue" nil nil "2026-10-10")
      (add-run root vault 60 "2026-10-10T05:00:00Z" "2026-10-10T06:00:00Z" "continue" nil nil "2026-10-10")
      (add-run root vault 61 "2026-10-09T00:00:00Z" "2026-10-09T01:00:00Z" "continue" nil nil "2026-10-10")
      (add-run root vault 61 "2026-10-11T00:00:00Z" "2026-10-11T01:00:00Z" "continue" nil nil "2026-10-10")
      (is (= {:matured 2 :rework 1 :pending 0} (get-in (ai-ops-outcome/snapshot root vault now) [:windows "28d" :rework]))))))
(deftest cli-usage
  (let [p (shell {:out :string :err :string :continue true} "bb" tool)]
    (is (= 2 (:exit p))) (is (str/includes? (:err p) "usage:"))))
(let [{:keys [fail error]} (run-tests)] (System/exit (if (pos? (+ fail error)) 1 0)))
