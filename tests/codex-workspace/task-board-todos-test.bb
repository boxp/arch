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
(deftest parser-boundaries-and-position
  (let [text "## Plan\n```\n- [ ] TD-01【必須】same\n```\n- [ ] TD-01【必須】same\n- [ ] worker step\n  - child\nTD-02 を先に実施\n- TD-03 bad\n## Notes\n- [ ] TD-04【必須】no\n"
        items (task-board-todos/parse-items text)
        changed (task-board-todos/replace-item text (first items) "- [x] TD-01【必須】same")]
    (is (= ["TD-01" "TD-03"] (mapv :id items)))
    (is (= [:required :invalid] (mapv :tag items)))
    (is (empty? (:children (first items))))
    (is (str/includes? changed "```\n- [ ] TD-01【必須】same\n```\n- [x] TD-01"))
    (is (empty? (task-board-todos/parse-items "## Plan\n````\n```\n- [ ] TD-99【必須】hidden\n~~~~\n````\n")))
    (is (empty? (:children (first (task-board-todos/parse-items "## Plan\n- [ ] TD-01【必須】x\n\n  - unrelated\n")))))))

(deftest mutations-and-hook-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-2.md") dir (fs/path d "run")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))
        args ["--vault" d] read-view #(task-board-todos/ticket-view (slurp (str path)))
        hook (fn [event command] @(p/process ["bb" module "hook" "--vault" d "--ticket" "BOXP-2" "--run-dir" (str dir) "--event" event] {:in (str "{\"tool_input\":{\"command\":\"" command "\"}}") :out :string :err :string}))]
    (fs/create-dirs (fs/parent path)) (fs/create-dirs dir)
    (spit (str path) (str/replace sample "todo_contract: v1" "status: ready"))
    (let [rev (:rev (read-view))]
      (is (zero? (:exit (apply run "ack" "BOXP-2" (concat args ["--rev" rev])))))
      (is (= :legacy (:mode (read-view)))))
    (is (zero? (:exit (apply run "add" "BOXP-2" (concat args ["--id" "TD-10" "--required" "--text" "work" "--ac" "x" "--priority" "high" "--source" "test"])))))
    (let [before (slurp (str path)) rev (:rev (read-view))]
      (is (str/includes? before "unreceived=2"))
      (is (zero? (:exit (apply run "add" "BOXP-2" (concat args ["--id" "TD-10" "--required" "--text" "work" "--ac" "x" "--priority" "high" "--source" "test"])))))
      (is (= before (slurp (str path))))
      (is (zero? (:exit (apply run "add" "BOXP-2" (concat args ["--required" "--text" "work" "--source" "test"])))))
      (is (= before (slurp (str path))))
      (spit (str (fs/path dir "todo-start.edn")) (pr-str {:rev "old"}))
      (is (str/includes? (:out (hook "pre" "gh pr merge 12")) "deny"))
      (is (= "" (:out (hook "pre" "echo gh pr merge 12"))))
      (is (str/includes? (:out (hook "pre" "cd /tmp\\ngh pr merge 12")) "deny"))
      (is (str/includes? (:out (hook "pre" "GH_TOKEN=x timeout 60 gh pr merge 12")) "deny"))
      (is (str/includes? (:out (hook "pre" "gh api -X PUT repos/o/r/pulls/1/merge")) "deny"))
      (is (= "" (:out (hook "pre" "git push origin feature-mainline"))))
      (is (not (str/blank? (:out (hook "stop" "")))))
      (is (not (str/blank? (:out (hook "stop" "")))))
      (is (= "" (:out (hook "stop" ""))))
      (let [stale (apply run "ack" "BOXP-2" (concat args ["--rev" "stale"]))]
        (is (= 3 (:exit stale)))
        (is (str/includes? (:err stale) "changes:")))
      (is (zero? (:exit (apply run "ack" "BOXP-2" (concat args ["--rev" rev])))))
      (is (= "" (:out (hook "pre" "gh pr merge 12"))))
      (doseq [_ (range 2)] (is (zero? (:exit (apply run "done" "BOXP-2" "TD-10" (concat args ["--evidence" "proof"]))))) )
      (is (= 1 (count (re-seq #"証拠: proof" (slurp (str path))))))
      (is (= 4 (:exit (apply run "skip" "BOXP-2" "TD-10" (concat args ["--reason" "no"])))))
      (is (= rev (:rev (read-view)))))))
(deftest gate-changes-mock-path
  (let [base "---\ntodo_contract: v1\n---\n## Summary\nbody\n## Plan\n- [ ] TD-01【必須】work\n"
        original (task-board-todos/ticket-view base)
        ack-items (str/join "," (map (fn [[id hash]] (str id ":" (subs hash 0 8))) (sort-by key (:hashes original))))
        received (task-board-todos/set-fm base "todo_ack_items" ack-items)
        decision (fn [text result] (task-board-todos/gate-decision {:view (task-board-todos/ticket-view text) :start-rev (:rev original) :result result}))]
    (is (not (:hold? (decision received "blocked"))))
    (is (:hold? (decision (str/replace received "work" "changed") "blocked")))
    (is (:hold? (decision (str/replace received "work" "changed") "done")))
    (is (:hold? (decision (str/replace received "【必須】" "【取消】") "done")))
    (is (not (:hold? (decision (str/replace received "【必須】" "【任意】") "done"))))
    (let [no-item (task-board-todos/ticket-view (str/replace base "- [ ] TD-01【必須】work\n" ""))
          ack-body (str "_BODY:" (subs (get-in no-item [:hashes "_BODY"]) 0 8))
          never-acked (-> base (task-board-todos/set-fm "todo_ack_items" ack-body) (str/replace "【必須】" "【取消】"))]
      (is (not (:hold? (decision never-acked "done")))))
    (is (not (:hold? (decision (str/replace received "work" "changed") "continue"))))))

(deftest optional-skip-is-idempotent-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-4.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\nstatus: ready\n---\n## Summary\nbody\n## Plan\n")
    (is (zero? (:exit (run "add" "BOXP-4" "--vault" d "--optional" "--text" "defer" "--source" "test"))))
    (doseq [_ (range 2)]
      (is (zero? (:exit (run "skip" "BOXP-4" "TD-01" "--vault" d "--reason" "later")))))
    (is (= 1 (count (re-seq #"見送り: later" (slurp (str path))))))
    (is (str/includes? (slurp (str path)) "deferred=1"))))

(deftest invalid-items-cannot-be-completed
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-4.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\ntodo_contract: v1\n---\n## Plan\n- [ ] TD-01 no tag\n")
    (is (= 4 (:exit (run "done" "BOXP-4" "TD-01" "--vault" d "--evidence" "x"))))
    (is (= 4 (:exit (run "skip" "BOXP-4" "TD-01" "--vault" d "--reason" "x"))))
    (is (zero? (:exit (run "change" "BOXP-4" "TD-01" "--vault" d "--required" "--source" "t"))))
    (is (= :required (:tag (first (task-board-todos/parse-items (slurp (str path)))))))))
(deftest hook-fail-open-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-3.md") dir (fs/path d "run")
        hook (fn [event input] @(p/process ["bb" module "hook" "--vault" d "--ticket" "BOXP-3" "--run-dir" (str dir) "--event" event] {:in input :out :string :err :string}))]
    (fs/create-dirs (fs/parent path)) (fs/create-dirs dir) (spit (str path) sample)
    (is (= "" (:out (hook "post" "{}"))))
    (is (= "" (:out (hook "post" "invalid json"))))
    (spit (str (fs/path dir "todo-start.edn")) (pr-str {:rev (:rev (task-board-todos/ticket-view sample))}))
    (is (= "" (:out (hook "post" "{}"))))))
(deftest legacy-opt-in-existing-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-5.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\nstatus: ready\n---\n## Summary\nbody\n## Plan\n- [ ] TD-01【必須】existing\n")
    (is (= :legacy (:mode (task-board-todos/ticket-view (slurp (str path))))))
    (is (zero? (:exit (run "add" "BOXP-5" "--vault" d "--required" "--text" "existing" "--source" "test"))))
    (is (= :v1 (:mode (task-board-todos/ticket-view (slurp (str path))))))
    (is (= 1 (count (task-board-todos/parse-items (slurp (str path))))))))

(deftest bounded-hook-delta-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-6.md") dir (fs/path d "run")
        hook (fn [] @(p/process ["bb" module "hook" "--vault" d "--ticket" "BOXP-6" "--run-dir" (str dir) "--event" "post"] {:in "{}" :out :string :err :string}))]
    (fs/create-dirs (fs/parent path)) (fs/create-dirs dir)
    (spit (str path) (str "---\ntodo_contract: v1\n---\n## Plan\n- [ ] TD-01【必須】" (apply str (repeat 4000 "x")) "\n"))
    (spit (str (fs/path dir "todo-start.edn")) (pr-str {:rev "old"}))
    (let [first-output (:out (hook))]
      (is (str/includes? first-output "truncated"))
      (is (< (count first-output) 2400)))
    (is (= "" (:out (hook))))
    (is (fs/exists? (fs/path dir "todo-delivery.edn")))))
