#!/usr/bin/env bb
;; BOXP-616: direct tests of the runner's safety boundaries (result markers, PR gates,
;; locks, budgets). Each case states a rule the end-to-end cases did not pin down: a
;; mutant breaking it survived them (tests/codex-workspace/task-board-mutation.bb).
(require '[clojure.test :refer [deftest is testing run-tests]] '[clojure.string :as str] '[babashka.fs :as fs])
(System/setProperty "babashka.file" "/tmp/load-runner.bb")
(load-file "docker/codex-workspace/task-board/task_board_runner.bb")

;; ---------------------------------------------------------------------------
;; Markers in the agent's last message

(deftest result-marker-reads-only-a-whole-marker-line
  (is (= "done" (result-marker "summary\nTASK_BOARD_RESULT: done\n")))
  (is (= "done" (result-marker "task_board_result:done")) "case and the space after the colon do not matter")
  (is (= "continue" (result-marker "TASK_BOARD_RESULT: review")) "the retired spelling still means continue")
  (is (= "blocked" (result-marker "a\r\nTASK_BOARD_RESULT: blocked  \r\nb")))
  (testing "a marker quoted inside a sentence is not the run's result"
    ;; Prompts list the markers; an agent echoing them must not finish the ticket.
    (is (nil? (result-marker "End with TASK_BOARD_RESULT: done")))
    (is (nil? (result-marker "TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: continue")))
    (is (nil? (result-marker "TASK_BOARD_RESULT: done or blocked"))))
  (is (nil? (result-marker "TASK_BOARD_RESULT: finished")))
  (is (nil? (result-marker nil))))

(deftest wait-reason-marker-reads-only-known-reasons
  (is (= "owner-decision" (wait-reason-marker "x\nTASK_BOARD_WAIT_REASON: Owner-Decision\n")))
  (is (= "agent-recoverable" (wait-reason-marker "TASK_BOARD_WAIT_REASON:agent-recoverable")))
  (is (nil? (wait-reason-marker "add TASK_BOARD_WAIT_REASON: new-scope here")))
  (is (nil? (wait-reason-marker "reason TASK_BOARD_WAIT_REASON: new-scope")))
  (is (nil? (wait-reason-marker "TASK_BOARD_WAIT_REASON: new-scope or external-hold")))
  (is (nil? (wait-reason-marker nil))))

(deftest recheck-at-needs-exactly-one-parsable-line
  (is (= "2026-01-02T03:04:05Z" (recheck-at-marker "TASK_BOARD_RECHECK_AT: 2026-01-02T03:04:05Z")))
  (is (= "2026-01-02T00:04:05Z" (recheck-at-marker "a\nTASK_BOARD_RECHECK_AT: 2026-01-02T09:04:05+09:00\nb"))
      "an offset is converted to UTC")
  (is (nil? (recheck-at-marker (str "TASK_BOARD_RECHECK_AT: 2026-01-02T03:04:05Z\n"
                                    "TASK_BOARD_RECHECK_AT: 2026-01-02T03:04:05Z")))
      "two lines are ambiguous even when they agree")
  (is (= "2026-01-02T03:04:05Z" (recheck-at-marker "task_board_recheck_at: 2026-01-02T03:04:05Z")) "case does not matter, as for the other markers")
  (is (nil? (recheck-at-marker "retry at TASK_BOARD_RECHECK_AT: 2026-01-02T03:04:05Z")))
  (is (nil? (recheck-at-marker "TASK_BOARD_RECHECK_AT: tomorrow")))
  (is (nil? (recheck-at-marker "")))
  (is (nil? (recheck-at-marker nil))))

(deftest review-pr-markers
  (is (true? (no-repo-review-marker? "x\nTASK_BOARD_REVIEW_PR: None\n")))
  (is (false? (no-repo-review-marker? "say TASK_BOARD_REVIEW_PR: none when nothing changed")))
  (is (false? (no-repo-review-marker? "TASK_BOARD_REVIEW_PR: none yet")))
  (is (false? (no-repo-review-marker? "otherwise TASK_BOARD_REVIEW_PR: none")))
  (is (false? (no-repo-review-marker? nil)))
  (is (true? (review-ready? "TASK_BOARD_REVIEW_PR: none")))
  (is (true? (review-ready? "PR https://github.com/boxp/arch/pull/12")))
  (is (false? (review-ready? "no PR yet")))
  (is (false? (review-ready? nil)))
  (is (= ["https://github.com/a/b/pull/1" "https://github.com/c/d/pull/2"]
         (github-pr-urls "https://github.com/a/b/pull/1 and https://github.com/c/d/pull/2 https://github.com/a/b/pull/1")))
  (is (= [] (github-pr-urls nil))))

;; ---------------------------------------------------------------------------
;; Codex review: only P0/P1 block, anything that cannot be read is invalid

(deftest codex-review-findings-parse-each-field
  (let [[a b c d] (codex-review-findings (str "CODEX_REVIEW_FINDING: p1 | src/a.bb:3 | wrong | still the description\n"
                                              "codex_review_finding:NIT|b.md|typo\n"
                                              "CODEX_REVIEW_FINDING: P4 | c | d\n"
                                              "CODEX_REVIEW_FINDING: P2 | | missing location\n"
                                              "prose CODEX_REVIEW_FINDING: P0 | x | y\n"))]
    (is (= {:severity "P1" :severity-token "p1" :location "src/a.bb:3" :description "wrong | still the description"
            :malformed? false :line "CODEX_REVIEW_FINDING: p1 | src/a.bb:3 | wrong | still the description"} a))
    (is (= ["nit" "b.md" "typo" false] ((juxt :severity :location :description :malformed?) b)))
    (is (= [nil "P4"] ((juxt :severity :severity-token) c)))
    (is (true? (:malformed? d)))
    (is (= 4 (count (codex-review-findings (str "CODEX_REVIEW_FINDING: p1 | a | b\ncodex_review_finding:NIT|b|c\nCODEX_REVIEW_FINDING: P4 | c | d\n"
                                                "CODEX_REVIEW_FINDING: P2 | | e\nprose CODEX_REVIEW_FINDING: P0 | x | y\n"))))
        "a finding quoted inside prose is not a finding")
    (is (= 4 (count (codex-review-findings "CODEX_REVIEW_FINDING: P0 | x | y\nCODEX_REVIEW_FINDING: P1|x|y\nCODEX_REVIEW_FINDING: P2|x|y\nCODEX_REVIEW_FINDING: P3|x|y"))))
    (is (= ["P0" "P1" "P2" "P3"] (map :severity (codex-review-findings "CODEX_REVIEW_FINDING: P0 | x | y\nCODEX_REVIEW_FINDING: P1|x|y\nCODEX_REVIEW_FINDING: P2|x|y\nCODEX_REVIEW_FINDING: P3|x|y"))))
    (is (true? (:malformed? (first (codex-review-findings "CODEX_REVIEW_FINDING: P1 | only location")))))
    (is (true? (:malformed? (first (codex-review-findings "CODEX_REVIEW_FINDING: P1 | x |  ")))))
    (is (= [] (codex-review-findings nil)))))

(defn verdict [text] (select-keys (classify-codex-review text) [:verdict :reason]))

(deftest classify-codex-review-verdicts
  (is (= {:verdict :clean :reason nil} (verdict "CODEX_REVIEW_RESULT: clean")))
  (is (= {:verdict :clean :reason nil} (verdict "codex_review_result:CLEAN\n\n")))
  (is (= {:verdict :blocking :reason nil} (verdict "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P0 | a.bb:1 | x")))
  (is (= {:verdict :blocking :reason nil} (verdict "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | a.bb:1 | x\nCODEX_REVIEW_FINDING: P3 | a.bb:2 | y")))
  (doseq [s ["P2" "P3" "nit"]]
    (is (= {:verdict :pass-low :reason nil} (verdict (str "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: " s " | a.bb:1 | x"))) s))
  (let [r (classify-codex-review "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | a | x\nCODEX_REVIEW_FINDING: P2 | b | y")]
    (is (= ["a"] (map :location (:blocking r))))
    (is (= ["b"] (map :location (:low r)))))
  (testing "output that cannot be judged is invalid, never clean"
    (is (= {:verdict :invalid :reason :empty-output} (verdict "")))
    (is (= {:verdict :invalid :reason :empty-output} (verdict nil)))
    (is (= {:verdict :invalid :reason :missing-result-marker} (verdict "CODEX_REVIEW_FINDING: P1 | a | x")))
    (is (= {:verdict :invalid :reason :missing-result-marker} (verdict "see CODEX_REVIEW_RESULT: clean")))
    (is (= {:verdict :invalid :reason :conflicting-result-marker} (verdict "CODEX_REVIEW_RESULT: clean\nCODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | a | x")))
    (is (= {:verdict :invalid :reason :missing-severity} (verdict "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING:  | a | x")))
    (is (= {:verdict :invalid :reason :unknown-severity} (verdict "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: high | a | x")))
    (is (= {:verdict :invalid :reason :malformed-finding} (verdict "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | a")))
    (is (= {:verdict :invalid :reason :missing-severity} (verdict "CODEX_REVIEW_RESULT: issues")))
    (is (= {:verdict :invalid :reason :unstructured-findings} (verdict "CODEX_REVIEW_RESULT: clean\nThe lock is never released.")))
    (is (= {:verdict :invalid :reason :unstructured-findings} (verdict "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P0 | a | x\nalso this")))
    (testing "a P0 with an unknown severity next to it is still invalid, not blocking"
      (is (= :unknown-severity (:reason (classify-codex-review "CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P0 | a | x\nCODEX_REVIEW_FINDING: P9 | a | x")))))
    (testing "marker and finding lines count only as whole lines; anything else is prose"
      (is (= {:verdict :invalid :reason :unstructured-findings} (verdict "CODEX_REVIEW_RESULT: clean\nsee CODEX_REVIEW_RESULT: clean")))
      (is (= {:verdict :invalid :reason :unstructured-findings} (verdict "CODEX_REVIEW_RESULT: clean\nCODEX_REVIEW_RESULT: clean but see below")))
      (is (= {:verdict :invalid :reason :unstructured-findings} (verdict "CODEX_REVIEW_RESULT: clean\nnote CODEX_REVIEW_FINDING: P1 | a | x"))))
    (testing "blank lines and lower-case contract lines are not prose"
      (is (= {:verdict :pass-low :reason nil} (verdict "CODEX_REVIEW_RESULT: issues\n\n  \ncodex_review_finding: P2 | a | x"))))
    (testing "a well-formed finding with a clean marker is judged on the finding"
      (is (= {:verdict :blocking :reason nil} (verdict "CODEX_REVIEW_RESULT: clean\nCODEX_REVIEW_FINDING: P1 | a | x"))))))

(deftest invalid-review-outputs-name-only-a-fixed-reason
  ;; BOXP-621: these inputs were six end-to-end cases that differed only in the review
  ;; text. The gate turns every :invalid verdict into the same blocked result whose
  ;; message names the reason keyword (never the review text), so the e2e cases
  ;; test_review_with_codex_review_issue_is_blocked / _unknown_severity_output_stops
  ;; keep the wiring and these assertions keep each input.
  (let [reasons #{:empty-output :missing-result-marker :conflicting-result-marker :missing-severity
                  :unknown-severity :malformed-finding :unstructured-findings}]
    (doseq [[text reason] [["CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | wording\n- unformatted real defect" :unstructured-findings]
                           ["CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | x | real defect\n- unformatted second defect" :unstructured-findings]
                           ["CODEX_REVIEW_RESULT: clean\n- unformatted real defect" :unstructured-findings]
                           ["CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | wording\nCODEX_REVIEW_FINDING: | x | real defect" :missing-severity]
                           ["CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2" :malformed-finding]
                           ["CODEX_REVIEW_RESULT: clean\nCODEX_REVIEW_RESULT: issues" :conflicting-result-marker]
                           ["CODEX_REVIEW_RESULT: issues\n- missing regression test" :missing-severity]
                           ["CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P9 | x | y" :unknown-severity]
                           ["no marker" :missing-result-marker]]]
      (let [r (classify-codex-review text)]
        (is (= {:verdict :invalid :reason reason} (select-keys r [:verdict :reason])) text)
        (is (contains? reasons (:reason r)) text)))))

