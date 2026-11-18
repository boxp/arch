#!/usr/bin/env bb
(require '[clojure.test :refer [deftest is run-tests testing]] '[clojure.string :as str] '[babashka.fs :as fs] '[babashka.process :as p])
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
(deftest add-without-id-keeps-new-conditions
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-11.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))
        add (fn [& args] (:exit (apply run "add" "BOXP-11" "--vault" d "--source" "test" args)))
        items #(task-board-todos/parse-items (slurp (str path)))
        children-of (fn [id] (mapv str/trim (remove (fn [c] (str/includes? c "由来:")) (:children (first (filter (fn [i] (= id (:id i))) (items)))))))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\nstatus: ready\n---\n## Summary\nhello\n## Plan\n## Notes\n")
    (testing "a retry with the same or fewer conditions is a no-op"
      (is (zero? (add "--required" "--text" "work" "--ac" "a" "--priority" "high")))
      (let [before (slurp (str path))]
        (is (zero? (add "--required" "--text" "work" "--ac" "a" "--priority" "high")))
        (is (zero? (add "--required" "--text" " work  " "--ac" "a")))
        (is (zero? (add "--required" "--text" "work")))
        (is (= before (slurp (str path))))))
    (testing "a different AC or priority is saved and bumps the revision"
      (let [rev (:rev (task-board-todos/ticket-view (slurp (str path))))]
        (is (zero? (add "--required" "--text" "work" "--ac" "b")))
        (is (not= rev (:rev (task-board-todos/ticket-view (slurp (str path))))))
        (is (= ["- AC: a" "- 優先度: high"] (children-of "TD-01")))
        (is (= ["- AC: b"] (children-of "TD-02"))))
      (is (zero? (add "--required" "--text" "work" "--ac" "a" "--priority" "low")))
      (is (= ["- AC: a" "- 優先度: low"] (children-of "TD-03"))))
    (testing "retrying any saved variant does not add another item"
      (let [before (slurp (str path))]
        (is (zero? (add "--required" "--text" "work" "--ac" "b")))
        (is (= before (slurp (str path))))))
    (testing "an explicit ID with different content is still refused"
      (let [before (slurp (str path))]
        (is (not (zero? (add "--id" "TD-01" "--required" "--text" "work" "--ac" "z"))))
        (is (= before (slurp (str path))))))))
(deftest add-rejects-ids-the-parser-cannot-read
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-12.md")
        body "---\nstatus: ready\n---\n## Summary\nhello\n## Plan\n## Notes\n"
        add (fn [id] @(p/process ["bb" module "add" "BOXP-12" "--vault" d "--source" "test" "--id" id "--required" "--text" "work"] {:out :string :err :string}))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) body)
    (doseq [id ["TD-foo" "TD-1a" "td-01" "TD-" "X-1" "TD-01【任意】x"]]
      (testing id
        (is (= 4 (:exit (add id))))
        (is (= body (slurp (str path))))))
    (is (zero? (:exit (add "TD-7"))))
    (is (= ["TD-7"] (mapv :id (task-board-todos/parse-items (slurp (str path))))))
    (is (= :unreceived (:state (first (:items (task-board-todos/ticket-view (slurp (str path))))))))))
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
(deftest duplicate-ids-never-pass-the-done-gate
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-12.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))
        view #(task-board-todos/ticket-view (slurp (str path)))
        gate #(task-board-todos/gate-decision {:view (view) :result %})]
    (fs/create-dirs (fs/parent path))
    (spit (str path) (str "---\ntodo_contract: v1\n---\n## Summary\nhello\n## Plan\n"
                          "- [x] TD-01【必須】first\n  - 証拠: a\n"
                          "- [x] TD-01【必須】second\n  - 証拠: b\n"
                          "## Notes\n"))
    (is (zero? (:exit (run "ack" "BOXP-12" "--vault" d "--rev" (:rev (view))))))
    (testing "received, checked and with evidence on both lines, yet not verified"
      (is (= [:invalid :invalid] (mapv :tag (:items (view)))))
      (is (= [:received :received] (mapv :state (:items (view)))))
      (is (not (str/includes? (task-board-todos/state-summary (view)) "done=2"))))
    (testing "done is held, blocked is not since the items are already received"
      (is (:hold? (gate "done")))
      (is (= ["TD-01"] (:blocking-ids (gate "done"))))
      (is (not (:hold? (gate "blocked")))))
    (testing "a repaired ID is judged again and can pass"
      (spit (str path) (str/replace (slurp (str path)) "TD-01【必須】second" "TD-02【必須】second"))
      (is (zero? (:exit (run "ack" "BOXP-12" "--vault" d "--rev" (:rev (view))))))
      ;; TD-01's content changed (it was invalid), so its old check and evidence are gone.
      (is (= :received (:state (first (:items (view))))))
      (is (= ["TD-01"] (:blocking-ids (gate "done"))))
      (is (zero? (:exit (run "done" "BOXP-12" "TD-01" "--vault" d "--evidence" "a"))))
      (is (= [:verified :verified] (mapv :state (:items (view)))))
      (is (not (:hold? (gate "done")))))))
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
      ;; The delta is capped at 1950 characters; the worker commands add a fixed block.
      (is (< (count first-output) 3500)))
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
(deftest changed-completion-does-not-carry-over-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-10.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))
        view #(task-board-todos/ticket-view (slurp (str path)))
        state (fn [id] (:state (some (fn [i] (when (= id (:id i)) i)) (:items (view)))))
        gate #(task-board-todos/gate-decision {:view (view) :start-rev "start" :result "done"})
        ack #(is (zero? (:exit (run "ack" "BOXP-10" "--vault" d "--rev" (:rev (view))))))
        finish (fn [] (ack) (is (zero? (:exit (run "done" "BOXP-10" "TD-01" "--vault" d "--evidence" "old-proof"))))
                 (is (= :verified (state "TD-01"))) (is (not (:hold? (gate)))))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\ntodo_contract: v1\n---\n## Summary\nx\n## Plan\n- [ ] TD-01【必須】first\n  - AC: keep\n- [ ] TD-02【任意】other\n")
    (testing "change command: acknowledging the new content is not doing it"
      (finish)
      (let [rev (:rev (view))]
        (is (zero? (:exit (run "change" "BOXP-10" "TD-01" "--vault" d "--text" "second" "--source" "owner"))))
        (is (not= rev (:rev (view)))))
      (is (= :unreceived (state "TD-01")))
      (is (not (str/includes? (slurp (str path)) "old-proof")))
      (is (str/includes? (slurp (str path)) "- [ ] TD-01【必須】second\n  - AC: keep"))
      (ack)
      (is (= :received (state "TD-01")))
      (is (:hold? (gate)))
      (is (zero? (:exit (run "done" "BOXP-10" "TD-01" "--vault" d "--evidence" "new-proof"))))
      (is (= :verified (state "TD-01"))))
    (testing "a change that repeats the current content keeps the completion"
      (is (zero? (:exit (run "change" "BOXP-10" "TD-01" "--vault" d "--text" "second" "--required" "--source" "owner"))))
      (is (= :verified (state "TD-01")))
      (is (str/includes? (slurp (str path)) "new-proof")))
    (testing "a hand edit in the vault cannot carry the completion through ack either"
      (spit (str path) (str/replace (slurp (str path)) "【必須】second" "【必須】third"))
      (is (= :unreceived (state "TD-01")))
      (let [rev (:rev (view))]
        (ack)
        (is (= rev (:rev (view))) "reopening must not create a new revision"))
      (is (= :received (state "TD-01")))
      (is (not (str/includes? (slurp (str path)) "new-proof")))
      (is (str/includes? (slurp (str path)) "- [ ] TD-01【必須】third\n  - AC: keep"))
      (is (:hold? (gate))))
    (testing "ack leaves untouched items and a stale deferral is dropped"
      (is (zero? (:exit (run "done" "BOXP-10" "TD-01" "--vault" d "--evidence" "third-proof"))))
      (is (zero? (:exit (run "skip" "BOXP-10" "TD-02" "--vault" d "--reason" "later"))))
      (is (= :deferred (state "TD-02")))
      (spit (str path) (str/replace (slurp (str path)) "【任意】other" "【任意】other2"))
      (ack)
      (is (= :received (state "TD-02")))
      (is (= :verified (state "TD-01")))
      (is (str/includes? (slurp (str path)) "third-proof"))
      (is (not (:hold? (gate)))))))
