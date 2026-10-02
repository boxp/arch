#!/usr/bin/env bb
(ns autonomy-intent-test
  (:require [babashka.fs :as fs]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing run-tests]]))

(def root (-> (io/file *file*) .getParentFile .getParentFile .getParent))
(load-file (str root "/docker/codex-workspace/task-board/autonomy_control.bb"))
(load-file (str root "/docker/codex-workspace/task-board/autonomy_intent.bb"))
;; The libraries are .bb scripts loaded explicitly, not classpath libraries.
(in-ns 'autonomy-intent-test)
(alias 'control 'autonomy-control)
(alias 'intent 'autonomy-intent)
(alias 'policy 'autonomy-policy)

(def fixture-dir (str root "/tests/codex-workspace/fixtures/autonomy/"))
(defn fixture [name] (read-string (slurp (str fixture-dir name ".edn"))))
(def control-fixture (fixture "control"))
(def decision-fixture (fixture "decision"))
(def now "2026-09-30T10:00:00Z")
(def ticket "BOXP-203")
(def sentinel "sentinel-requirement-secret")

;; Synthetic identities, resolved by the mock store from its own registrations.
(def owner "synthetic-owner-credential")
(def runner "synthetic-runner-credential")
(def agent "synthetic-agent-credential")
(def principals {owner {:subject "synthetic-owner-subject" :role :owner}
                 runner {:subject "synthetic-runner-subject" :role :runner}
                 agent {:subject "synthetic-agent-subject" :role :agent}})

(def policy-context {:now now
                     :allowed-repos ["boxp/arch"]
                     :allowed-paths ["docs/project_docs/BOXP-203/"]})

(defn ticket-text
  "A ticket whose Summary/Acceptance Criteria are the objective."
  ([] (ticket-text {}))
  ([{:keys [summary criteria notes] :or {summary (str "Implement bounded canary validator. " sentinel)
                                         criteria "- [ ] Validator rejects unknown versions"
                                         notes "- initial note"}}]
   (str "---\nid: " ticket "\n---\n\n# " ticket ": test\n\n## Summary\n\n" summary
        "\n\n## Acceptance Criteria\n\n" criteria "\n\n## Context\n\nfree text\n\n## Notes\n" notes "\n")))

(def requirements (intent/requirements-text (ticket-text)))

(defn new-store []
  (control/init-store!
   (control/open-store {:dir (str (fs/create-temp-dir {:prefix "autonomy-intent-"}))
                        :principals principals
                        :allowed-repos (:allowed-repos policy-context)
                        :allowed-paths (:allowed-paths policy-context)
                        :now (constantly now)})))

(defn ok! [result]
  (when-not (true? (:ok? result))
    (throw (ex-info "fixture request failed" {:diagnostic (:diagnostic result)})))
  result)

(defn issued-store
  "A store at writer generation 1 with one control for `ticket` at revision 1."
  ([] (issued-store {}))
  ([overrides]
   (let [store (new-store)]
     (ok! (control/request! store owner {:op :issue-writer-generation :expected-generation 0}))
     (ok! (control/request! store owner (merge {:op :issue-control
                                                :ticket ticket
                                                :objective-id "BOXP-203-validator"
                                                :requirements requirements
                                                :intent "run"
                                                :agent_route "claude-fable"
                                                :scope (:scope control-fixture)
                                                :budget {:max_steps 3 :max_wall_minutes 60}}
                                               overrides)))
     store)))

(defn read-original [store]
  (control/read-control store runner ticket))

(defn projection
  "The agent-writable frontmatter projection of the control original."
  [store extra]
  (let [control (:control (read-original store))]
    (merge {:assignee "claude-fable"
            :autonomy_version "2"
            :execution_intent (:intent control)
            :control_revision (str (:revision control))}
           extra)))

(defn input
  ([store] (input store {}))
  ([store overrides]
   (merge {:card {:ticket-id ticket :status "ready"}
           :frontmatter (projection store {})
           :ticket-text (ticket-text)
           :legacy-action :implement
           :control-result (read-original store)
           :canary-tickets #{ticket}
           :policy-context policy-context}
          overrides)))

(defn code [verdict] (get-in verdict [:diagnostic :code]))
(defn rejected? [expected verdict]
  (and (false? (:start? verdict))
       (nil? (:action verdict))
       (= expected (code verdict))
       (= #{:mode :start? :action :diagnostic} (set (keys verdict)))))

(deftest claude-route-starts-only-for-a-verified-canary
  (let [store (issued-store)
        verdict (intent/evaluate (input store))]
    (is (true? (:start? verdict)))
    (is (= :v2 (:mode verdict)))
    (is (= :implement (:action verdict)))
    (is (= {:cli :claude
            :route "claude-fable"
            :model "claude-fable-5-1"
            :args ["--model" "claude-fable-5-1"]
            :helper "~/.claude/skills/obsidian-task-board/bin/task-board.bb"
            :notes-source "claude-fable"}
           (:launch verdict)))
    (is (= {:ticket ticket :revision 1 :generation 1 :route "claude-fable"}
           (select-keys (:snapshot verdict) [:ticket :revision :generation :route])))
    (is (not (str/includes? (pr-str verdict) sentinel)))
    (testing "the owner's canary selection and the control original are both required"
      (is (rejected? "not-canary" (intent/evaluate (input store {:canary-tickets #{}}))))
      (is (rejected? "not-canary" (intent/evaluate (input store {:canary-tickets #{"BOXP-999"}}))))
      (is (rejected? "not-canary" (intent/evaluate (input store {:canary-tickets nil}))))
      (is (rejected? "control-unavailable" (intent/evaluate (input store {:control-result nil}))))
      (is (rejected? "control-unavailable"
                     (intent/evaluate (input store {:control-result
                                                    (control/read-control store runner "BOXP-999")}))))
      (is (rejected? "control-unavailable"
                     (intent/evaluate (input store {:control-result
                                                    (control/read-control store "unknown-credential" ticket)}))))
      (is (rejected? "control-unavailable"
                     (intent/evaluate (input store {:control-result
                                                    (control/read-control store runner ticket
                                                                          {:min-revision 9})})))))
    (testing "a control for another ticket or outside the owner bounds is not accepted"
      (is (rejected? "control-mismatch"
                     (intent/evaluate (input store {:card {:ticket-id "BOXP-204" :status "ready"}
                                                    :canary-tickets #{"BOXP-204"}}))))
      (is (rejected? "control-mismatch"
                     (intent/evaluate (input store {:policy-context
                                                    (assoc policy-context :allowed-repos ["boxp/other"])}))))
      (is (rejected? "control-mismatch" (intent/evaluate (input store {:policy-context nil}))))
      (is (rejected? "control-mismatch"
                     (intent/evaluate (input store {:control-result
                                                    (dissoc (read-original store) :consumed)})))))))

(deftest lane-intent-route-matrix
  (let [stores {"claude-fable" (issued-store)
                "codex" (issued-store {:agent_route "codex"})
                "codex-sol-high" (issued-store {:agent_route "codex-sol-high"})}
        expected-action {"backlog" :groom "ready" :implement "in-progress" :implement "review" :review-fix}]
    (doseq [[route store] stores
            intent-value ["run" "pause" "cancel" "wait-human"]]
      (when-not (= "run" intent-value)
        (ok! (control/request! store owner {:op :update-control :ticket ticket
                                            :expected-revision (:revision (read-original store))
                                            :intent intent-value})))
      (doseq [status ["backlog" "ready" "in-progress" "review" "blocked" "done" "unknown"]
              assignee [route "boxp" "fable" "unknown"]]
        (let [verdict (intent/evaluate (input store {:card {:ticket-id ticket :status status}
                                                     :frontmatter (projection store {:assignee assignee})}))]
          (testing (str route "/" intent-value "/" status "/" assignee)
            (cond
              (contains? #{"done" "unknown"} status) (is (rejected? "lane-terminal" verdict))
              (not= "run" intent-value) (is (rejected? "intent-stopped" verdict))
              (= "blocked" status) (is (rejected? "retry-contract-required" verdict))
              :else (do (is (true? (:start? verdict)))
                        (is (= (get expected-action status) (:action verdict)))
                        ;; The route comes from the control, never from the assignee.
                        (is (= route (get-in verdict [:launch :route])))))))))))

(deftest assignee-or-projection-edits-never-start
  (let [store (issued-store {:intent "pause"})]
    (testing "an agent editing the projection to run cannot lift an owner stop"
      (is (rejected? "intent-stopped"
                     (intent/evaluate (input store {:frontmatter (projection store {:execution_intent "run"})})))))
    (testing "the agent identity cannot change the original"
      (is (false? (:ok? (control/request! store agent {:op :update-control :ticket ticket
                                                       :expected-revision 1 :intent "run"}))))
      (is (false? (:ok? (control/request! store runner {:op :update-control :ticket ticket
                                                        :expected-revision 1 :intent "run"}))))
      (is (rejected? "intent-stopped" (intent/evaluate (input store)))))
    (testing "only the owner lifts the stop, and the projection must follow the new revision"
      (let [stale (projection store {:execution_intent "run"})]
        (ok! (control/request! store owner {:op :update-control :ticket ticket
                                            :expected-revision 1 :intent "run"}))
        (is (rejected? "projection-mismatch" (intent/evaluate (input store {:frontmatter stale}))))
        (is (true? (:start? (intent/evaluate (input store))))))))
  (testing "a v2 claim that cannot be verified never falls back to the legacy rule"
    (let [store (issued-store)]
      (doseq [fm [{:autonomy_version "1"}
                  {:autonomy_version "two"}
                  {:autonomy_version "\"2\""}
                  {:autonomy_version nil :execution_intent "run"}
                  {:autonomy_version nil :execution_intent nil :control_revision "1"}]]
        (is (rejected? "unsupported-version"
                       (intent/evaluate (input store {:frontmatter (projection store fm)})))))
      (is (rejected? "projection-mismatch"
                     (intent/evaluate (input store {:frontmatter (projection store {:control_revision nil})}))))
      (is (rejected? "projection-mismatch"
                     (intent/evaluate (input store {:frontmatter (projection store {:control_revision "malformed"})}))))
      (is (true? (:start? (intent/evaluate
                           (input store {:frontmatter {"assignee" "boxp"
                                                       "autonomy_version" "2"
                                                       "execution_intent" "run"
                                                       "control_revision" "1"}}))))
          "string-keyed frontmatter is the same projection"))))

(deftest legacy-tickets-keep-the-legacy-rule
  (let [store (issued-store)
        legacy (fn [assignee action]
                 (intent/evaluate (input store {:frontmatter {:assignee assignee}
                                                :legacy-action action
                                                :control-result nil
                                                :canary-tickets #{}})))]
    (is (= {:mode :legacy-v1 :start? true :action :implement :diagnostic {:category :legacy :code "legacy"}}
           (legacy "claude-fable" :implement)))
    (is (= :blocked-retry (:action (legacy "codex-sol" :blocked-retry))))
    (is (= "no-legacy-action" (code (legacy "boxp" nil))))
    (is (= :legacy-v1 (:mode (legacy "boxp" nil))))
    (testing "the retired fable route is not a start candidate in the shadow verdict"
      (is (= "legacy-route-retired" (code (legacy "fable" :implement))))
      (is (false? (:start? (legacy "fable" :implement)))))))

(deftest objective-snapshot-is-compared-with-the-ticket
  (let [store (issued-store)
        verdict #(intent/evaluate (input store {:ticket-text %}))]
    (testing "Notes, checkbox state and trailing whitespace are not requirement changes"
      (is (true? (:start? (verdict (ticket-text {:notes "- a later note\n- another"})))))
      (is (true? (:start? (verdict (ticket-text {:criteria "- [x] Validator rejects unknown versions  "}))))))
    (testing "a rewritten, extended or missing requirement stops the start"
      (is (rejected? "objective-mismatch" (verdict (ticket-text {:summary "Deploy to production."}))))
      (is (rejected? "objective-mismatch"
                     (verdict (ticket-text {:criteria "- [ ] Validator rejects unknown versions\n- [ ] Also merge"}))))
      (is (rejected? "objective-mismatch" (verdict "---\nid: BOXP-203\n---\n\n## Notes\n")))
      (is (rejected? "objective-mismatch" (verdict nil))))
    (testing "a different objective for the same path scope is a different control"
      (let [other (issued-store {:requirements "## Summary\nAnother goal.\n\n## Acceptance Criteria\n- [ ] Other\n"})]
        (is (rejected? "objective-mismatch" (intent/evaluate (input other))))))
    (testing "only an owner-issued requirement version makes the edited ticket startable again"
      (let [edited (ticket-text {:summary "Implement bounded canary validator v2."})]
        (is (rejected? "objective-mismatch" (verdict edited)))
        (ok! (control/request! store owner {:op :update-control :ticket ticket :expected-revision 1
                                            :requirements (intent/requirements-text edited)}))
        (is (true? (:start? (intent/evaluate (input store {:ticket-text edited})))))
        (is (rejected? "objective-mismatch" (intent/evaluate (input store))))))))

(deftest budget-and-generation-gates
  (let [store (issued-store)
        consume! (fn [key revision]
                   (ok! (control/request! store runner {:op :consume-budget :ticket ticket
                                                        :writer-generation (:generation (read-original store))
                                                        :expected-revision revision
                                                        :idempotency-key key :steps 1 :wall_minutes 0})))]
    (doseq [key ["step-1" "step-2" "step-3"]] (consume! key 1))
    (is (rejected? "budget-exhausted" (intent/evaluate (input store))))
    (testing "a revision bump alone does not reset consumption"
      (ok! (control/request! store owner {:op :update-control :ticket ticket :expected-revision 1
                                          :agent_route "codex"}))
      (is (rejected? "budget-exhausted" (intent/evaluate (input store)))))
    (testing "only an explicit owner budget epoch does"
      (ok! (control/request! store owner {:op :update-control :ticket ticket :expected-revision 2
                                          :new-budget-epoch true}))
      (is (true? (:start? (intent/evaluate (input store))))))
    (testing "a control stamped with an older writer generation does not start"
      (ok! (control/request! store owner {:op :issue-writer-generation :expected-generation 1}))
      (is (rejected? "stale-generation" (intent/evaluate (input store))))
      (ok! (control/request! store owner {:op :update-control :ticket ticket :expected-revision 3
                                          :intent "run"}))
      (is (true? (:start? (intent/evaluate (input store))))))))

(deftest unsupported-routes-never-launch
  (let [store (issued-store)
        original (read-original store)]
    (testing "the store refuses to issue a non-v2 route"
      (doseq [route ["fable" "claude-opus" "claude-sonnet" "codex-astra" "unknown"]]
        (is (false? (:ok? (control/request! store owner {:op :update-control :ticket ticket
                                                         :expected-revision 1 :agent_route route}))))))
    (testing "a control carrying one anyway is rejected before any launch mapping"
      (doseq [route ["fable" "claude-opus" "unknown" nil]]
        (is (rejected? "control-mismatch"
                       (intent/evaluate (input store {:control-result
                                                      (assoc-in original [:control :agent_route] route)}))))))
    (testing "launch mapping has no fallback and takes no environment override"
      (is (= ["--model" "claude-fable-5-1"] (:args (intent/launch-spec "claude-fable"))))
      (doseq [route ["fable" "claude-opus" "claude-sonnet" "claude-fable-5-1" "claude-fable-high" "" nil 2]]
        (is (nil? (intent/launch-spec route))))
      (doseq [route ["codex" "codex-sol" "codex-terra-low"]]
        (is (= {:cli :codex :route route} (select-keys (intent/launch-spec route) [:cli :route :model])))))))

(deftest stop-after-candidate-snapshot-wins
  (let [store (issued-store)
        candidate (intent/evaluate (input store))]
    (is (= candidate (intent/confirm-start candidate (intent/evaluate (input store)))))
    (testing "an owner pause between the candidate snapshot and the lock"
      (ok! (control/request! store owner {:op :update-control :ticket ticket
                                          :expected-revision 1 :intent "pause"}))
      (is (rejected? "intent-stopped" (intent/confirm-start candidate (intent/evaluate (input store)))))
      (is (false? (:ok? (control/authorize-write store runner
                                                 {:ticket ticket
                                                  :expected-revision (get-in candidate [:snapshot :revision])
                                                  :writer-generation 1})))))
    (testing "a resume at a newer revision is a new candidate, not the old one"
      (ok! (control/request! store owner {:op :update-control :ticket ticket
                                          :expected-revision 2 :intent "run"}))
      (let [fresh (intent/evaluate (input store))]
        (is (true? (:start? fresh)))
        (is (rejected? "revision-changed" (intent/confirm-start candidate fresh)))
        (is (= fresh (intent/confirm-start fresh fresh)))))
    (testing "a lane change under the lock changes the action and voids the snapshot"
      (let [ready (intent/evaluate (input store))
            review (intent/evaluate (input store {:card {:ticket-id ticket :status "review"}}))]
        (is (rejected? "revision-changed" (intent/confirm-start ready review)))))
    (testing "a non-start or legacy candidate cannot be confirmed"
      (let [fresh (intent/evaluate (input store))]
        (is (rejected? "revision-changed" (intent/confirm-start (intent/evaluate (input store {:canary-tickets #{}})) fresh)))
        (is (rejected? "revision-changed"
                       (intent/confirm-start {:mode :legacy-v1 :start? true :action :implement} fresh)))))))

(deftest finished-run-does-not-override-a-newer-stop
  (let [store (issued-store)
        snapshot (:snapshot (intent/evaluate (input store)))]
    (is (= {:project? true :diagnostic {:category :ok :code "ok"}}
           (intent/finish-projection snapshot (read-original store) "in-progress")))
    (testing "a card moved out of In Progress during the run is not overwritten"
      (doseq [status ["blocked" "review" "backlog" "done" nil]]
        (is (= {:project? false :diagnostic {:category :lane-changed :code "lane-changed"}}
               (intent/finish-projection snapshot (read-original store) status)))))
    (testing "recorded budget consumption is not a control change"
      (ok! (control/request! store runner {:op :consume-budget :ticket ticket :writer-generation 1
                                           :expected-revision 1 :idempotency-key "run-1"
                                           :steps 1 :wall_minutes 5}))
      (is (true? (:project? (intent/finish-projection snapshot (read-original store) "in-progress")))))
    (testing "the runner tightening to wait-human, or the owner pausing, holds the projection"
      (ok! (control/request! store runner {:op :restrict-intent :ticket ticket :expected-revision 1
                                           :writer-generation 1 :intent "wait-human"}))
      (is (= {:project? false :diagnostic {:category :intent-stopped :code "intent-stopped"}}
             (intent/finish-projection snapshot (read-original store) "in-progress"))))
    (testing "an owner resume at a newer revision still does not belong to the old run"
      (ok! (control/request! store owner {:op :update-control :ticket ticket
                                          :expected-revision 2 :intent "run"}))
      (is (= "revision-changed" (code (intent/finish-projection snapshot (read-original store) "in-progress")))))
    (testing "a new writer generation or an unreadable original holds the projection"
      (ok! (control/request! store owner {:op :issue-writer-generation :expected-generation 1}))
      (is (= "stale-generation" (code (intent/finish-projection snapshot (read-original store) "in-progress"))))
      (is (= "control-unavailable" (code (intent/finish-projection snapshot nil "in-progress"))))
      (is (= "control-unavailable"
             (code (intent/finish-projection snapshot (control/read-control store runner "BOXP-999") "in-progress"))))
      (is (= "control-unavailable" (code (intent/finish-projection nil (read-original store) "in-progress")))))))

(deftest decision-is-void-after-head-or-scope-change
  (let [store (issued-store)
        control (:control (read-original store))
        head (:artifact_head decision-fixture)
        decision (assoc decision-fixture :scope (policy/scope-digest (:scope control)))
        context {:control control :artifact-head head :policy-context policy-context}
        current? #(:current? (intent/decision-current? %1 %2))]
    (is (= {:current? true :diagnostic {:category :ok :code "ok"}}
           (intent/decision-current? decision context)))
    (is (true? (current? (assoc decision :status "resolved") context)))
    (testing "a new head, a missing head or a stopped packet"
      (is (false? (current? decision (assoc context :artifact-head "89abcdef0123456789abcdef0123456789abcdef"))))
      (is (false? (current? decision (dissoc context :artifact-head))))
      (is (false? (current? decision (dissoc context :policy-context))))
      (is (false? (current? (assoc decision :status "superseded") context)))
      (is (false? (current? (assoc decision :status "expired") context)))
      (is (false? (current? (assoc decision :issuance "template") context)))
      (is (= {:category :decision-invalid :code "decision-invalid"}
             (:diagnostic (intent/decision-current? nil context)))))
    (testing "an owner scope change bumps the revision and voids the old decision"
      (ok! (control/request! store owner {:op :update-control :ticket ticket :expected-revision 1
                                          :scope (assoc (:scope control) :operations ["read"])}))
      (let [updated (:control (read-original store))]
        (is (false? (current? decision (assoc context :control updated))))
        (is (false? (current? (assoc decision :control_revision 2) (assoc context :control updated))))
        (is (true? (current? (assoc decision :control_revision 2
                                    :scope (policy/scope-digest (:scope updated)))
                             (assoc context :control updated))))))))

(deftest shadow-comparison-is-pure-and-redacted
  (let [store (issued-store)
        v2-input (input store)
        entries [(intent/shadow-entry v2-input)
                 (intent/shadow-entry (input store {:card {:ticket-id "BOXP-300" :status "ready"}
                                                    :frontmatter {:assignee "codex"}
                                                    :legacy-action :implement}))
                 (intent/shadow-entry (input store {:card {:ticket-id "BOXP-301" :status "review"}
                                                    :frontmatter {:assignee "fable"}
                                                    :legacy-action :review-fix}))
                 (intent/shadow-entry (input store {:card {:ticket-id "BOXP-302" :status "blocked"}
                                                    :frontmatter (projection store {})
                                                    :legacy-action :blocked-retry
                                                    :canary-tickets #{}}))
                 (intent/shadow-entry (input store {:card {:ticket-id "BOXP-303" :status "ready"}
                                                    :frontmatter {:assignee "boxp"}
                                                    :legacy-action nil}))]
        summary (intent/shadow-summary entries)]
    (is (= {:ticket ticket :status "ready" :mode :v2 :legacy-action :implement
            :start? true :action :implement :diagnostic "ok" :differs? false}
           (first entries)))
    (is (= {:schema_version 1 :cards 5 :legacy-starts 4 :shadow-starts 2 :differing 2
            :by-mode {:v2 2 :legacy-v1 3}
            :by-diagnostic {"ok" 1 "legacy" 1 "legacy-route-retired" 1 "not-canary" 1 "no-legacy-action" 1}}
           (dissoc summary :entries)))
    (is (= ["BOXP-203" "BOXP-300" "BOXP-301" "BOXP-302" "BOXP-303"] (mapv :ticket (:entries summary))))
    (is (every? #(= #{:ticket :status :mode :legacy-action :start? :action :diagnostic :differs?} (set (keys %)))
                entries))
    (is (not (str/includes? (pr-str summary) sentinel)))
    (testing "evaluation leaves the control original untouched"
      (is (= 2 (count (:events (control/events store owner))))))))

(deftest requirements-text-normalization
  (is (= (str "## Summary\nImplement bounded canary validator. " sentinel
              "\n\n## Acceptance Criteria\n- [ ] Validator rejects unknown versions\n")
         requirements))
  (is (= requirements (intent/requirements-text (str/replace (ticket-text) "- [ ]" "- [X]"))))
  (is (nil? (intent/requirements-text "## Summary\n\ntext only\n")))
  (is (nil? (intent/requirements-text "## Summary\n\n## Acceptance Criteria\n- [ ] a\n")))
  (is (nil? (intent/requirements-text 42))))

(let [{:keys [fail error]} (run-tests 'autonomy-intent-test)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