;; ---------------------------------------------------------------------------
;; CI checks and merge state

(deftest check-states
  (testing "a check run is completed by status, a commit status by state"
    (is (check-completed? {:status "completed"}))
    (is (not (check-completed? {:status "IN_PROGRESS"})))
    (doseq [s ["success" "FAILURE" "ERROR"]] (is (check-completed? {:state s}) s))
    (is (not (check-completed? {:state "PENDING"})))
    (is (not (check-completed? {}))))
  (testing "success needs completion"
    (doseq [c ["SUCCESS" "skipped" "NEUTRAL"]] (is (check-successful? {:status "COMPLETED" :conclusion c}) c))
    (is (not (check-successful? {:status "IN_PROGRESS" :conclusion "SUCCESS"})))
    (is (check-successful? {:state "success"}))
    (is (not (check-successful? {:status "COMPLETED" :conclusion "FAILURE"})))
    (is (not (check-successful? {:state "FAILURE"}))))
  (testing "failure is a completed check that did not succeed"
    (is (check-failed? {:status "COMPLETED" :conclusion "CANCELLED"}))
    (is (check-failed? {:state "ERROR"}))
    (is (not (check-failed? {:status "COMPLETED" :conclusion "SUCCESS"})))
    (is (not (check-failed? {:status "QUEUED"})))))