(deftest concurrent-stop-limit-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-9.md") dir (fs/path d "run")]
    (fs/create-dirs (fs/parent path)) (fs/create-dirs dir)
    (spit (str path) sample)
    (spit (str (fs/path dir "todo-start.edn")) "{:rev \"old\"}")
    (let [processes (doall (repeatedly 6 #(p/process ["bb" module "hook" "--vault" d "--ticket" "BOXP-9" "--run-dir" (str dir) "--event" "stop"] {:in "{}" :out :string :err :string})))
          outputs (mapv #(-> @% :out) processes)]
      (is (= 2 (count (remove str/blank? outputs)))))))
(deftest writes-keep-ticket-permissions-mock-path
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-10.md")
        run (fn [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))
        mode #(fs/str->posix (fs/posix->str (fs/posix-file-permissions path)))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) sample)
    (doseq [perm ["rw-r--r--" "rw-rw-r--"]]
      (fs/set-posix-file-permissions path perm)
      (let [before (mode)]
        (is (zero? (:exit (run "add" "BOXP-10" "--vault" d "--optional" "--text" (str "perm " perm) "--source" "test"))))
        (is (= (fs/posix->str before) (fs/posix->str (mode))))
        (is (str/includes? (slurp (str path)) (str "perm " perm)))))))
(deftest writes-keep-ticket-owner
  (let [d (fs/create-temp-dir) path (fs/path d "BOXP-13.md")
        me (task-board-todos/file-owner d)
        leftovers #(mapv str (fs/glob d ".todo-*" {:hidden true}))
        ;; Owner of the ticket, seen as someone else: nobody here can chown for real.
        as-other (fn [f]
                   (with-redefs [task-board-todos/file-owner
                                 (let [real task-board-todos/file-owner]
                                   (fn [p] (if (= (str p) (str path)) :other (real p))))]
                     (f)))]
    (testing "same owner: nothing to hand over, the real calls work"
      (spit (str path) "base")
      (task-board-todos/set-owner! path me)
      (is (true? (task-board-todos/write-if-unchanged path "base" "mine")))
      (is (= me (task-board-todos/file-owner path))))
    (testing "root: the temp copy is handed to the ticket's owner before the rename"
      (spit (str path) "base")
      (fs/set-posix-file-permissions path "rw-r--r--")
      (let [handed (atom nil)]
        (with-redefs [task-board-todos/set-owner! (fn [_ owner] (reset! handed owner))]
          (as-other #(task-board-todos/atomic-write path "mine")))
        (is (= :other @handed))
        (is (= "mine" (slurp (str path))))))
    (testing "not root, 0644: refuses and leaves the ticket and no temp file"
      (spit (str path) "base")
      (fs/set-posix-file-permissions path "rw-r--r--")
      (with-redefs [task-board-todos/set-owner! (fn [_ _] (throw (java.io.IOException. "not permitted")))]
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"would lose write access"
                              (as-other #(task-board-todos/atomic-write path "mine"))))
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"would lose write access"
                              (as-other #(task-board-todos/write-if-unchanged path "base" "mine")))))
      (is (= "base" (slurp (str path))))
      (is (empty? (leftovers))))
    (testing "not root, 0664 with the same group: the owner keeps access through the group"
      (spit (str path) "base")
      (fs/set-posix-file-permissions path "rw-rw-r--")
      (with-redefs [task-board-todos/set-owner! (fn [_ _] (throw (java.io.IOException. "not permitted")))]
        (as-other #(task-board-todos/atomic-write path "mine")))
      (is (= "mine" (slurp (str path))))
      (is (empty? (leftovers))))))
(deftest ticket-lock-spans-containers
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-12.md")
        ;; A container of its own: same vault volume, different temp dir.
        other-tmp (str (fs/create-temp-dir))
        spawn (fn [& args] (p/process (into ["bb" (str "-Djava.io.tmpdir=" other-tmp)] args) {:out :string :err :string}))
        helper "docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb"
        waits? (fn [process] (Thread/sleep 1500) (p/alive? process))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) sample)
    (testing "a TODO write in another container waits for the ticket lock"
      (let [process (atom nil)]
        (task-board-todos/with-lock path
          (fn []
            (reset! process (spawn module "add" "BOXP-12" "--vault" d "--optional" "--text" "from-other" "--source" "test"))
            (is (waits? @process))
            (is (not (str/includes? (slurp (str path)) "from-other")))))
        (is (zero? (:exit @@process)))
        (is (str/includes? (slurp (str path)) "from-other"))))
    (testing "the helper in another container waits for the same lock"
      (let [process (atom nil)]
        (task-board-todos/with-lock path
          (fn []
            (reset! process (spawn helper "append-note" "BOXP-12" "--vault" d "--source" "test" "--note" "note-other"))
            (is (waits? @process))))
        (is (zero? (:exit @@process)))
        (is (str/includes? (slurp (str path)) "note-other"))))
    (testing "a helper that only knows the local lock is still excluded"
      (let [process (atom nil)]
        (task-board-todos/with-local-lock path
          (fn []
            (reset! process (p/process ["bb" module "add" "BOXP-12" "--vault" d "--optional" "--text" "from-local" "--source" "test"] {:out :string :err :string}))
            (is (waits? @process))))
        (is (zero? (:exit @@process)))))
    (testing "the lock lives in a hidden vault directory and a helper dry-run does not create it"
      (is (fs/exists? (fs/path d ".task-board-locks" "BOXP-12.md.lock")))
      (let [fresh (str (fs/create-temp-dir)) ticket (fs/path fresh "Tickets" "BOXP-13.md")]
        (fs/create-dirs (fs/parent ticket))
        (spit (str ticket) sample)
        (spit (str (fs/create-dirs (fs/path fresh "Boards")) "/Task Board.md") "## Ready\n")
        @(p/process ["bb" helper "update" "BOXP-13" "--vault" fresh "--priority" "high" "--dry-run"] {:out :string :err :string})
        (is (not (fs/exists? (fs/path fresh ".task-board-locks"))))))))
(deftest write-outside-the-locks-is-not-overwritten
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-14.md")]
    (fs/create-dirs (fs/parent path))
    (spit (str path) sample)
    (testing "a stale snapshot does not replace the file"
      (is (not (task-board-todos/write-if-unchanged path "stale" "overwrite")))
      (is (= sample (slurp (str path)))))
    (testing "a sync that lands during the write survives and the command retries"
      (let [original task-board-todos/write-if-unchanged calls (atom 0)]
        (with-redefs [task-board-todos/write-if-unchanged
                      (fn [p expected text]
                        (when (= 1 (swap! calls inc))
                          (spit (str p) (str (slurp (str p)) "- synced note\n")))
                        (original p expected text))]
          (with-out-str (task-board-todos/-main "add" "BOXP-14" "--vault" d "--optional" "--text" "added" "--source" "test")))
        (is (= 2 @calls))
        (is (str/includes? (slurp (str path)) "- synced note"))
        (is (str/includes? (slurp (str path)) "added"))))
    (testing "a conflict that never clears fails instead of overwriting"
      (let [before (slurp (str path)) calls (atom 0)]
        (with-redefs [task-board-todos/write-if-unchanged (fn [_ _ _] (swap! calls inc) false)]
          (is (thrown-with-msg? clojure.lang.ExceptionInfo #"ticket changed"
                                (with-out-str (task-board-todos/-main "add" "BOXP-14" "--vault" d "--optional" "--text" "never" "--source" "test")))))
        (is (= 3 @calls))
        (is (= before (slurp (str path))))))))
(defn- leftovers [dir]
  (map str (fs/glob dir ".todo-*" {:hidden true})))
(deftest compare-and-swap-keeps-writers-between-compare-and-replace
  (let [dir (str (fs/create-temp-dir))
        path (fs/path dir "BOXP-15.md")
        original task-board-todos/exchange-files
        ;; Each write lands after the pre-check and before the first swap.
        racing (fn [write]
                 (let [calls (atom 0)]
                   (fn [a b]
                     (when (= 1 (swap! calls inc)) (write))
                     (original a b))))]
    (testing "no writer: replaced, mode kept, no temp left"
      (spit (str path) "base")
      (fs/set-posix-file-permissions path "rw-rw-r--")
      (is (true? (task-board-todos/write-if-unchanged path "base" "mine")))
      (is (= "mine" (slurp (str path))))
      (is (= "rw-rw-r--" (fs/posix->str (fs/posix-file-permissions path))))
      (is (empty? (leftovers dir))))
    (testing "in-place write (ob sync) just before the swap survives"
      (spit (str path) "base")
      (with-redefs [task-board-todos/exchange-files (racing #(spit (str path) "synced"))]
        (is (false? (task-board-todos/write-if-unchanged path "base" "mine"))))
      (is (= "synced" (slurp (str path))))
      (is (empty? (leftovers dir))))
    (testing "rename-based write just before the swap survives"
      (spit (str path) "base")
      (with-redefs [task-board-todos/exchange-files
                    (racing #(task-board-todos/atomic-write path "renamed"))]
        (is (false? (task-board-todos/write-if-unchanged path "base" "mine"))))
      (is (= "renamed" (slurp (str path))))
      (is (empty? (leftovers dir))))
    (testing "in-place writer that opened before the swap and finishes after it"
      (spit (str path) "base")
      (let [writer (atom nil)]
        (with-redefs [task-board-todos/exchange-files
                      (racing #(reset! writer (java.io.FileOutputStream. (str path))))]
          (is (false? (task-board-todos/write-if-unchanged path "base" "mine"))))
        (with-open [w @writer] (.write w (.getBytes "finished late"))))
      (is (= "finished late" (slurp (str path))))
      (is (empty? (leftovers dir))))
    (testing "a second writer during the rollback: newest stays at path, earlier is kept, it fails"
      (spit (str path) "base")
      (let [calls (atom 0)]
        (with-redefs [task-board-todos/exchange-files
                      (fn [a b]
                        (case (swap! calls inc)
                          1 (spit (str path) "first")
                          2 (spit (str path) "second")
                          nil)
                        (original a b))]
          (is (thrown-with-msg? clojure.lang.ExceptionInfo #"changed twice"
                                (task-board-todos/write-if-unchanged path "base" "mine")))))
      (is (= "second" (slurp (str path))))
      (is (= ["first"] (map slurp (leftovers dir))))
      (run! fs/delete (leftovers dir)))
    (testing "without exchange support it refuses: nothing overwritten, nothing left behind"
      (spit (str path) "base")
      (with-redefs [task-board-todos/exchange-files (fn [_ _] false)]
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"atomic exchange is unavailable"
                              (task-board-todos/write-if-unchanged path "base" "mine")))
        (is (= "base" (slurp (str path))))
        (testing "a writer arriving during the failed swap is kept"
          (with-redefs [task-board-todos/exchange-files
                        (fn [_ _] (spit (str path) "synced") false)]
            (is (thrown-with-msg? clojure.lang.ExceptionInfo #"atomic exchange is unavailable"
                                  (task-board-todos/write-if-unchanged path "base" "mine"))))
          (is (= "synced" (slurp (str path))))))
      (is (empty? (leftovers dir))))))
;; BOXP-588: Conditions (CD-NN items in `## Conditions`).
(def conditions-ticket
  (str "---\nstatus: ready\n---\n# T\n\n## Summary\n\nhello\n\n## Acceptance Criteria\n\ncheck\n\n## Conditions\n\n"
       "- CD-01【承認】design only\n  - 由来: hermes-agent reply_id=r1\n"
       "- CD-02【制約】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n"
       "- CD-03【要確認】inbox shape stays\n  - 由来: claude-fable\n"
       "- CD-04【取消】once a day\n  - 由来: hermes-agent reply_id=r0\n  - 取消理由: 置換（CD-01） replaced\n  - 取消者: hermes-agent reply_id=r1\n"
       "```\n- CD-05【制約】inside a fence\n```\n"
       "\n## Plan\n\n- CD-06【制約】not in Conditions\n\n## Notes\n\n- CD-07【制約】not in Conditions\n"))
(deftest conditions-parser
  (let [items (task-board-todos/parse-conditions conditions-ticket)]
    (is (= ["CD-01" "CD-02" "CD-03" "CD-04"] (mapv :id items)))
    (is (= [:approval :constraint :unconfirmed :cancelled] (mapv :kind items)))
    (is (= "do not touch docker/hermes-agent" (:text (second items))))
    (is (= ["hermes-agent" "claude-fable@BOXP-546" "claude-fable" "hermes-agent"] (mapv task-board-todos/condition-source items)))
    (is (= [true false false true] (mapv task-board-todos/owner-derived? items))))
  (testing "a line the parser cannot read, an empty text and a repeated id are never usable conditions"
    (is (= [:invalid :invalid :invalid :invalid :constraint]
           (mapv :kind (task-board-todos/parse-conditions
                        "## Conditions\n- CD-01【変】a\n- CD-02【制約】\n- CD-03【制約】b\n- CD-03【制約】c\n- CD-04【制約】d\n"))))
    (is (= [:invalid] (mapv :kind (task-board-todos/parse-conditions "## Conditions\n- [ ] CD-01 free text\n"))))))
(deftest conditions-revision
  (testing "a ticket without condition items keeps the revision it had before Conditions existed"
    (is (= "2ac264fb5589" (:rev (task-board-todos/ticket-view sample))))
    (is (= "b8b96fd0ccf7" (:rev (task-board-todos/ticket-view (str/replace sample "todo_contract: v1" "status: ready")))))
    (is (= "2ac264fb5589" (:rev (task-board-todos/ticket-view (str/replace sample "## Plan" "## Conditions\n\nnothing registered yet\n## Plan"))))))
  (let [rev #(:rev (task-board-todos/ticket-view %))
        base (rev conditions-ticket)]
    (testing "every part of an item counts: kind, text, origin and cancellation"
      (doseq [[a b] [["【制約】do not touch" "【要確認】do not touch"]
                     ["docker/hermes-agent\n" "docker/hermes-agent/**\n"]
                     ["由来: claude-fable@BOXP-546" "由来: hermes-agent"]
                     ["取消者: hermes-agent" "取消者: claude-fable"]
                     ["- CD-03【要確認】inbox shape stays\n  - 由来: claude-fable\n" ""]]]
        (is (not= base (rev (str/replace conditions-ticket a b))) a)))
    (testing "Notes and items outside the section do not"
      (is (= base (rev (str conditions-ticket "- 2026-01-01 a note\n"))))
      (is (= base (rev (str/replace conditions-ticket "- CD-07【制約】not in Conditions\n" "")))))
    (testing "the difference names the items and shows their lines"
      (let [view (task-board-todos/ticket-view conditions-ticket)]
        (is (= ["CD-01" "CD-02" "CD-03" "CD-04" "_BODY"] (get-in view [:diff :added])))
        (is (str/includes? (task-board-todos/diff-text view) "- CD-02【制約】do not touch docker/hermes-agent"))))))
(deftest conditions-gate
  (let [decide (fn [text result start] (task-board-todos/gate-decision
                                        {:view (task-board-todos/ticket-view text) :start-rev start :result result}))
        v1 (str/replace conditions-ticket "status: ready" "todo_contract: v1")
        acked (fn [text] (let [view (task-board-todos/ticket-view text)]
                           (-> text
                               (task-board-todos/set-fm "todo_ack_rev" (:rev view))
                               (task-board-todos/set-fm "todo_ack_items" (str/join "," (map (fn [[k v]] (str k ":" (subs v 0 8))) (:hashes view)))))))]
    (testing "v1: a condition that was not acknowledged holds done and blocked, never continue"
      (is (= ["CD-01" "CD-02" "CD-03" "CD-04" "_BODY"] (sort (:blocking-ids (decide v1 "done" "x")))))
      (is (:hold? (decide v1 "blocked" "x")))
      (is (not (:hold? (decide v1 "continue" "x"))))
      (is (not (:hold? (decide (acked v1) "done" "x"))))
      (is (= ["CD-02"] (:blocking-ids (decide (str/replace (acked v1) "do not touch" "never touch") "done" "x")))))
    (testing "v1: an unreadable line holds even after an acknowledgement"
      (is (= ["CD-09"] (:blocking-ids (decide (acked (str/replace v1 "- CD-03【要確認】" "- CD-09【変】x\n- CD-03【要確認】")) "done" "x")))))
    (testing "legacy: a change during the run holds until it is acknowledged"
      (let [start (:rev (task-board-todos/ticket-view conditions-ticket))
            changed (str/replace conditions-ticket "do not touch" "never touch")]
        (is (not (:hold? (decide conditions-ticket "done" start))))
        (is (:hold? (decide changed "done" start)))
        (is (not (:hold? (decide (acked changed) "done" start))))))))
(deftest conditions-violations
  (let [items task-board-todos/parse-conditions
        start (items conditions-ticket)
        check (fn [text] (task-board-todos/condition-violations start (items text)))
        swap (fn [a b] (str/replace conditions-ticket a b))
        cancel (fn [id text origin by] (swap (str "- " id "【" (if (= id "CD-01") "承認" "制約") "】" text "\n  - 由来: " origin "\n")
                                             (str "- " id "【取消】" text "\n  - 由来: " origin "\n  - 取消理由: 取消 x\n  - 取消者: " by "\n")))]
    (is (= [] (check conditions-ticket)))
    (testing "what the rules allow"
      (is (= [] (check (swap "\n## Plan" "- CD-08【制約】new limit\n  - 由来: claude-fable\n\n## Plan"))))
      (is (= [] (check (swap "\n## Plan" "- CD-08【承認】deploy\n  - 由来: hermes-agent reply_id=r2\n\n## Plan"))))
      (is (= [] (check (swap "\n## Plan" "- CD-08【承認】deploy\n  - 由来: boxp event=e1\n\n## Plan"))))
      (is (= [] (check (cancel "CD-02" "do not touch docker/hermes-agent" "claude-fable@BOXP-546" "claude-fable@BOXP-546"))))
      (is (= [] (check (cancel "CD-02" "do not touch docker/hermes-agent" "claude-fable@BOXP-546" "hermes-agent reply_id=r2"))))
      (is (= [] (check (cancel "CD-01" "design only" "hermes-agent reply_id=r1" "hermes-agent reply_id=r2")))))
    (testing "an item is never deleted or rewritten"
      (is (= ["CD-02:removed"] (check (swap "- CD-02【制約】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n" ""))))
      (is (= ["CD-02:changed-without-cancel"] (check (swap "do not touch docker/hermes-agent" "do not touch docker"))))
      (is (= ["CD-03:changed-without-cancel"] (check (swap "【要確認】inbox" "【制約】inbox"))))
      (is (= ["CD-01:owner-item-changed"] (check (swap "design only" "design and deploy"))))
      (is (= ["CD-01:owner-item-changed"] (check (swap "reply_id=r1\n- CD-02" "reply_id=r9\n- CD-02"))))
      (is (= ["CD-04:owner-item-changed"] (check (swap "- CD-04【取消】once a day" "- CD-04【制約】once a day")))))
    (testing "a cancellation keeps the text and the origin, and is made by the registrant or the Owner path"
      (is (= ["CD-01:owner-item-changed"] (check (cancel "CD-01" "design only" "hermes-agent reply_id=r1" "claude-fable"))))
      (is (= ["CD-02:changed-without-cancel"] (check (cancel "CD-02" "do not touch docker/hermes-agent" "claude-fable@BOXP-546" "claude-fable"))))
      (is (= ["CD-02:changed-without-cancel"]
             (check (swap "- CD-02【制約】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n"
                          "- CD-02【取消】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n"))))
      (is (= ["CD-02:changed-without-cancel"]
             (check (swap "- CD-02【制約】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n"
                          "- CD-02【取消】do not touch docker/hermes-agent\n  - 取消者: hermes-agent\n"))))
      (testing "and carries its reason"
        (is (= ["CD-02:changed-without-cancel"]
               (check (swap "- CD-02【制約】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n"
                            "- CD-02【取消】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n  - 取消者: hermes-agent reply_id=r2\n"))))
        (is (= ["CD-02:changed-without-cancel"]
               (check (swap "- CD-02【制約】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n"
                            "- CD-02【取消】do not touch docker/hermes-agent\n  - 由来: claude-fable@BOXP-546\n  - 取消理由:\n  - 取消者: hermes-agent reply_id=r2\n"))))))
    (testing "an approval is registered by the Owner path with the reply it came from"
      (is (= ["CD-08:approval-without-owner-reply"] (check (swap "\n## Plan" "- CD-08【承認】deploy\n  - 由来: claude-fable reply_id=r2\n\n## Plan"))))
      (is (= ["CD-08:approval-without-owner-reply"] (check (swap "\n## Plan" "- CD-08【承認】deploy\n  - 由来: hermes-agent\n\n## Plan"))))
      (is (= ["CD-08:approval-without-owner-reply"] (check (swap "\n## Plan" "- CD-08【承認】deploy\n\n## Plan"))))
      (is (= ["CD-02:approval-without-owner-reply" "CD-02:changed-without-cancel"] (check (swap "- CD-02【制約】" "- CD-02【承認】")))))
    (testing "an unreadable line is reported once, when it appears"
      (let [broken (swap "- CD-03【要確認】" "- CD-03【変】")]
        (is (= ["CD-03:invalid"] (check broken)))
        (is (= [] (task-board-todos/condition-violations (items broken) (items broken))))))
    (testing "the gate holds done and blocked on a violation in both modes, and skips runs that recorded no start"
      (let [deleted (swap "- CD-01【承認】design only\n  - 由来: hermes-agent reply_id=r1\n" "")
            decide (fn [text result start-conditions]
                     (task-board-todos/gate-decision {:view (task-board-todos/ticket-view text)
                                                      :start-rev (:rev (task-board-todos/ticket-view text))
                                                      :start-conditions start-conditions :result result}))
            stored (mapv #(select-keys % [:id :kind :text :children]) start)]
        (is (= ["CD-01:removed"] (:blocking-ids (decide deleted "done" stored))))
        (is (:hold? (decide deleted "blocked" stored)))
        (is (not (:hold? (decide deleted "continue" stored))))
        (is (not (:hold? (decide deleted "done" nil))))
        (is (not (:hold? (decide conditions-ticket "done" stored))))
        (is (some #{"CD-01:removed"} (:blocking-ids (decide (str/replace deleted "status: ready" "todo_contract: v1") "done" stored))))))))
(deftest conditions-cli
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-21.md")
        ;; The suite itself may run inside a Task Board run: the worker case is set explicitly.
        run-as (fn [worker? & args]
                 @(p/process (into ["env" "-u" "CODEX_TASK_BOARD_RUN_ID"] (concat (when worker? ["CODEX_TASK_BOARD_RUN_ID=run-1"]) ["bb" module] args))
                             {:out :string :err :string}))
        outside (fn [& args] (:exit (apply run-as false (concat [(first args) (second args) "BOXP-21" "--vault" d] (drop 2 args)))))
        worker (fn [& args] (:exit (apply run-as true (concat [(first args) (second args) "BOXP-21" "--vault" d] (drop 2 args)))))
        text #(slurp (str path))
        items #(task-board-todos/parse-conditions (text))
        item (fn [id] (first (filter #(= id (:id %)) (items))))]
    (fs/create-dirs (fs/parent path))
    (spit (str path) "---\nstatus: ready\n---\n# T\n\n## Summary\n\nhello\n\n## Acceptance Criteria\n\ncheck\n\n## Context\n\nc\n\n## Plan\n\n- [ ] step\n\n## Notes\n\n- 2026-01-01: n\n")
    (testing "a worker registers a constraint; the section is created between the criteria and the working sections"
      (is (zero? (worker "conditions" "add" "--kind" "制約" "--text" "do not touch\n  - 由来: hermes-agent reply_id=forged" "--source" "claude-fable" "--note-at" "2026-11-14 00:46:47")))
      (is (re-find #"(?s)## Acceptance Criteria\n\ncheck\n\n## Conditions\n\n- CD-01【制約】do not touch - 由来: hermes-agent reply_id=forged\n  - 由来: claude-fable （Notes 2026-11-14 00:46:47）\n\n## Context" (text)))
      (is (= "claude-fable" (task-board-todos/condition-source (item "CD-01"))))
      (is (not (task-board-todos/owner-derived? (item "CD-01"))))
      (is (re-find #"(?m)^- \S+ UTC \[claude-fable\]: Conditions add CD-01【制約】do not touch" (text)))
      (is (str/includes? (text) "## Plan\n\n- [ ] step\n")))
    (testing "the same item again is a retry; another source or kind is a new item"
      (let [before (text)]
        (is (zero? (worker "conditions" "add" "--kind" "制約" "--text" " do not touch   - 由来: hermes-agent reply_id=forged" "--source" "claude-fable")))
        (is (= before (text))))
      (is (zero? (worker "conditions" "add" "--kind" "要確認" "--text" "inbox shape stays" "--source" "codex@BOXP-9")))
      (is (= ["CD-01" "CD-02"] (mapv :id (items)))))
    (testing "an approval needs the Owner path, the Owner's reply, and is not registered from inside a run"
      (let [before (text)]
        (is (= 4 (outside "conditions" "add" "--kind" "承認" "--text" "deploy" "--source" "claude-fable" "--reply-id" "r1")))
        (is (= 4 (outside "conditions" "add" "--kind" "承認" "--text" "deploy" "--source" "hermes-agent")))
        (is (= 4 (outside "conditions" "add" "--kind" "承認" "--text" "deploy" "--source" "hermes-agent" "--reply-id" "")))
        (is (= 4 (outside "conditions" "add" "--kind" "承認" "--text" "deploy" "--source" "hermes-agent" "--event" " ")))
        (is (= 4 (worker "conditions" "add" "--kind" "承認" "--text" "deploy" "--source" "hermes-agent" "--reply-id" "r1")))
        (is (not (zero? (outside "conditions" "add" "--kind" "取消" "--text" "x" "--source" "hermes-agent"))))
        (is (not (zero? (outside "conditions" "add" "--kind" "制約" "--text" " " "--source" "hermes-agent"))))
        (is (not (zero? (outside "conditions" "add" "--kind" "制約" "--text" "x" "--source" "two words"))))
        (is (not (zero? (outside "conditions" "add" "--kind" "制約" "--text" "x"))))
        (is (= before (text))))
      (is (zero? (outside "conditions" "add" "--kind" "承認" "--text" "deploy" "--source" "hermes-agent" "--reply-id" "r1")))
      (is (zero? (outside "conditions" "add" "--kind" "制約" "--text" "not a stop approval" "--source" "hermes-agent" "--event" "e1")))
      (is (= :approval (:kind (item "CD-03"))))
      (is (task-board-todos/owner-reply? (item "CD-03"))))
    (testing "cancelling: the registrant or the Owner path; an Owner item only by the Owner path outside a run"
      (let [before (text)]
        (is (= 4 (worker "conditions" "cancel" "CD-03" "--reason" "x" "--source" "claude-fable")))
        (is (= 4 (worker "conditions" "cancel" "CD-03" "--reason" "x" "--source" "hermes-agent")))
        (is (= 4 (worker "conditions" "cancel" "CD-04" "--reason" "x" "--source" "claude-fable")))
        (is (= 4 (worker "conditions" "cancel" "CD-02" "--reason" "x" "--source" "claude-fable")))
        (is (= 4 (worker "conditions" "cancel" "CD-01" "--reason" "x" "--reason-kind" "置換" "--source" "claude-fable")))
        (is (= 4 (worker "conditions" "cancel" "CD-01" "--reason" "x" "--reason-kind" "置換" "--replaced-by" "CD-01" "--source" "claude-fable")))
        (is (not (zero? (worker "conditions" "cancel" "CD-01" "--reason" "x" "--reason-kind" "other" "--source" "claude-fable"))))
        (is (not (zero? (worker "conditions" "cancel" "CD-01" "--source" "claude-fable"))))
        (is (not (zero? (worker "conditions" "cancel" "CD-99" "--reason" "x" "--source" "claude-fable"))))
        (is (= before (text))))
      (let [start (items)]
        (is (zero? (worker "conditions" "cancel" "CD-01" "--reason" "superseded" "--reason-kind" "置換" "--replaced-by" "CD-04" "--source" "claude-fable")))
        (is (zero? (outside "conditions" "cancel" "CD-03" "--reason" "withdrawn" "--source" "hermes-agent" "--reply-id" "r2")))
        (is (zero? (outside "conditions" "cancel" "CD-02" "--reason" "confirmed not in force" "--reason-kind" "履行済み" "--source" "boxp")))
        (is (= [:cancelled :cancelled :cancelled :constraint] (mapv :kind (items))))
        (is (= ["  - 由来: claude-fable （Notes 2026-11-14 00:46:47）" "  - 取消理由: 置換（CD-04） superseded" "  - 取消者: claude-fable"] (:children (item "CD-01"))))
        (is (= "  - 取消者: hermes-agent reply_id=r2" (last (:children (item "CD-03")))))
        (testing "what the commands write passes the check the runner applies"
          (is (= [] (task-board-todos/condition-violations start (items)))))
        (is (= 4 (worker "conditions" "cancel" "CD-01" "--reason" "again" "--source" "claude-fable")))))
    (testing "list prints the section's items; registering changes the revision and needs no TODO contract"
      (let [out (:out (run-as false "conditions" "list" "BOXP-21" "--vault" d))]
        (is (str/includes? out "- CD-04【制約】not a stop approval\n  - 由来: hermes-agent event=e1"))
        (is (= 4 (count (re-seq #"(?m)^- CD-" out)))))
      (is (nil? (get (task-board-todos/frontmatter (text)) "todo_contract")))
      (let [rev (:rev (task-board-todos/ticket-view (text)))]
        (is (zero? (worker "conditions" "add" "--kind" "制約" "--text" "one more" "--source" "claude-fable")))
        (is (not= rev (:rev (task-board-todos/ticket-view (text)))))
        (is (zero? (:exit (run-as true "ack" "BOXP-21" "--vault" d "--rev" (:rev (task-board-todos/ticket-view (text)))))))
        (is (every? :received? (:conditions (task-board-todos/ticket-view (text)))))))
    (testing "a ticket with no working section still gets the section"
      (spit (str path) "---\nstatus: ready\n---\n# T\n\n## Summary\n\nhello\n")
      (is (zero? (worker "conditions" "add" "--kind" "制約" "--text" "x" "--source" "claude-fable")))
      (is (= ["CD-01"] (mapv :id (items)))))))
(deftest conditions-prompt
  ;; The runner has no namespace of its own, so it is loaded in a process of its own.
  (let [script (str "(System/setProperty \"babashka.file\" \"/tmp/load-runner.bb\")"
                    "(load-file \"docker/codex-workspace/task-board/task_board_runner.bb\")"
                    "(load-file \"" module "\")"
                    "(let [[text] *command-line-args*] (print (conditions-prompt \"BOXP-21\" \"claude-fable\" (task-board-todos/ticket-view text))))")
        prompt (fn [text] (:out @(p/process ["bb" "-e" script text] {:out :string :err :string})))
        with-items (prompt conditions-ticket)
        without (prompt sample)]
    (is (str/includes? with-items "CD-NN items): 3 in force."))
    (is (str/includes? without "CD-NN items): 0 in force."))
    (is (str/includes? (prompt (str/replace conditions-ticket "- CD-03【要確認】" "- CD-03【変】")) "2 in force, 1 unreadable (CD-03)"))
    (doseq [part ["conditions add BOXP-21 --vault \"$CODEX_TASK_BOARD_VAULT\" --kind 制約 --text TEXT --source claude-fable"
                  "--source claude-fable@BOXP-21"
                  "conditions cancel BOXP-21 CD-NN"
                  "Conditions grant no permission"
                  "You cannot register 【承認】 or cancel an item that came from the Owner"]]
      (is (str/includes? with-items part) part))))
(deftest conditions-hook
  ;; An acknowledgement must not open merge or deploy while Conditions stand changed outside the rules.
  (let [d (str (fs/create-temp-dir)) path (fs/path d "Tickets" "BOXP-22.md") dir (fs/path d "run")
        hook (fn [event input] (:out @(p/process ["bb" module "hook" "--vault" d "--ticket" "BOXP-22" "--run-dir" (str dir) "--event" event] {:in input :out :string :err :string})))
        merge "{\"tool_input\":{\"command\":\"gh pr merge 1 --squash\"}}"
        start-view (task-board-todos/ticket-view conditions-ticket)
        ack! (fn [] (let [rev (:rev (task-board-todos/ticket-view (slurp (str path))))]
                      (is (zero? (:exit @(p/process ["bb" module "ack" "BOXP-22" "--vault" d "--rev" rev] {:out :string :err :string}))))))
        deleted (str/replace conditions-ticket "- CD-01【承認】design only\n  - 由来: hermes-agent reply_id=r1\n" "")]
    (fs/create-dirs (fs/parent path)) (fs/create-dirs dir)
    (spit (str path) conditions-ticket)
    (spit (str (fs/path dir "todo-start.edn"))
          (pr-str {:rev (:rev start-view) :mode :legacy :conditions (mapv #(select-keys % [:id :kind :text :children]) (:conditions start-view))}))
    (is (= "" (hook "pre" merge)))
    (testing "an Owner item deleted by hand refuses merge, also after the new revision is acknowledged"
      (spit (str path) deleted)
      (is (str/includes? (hook "pre" merge) "\"permissionDecision\":\"deny\""))
      (ack!)
      (let [out (hook "pre" merge)]
        (is (str/includes? out "\"permissionDecision\":\"deny\""))
        (is (str/includes? out "Conditions changed outside the rules during this run: CD-01:removed")))
      (is (= "" (hook "pre" "{\"tool_input\":{\"command\":\"git status\"}}")))
      (is (str/includes? (hook "stop" "{}") "\"decision\":\"block\"")))
    (testing "putting the item back opens it again"
      (spit (str path) (str/replace (slurp (str path)) "- CD-02【制約】" "- CD-01【承認】design only\n  - 由来: hermes-agent reply_id=r1\n- CD-02【制約】"))
      (ack!)
      (is (= "" (hook "pre" merge))))
    (testing "a run that recorded no Conditions at its start is not compared"
      (spit (str path) deleted)
      (ack!)
      (spit (str (fs/path dir "todo-start.edn")) (pr-str {:rev (:rev start-view) :mode :legacy}))
      (is (= "" (hook "pre" merge))))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
