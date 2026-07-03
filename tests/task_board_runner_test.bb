#!/usr/bin/env bb

(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[clojure.edn :as edn]
         '[clojure.string :as str])

(def repo-root (str (fs/absolutize ".")))
(def runner (fs/path repo-root "docker/codex-workspace/task-board/task_board_runner.bb"))

(defn assert! [message pred]
  (when-not pred
    (throw (ex-info message {}))))

(defn read-lines [path]
  (str/split-lines (slurp (str path))))

(defn make-temp-root []
  (fs/create-temp-dir {:prefix "task-board-runner-test-"}))

(defn write-file! [path text]
  (fs/create-dirs (fs/parent path))
  (spit (str path) text))

(defn ticket-frontmatter [vault ticket-id]
  (let [lines (read-lines (fs/path vault "Tickets" (str ticket-id ".md")))
        fm (->> lines
                (drop 1)
                (take-while #(not= "---" %)))]
    (into {} (keep (fn [line]
                     (when-let [[_ k v] (re-matches #"([^:]+):\s*(.*)" line)]
                       [(keyword k) v]))
                   fm))))

(defn board-text [vault]
  (slurp (str (fs/path vault "Boards" "Task Board.md"))))

(defn lane-section [vault lane]
  (let [lines (read-lines (fs/path vault "Boards" "Task Board.md"))
        start (first (keep-indexed (fn [idx line]
                                     (when (= line (str "## " lane)) idx))
                                   lines))
        end (when start
              (or (first (keep-indexed (fn [idx line]
                                          (when (and (> idx start)
                                                     (str/starts-with? line "## "))
                                            idx))
                                        lines))
                  (count lines)))]
    (when start
      (str/join "\n" (subvec (vec lines) (inc start) end)))))

(defn ticket-in-lane? [vault lane ticket-id]
  (str/includes? (or (lane-section vault lane) "") ticket-id))

(defn lock-path [root ticket-id]
  (fs/path root "locks" (str ticket-id ".edn")))

(defn summary-path [root ticket-id run-id]
  (fs/path root "runs" ticket-id run-id "summary.edn"))

(defn write-board! [vault lane->ticket-ids]
  (let [lanes ["Backlog" "Ready" "In Progress" "Blocked" "Review" "Done"]
        body (str/join
              "\n\n"
              (map (fn [lane]
                     (let [status ({"Backlog" "backlog"
                                    "Ready" "ready"
                                    "In Progress" "in-progress"
                                    "Blocked" "blocked"
                                    "Review" "review"
                                    "Done" "done"} lane)]
                       (str "## " lane "\n"
                            (str/join
                             "\n"
                             (map (fn [ticket-id]
                                    (str "- [ ] [[Tickets/" ticket-id "|" ticket-id ": test]] #ticket status::" status " priority::medium"))
                                  (get lane->ticket-ids lane []))))))
                   lanes))]
    (write-file! (fs/path vault "Boards" "Task Board.md") (str body "\n"))))

(defn write-ticket! [vault ticket-id {:keys [status assignee repo]}]
  (write-file!
   (fs/path vault "Tickets" (str ticket-id ".md"))
   (str "---\n"
        "id: " ticket-id "\n"
        "status: " status "\n"
        "priority: medium\n"
        "assignee: " assignee "\n"
        "repo: " (or repo "") "\n"
        "closed: \n"
        "---\n\n"
        "# " ticket-id "\n\n"
        "## Summary\n\n"
        "Test ticket.\n\n"
        "## Acceptance Criteria\n\n"
        "- [ ] Tested.\n\n"
        "## Context\n\n"
        "Temporary vault.\n\n"
        "## Plan\n\n"
        "- [ ] Run Codex.\n\n"
        "## Notes\n")))

(defn write-fake-codex! [bin-dir sleep-ms final-message]
  (let [script (fs/path bin-dir "codex")]
    (write-file!
     script
     (str "#!/usr/bin/env bash\n"
          "set -euo pipefail\n"
          "last_message=''\n"
          "while (($#)); do\n"
          "  case \"$1\" in\n"
          "    --output-last-message) last_message=\"$2\"; shift 2 ;;\n"
          "    *) shift ;;\n"
          "  esac\n"
          "done\n"
          "prompt=\"$(cat)\"\n"
          "ticket=\"$(printf '%s' \"$prompt\" | sed -n 's/^Ticket: //p' | head -n1)\"\n"
          "date +%s%3N >> \"${FAKE_CODEX_LOG}\"\n"
          "printf 'start %s\\n' \"$ticket\" >> \"${FAKE_CODEX_LOG}\"\n"
          "sleep " (/ sleep-ms 1000.0) "\n"
          "cat > \"$last_message\" <<'EOF'\n"
          final-message "\n"
          "EOF\n"
          "printf '{\"type\":\"done\",\"ticket\":\"%s\"}\\n' \"$ticket\"\n"
          "printf 'end %s\\n' \"$ticket\" >> \"${FAKE_CODEX_LOG}\"\n"))
    (fs/set-posix-file-permissions script "rwxr-xr-x")))

(defn run-tick! [root vault bin-dir extra-env]
  (let [env (merge (into {} (System/getenv))
                   {"CODEX_TASK_BOARD_ROOT" (str root)
                    "CODEX_TASK_BOARD_VAULT" (str vault)
                    "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"
                    "PATH" (str bin-dir ":" (System/getenv "PATH"))}
                   extra-env)
        proc @(p/process ["bb" (str runner) "tick"]
                         {:env env :out :string :err :string})]
    (assert! (str "runner exited non-zero\nstdout:\n" (:out proc) "\nstderr:\n" (:err proc))
             (zero? (:exit proc)))
    proc))

(defn setup-case! [tickets lane->ticket-ids final-message sleep-ms]
  (let [root (make-temp-root)
        vault (fs/path root "vault")
        state (fs/path root "state")
        bin-dir (fs/path root "bin")
        log-path (fs/path root "fake-codex.log")]
    (fs/create-dirs bin-dir)
    (write-board! vault lane->ticket-ids)
    (doseq [[ticket-id attrs] tickets]
      (write-ticket! vault ticket-id attrs))
    (write-fake-codex! bin-dir sleep-ms final-message)
    {:root state :vault vault :bin-dir bin-dir :log-path log-path}))

(defn test-parallel-runs []
  (let [{:keys [root vault bin-dir log-path]}
        (setup-case!
         {"BOXP-101" {:status "ready" :assignee "codex"}
          "BOXP-102" {:status "ready" :assignee "codex"}}
         {"Ready" ["BOXP-101" "BOXP-102"]}
         "Finished.\nTASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review"
         1200)
        started (System/nanoTime)]
    (run-tick! root vault bin-dir {"FAKE_CODEX_LOG" (str log-path)})
    (let [elapsed-ms (/ (- (System/nanoTime) started) 1000000.0)
          log (slurp (str log-path))
          review-section (lane-section vault "Review")]
      (assert! (str "expected parallel runtime, got " elapsed-ms "ms")
               (< elapsed-ms 2300))
      (assert! "first ticket did not start" (str/includes? log "start BOXP-101"))
      (assert! "second ticket did not start" (str/includes? log "start BOXP-102"))
      (assert! "BOXP-101 was not moved to Review" (str/includes? review-section "BOXP-101"))
      (assert! "BOXP-102 was not moved to Review" (str/includes? review-section "BOXP-102"))
      (assert! "assignee was not returned to boxp"
               (= "boxp" (:assignee (ticket-frontmatter vault "BOXP-101")))))))

(defn test-active-lock-skips-only-that-ticket []
  (let [{:keys [root vault bin-dir log-path]}
        (setup-case!
         {"BOXP-201" {:status "ready" :assignee "codex"}
          "BOXP-202" {:status "ready" :assignee "codex"}}
         {"Ready" ["BOXP-201" "BOXP-202"]}
         "Finished.\nTASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review"
         100)]
    (write-file! (lock-path root "BOXP-201")
                 (str (pr-str {:ticket "BOXP-201"
                               :run-id "active-run"
                               :heartbeat-at (str (java.time.Instant/now))})
                      "\n"))
    (run-tick! root vault bin-dir {"FAKE_CODEX_LOG" (str log-path)})
    (let [log (slurp (str log-path))
          board (board-text vault)]
      (assert! "locked ticket should not start" (not (str/includes? log "start BOXP-201")))
      (assert! "unlocked ticket should start" (str/includes? log "start BOXP-202"))
      (assert! "locked ticket should remain in Ready" (ticket-in-lane? vault "Ready" "BOXP-201"))
      (assert! "unlocked ticket should move to Review" (ticket-in-lane? vault "Review" "BOXP-202")))))

(defn test-stale-lock-recovers []
  (let [{:keys [root vault bin-dir log-path]}
        (setup-case!
         {"BOXP-301" {:status "ready" :assignee "codex"}}
         {"Ready" ["BOXP-301"]}
         "Done.\nTASK_BOARD_RESULT: done"
         50)
        old-run-id "old-run"]
    (write-file! (lock-path root "BOXP-301")
                 (str (pr-str {:ticket "BOXP-301"
                               :run-id old-run-id
                               :heartbeat-at "2000-01-01T00:00:00Z"})
                      "\n"))
    (run-tick! root vault bin-dir {"FAKE_CODEX_LOG" (str log-path)
                                   "CODEX_TASK_BOARD_LOCK_STALE_SECONDS" "1"})
    (let [summary (edn/read-string (slurp (str (summary-path root "BOXP-301" old-run-id))))
          board (board-text vault)]
      (assert! "old run was not marked interrupted" (= :interrupted (:status summary)))
      (assert! "ticket did not restart after stale lock" (str/includes? (slurp (str log-path)) "start BOXP-301"))
      (assert! "ticket was not moved to Done" (ticket-in-lane? vault "Done" "BOXP-301")))))

(defn test-review-without-pr-marker_blocks []
  (let [{:keys [root vault bin-dir log-path]}
        (setup-case!
         {"BOXP-401" {:status "ready" :assignee "codex"}}
         {"Ready" ["BOXP-401"]}
         "Needs review.\nTASK_BOARD_RESULT: review"
         50)]
    (run-tick! root vault bin-dir {"FAKE_CODEX_LOG" (str log-path)})
    (let [board (board-text vault)
          ticket (slurp (str (fs/path vault "Tickets/BOXP-401.md")))]
      (assert! "ticket should be blocked when review lacks PR marker"
               (ticket-in-lane? vault "Blocked" "BOXP-401"))
      (assert! "blocked note should explain missing PR marker"
               (str/includes? ticket "Review was requested without a GitHub PR URL")))))

(defn test-lane-source-of-truth-sync []
  (let [{:keys [root vault bin-dir log-path]}
        (setup-case!
         {"BOXP-501" {:status "in-progress" :assignee "boxp"}}
         {"Ready" ["BOXP-501"]}
         "Unused.\nTASK_BOARD_RESULT: done"
         10)]
    (run-tick! root vault bin-dir {"FAKE_CODEX_LOG" (str log-path)})
    (let [fm (ticket-frontmatter vault "BOXP-501")
          board (board-text vault)]
      (assert! "frontmatter should sync to board lane" (= "ready" (:status fm)))
      (assert! "card status should remain ready" (re-find #"BOXP-501: test.*status::ready" board))
      (assert! "codex should not run for non-codex assignee" (not (fs/exists? log-path))))))

(def tests
  [["parallel runs" test-parallel-runs]
   ["active lock skips only that ticket" test-active-lock-skips-only-that-ticket]
   ["stale lock recovers" test-stale-lock-recovers]
   ["review without PR marker blocks" test-review-without-pr-marker_blocks]
   ["lane source of truth sync" test-lane-source-of-truth-sync]])

(doseq [[name f] tests]
  (print (str name " ... "))
  (flush)
  (f)
  (println "ok"))