(deftest terminal-metadata-does-not-accumulate-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-7.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\ntodo_contract: v1\n---\n## Summary\nx\n## Plan\n- [ ] TD-01【必須】one\n- [ ] TD-02【任意】two\n")
    (let [rev (:rev (task-board-todos/ticket-view (slurp (str path))))]
      (is (zero? (:exit (run "ack" "BOXP-7" "--vault" d "--rev" rev))))
      (is (zero? (:exit (run "done" "BOXP-7" "TD-01" "--vault" d "--evidence" "ok"))))
      (is (zero? (:exit (run "skip" "BOXP-7" "TD-02" "--vault" d "--reason" "later"))))
      (let [before (slurp (str path))]
        (is (zero? (:exit (run "done" "BOXP-7" "TD-01" "--vault" d "--evidence" "ok"))))
        (is (zero? (:exit (run "skip" "BOXP-7" "TD-02" "--vault" d "--reason" "later"))))
        (is (= before (slurp (str path))))))))
(deftest change-and-cancel-refresh-state-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-8.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))
        view #(task-board-todos/ticket-view (slurp (str path)))
        gate #(task-board-todos/gate-decision {:view (view) :start-rev "start" :result "done"})]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\nstatus: ready\n---\n## Summary\nbody\n## Plan\n")
    (is (zero? (:exit (run "add" "BOXP-8" "--vault" d "--required" "--text" "first" "--source" "test"))))
    (is (zero? (:exit (run "ack" "BOXP-8" "--vault" d "--rev" (:rev (view))))))
    (is (zero? (:exit (run "change" "BOXP-8" "TD-01" "--vault" d "--text" "changed" "--source" "test"))))
    (is (str/includes? (slurp (str path)) "unreceived=1"))
    (is (:hold? (gate)))
    (is (zero? (:exit (run "change" "BOXP-8" "TD-01" "--vault" d "--optional" "--source" "test"))))
    (is (not (:hold? (gate))))
    (is (zero? (:exit (run "cancel" "BOXP-8" "TD-01" "--vault" d "--reason" "withdrawn" "--source" "test"))))
    (is (:hold? (gate)))
    (is (str/includes? (slurp (str path)) "deferred=1"))))
(deftest concurrent-stop-limit-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-9.md") dir (fs/path d "run")]
    (fs/create-dirs (fs/parent path)) (fs/create-dirs dir)
    (spit (str path) sample)
    (spit (str (fs/path dir "todo-start.edn")) "{:rev \"old\"}")
    (let [processes (doall (repeatedly 6 #(p/process ["bb" module "hook" "--vault" d "--ticket" "BOXP-9" "--run-dir" (str dir) "--event" "stop"] {:in "{}" :out :string :err :string})))
          outputs (mapv #(-> @% :out) processes)]
      (is (= 2 (count (remove str/blank? outputs)))))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
