#!/usr/bin/env bb
(ns autonomy-control-test
  (:require [babashka.fs :as fs]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing run-tests]]))

(def root (-> (io/file *file*) .getParentFile .getParentFile .getParent))
(load-file (str root "/docker/codex-workspace/task-board/autonomy_control.bb"))
;; The libraries are .bb scripts loaded explicitly, not classpath libraries.
(in-ns 'autonomy-control-test)
(alias 'control 'autonomy-control)
(alias 'policy 'autonomy-policy)

(def fixture-dir (str root "/tests/codex-workspace/fixtures/autonomy/"))
(defn fixture [name] (read-string (slurp (str fixture-dir name ".edn"))))
(def control-fixture (fixture "control"))
(def decision-fixture (fixture "decision"))
(def now "2026-09-30T10:00:00Z")
(def ticket "BOXP-203")

;; Synthetic identities. The store resolves the actor from these registrations;
;; nothing a caller writes into a request or the vault can change the role.
(def owner "synthetic-owner-credential")
(def runner "synthetic-runner-credential")
(def agent "synthetic-agent-credential")
(def principals {owner {:subject "synthetic-owner-subject" :role :owner}
                 runner {:subject "synthetic-runner-subject" :role :runner}
                 agent {:subject "synthetic-agent-subject" :role :agent}})

(defn new-store []
  (control/init-store!
   (control/open-store {:dir (str (fs/create-temp-dir {:prefix "autonomy-control-"}))
                        :principals principals
                        :allowed-repos ["boxp/arch"]
                        :allowed-paths ["docs/project_docs/BOXP-203/"]
                        :now (constantly now)})))

(def issue-request
  {:op :issue-control
   :ticket ticket
   :objective-id "BOXP-203-validator"
   :requirements (get-in control-fixture [:objective :requirements])
   :intent "run"
   :agent_route "codex"
   :scope (:scope control-fixture)
   :budget {:max_steps 3 :max_wall_minutes 60}})

(defn category [result] (get-in result [:diagnostic :category]))
(defn ok? [result] (true? (:ok? result)))
(defn rejected? [expected result]
  (and (false? (:ok? result))
       (= expected (category result))
       (= #{:ok? :diagnostic} (set (keys result)))
       (= #{:category :code} (set (keys (:diagnostic result))))))

(defn issued-store
  "A store with writer generation 1 and one control at revision 1."
  []
  (let [store (new-store)]
    (assert (ok? (control/request! store owner {:op :issue-writer-generation
                                                :expected-generation 0})))
    (assert (ok? (control/request! store owner issue-request)))
    store))

(defn revision [store]
  (:revision (control/read-control store owner ticket)))

(deftest writer-generation-is-owner-issued-and-monotonic
  (let [store (new-store)]
    (is (rejected? :stale-generation (control/request! store owner issue-request))
        "no control before a writer generation exists")
    (doseq [credential [runner agent]]
      (is (rejected? :forbidden
                     (control/request! store credential {:op :issue-writer-generation
                                                         :expected-generation 0}))))
    (is (rejected? :unauthenticated
                   (control/request! store "unregistered" {:op :issue-writer-generation
                                                           :expected-generation 0})))
    (is (= 1 (:generation (control/request! store owner {:op :issue-writer-generation
                                                         :expected-generation 0}))))
    (is (rejected? :conflict
                   (control/request! store owner {:op :issue-writer-generation
                                                  :expected-generation 0}))
        "a replayed issue cannot skip or repeat a generation")
    (is (= 2 (:generation (control/request! store owner {:op :issue-writer-generation
                                                         :expected-generation 1}))))
    (is (ok? (control/verify-writer store runner {:generation 2})))
    (is (rejected? :stale-generation (control/verify-writer store runner {:generation 1})))
    (is (rejected? :forbidden (control/verify-writer store agent {:generation 2})))
    (is (rejected? :rollback-detected
                   (control/verify-writer store runner {:generation 2 :min-generation 3})))))

(deftest only-the-owner-issues-controls
  (let [store (issued-store)
        original (control/read-control store runner ticket)]
    (is (ok? original))
    (is (= 1 (:revision original)))
    (is (= 1 (get-in original [:control :writer_generation])))
    (is (= (policy/sha256 (:requirements issue-request))
           (get-in original [:control :objective :requirements_sha256])))
    (is (rejected? :conflict (control/request! store owner issue-request)))
    (doseq [credential [runner agent]]
      (is (rejected? :forbidden
                     (control/request! store credential (assoc issue-request :ticket "BOXP-204")))))
    (is (rejected? :unauthenticated
                   (control/request! store nil (assoc issue-request :ticket "BOXP-204"))))
    (testing "callers cannot choose revision, generation or digest, or leave the bounds"
      (doseq [request [(assoc issue-request :ticket "BOXP-204" :revision 9)
                       (assoc issue-request :ticket "BOXP-204" :writer_generation 9)
                       (assoc issue-request :ticket "BOXP-204" :requirements_sha256 "0")
                       (assoc-in (assoc issue-request :ticket "BOXP-204")
                                 [:scope :paths] ["terraform/"])
                       (assoc-in (assoc issue-request :ticket "BOXP-204")
                                 [:scope :operations] ["read" "apply"])
                       (assoc issue-request :ticket "BOXP-204" :agent_route "fable")
                       (assoc issue-request :ticket "../BOXP-204")]]
        (is (rejected? :invalid-request (control/request! store owner request)))))
    (is (rejected? :not-found (control/read-control store runner "BOXP-204")))))

(deftest non-owner-actors-cannot-widen-control
  (let [store (issued-store)
        widen [{:scope (update (:scope control-fixture) :operations conj "commit")}
               {:agent_route "codex-sol"}
               {:budget {:max_steps 6 :max_wall_minutes 60}}
               {:requirements "Implement something else entirely."}
               {:intent "run"}
               {:new-budget-epoch true}]]
    (doseq [change widen
            credential [runner agent]]
      (is (rejected? :forbidden
                     (control/request! store credential
                                       (merge {:op :update-control :ticket ticket
                                               :expected-revision 1}
                                              change)))))
    (is (rejected? :unauthenticated
                   (control/request! store "synthetic-owner-subject"
                                     {:op :update-control :ticket ticket
                                      :expected-revision 1 :intent "pause"}))
        "a subject name is not a credential")
    (is (= 1 (revision store)) "rejected requests leave the revision untouched")
    (is (= 2 (:revision (control/request! store owner
                                          {:op :update-control :ticket ticket
                                           :expected-revision 1
                                           :scope (update (:scope control-fixture)
                                                          :operations conj "commit")}))))
    (is (rejected? :conflict
                   (control/request! store owner {:op :update-control :ticket ticket
                                                  :expected-revision 1 :intent "pause"}))
        "a stale owner request cannot overwrite a newer revision")
    (is (rejected? :invalid-request
                   (control/request! store owner {:op :update-control :ticket ticket
                                                  :expected-revision 2})))
    (is (rejected? :invalid-request
                   (control/request! store owner {:op :update-control :ticket ticket
                                                  :expected-revision 2 :revision 7})))))

(deftest revision-cas-admits-one-concurrent-writer
  (let [store (issued-store)
        results (->> (range 8)
                     (mapv (fn [_]
                             (future (control/request! store owner
                                                       {:op :update-control :ticket ticket
                                                        :expected-revision 1
                                                        :intent "pause"}))))
                     (mapv deref))]
    (is (= 1 (count (filter ok? results))))
    (is (= 7 (count (filter #(rejected? :conflict %) results))))
    (is (= 2 (revision store)))))

(deftest runner-may-only-tighten-intent
  (let [store (issued-store)
        restrict (fn [credential request]
                   (control/request! store credential
                                     (merge {:op :restrict-intent :ticket ticket} request)))]
    (is (rejected? :forbidden (restrict agent {:expected-revision 1 :writer-generation 1
                                               :intent "pause"})))
    (is (rejected? :forbidden (restrict runner {:expected-revision 1 :writer-generation 1
                                                :intent "run"})))
    (is (rejected? :stale-generation (restrict runner {:expected-revision 1
                                                       :writer-generation 0
                                                       :intent "pause"})))
    (is (= 2 (:revision (restrict runner {:expected-revision 1 :writer-generation 1
                                          :intent "pause"}))))
    (is (rejected? :conflict (restrict runner {:expected-revision 1 :writer-generation 1
                                               :intent "wait-human"}))
        "an older run cannot overwrite the newer stop")
    (is (rejected? :forbidden (restrict runner {:expected-revision 2 :writer-generation 1
                                                :intent "run"}))
        "the runner cannot lift a stop")
    (is (= 3 (:revision (control/request! store owner {:op :update-control :ticket ticket
                                                       :expected-revision 2
                                                       :intent "cancel"}))))
    (is (rejected? :forbidden (restrict runner {:expected-revision 3 :writer-generation 1
                                                :intent "pause"}))
        "an owner cancel stays until the owner changes it")
    (is (= "cancel" (get-in (control/read-control store runner ticket) [:control :intent])))))

(deftest new-objective-version-invalidates-pinned-decisions
  (let [store (issued-store)
        context {:now now
                 :allowed-repos ["boxp/arch"]
                 :allowed-paths ["docs/project_docs/BOXP-203/"]}
        before (:control (control/read-control store runner ticket))]
    (is (true? (:valid? (policy/validate-decision decision-fixture
                                                   (assoc context :control before)))))
    (is (control/objective-matches? before (:requirements issue-request)))
    (is (not (control/objective-matches? before (str (:requirements issue-request) " And deploy."))))
    (is (= 2 (:revision (control/request! store owner
                                          {:op :update-control :ticket ticket
                                           :expected-revision 1
                                           :requirements "Implement the bounded validator only."}))))
    (let [after (:control (control/read-control store runner ticket))]
      (is (= 2 (get-in after [:objective :ticket_version])))
      (is (= (policy/sha256 "Implement the bounded validator only.")
             (get-in after [:objective :requirements_sha256])))
      (is (not (control/objective-matches? after (:requirements issue-request))))
      (is (false? (:valid? (policy/validate-decision decision-fixture
                                                      (assoc context :control after))))
          "a decision pinned to the old revision no longer validates"))
    (testing "restating identical requirements is not a new ticket version"
      (is (= 3 (:revision (control/request! store owner
                                            {:op :update-control :ticket ticket
                                             :expected-revision 2
                                             :requirements "Implement the bounded validator only."
                                             :intent "pause"}))))
      (is (= 2 (get-in (control/read-control store runner ticket)
                       [:control :objective :ticket_version]))))))

(deftest budget-accumulates-per-epoch-not-per-revision
  (let [store (issued-store)
        consume (fn [credential request]
                  (control/request! store credential
                                    (merge {:op :consume-budget :ticket ticket
                                            :writer-generation 1 :wall_minutes 0 :steps 0}
                                           request)))
        consumed #(:consumed (control/read-control store runner ticket))]
    (is (rejected? :forbidden (consume agent {:idempotency-key "run-1/step-1" :steps 1
                                              :expected-revision 1})))
    (is (ok? (consume runner {:idempotency-key "run-1/step-1" :steps 1 :wall_minutes 10
                              :expected-revision 1})))
    (is (true? (:duplicate? (consume runner {:idempotency-key "run-1/step-1" :steps 1
                                             :wall_minutes 10 :expected-revision 1}))))
    (is (= {:steps 1 :wall_minutes 10} (consumed)) "a duplicate event is counted once")
    (is (rejected? :conflict (consume runner {:idempotency-key "run-1/step-2" :steps 1
                                              :expected-revision 7})))
    (is (rejected? :stale-generation
                   (control/request! store runner {:op :consume-budget :ticket ticket
                                                   :writer-generation 0
                                                   :idempotency-key "run-0/step-1"
                                                   :steps 1 :wall_minutes 0
                                                   :expected-revision 1})))
    (testing "a revision bump does not reset consumption"
      (is (ok? (control/request! store runner {:op :restrict-intent :ticket ticket
                                               :expected-revision 1 :writer-generation 1
                                               :intent "pause"})))
      (is (rejected? :forbidden (consume runner {:idempotency-key "run-1/step-2" :steps 1
                                                 :expected-revision 2}))
          "no new step while paused")
      (is (ok? (consume runner {:idempotency-key "run-1/step-1-wall" :wall_minutes 5}))
          "elapsed time of a started step is still recorded")
      (is (ok? (control/request! store owner {:op :update-control :ticket ticket
                                              :expected-revision 2 :intent "run"})))
      (is (= {:steps 1 :wall_minutes 15} (consumed)))
      (is (= 1 (:budget-epoch (control/read-control store runner ticket)))))
    (testing "the cap holds across runs"
      (is (ok? (consume runner {:idempotency-key "run-2/step-1" :steps 2 :expected-revision 3})))
      (is (rejected? :budget-exceeded (consume runner {:idempotency-key "run-3/step-1" :steps 1
                                                       :expected-revision 3})))
      (is (= {:steps 3 :wall_minutes 15} (consumed))))
    (testing "only an explicit owner epoch resets consumption"
      (is (ok? (control/request! store owner {:op :update-control :ticket ticket
                                              :expected-revision 3 :new-budget-epoch true})))
      (is (= {:steps 0 :wall_minutes 0} (consumed)))
      (is (= 2 (:budget-epoch (control/read-control store runner ticket))))
      (is (true? (:duplicate? (consume runner {:idempotency-key "run-2/step-1" :steps 2
                                               :expected-revision 4})))
          "keys from the previous epoch cannot be replayed into the new one")
      (is (ok? (consume runner {:idempotency-key "run-4/step-1" :steps 1 :wall_minutes 60
                                :expected-revision 4})))
      (is (rejected? :budget-exceeded (consume runner {:idempotency-key "run-4/step-2" :steps 1
                                                       :expected-revision 4}))
          "exhausted wall budget blocks further steps"))))

(deftest writes-are-fenced-by-generation-and-revision
  (let [store (issued-store)
        authorize #(control/authorize-write store runner %)]
    (is (ok? (authorize {:ticket ticket :expected-revision 1 :writer-generation 1})))
    (is (rejected? :forbidden
                   (control/authorize-write store agent {:ticket ticket :expected-revision 1
                                                         :writer-generation 1})))
    (is (rejected? :conflict (authorize {:ticket ticket :expected-revision 2
                                         :writer-generation 1})))
    (is (rejected? :not-found (authorize {:ticket "BOXP-204" :expected-revision 1
                                          :writer-generation 1})))
    (is (rejected? :rollback-detected (authorize {:ticket ticket :expected-revision 1
                                                  :writer-generation 1 :min-revision 2})))
    (is (ok? (control/request! store owner {:op :issue-writer-generation
                                            :expected-generation 1})))
    (is (rejected? :stale-generation (authorize {:ticket ticket :expected-revision 1
                                                 :writer-generation 1}))
        "the old generation is fenced")
    (is (rejected? :stale-generation (authorize {:ticket ticket :expected-revision 1
                                                 :writer-generation 2}))
        "a control issued under the old generation needs an owner re-issue")
    (is (rejected? :stale-generation
                   (control/request! store runner {:op :restrict-intent :ticket ticket
                                                   :expected-revision 1 :writer-generation 1
                                                   :intent "pause"})))
    (is (ok? (control/request! store owner {:op :update-control :ticket ticket
                                            :expected-revision 1 :intent "run"})))
    (is (ok? (authorize {:ticket ticket :expected-revision 2 :writer-generation 2})))))

(deftest unavailable-or-damaged-original-fails-closed
  (let [store (issued-store)
        path (str (fs/path (:dir store) control/events-file-name))
        lines (str/split-lines (slurp path))]
    (is (ok? (control/request! store owner {:op :update-control :ticket ticket
                                            :expected-revision 1 :intent "pause"})))
    (testing "a truncated but well-formed log is a rollback for a client that saw more"
      (let [full (slurp path)]
        (spit path (str (str/join "\n" lines) "\n"))
        (is (= 1 (revision store)))
        (is (rejected? :rollback-detected
                       (control/read-control store runner ticket {:min-revision 2})))
        (is (rejected? :rollback-detected
                       (control/authorize-write store runner {:ticket ticket
                                                              :expected-revision 1
                                                              :writer-generation 1
                                                              :min-revision 2})))
        (spit path full)
        (is (= 2 (revision store)))))
    (testing "edited, reordered or unparsable events are unavailable"
      (let [full (slurp path)
            all (str/split-lines full)]
        (doseq [damaged [(str/replace full "\"pause\"" "\"run\"")
                         (str (str/join "\n" (reverse all)) "\n")
                         (str (first all) "\n" (last all) "\n")
                         (str full "not an event\n")]]
          (spit path damaged)
          (is (rejected? :unavailable (control/read-control store runner ticket)))
          (is (rejected? :unavailable (control/verify-writer store runner {:generation 1})))
          (is (rejected? :unavailable
                         (control/request! store owner {:op :update-control :ticket ticket
                                                        :expected-revision 2 :intent "run"}))))
        (spit path full)))
    (testing "a missing original is unavailable, not an empty one"
      (fs/delete path)
      (is (rejected? :unavailable (control/read-control store runner ticket)))
      (is (rejected? :unavailable
                     (control/request! store owner {:op :issue-writer-generation
                                                    :expected-generation 0})))
      (fs/delete-tree (:dir store))
      (is (rejected? :unavailable (control/read-control store runner ticket)))
      (is (rejected? :unavailable (control/authorize-write store runner
                                                           {:ticket ticket
                                                            :expected-revision 2
                                                            :writer-generation 1}))))))

(deftest projections-never-grant
  (let [store (issued-store)
        original (:control (control/read-control store runner ticket))
        projection {"autonomy_version" "2" "execution_intent" "run" "control_revision" "1"}]
    (is (ok? (control/verify-projection original projection)))
    (doseq [forged [(assoc projection "control_revision" "2")
                    (assoc projection "execution_intent" "pause")
                    (dissoc projection "autonomy_version")
                    {}]]
      (is (rejected? :conflict (control/verify-projection original forged))))
    (is (ok? (control/request! store runner {:op :restrict-intent :ticket ticket
                                             :expected-revision 1 :writer-generation 1
                                             :intent "pause"})))
    (is (rejected? :conflict
                   (control/verify-projection
                    (:control (control/read-control store runner ticket)) projection))
        "a stale run projection does not match the paused original")))

(deftest events-are-attributable-and-results-are-redacted
  (let [store (issued-store)
        secret "SYNTHETIC_SECRET_REQUIREMENT"]
    (is (ok? (control/request! store owner {:op :update-control :ticket ticket
                                            :expected-revision 1 :requirements secret})))
    (is (ok? (control/request! store runner {:op :restrict-intent :ticket ticket
                                             :expected-revision 2 :writer-generation 1
                                             :intent "wait-human"})))
    (let [events (:events (control/events store runner))]
      (is (= [1 2 3 4] (mapv :seq events)))
      (is (= [:issue-writer-generation :issue-control :update-control :restrict-intent]
             (mapv :op events)))
      (is (= ["synthetic-owner-subject" "synthetic-runner-subject"]
             (mapv :actor-subject (take-last 2 events))))
      (is (= [[1 2] [2 3]]
             (mapv (juxt :previous-revision :revision) (take-last 2 events)))))
    (is (not (str/includes? (pr-str (control/events store owner)) secret))
        "the audit view carries attribution, never the requirements snapshot")
    (is (not-any? :entry (:events (control/events store runner))))
    (is (rejected? :forbidden (control/events store agent)))
    (let [output (java.io.StringWriter.)
          results (binding [*out* output *err* output]
                    [(control/request! store agent {:op :update-control :ticket ticket
                                                    :expected-revision 3 :requirements secret})
                     (control/request! store owner {:op :update-control :ticket ticket
                                                    :expected-revision 1 :requirements secret})
                     (control/request! store owner {:op :update-control :ticket ticket
                                                    :expected-revision 3 :requirements secret
                                                    :scope {:repos ["other/repo"]
                                                            :paths [secret]
                                                            :operations ["read"]}})
                     (control/request! store "SYNTHETIC_SECRET_CREDENTIAL"
                                       {:op :update-control :ticket ticket
                                        :expected-revision 3 :intent "run"})
                     (control/request! store owner {:op (keyword secret)})])]
      (is (every? #(false? (:ok? %)) results))
      (is (= "" (str output)))
      (is (not (str/includes? (pr-str results) "SYNTHETIC_SECRET"))))))

(let [{:keys [fail error]} (run-tests)]
  (when (pos? (+ fail error)) (System/exit 1)))