(deftest ci-state-orders-failure-before-pending
  (let [ok {:name "a" :status "COMPLETED" :conclusion "SUCCESS"}
        bad {:name "b" :status "COMPLETED" :conclusion "FAILURE"}
        wait {:context "c" :status "IN_PROGRESS"}]
    (is (= :pending (:state (ci-state []))) "no check reported yet is not a pass")
    (is (= {:state :passed :message "CI checks passed: a"} (ci-state [ok])))
    (is (= {:state :failed :message "CI checks failed: b=FAILURE"} (ci-state [ok bad wait])))
    (is (= {:state :pending :message "CI checks still pending: c"} (ci-state [ok wait])))
    (is (= "CI checks passed: a, unknown check" (:message (ci-state [ok {:state "SUCCESS"}]))))))

(deftest merge-state-gates
  (is (= [:failed :mergeability :merge-state] ((juxt :state :gate :failure-kind) (merge-state {:isDraft true :mergeStateStatus "CLEAN"}))))
  (is (= [:failed :conflict :merge-state] ((juxt :state :gate :failure-kind) (merge-state {:mergeStateStatus "dirty"}))))
  (doseq [s ["UNKNOWN" "behind"]]
    (is (= [:pending :mergeability] ((juxt :state :gate) (merge-state {:mergeStateStatus s}))) s))
  (doseq [s ["CLEAN" "HAS_HOOKS" "BLOCKED" "unstable"]]
    (is (= :passed (:state (merge-state {:mergeStateStatus s}))) s))
  (is (= [:failed :mergeability :merge-state-unknown "GitHub mergeStateStatus=missing is not review-ready."]
         ((juxt :state :gate :failure-kind :message) (merge-state {}))))
  (is (= :merge-state-unknown (:failure-kind (merge-state {:mergeStateStatus "DRAFT"}))))
  (is (merged-pr? {:state "merged"}))
  (is (not (merged-pr? {:state "OPEN"})))
  (is (not (merged-pr? {}))))

