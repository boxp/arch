#!/usr/bin/env bb
(ns vault-writer-test
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing run-tests]]))

(def root (-> (io/file *file*) .getParentFile .getParentFile .getParent))
(load-file (str root "/docker/codex-workspace/task-board/autonomy_control.bb"))
;; The libraries are .bb scripts loaded explicitly, not classpath libraries.
(in-ns 'vault-writer-test)
(alias 'control 'autonomy-control)
(alias 'writer 'vault-writer)

(def runner-script (str root "/docker/codex-workspace/task-board/task_board_runner.bb"))
(def helper-script (str root "/docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb"))
(def worker-script (str root "/tests/codex-workspace/fixtures/autonomy/vault-writer-worker.bb"))

(def tickets ["BOXP-901" "BOXP-902" "BOXP-903" "BOXP-904"])

(defn card [ticket lane]
  (str "- [ ] [[Tickets/" ticket "|" ticket ": Synthetic " ticket "]] #ticket status::"
       (writer/lane->status lane) " priority::medium assignee::boxp"))

(defn ticket-content [ticket]
  (str "---\nid: " ticket "\ntype: task\nstatus: ready\npriority: medium\nassignee: boxp\n"
       "control_revision: 3\ntags:\n  - ticket\n---\n\n# " ticket ": Synthetic " ticket
       "\n\n## Summary\n\nSynthetic fixture.\n\n## Notes\n\n- seed\n"))

(defn board-content []
  (str "---\n\nkanban-plugin: board\n\n---\n\n## Backlog\n\n## Ready\n\n"
       (str/join "\n" (map #(card % "Ready") tickets))
       "\n\n\n## In Progress\n\n## Blocked\n\n## Review\n\n## Done\n\n\n"))

(defn new-vault []
  (let [dir (fs/create-temp-dir {:prefix "vault-writer-"})
        vault (fs/path dir "vault")]
    (fs/create-dirs (fs/path vault "Boards"))
    (fs/create-dirs (fs/path vault "Tickets"))
    (spit (str (fs/path vault "Boards" "Task Board.md")) (board-content))
    (doseq [ticket tickets]
      (spit (str (fs/path vault "Tickets" (str ticket ".md"))) (ticket-content ticket)))
    {:vault (str vault)
     :state-dir (str (fs/path dir "state"))
     :store-dir (str (fs/path dir "control"))}))

(defn new-writer
  ([env] (new-writer env {}))
  ([env opts]
   (writer/open-writer (merge {:vault (:vault env)
                               :state-dir (:state-dir env)
                               :generation 1
                               :verify-generation #(= 1 %)
                               :now (constantly (java.time.Instant/parse "2026-10-01T12:00:00Z"))}
                              opts))))

(defn board [env] (slurp (str (fs/path (:vault env) "Boards" "Task Board.md"))))
(defn ticket-file [env ticket] (str (fs/path (:vault env) "Tickets" (str ticket ".md"))))
(defn ticket [env id] (slurp (ticket-file env id)))
(defn journal [env]
  (let [path (fs/path (:state-dir env) writer/journal-file-name)]
    (if (fs/exists? path) (slurp (str path)) "")))

(defn lane-of [env id]
  (loop [lines (str/split-lines (board env)) lane nil]
    (when-let [line (first lines)]
      (cond
        (str/starts-with? line "## ") (recur (rest lines) (subs line 3))
        (str/includes? line (str "[[Tickets/" id "|")) lane
        :else (recur (rest lines) lane)))))

(defn occurrences [text needle]
  (count (re-seq (re-pattern (java.util.regex.Pattern/quote needle)) text)))

(defn vault-snapshot
  "Every file under the vault with its content, to prove nothing was written."
  [env]
  (into (sorted-map)
        (map (fn [path] [(str (fs/relativize (:vault env) path)) (slurp (str path))])
             (filter fs/regular-file? (fs/glob (:vault env) "**")))))

(defn category [result] (get-in result [:diagnostic :category]))
(defn ok? [result] (true? (:ok? result)))
(defn rejected? [expected result]
  (and (false? (:ok? result))
       (= expected (category result))
       (= #{:ok? :diagnostic} (set (keys result)))))

(defn pending [w] (:pending (writer/pending-transitions w)))

(defn crash-at
  "A writer whose transition dies at step, leaving files as a killed process would."
  [env step]
  (new-writer env {:failpoint #(when (= step %) (throw (Error. "simulated kill")))}))

(defn crashed-transition! [env step request]
  (try
    (writer/transition! (crash-at env step) request)
    (catch Error _ :killed)))

(def to-review {:ticket "BOXP-904" :from-lane "Ready" :to-lane "Review"
                :frontmatter {"assignee" "boxp"} :note "- moved to review"
                :expected-revision 3})

(deftest atomic-write-replaces-content-without-leftovers
  (let [dir (fs/create-temp-dir {:prefix "vault-writer-atomic-"})
        path (fs/path dir "file.md")]
    (spit (str path) "old\n")
    (fs/set-posix-file-permissions path "rw-r-----")
    (writer/atomic-write! path "new ✓\n")
    (is (= "new ✓\n" (slurp (str path))))
    (is (= "rw-r-----" (fs/posix->str (fs/posix-file-permissions path))))
    (is (= ["file.md"] (map fs/file-name (fs/list-dir dir))) "no temp file is left behind")))

(deftest vault-lock-serializes-threads-and-is-reentrant
  (let [env (new-vault)
        counter (fs/path (:state-dir env) "counter")
        bump #(writer/with-vault-lock
                (:state-dir env)
                (fn []
                  (let [n (if (fs/exists? counter) (parse-long (slurp (str counter))) 0)]
                    (Thread/sleep 1)
                    (spit (str counter) (str (inc n))))))]
    (run! deref (mapv (fn [_] (future (dotimes [_ 10] (bump)))) (range 6)))
    (is (= "60" (slurp (str counter))))
    (is (= :inner (writer/with-vault-lock
                    (:state-dir env)
                    #(writer/with-vault-lock (:state-dir env) (fn [] :inner)))))))

(deftest transition-moves-card-and-projects-ticket
  (let [env (new-vault)
        w (new-writer env)
        result (writer/transition! w to-review)]
    (is (ok? result))
    (is (string? (:transition-id result)))
    (is (= "Review" (lane-of env "BOXP-904")))
    (is (str/includes? (board env) "## Review\n\n- [ ] [[Tickets/BOXP-904|"))
    (is (str/includes? (board env) "status::review priority::medium"))
    (is (str/ends-with? (board env) "## Done\n\n\n") "untouched trailing lines are preserved")
    (is (= (str/replace (board-content) (str (card "BOXP-904" "Ready") "\n") "")
           (str/replace (board env) (str (card "BOXP-904" "Review") "\n") ""))
        "every other Board line is byte-identical")
    (is (str/includes? (ticket env "BOXP-904") "\nstatus: review\n"))
    (is (str/ends-with? (ticket env "BOXP-904") "- seed\n- moved to review\n"))
    (is (= [] (pending w)))
    (is (= 2 (count (str/split-lines (journal env)))) "prepared and committed records")
    (testing "Done marks the card closed"
      (is (ok? (writer/transition! w {:ticket "BOXP-904" :from-lane "Review" :to-lane "Done"})))
      (is (str/includes? (board env) "- [x] [[Tickets/BOXP-904|"))
      (is (str/includes? (board env) "status::done priority::medium assignee::boxp done::2026-10-01")))))

(deftest notes-are-appended-inside-the-notes-section
  (let [env (new-vault)
        w (new-writer env)
        head "---\nid: BOXP-904\nstatus: ready\n---\n\n# BOXP-904: Synthetic\n"
        append! (fn [content]
                  (spit (ticket-file env "BOXP-904") content)
                  (is (ok? (writer/update-ticket! w {:ticket "BOXP-904" :note "- added"})))
                  (is (ok? (writer/update-ticket! w {:ticket "BOXP-904" :note "- added"}))
                      "the same line is appended once")
                  (ticket env "BOXP-904"))]
    (is (= (str head "\n## Notes\n\n- seed\n- added\n\n## Later\n\ntext\n")
           (append! (str head "\n## Notes\n\n- seed\n\n## Later\n\ntext\n"))))
    (is (= (str head "\n## Notes\n\n- added\n\n## Later\n")
           (append! (str head "\n## Notes\n\n## Later\n"))))
    (is (= (str head "\n## Notes\n\n- added\n") (append! (str head "\n## Notes\n"))))
    (is (= (str head "\n## Notes\n\n- added\n") (append! (str head "\n## Notes"))))
    (is (= (str head "\n## Notes\n\n- added\n") (append! head)))
    (testing "frontmatter updates replace existing keys and add new ones inside the block"
      (is (ok? (writer/update-ticket! w {:ticket "BOXP-904"
                                         :frontmatter {"status" "review" "execution_intent" "pause"}})))
      (is (str/starts-with? (ticket env "BOXP-904")
                            "---\nid: BOXP-904\nstatus: review\nexecution_intent: pause\n---\n")))
    (testing "a ticket without frontmatter is not rewritten"
      (spit (ticket-file env "BOXP-904") "# BOXP-904: Synthetic\n")
      (is (rejected? :invalid-vault-state
                     (writer/update-ticket! w {:ticket "BOXP-904" :frontmatter {"status" "x"}})))
      (is (= "# BOXP-904: Synthetic\n" (ticket env "BOXP-904"))))))

(deftest stale-expectations-and-bad-requests-write-nothing
  (let [env (new-vault)
        w (new-writer env)
        before (vault-snapshot env)]
    (is (rejected? :conflict (writer/transition! w (assoc to-review :from-lane "Blocked"))))
    (is (rejected? :conflict (writer/transition! w (assoc to-review :expected-revision 2))))
    (is (rejected? :conflict (writer/update-ticket! w {:ticket "BOXP-904" :note "- stale"
                                                       :expected-revision 4})))
    (doseq [request [(assoc to-review :ticket "../BOXP-904")
                     (assoc to-review :ticket "boxp-904")
                     (assoc to-review :to-lane "Ready")
                     (assoc to-review :to-lane "Archive")
                     (assoc to-review :note "- two\n- lines")
                     (assoc to-review :frontmatter {"status" "done"})
                     (assoc to-review :frontmatter {"bad key" "x"})
                     (assoc to-review :frontmatter {"assignee" "boxp\nstatus: done"})
                     (assoc to-review :expected-revision "3")
                     (assoc to-review :guard :not-a-fn)]]
      (is (rejected? :invalid-request (writer/transition! w request))))
    (is (rejected? :invalid-request (writer/update-ticket! w {:ticket "BOXP-904"})))
    (is (= before (vault-snapshot env)))
    (is (= "" (journal env)))))

(deftest broken-vault-state-is-reported-not-repaired
  (let [env (new-vault)
        w (new-writer env)]
    (testing "duplicate card"
      (spit (str (fs/path (:vault env) "Boards" "Task Board.md"))
            (str/replace (board env) "## Blocked\n" (str "## Blocked\n\n" (card "BOXP-904" "Blocked") "\n")))
      (let [before (vault-snapshot env)]
        (is (rejected? :invalid-vault-state (writer/transition! w to-review)))
        (is (= before (vault-snapshot env)))))
    (testing "missing ticket file and missing card"
      (fs/delete (ticket-file env "BOXP-903"))
      (is (rejected? :invalid-vault-state
                     (writer/transition! w {:ticket "BOXP-903" :from-lane "Ready"
                                            :to-lane "Review"})))
      (is (rejected? :invalid-vault-state
                     (writer/transition! w {:ticket "BOXP-999" :from-lane "Ready"
                                            :to-lane "Review"})))
      (is (not (fs/exists? (ticket-file env "BOXP-903"))))
      (is (= "Ready" (lane-of env "BOXP-903"))))
    (is (= "" (journal env)))))

(deftest stale-generation-and-lost-lease-cannot-write
  (let [env (new-vault)
        before (vault-snapshot env)]
    (testing "a writer of another generation, or without a verifier, writes nothing"
      (doseq [w [(new-writer env {:generation 2})
                 (new-writer env {:verify-generation nil})
                 (new-writer env {:verify-generation (constantly "yes")})]]
        (is (rejected? :stale-generation (writer/transition! w to-review)))
        (is (rejected? :stale-generation (writer/update-ticket! w {:ticket "BOXP-904" :note "- x"})))
        (is (rejected? :stale-generation (writer/recover! w)))
        (is (rejected? :stale-generation
                       (writer/write-state! w (fs/path (:state-dir env) "state.edn") identity)))))
    (testing "an unreachable control original fails closed"
      (is (rejected? :unavailable
                     (writer/transition!
                      (new-writer env {:verify-generation
                                       (fn [_] (throw (Exception. "SYNTHETIC_SECRET")))})
                      to-review))))
    (testing "a worker whose lease was taken over cannot project its result"
      (let [lease (atom {:run-id "run-old"})
            guard #(= "run-old" (:run-id @lease))]
        (reset! lease {:run-id "run-new"})
        (is (rejected? :lease-lost
                       (writer/transition! (new-writer env) (assoc to-review :guard guard))))))
    (is (= before (vault-snapshot env)))
    (is (= "" (journal env)))))

(deftest generation-change-during-a-transition
  (testing "before the Board write the entry is closed and nothing is written"
    (let [env (new-vault)
          current (atom 1)
          w (new-writer env {:verify-generation #(= @current %)
                             :failpoint #(when (= :after-prepare %) (reset! current 2))})
          before (vault-snapshot env)]
      (is (rejected? :stale-generation (writer/transition! w to-review)))
      (is (= before (vault-snapshot env)))
      (is (= [] (pending (new-writer env {:generation 2 :verify-generation #(= 2 %)}))))))
  (testing "after the Board write the old writer stops and the new generation recovers"
    (let [env (new-vault)
          current (atom 1)
          verify #(= @current %)
          old (new-writer env {:verify-generation verify
                               :failpoint #(when (= :after-board %) (reset! current 2))})
          new (new-writer env {:generation 2 :verify-generation verify})]
      (is (rejected? :stale-generation (writer/transition! old to-review)))
      (is (= "Review" (lane-of env "BOXP-904")))
      (is (str/includes? (ticket env "BOXP-904") "\nstatus: ready\n")
          "the fenced writer did not write the ticket")
      (is (rejected? :stale-generation (writer/recover! old)))
      (is (= [{:ticket "BOXP-904" :outcome :recovered}]
             (mapv #(dissoc % :id) (:outcomes (writer/recover! new)))))
      (is (str/includes? (ticket env "BOXP-904") "\nstatus: review\n")))))

(deftest recovery-after-a-kill-between-each-write
  (testing "killed after the journal entry: nothing was applied, so it is aborted"
    (let [env (new-vault)
          before (vault-snapshot env)
          w (new-writer env)]
      (is (= :killed (crashed-transition! env :after-prepare to-review)))
      (is (= before (vault-snapshot env)))
      (is (= 1 (count (pending w))))
      (is (rejected? :unresolved-journal (writer/transition! w to-review)))
      (is (rejected? :unresolved-journal
                     (writer/update-ticket! w {:ticket "BOXP-904" :note "- blocked"})))
      (is (ok? (writer/update-ticket! w {:ticket "BOXP-903" :note "- other tickets continue"})))
      (is (= [:aborted] (mapv :outcome (:outcomes (writer/recover! w)))))
      (is (= "Ready" (lane-of env "BOXP-904")))
      (is (= [] (pending w)))
      (is (ok? (writer/transition! w to-review)) "the transition can be decided again")))
  (testing "killed after the Board write: the ticket projection is completed"
    (let [env (new-vault)
          w (new-writer env)]
      (is (= :killed (crashed-transition! env :after-board to-review)))
      (is (= "Review" (lane-of env "BOXP-904")))
      (is (str/includes? (ticket env "BOXP-904") "\nstatus: ready\n"))
      (testing "a note appended meanwhile by another writer survives recovery"
        (spit (ticket-file env "BOXP-904") (str (ticket env "BOXP-904") "- concurrent note\n")))
      (is (= [:recovered] (mapv :outcome (:outcomes (writer/recover! w)))))
      (is (str/includes? (ticket env "BOXP-904") "\nstatus: review\n"))
      (is (str/ends-with? (ticket env "BOXP-904")
                          "- seed\n- concurrent note\n- moved to review\n"))
      (is (= [] (:outcomes (writer/recover! w))) "recovery is not repeated")))
  (testing "killed after the ticket write: recovery does not duplicate the note"
    (let [env (new-vault)
          w (new-writer env)]
      (is (= :killed (crashed-transition! env :after-ticket to-review)))
      (is (= 1 (count (pending w))))
      (is (= [:recovered] (mapv :outcome (:outcomes (writer/recover! w)))))
      (is (= 1 (occurrences (ticket env "BOXP-904") "- moved to review")))
      (is (= [] (pending w))))))

(deftest recovery-never-replays-over-a-newer-change
  (testing "the owner moved the card after the crash"
    (let [env (new-vault)
          w (new-writer env)]
      (is (= :killed (crashed-transition! env :after-board to-review)))
      (spit (str (fs/path (:vault env) "Boards" "Task Board.md"))
            (-> (board env)
                (str/replace (str (card "BOXP-904" "Review") "\n") "")
                (str/replace "## Blocked\n" (str "## Blocked\n\n" (card "BOXP-904" "Blocked") "\n"))))
      (let [before (vault-snapshot env)]
        (is (= [:superseded] (mapv :outcome (:outcomes (writer/recover! w)))))
        (is (= before (vault-snapshot env)) "the current lane wins and nothing is replayed")
        (is (= [] (pending w))))))
  (testing "the control revision projection changed after the crash"
    (let [env (new-vault)
          w (new-writer env)]
      (is (= :killed (crashed-transition! env :after-board to-review)))
      (spit (ticket-file env "BOXP-904")
            (str/replace (ticket env "BOXP-904") "control_revision: 3" "control_revision: 4"))
      (let [before (vault-snapshot env)]
        (is (= [:superseded] (mapv :outcome (:outcomes (writer/recover! w)))))
        (is (= before (vault-snapshot env))))))
  (testing "a broken vault stays pending for a human"
    (let [env (new-vault)
          w (new-writer env)]
      (is (= :killed (crashed-transition! env :after-board to-review)))
      (spit (str (fs/path (:vault env) "Boards" "Task Board.md"))
            (str/replace (board env) "## Blocked\n" (str "## Blocked\n\n" (card "BOXP-904" "Blocked") "\n")))
      (let [before (vault-snapshot env)]
        (is (= [:unresolved] (mapv :outcome (:outcomes (writer/recover! w)))))
        (is (= before (vault-snapshot env)))
        (is (= 1 (count (pending w))))))))

(deftest journal-damage-handling
  (let [journal-path #(str (fs/path (:state-dir %) writer/journal-file-name))]
    (testing "an interrupted append is dropped and truncated before the next record"
      (let [env (new-vault)
            w (new-writer env)]
        (is (ok? (writer/transition! w {:ticket "BOXP-902" :from-lane "Ready" :to-lane "Review"})))
        (spit (journal-path env) "0123abcd {:id \"torn\" :phase :prep" :append true)
        (is (= [] (pending w)))
        (is (ok? (writer/transition! w to-review)))
        (is (not (str/includes? (journal env) "torn")))
        (is (= 4 (count (str/split-lines (journal env)))))
        (is (= [] (pending w)))))
    (testing "damage before the tail, or an unknown version, stops every write"
      (doseq [damage [#(str "garbage line\n" %)
                      #(str/replace % ":journal-version 1" ":journal-version 2")]]
        (let [env (new-vault)
              w (new-writer env)]
          (is (ok? (writer/transition! w {:ticket "BOXP-902" :from-lane "Ready" :to-lane "Review"})))
          (spit (journal-path env) (damage (journal env)))
          (let [before (vault-snapshot env)
                damaged (journal env)]
            (is (rejected? :journal-corrupt (writer/transition! w to-review)))
            (is (rejected? :journal-corrupt (writer/update-ticket! w {:ticket "BOXP-904" :note "- x"})))
            (is (rejected? :journal-corrupt (writer/recover! w)))
            (is (rejected? :journal-corrupt (writer/pending-transitions w)))
            (is (= before (vault-snapshot env)))
            (is (= damaged (journal env)))))))))

(deftest state-swaps-are-serializable
  (let [env (new-vault)
        w (new-writer env)
        path (fs/path (:state-dir env) "state.edn")]
    (run! deref (mapv (fn [_] (future (dotimes [_ 10]
                                        (writer/write-state! w path #(update (or % {}) :n (fnil inc 0))))))
                      (range 6)))
    (is (= {:n 60} (read-string (slurp (str path)))))))

;; --- separate processes ------------------------------------------------------

(defn control-store! [env]
  (let [store (control/init-store!
               (control/open-store
                {:dir (:store-dir env)
                 :principals {"synthetic-owner-credential" {:subject "synthetic-owner-subject"
                                                            :role :owner}
                              "synthetic-runner-credential" {:subject "synthetic-runner-subject"
                                                             :role :runner}}}))]
    (assert (ok? (control/request! store "synthetic-owner-credential"
                                   {:op :issue-writer-generation :expected-generation 0})))
    store))

(defn worker [env & args]
  (p/process {:out :string :err :string}
             (str/join " " (map #(str "'" % "'")
                                (concat ["bb" worker-script (first args) (:vault env)
                                         (:state-dir env) (:store-dir env)]
                                        (rest args))))))

(defn shell-loop
  "Run command n times in one child shell with the shared lock opted in."
  [env n command]
  (p/process {:out :string :err :string
              :extra-env {"TASK_BOARD_VAULT_WRITER_LOCK_DIR" (:state-dir env)
                          "CODEX_TASK_BOARD_VAULT" (:vault env)
                          "CODEX_TASK_BOARD_ROOT" (str (fs/path (:state-dir env) "runner-root"))}}
             "bash" "-c" (str "set -e; for i in $(seq 1 " n "); do " command "; done")))

(deftest concurrent-processes-and-helper-lose-no-update
  (let [env (new-vault)
        _ (control-store! env)
        n 15
        procs [(worker env "notes" "alpha" "BOXP-901" n)
               (worker env "notes" "beta" "BOXP-901" n)
               (worker env "moves" "gamma" "BOXP-902" n)
               (worker env "moves" "delta" "BOXP-903" n)
               (shell-loop env n (str "bb '" helper-script "' append-note BOXP-901 --vault '"
                                      (:vault env) "' --source helper --note \"helper-note-$i\" >/dev/null"))
               (shell-loop env n (str "bb '" helper-script "' update BOXP-904 --vault '"
                                      (:vault env) "' --priority high >/dev/null"))
               (shell-loop env n (str "bb '" runner-script "' sync >/dev/null"))]
        results (mapv deref procs)]
    (doseq [result results]
      (is (zero? (:exit result)) (:err result)))
    (is (zero? (:exit @(shell-loop env 1 (str "bb '" runner-script "' sync >/dev/null")))))
    (let [shared (ticket env "BOXP-901")]
      (doseq [i (range 1 (inc n))]
        (is (= 1 (occurrences shared (str "- note alpha " i "\n"))))
        (is (= 1 (occurrences shared (str "- note beta " i "\n"))))
        (is (= 1 (occurrences shared (str "helper-note-" i "\n")))))
      (is (str/includes? shared (str "\nalpha_counter: " n "\n")))
      (is (str/includes? shared (str "\nbeta_counter: " n "\n")))
      (is (str/includes? shared "- seed\n")))
    (doseq [[id name] [["BOXP-902" "gamma"] ["BOXP-903" "delta"]]]
      (is (= "In Progress" (lane-of env id)))
      (is (str/includes? (ticket env id) "\nstatus: in-progress\n"))
      (doseq [i (range 1 (inc n))]
        (is (= 1 (occurrences (ticket env id) (str "- move " name " " i "\n"))))))
    (is (str/includes? (ticket env "BOXP-904") "\npriority: high\n"))
    (doseq [id tickets]
      (is (= 1 (occurrences (board env) (str "[[Tickets/" id "|"))) "exactly one card per ticket"))
    (is (= [] (pending (new-writer env))))
    (is (= (* 2 2 n) (count (str/split-lines (journal env)))))))

(deftest killed-process-is-recovered-by-the-next-writer
  (doseq [[step lane-after-kill] [["after-prepare" "Ready"]
                                  ["after-board" "Review"]
                                  ["after-ticket" "Review"]]]
    (let [env (new-vault)
          _ (control-store! env)
          result @(worker env "crash" "omega" "BOXP-904" 1 step)
          w (new-writer env)]
      (is (= 137 (:exit result)) step)
      (is (= lane-after-kill (lane-of env "BOXP-904")))
      (is (= 1 (count (pending w))) "the dead process released the lock and left one entry")
      (is (= [(if (= "Ready" lane-after-kill) :aborted :recovered)]
             (mapv :outcome (:outcomes (writer/recover! w)))))
      (when (= "Review" lane-after-kill)
        (is (str/includes? (ticket env "BOXP-904") "\nstatus: review\n"))
        (is (= 1 (occurrences (ticket env "BOXP-904") "- crash omega\n"))))
      (is (= [] (pending w))))))

(deftest old-generation-process-cannot-write
  (let [env (new-vault)
        store (control-store! env)
        before (vault-snapshot env)]
    (is (ok? (control/request! store "synthetic-owner-credential"
                               {:op :issue-writer-generation :expected-generation 1})))
    (let [result @(worker env "crash" "old" "BOXP-904" 1)]
      (is (= 1 (:exit result)))
      (is (str/includes? (:err result) ":stale-generation")))
    (testing "an unavailable control original also stops the writer"
      (fs/delete-tree (:store-dir env))
      (is (= 1 (:exit @(worker env "crash" "old" "BOXP-904" 1)))))
    (is (= before (vault-snapshot env)))
    (is (= "" (journal env)))))

;; --- helper dry-run ----------------------------------------------------------

(defn helper [env & args]
  @(p/process {:out :string :err :string}
              (str/join " " (map #(str "'" % "'")
                                 (concat ["bb" helper-script] args ["--vault" (:vault env)])))))

(deftest helper-control-commands-are-dry-run-only
  (let [env (new-vault)
        before (vault-snapshot env)]
    (testing "previews name the request and the required actor without writing"
      (doseq [[args expected]
              [[["control-intent" "BOXP-901" "--intent" "pause" "--expected-revision" "3" "--dry-run"]
                [":op \"set-intent\"" ":intent \"pause\"" ":requires-actor \"runner-or-owner\""]]
               [["control-intent" "BOXP-901" "--intent" "run" "--expected-revision" "3" "--dry-run"]
                [":requires-actor \"owner\""]]
               [["control-decision" "BOXP-901" "--decision-id" "BOXP-901/D1" "--option-id" "new-only"
                 "--expected-revision" "3" "--dry-run"]
                [":op \"answer-decision\"" ":option-id \"new-only\"" ":requires-actor \"owner\""]]
               [["control-retry" "BOXP-901" "--retry-op" "cancel" "--expected-revision" "3" "--dry-run"]
                [":op \"cancel-retry\"" ":requires-actor \"runner-or-owner\""]]
               [["control-retry" "BOXP-901" "--retry-op" "reschedule" "--expected-revision" "3" "--dry-run"]
                [":requires-actor \"owner\""]]]]
        (let [result (apply helper env args)]
          (is (zero? (:exit result)) (:err result))
          (doseq [fragment (concat expected [":dry-run true" ":writes []" ":expected-revision 3"
                                             ":lane \"Ready\"" "\"control_revision\" \"3\""])]
            (is (str/includes? (:out result) fragment) fragment)))))
    (testing "without --dry-run, or with invalid input, the helper refuses"
      (doseq [args [["control-intent" "BOXP-901" "--intent" "pause" "--expected-revision" "3"]
                    ["control-decision" "BOXP-901" "--decision-id" "D1" "--option-id" "o"
                     "--expected-revision" "3"]
                    ["control-retry" "BOXP-901" "--retry-op" "cancel" "--expected-revision" "3"]
                    ["control-intent" "BOXP-901" "--intent" "resume" "--expected-revision" "3" "--dry-run"]
                    ["control-intent" "BOXP-901" "--intent" "pause" "--dry-run"]
                    ["control-intent" "BOXP-901" "--intent" "pause" "--expected-revision" "0" "--dry-run"]
                    ["control-decision" "BOXP-901" "--decision-id" "../D1" "--option-id" "o"
                     "--expected-revision" "3" "--dry-run"]
                    ["control-retry" "BOXP-901" "--retry-op" "reset" "--expected-revision" "3" "--dry-run"]
                    ["control-intent" "BOXP-999" "--intent" "pause" "--expected-revision" "3" "--dry-run"]]]
        (let [result (apply helper env args)]
          (is (= 1 (:exit result)) (pr-str args))
          (is (= "" (:out result))))))
    (is (= before (vault-snapshot env)))
    (is (not (fs/exists? (:state-dir env))) "no lock, journal or state is created")))

(let [{:keys [fail error]} (run-tests)]
  (when (pos? (+ fail error)) (System/exit 1)))
