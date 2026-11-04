#!/usr/bin/env bb
(require '[clojure.test :refer [deftest is run-tests]] '[clojure.string :as str] '[babashka.fs :as fs] '[babashka.process :as p])
(load-file "docker/codex-workspace/task-board/task_board_todos.bb")
(def module "docker/codex-workspace/task-board/task_board_todos.bb")
(def sample "---\ntodo_contract: v1\n---\n## Summary\nhello\n## Acceptance Criteria\ncheck\n## Plan\n- [ ] TD-01【必須】test\n  - AC: one\n> - [ ] TD-02【必須】ignored\n```\n- [ ] TD-03【必須】ignored\n```\n  - [ ] TD-04【必須】ignored\n## Notes\n- [ ] TD-05【必須】ignored\n")
(deftest parser-and-revisions
  (is (= ["TD-01"] (mapv :id (task-board-todos/parse-items sample))))
  (is (= (:rev (task-board-todos/ticket-view sample)) (:rev (task-board-todos/ticket-view (str/replace sample "[ ] TD-01" "[x] TD-01")))))
  (is (not= (:rev (task-board-todos/ticket-view sample)) (:rev (task-board-todos/ticket-view (str/replace sample "【必須】test" "【任意】test")))))
  (is (= [:invalid :invalid] (mapv :tag (task-board-todos/parse-items "## Plan\n- [ ] TD-06【必須】a\n- [ ] TD-06【必須】b\n")))))
(deftest cli
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-1.md") run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))]
    (fs/create-dirs (fs/parent path)) (spit (str path) (str/replace sample "todo_contract: v1" "status: ready"))
    (is (zero? (:exit (run "add" "BOXP-1" "--vault" d "--required" "--text" "new" "--source" "test"))))
    (let [v (task-board-todos/ticket-view (slurp (str path))) rev (:rev v)]
      (is (= 3 (:exit (run "ack" "BOXP-1" "--vault" d "--rev" "stale"))))
      (is (zero? (:exit (run "ack" "BOXP-1" "--vault" d "--rev" rev))))
      (is (zero? (:exit (run "done" "BOXP-1" "TD-02" "--vault" d "--evidence" "verified"))))
      (is (= rev (:rev (task-board-todos/ticket-view (slurp (str path))))))
      (is (= 4 (:exit (run "skip" "BOXP-1" "TD-02" "--vault" d "--reason" "no")))))))
(deftest copies (is (= (slurp module) (slurp "docker/hermes-agent/skills/obsidian-task-board/bin/task_board_todos.bb"))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