;; ---------------------------------------------------------------------------
;; Outcome of a run

(deftest intended-outcome-rules
  (is (= "blocked" (intended-outcome :implement "done" 1)) "a failed agent process never finishes the ticket")
  (is (= "blocked" (intended-outcome :implement "continue" -1)))
  (is (= "ready" (intended-outcome :groom "blocked" 0)))
  (is (= "blocked" (intended-outcome :docs-groom "blocked" 0)))
  (is (= "ready" (intended-outcome :docs-groom "done" 0)))
  (doseq [r ["done" "continue" "blocked" "owner-acceptance"]] (is (= r (intended-outcome :implement r 0)) r))
  (is (= "continue" (intended-outcome :implement "review" 0)))
  (is (= "continue" (intended-outcome :implement nil 0)))
  (is (= "continue" (intended-outcome :implement "anything" 0))))

(deftest final-status-applies-the-gates-only-to-continue
  (let [ok {:ok? true}
        retry {:ok? false :retryable? true}]
    (is (= "ready" (final-status :implement "continue" 0 ok)))
    (is (= "in-progress" (final-status :implement "continue" 0 retry)))
    (doseq [k [:retry-exhausted? :budget-exhausted?]]
      (is (= "blocked" (final-status :implement "continue" 0 (assoc retry k true))) (str k)))
    (is (= "blocked" (final-status :implement "continue" 0 {:ok? false})))
    (is (= "blocked" (final-status :implement "owner-acceptance" 0 ok)))
    (is (= "done" (final-status :implement "done" 0 {:ok? false})) "done is decided by the todos gate, not the PR gate")
    (is (= "blocked" (final-status :implement "blocked" 0 ok)))
    (is (= "blocked" (final-status :implement "done" 2 ok)))
    (is (= "ready" (final-status :groom nil 0 {:ok? false})))))

(defmacro with-root [[dir] & body]
  `(let [~dir (str (fs/create-temp-dir))]
     (try (with-redefs [root (fn [] ~dir)] ~@body)
          (finally (fs/delete-tree ~dir)))))

(deftest continuation-budget
  (with-root [dir]
    (with-redefs [continuation-limit (constantly 2)]
      (is (= 1 (:continuation-count (consume-continuation! "BOXP-1" "r1" {:ok? true}))))
      (is (= 1 (:continuation-count (consume-continuation! "BOXP-1" "r1" {:ok? true}))) "the same run is not counted twice")
      (is (= 1 (:continuation-count (consume-continuation! "BOXP-2" "r9" {:ok? true}))) "tickets are counted apart")
      (is (= 2 (:continuation-count (consume-continuation! "BOXP-1" "r2" {:ok? true}))) "reaching the limit is still allowed")
      (let [over (consume-continuation! "BOXP-1" "r3" {:ok? true :url "u"})]
        (is (= {:ok? false :retryable? false :continuation-exhausted? true :url "u"} (dissoc over :message)))
        (is (str/includes? (:message over) "(2 runs")))
      (is (= {:count 3 :last-run-id "r3"} (select-keys (get (read-edn-file (continuation-budget-path) {}) "BOXP-1") [:count :last-run-id])))
      (clear-continuation-budget! "BOXP-1")
      (is (= 1 (:continuation-count (consume-continuation! "BOXP-1" "r4" {:ok? true})))))))

;; ---------------------------------------------------------------------------
;; Ticket locks

(deftest lock-staleness-and-identity
  (let [t0 (java.time.Instant/parse "2026-01-01T00:00:00Z")]
   (with-redefs [env (fn [k d] (if (= k "CODEX_TASK_BOARD_LOCK_STALE_SECONDS") "100" d))
                 now (constantly t0)]
    ;; now is pinned so the exact-limit case cannot drift across a second boundary.
    (is (not (stale-lock? {:heartbeat-at (str (.minusSeconds t0 100))})) "exactly at the limit is still live")
    (is (stale-lock? {:heartbeat-at (str (.minusSeconds t0 101))}))
    (is (not (stale-lock? {:heartbeat-at (str (.minusSeconds t0 5))})))
    (is (stale-lock? {:heartbeat-at "not a time"}) "an unreadable heartbeat is stale")))
  (let [lock {:ticket "BOXP-1" :run-id "r" :owner-id "o" :owner-instance-id "i" :heartbeat-at "x"}]
    (is (same-ticket-lock? lock (assoc lock :heartbeat-at "y")) "the heartbeat may move")
    (doseq [k [:ticket :run-id :owner-id :owner-instance-id]]
      (is (not (same-ticket-lock? lock (assoc lock k "other"))) (str k)))))

;; ---------------------------------------------------------------------------
;; PR gate failure budget

(deftest gate-failure-classes
  (is (= "result-unknown" (gate-failure-class {:gate :ci :failure-kind :timeout})) "a timeout is unknown whatever the gate")
  (is (= "ci-failure" (gate-failure-class {:gate :ci})))
  (is (= "review-findings" (gate-failure-class {:gate :codex-review})))
  (is (= "merge-state" (gate-failure-class {:gate :mergeability})))
  (is (= "merge-state" (gate-failure-class {:gate :conflict})))
  (is (= "result-unknown" (gate-failure-class {:gate :other})))
  (is (= "result-unknown" (gate-failure-class {}))))

(deftest gate-budget-scope
  (let [budget {:pr-registrations {"a" {:ticket "BOXP-1" :pr "pr/1" :registered-at "2026-01-01T00:00:00Z"}
                                   "b" {:ticket "BOXP-2" :pr "pr/1" :registered-at "2026-01-02T00:00:00Z"}
                                   "c" {:ticket "BOXP-2" :pr "pr/2" :registered-at "2026-01-01T00:00:00Z"}
                                   "d" {:ticket "BOXP-1" :pr "pr/3" :registered-at "2026-01-03T00:00:00Z"}}
                :failures {"f" {:ticket "BOXP-1" :pr "pr/2" :recorded-at "2026-01-02T00:00:00Z"}
                           "g" {:ticket "BOXP-1" :pr nil :recorded-at "2026-01-01T00:00:00Z"}}
                :pr-exclusions [{:ticket "BOXP-1" :pr "pr/3"} {:ticket "BOXP-9" :pr "pr/1"}]}]
    (is (= ["pr/1"] (gate-budget-scope-prs budget "BOXP-1")) "only PRs the ticket registered first, minus its own exclusions")
    (is (= ["pr/2"] (gate-budget-scope-prs budget "BOXP-2")))
    (is (= [] (gate-budget-scope-prs budget "BOXP-3")))
    (is (= ["pr/1" "pr/4"] (gate-budget-scope-prs {:pr-registrations {"x" {:ticket "T" :pr "pr/4"} "y" {:ticket "T" :pr "pr/1"}}} "T"))
        "sorted, and a record without a time still counts")))

(deftest gate-budget-limits
  (with-redefs [gate-failure-budget-limit (constantly 3)]
    (let [fail (fn [n ticket pr] (into {} (for [i (range n)] [(str ticket pr i) {:ticket ticket :pr pr}])))
          reg (fn [ticket & prs] (into {} (for [p prs] [(str ticket p) {:ticket ticket :pr p :registered-at "2026-01-01T00:00:00Z"}])))]
      (testing "a ticket gets one unit per PR in its scope, at least one"
        (is (= {:used 0 :limit 3 :exhausted? false :n 0 :base 3}
               (select-keys (gate-budget-status {} :ticket "T") [:used :limit :exhausted? :n :base])))
        (is (= {:used 2 :limit 3 :exhausted? false} (select-keys (gate-budget-status {:failures (fail 2 "T" "p1")} :ticket "T") [:used :limit :exhausted?])))
        (is (= {:used 3 :limit 3 :exhausted? true} (select-keys (gate-budget-status {:failures (fail 3 "T" "p1")} :ticket "T") [:used :limit :exhausted?])))
        (is (= {:used 5 :limit 6 :exhausted? false :n 2 :base 6 :scope-prs ["p1" "p2"]}
               (select-keys (gate-budget-status {:failures (fail 5 "T" "p1") :pr-registrations (reg "T" "p1" "p2")} :ticket "T")
                            [:used :limit :exhausted? :n :base :scope-prs])))
        (is (= 1 (:used (gate-budget-status {:failures (merge (fail 1 "T" "p1") (fail 2 "U" "p1"))} :ticket "T"))) "only this ticket's failures"))
      (testing "grants: legacy grants raise the floor, additive grants add on top"
        (let [legacy [{:scope :ticket :key "T" :amount 2} {:scope :ticket :key "T" :amount 1} {:scope :ticket :key "U" :amount 50}]
              s (gate-budget-status {:grants legacy :pr-registrations (reg "T" "p1")} :ticket "T")]
          (is (= {:legacy-granted 3 :additive-granted 0 :limit 6} (select-keys s [:legacy-granted :additive-granted :limit]))))
        (is (= 3 (:limit (gate-budget-status {:grants [{:scope :ticket :key "T"} {:scope :ticket :key "T" :kind :additive}]} :ticket "T")))
            "a grant without an amount adds nothing")
        (is (= 6 (:limit (gate-budget-status {:grants [{:scope :ticket :key "T" :amount 1}] :pr-registrations (reg "T" "a" "b")} :ticket "T")))
            "with two PRs the base (6) is above unit + legacy (4)")
        (let [s (gate-budget-status {:grants [{:scope :ticket :key "T" :amount 2 :kind :additive} {:scope :ticket :key "T" :amount 1}
                                              {:scope :pr :key "T" :amount 9 :kind :additive}]
                                     :pr-registrations (reg "T" "a" "b")} :ticket "T")]
          (is (= {:legacy-granted 1 :additive-granted 2 :limit 8} (select-keys s [:legacy-granted :additive-granted :limit])))))
      (testing "a PR scope is only reported, never exhausted on its own"
        (is (= {:used 3 :limit 3 :exhausted? false :legacy-limit-reached? true}
               (select-keys (gate-budget-status {:failures (fail 3 "T" "p1")} :pr "p1") [:used :limit :exhausted? :legacy-limit-reached?])))
        (is (= {:used 3 :limit 5 :legacy-limit-reached? false}
               (select-keys (gate-budget-status {:failures (fail 3 "T" "p1") :grants [{:scope :pr :key "p1" :amount 2} {:scope :ticket :key "p1" :amount 7}]} :pr "p1")
                            [:used :limit :legacy-limit-reached?])))
        (is (= 2 (:used (gate-budget-status {:failures (merge (fail 1 "T" "p1") (fail 1 "U" "p1") (fail 1 "T" "p2"))} :pr "p1"))))))))

;; ---------------------------------------------------------------------------
;; BOXP-673: the standard order of work in the prompts

(deftest spec-first-contract-states-the-order-and-the-exemption
  (let [p (spec-first-contract-prompt)]
    (is (< (str/index-of p "(1)") (str/index-of p "(2)") (str/index-of p "(3)") (str/index-of p "(4)"))
        "spec, model, tests, implementation, in that order")
    (is (str/includes? p spec-first-standard-note) "the details live in the vault note")
    (is (str/includes? p (str spec-index-module-path " show")) "how to reach the current spec")
    (is (str/includes? p "not from the implementation") "expected values are not copied from the implementation")
    (is (re-find #"does not apply.*reason" p) "an exempt change states its reason")
    (is (str/includes? p "Do not attach a Lean file for form"))
    (is (str/includes? p "real concurrency is not covered") "the limits of the guarantee are recorded")))

;; ---------------------------------------------------------------------------
;; BOXP-781: the measure-only criteria trial (spec: Projects/codex-workspace-disk-growth/criteria-trial-spec.md)

(defn- inst [s] (java.time.Instant/parse s))

(deftest criteria-trial-window-is-bounded-and-expires
  (let [cfg {:id "BOXP-781" :from "2026-11-28T18:00:00Z" :until "2026-11-29T18:00:00Z"}]
    (is (= "BOXP-781" (:id (criteria-trial-window-of cfg (inst "2026-11-28T18:00:00Z")))) "from is inclusive")
    (is (some? (criteria-trial-window-of cfg (inst "2026-11-29T17:59:59Z"))))
    (is (nil? (criteria-trial-window-of cfg (inst "2026-11-29T18:00:00Z"))) "until is exclusive: the trial ends by itself")
    (is (nil? (criteria-trial-window-of cfg (inst "2026-11-28T17:59:59Z"))) "not yet started"))
  (testing "a window longer than 25 hours is refused, not truncated"
    (is (= ::invalid-or-nil (or (criteria-trial-window-of {:from "2026-11-28T18:00:00Z" :until "2026-12-05T18:00:00Z"} (inst "2026-11-28T19:00:00Z")) ::invalid-or-nil)))
    (is (some? (criteria-trial-window-of {:from "2026-11-28T18:00:00Z" :until "2026-11-29T19:00:00Z"} (inst "2026-11-28T19:00:00Z"))) "exactly 25 hours is allowed"))
  (is (nil? (criteria-trial-window-of {:from "2026-11-29T18:00:00Z" :until "2026-11-28T18:00:00Z"} (inst "2026-11-28T19:00:00Z"))) "until before from")
  (is (nil? (criteria-trial-window-of {:from "bad" :until "2026-11-29T18:00:00Z"} (inst "2026-11-28T19:00:00Z"))))
  (is (nil? (criteria-trial-window-of nil (inst "2026-11-28T19:00:00Z"))) "no file, no trial")
  (is (nil? (criteria-trial-window-of [1 2] (inst "2026-11-28T19:00:00Z")))))

(deftest criteria-trial-classifies-by-name-only
  (let [c #(criteria-trial-class (str/split % #"/"))]
    (is (= :generated (c "ghq/github.com/o/r/node_modules/x.js")))
    (is (= :git-internal (c "ghq/github.com/o/r/.git/objects/ab/cd")))
    (is (= :git-internal (c "ghq/github.com/o/r/node_modules/p/.git/HEAD")) ".git wins over node_modules")
    (is (= :git-internal (c "ghq/github.com/o/r/.git")) "a worktree's .git file")
    (is (= :download (c "ghq/github.com/o/r/.tools/hugetracker/a.c")))
    (is (= :download (c "trial/uv-cache/sdists/x.tar.gz")) "a download outside ghq is still a download")
    (is (= :generated (c "ghq/github.com/o/r/apps/w/.lake/build/x.olean")))
    (is (= :checkout-other (c "ghq/github.com/o/r/src/a.clj")))
    (is (= :checkout-other (c "ghq/github.com/o/r/dist")) "a file named dist is not a dist directory")
    (is (= :outside-ghq (c "tmp/out.png")))
    (is (= :outside-ghq (c "pr-body.md")))))

(deftest criteria-trial-summary-counts-candidates-only-for-held-runs
  (let [runs {["T-1" "r1"] {:generated 100 :download 10 :git-internal 5 :checkout-other 20 :outside-ghq 3}
              ["T-1" "r2"] {:generated 1000 :checkout-other 1}
              ["T-2" "r3"] {:outside-ghq 7}
              ["T-3" "r4"] {:generated 50}}
        outcomes {["T-1" "r1"] "held:outside-checkout" ["T-2" "r3"] "held:git-error" ["T-3" "r4"] "deleted"}
        s (criteria-trial-summary runs outcomes)]
    (is (= {:runs 1 :bytes 138 :generated 100 :download 10 :git-internal 5 :checkout-other 20 :outside-ghq 3}
           (get-in s [:by-status "held:outside-checkout"])))
    (is (= {:runs 1 :bytes 1001 :generated 1000 :download 0 :git-internal 0 :checkout-other 1 :outside-ghq 0}
           (get-in s [:by-status "not-judged"])) "a run with no outcome this pass is time-protected, not a candidate")
    (is (= 50 (get-in s [:by-status "deleted" :bytes])))
    (is (= {:b-named 100 :b-download 10 :b-git-check 20 :d-outside 10 :keep 5} (:candidate s)))
    (is (= [{:ticket "T-1" :run "r1" :status "held:outside-checkout" :candidate-bytes 133}
            {:ticket "T-2" :run "r3" :status "held:git-error" :candidate-bytes 7}]
           (:top-held-runs s)))))

(deftest criteria-trial-alerts-before-the-guard
  (let [gib 1073741824 soft (* 16 gib)]
    (is (= #{} (criteria-trial-alerts (* 30 gib) soft nil)))
    (is (= #{:near-guard} (criteria-trial-alerts (dec (* 20 gib)) soft nil)) "below soft + 4GiB")
    (is (= #{} (criteria-trial-alerts (* 20 gib) soft nil)))
    (is (= #{:fast-drop} (criteria-trial-alerts (* 30 gib) soft 23.9)))
    (is (= #{} (criteria-trial-alerts (* 30 gib) soft 24.0)))))

(deftest criteria-trial-hours-to-guard-from-the-previous-record
  (let [gib 1073741824]
    (is (= {:free-drop-bytes-per-hour gib :hours-to-soft-guard 10.0}
           (criteria-trial-drop (* 26 gib) (* 16 gib) (inst "2026-11-28T20:00:00Z")
                                {:fs-free-bytes (* 27 gib) :at "2026-11-28T19:00:00Z"})))
    (is (= {:free-drop-bytes-per-hour (- gib) :hours-to-soft-guard nil}
           (criteria-trial-drop (* 28 gib) (* 16 gib) (inst "2026-11-28T20:00:00Z")
                                {:fs-free-bytes (* 27 gib) :at "2026-11-28T19:00:00Z"})) "free space grew")
    (is (= {:free-drop-bytes-per-hour nil :hours-to-soft-guard nil}
           (criteria-trial-drop (* 26 gib) (* 16 gib) (inst "2026-11-28T20:00:00Z")
                                {:fs-free-bytes (* 27 gib) :at "2026-11-28T19:45:00Z"})) "less than 30 minutes apart")
    (is (= {:free-drop-bytes-per-hour nil :hours-to-soft-guard nil}
           (criteria-trial-drop (* 26 gib) (* 16 gib) (inst "2026-11-28T20:00:00Z") nil)))))

(deftest criteria-trial-report-separates-generation-from-existing-reclaim
  (let [w {:id "BOXP-781" :from "2026-11-28T18:00:00Z" :until "2026-11-29T18:00:00Z"}
        t (fn [at free used] {:event :criteria-trial :trial-id "BOXP-781" :from "2026-11-28T18:00:00Z" :at at
                              :fs-free-bytes free :fs-used-bytes used :scan-complete true :alert [] :candidate {:b-named 1}})
        events [(t "2026-11-28T18:10:00Z" 300 700)
                {:event :prune-run :result :deleted :allocated-bytes 40 :measured? true :at "2026-11-28T19:00:00Z"}
                {:event :prune-run :result :held :allocated-bytes 999 :at "2026-11-28T19:00:00Z"}
                {:event :generated-reclaim :result :reclaimed :allocated-bytes 10 :at "2026-11-28T19:00:00Z"}
                {:event :generated-reclaim :result :would-reclaim :allocated-bytes 500 :at "2026-11-28T19:00:00Z"}
                {:event :prune-run :result :deleted :allocated-bytes 5000 :measured? true :at "2026-11-29T18:00:00Z"}
                (assoc (t "2026-11-29T17:00:00Z" 250 750) :alert [:near-guard])
                (assoc (t "2026-11-29T17:30:00Z" 260 740) :trial-id "other")]
        r (criteria-trial-report events w)]
    (is (= 2 (:records r)) "another trial's records are not mixed in")
    (is (= {:first 300 :last 250 :min 250} (dissoc (:free r) :series)))
    (is (= 50 (get-in r [:existing-reclaim :total-bytes])) "only deletions inside [from, until); would-reclaim and held are not reclaim")
    (is (= 50 (:used-delta-bytes r)))
    (is (= 100 (:generated-bytes-est r)) "generation = used growth + what the existing reclaim removed")
    (is (= {:near-guard 1} (:alerts r)))))

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
