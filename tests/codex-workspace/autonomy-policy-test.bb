#!/usr/bin/env bb
(ns autonomy-policy-test
  (:require [clojure.test :refer [deftest is testing run-tests]]
            [clojure.java.io :as io]))

(def root (-> (io/file *file*) .getParentFile .getParentFile .getParent))
(load-file (str root "/docker/codex-workspace/task-board/autonomy_policy.bb"))
(require '[autonomy-policy :as policy])

(def fixture-dir (str root "/tests/codex-workspace/fixtures/autonomy/"))
(defn fixture [name] (read-string (slurp (str fixture-dir name ".edn"))))
(def control (fixture "control"))
(def decision (fixture "decision"))
(def retry-contract (fixture "retry"))
(def notification (fixture "notification"))
(def context {:now "2026-09-30T10:00:00Z"
              :allowed-repos ["boxp/arch"]
              :allowed-paths ["docs/project_docs/BOXP-203/"]})
(def decision-context (assoc context :control control))
(defn valid? [result] (true? (:valid? result)))
(defn invalid? [result] (false? (:valid? result)))
(defn assert-safe-result [result]
  (is (= #{:valid? :diagnostic} (set (keys result))))
  (is (= #{:category :code}
         (set (keys (:diagnostic result))))))

(deftest valid-issued-fixtures
  (doseq [result [(policy/validate-control control context)
                  (policy/validate-decision decision decision-context)
                  (policy/validate-retry retry-contract decision-context)
                  (policy/validate-notification notification context)]]
    (is (valid? result))
    (assert-safe-result result)
    (is (= :ok (get-in result [:diagnostic :category])))
    (is (= "ok" (get-in result [:diagnostic :code]))))
  (is (= 64 (count (policy/sha256 "synthetic"))))
  (is (= (policy/scope-digest (:scope control))
         (policy/scope-digest (into (array-map) (reverse (:scope control)))))))

(deftest every-required-field-is-enforced
  (testing "control"
    (doseq [field (keys control)]
      (is (invalid? (policy/validate-control (dissoc control field) context))
          (str "missing control field " field)))
    (doseq [field (keys (:objective control))]
      (is (invalid? (policy/validate-control
                      (update control :objective dissoc field) context))
          (str "missing objective field " field)))
    (doseq [field (keys (:scope control))]
      (is (invalid? (policy/validate-control
                      (update control :scope dissoc field) context))
          (str "missing scope field " field)))
    (doseq [field (keys (:budget control))]
      (is (invalid? (policy/validate-control
                      (update control :budget dissoc field) context))
          (str "missing budget field " field))))
  (testing "decision, retry, and notification"
    (doseq [[schema validator ctx] [[decision policy/validate-decision decision-context]
                                    [retry-contract policy/validate-retry decision-context]
                                    [notification policy/validate-notification context]]
            field (keys schema)]
      (is (invalid? (validator (dissoc schema field) ctx))
          (str "missing field " field " from " (keys schema))))
    (doseq [field (keys (:retry_condition retry-contract))]
      (is (invalid? (policy/validate-retry
                      (update retry-contract :retry_condition dissoc field) decision-context))
          (str "missing retry-condition field " field)))
    (doseq [field (keys (:wip notification))]
      (is (invalid? (policy/validate-notification
                      (update notification :wip dissoc field) context))
          (str "missing WIP field " field)))
    (doseq [field (keys (:budget notification))]
      (is (invalid? (policy/validate-notification
                      (update notification :budget dissoc field) context))
          (str "missing policy-budget field " field)))
    (doseq [field (keys (:notifications notification))]
      (is (invalid? (policy/validate-notification
                      (update notification :notifications dissoc field) context))
          (str "missing notification field " field)))
    (doseq [field (keys (first (:options decision)))]
      (is (invalid? (policy/validate-decision
                      (update decision :options
                              #(assoc % 0 (dissoc (first %) field))) decision-context))
          (str "missing decision-option field " field)))))

(deftest version-route-and-probe-fail-closed
  (is (invalid? (policy/validate-control (assoc control :schema_version 99) context)))
  (is (invalid? (policy/validate-decision (assoc decision :schema_version 2) decision-context)))
  (is (invalid? (policy/validate-retry (assoc retry-contract :schema_version 2) decision-context)))
  (is (invalid? (policy/validate-notification (assoc notification :schema_version 2) context)))
  (is (invalid? (policy/validate-control (assoc control :agent_route "unknown-agent") context)))
  (is (invalid? (policy/validate-control (assoc control :agent_route "fable") context)))
  (is (valid? (policy/validate-control (assoc control :agent_route "codex-sol-high") context)))
  (is (invalid? (policy/validate-retry
                  (assoc-in retry-contract [:retry_condition :probe] "shell-command")
                  decision-context))))

(deftest scope-objective-and-operation-boundaries
  (is (invalid? (policy/validate-control (assoc control :unexpected "field") context)))
  (is (invalid? (policy/validate-control
                  (assoc control :ticket "BOXP-203" "ticket" "BOXP-999") context)))
  (is (invalid? (policy/validate-control
                  (assoc control :private/ticket "BOXP-999") context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:scope :repos] (list "boxp/arch")) context)))
  (is (invalid? (policy/validate-control
                  (assoc control "ticket" "BOXP-999") context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:scope :paths] ["../../etc/"]) context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:scope :paths] ["docs/private/"]) context)))
  (doseq [unsafe-path ["docs/project_docs/BOXP-203/*.md"
                       "/docs/project_docs/BOXP-203/file.md"
                       "docs/project_docs/BOXP-203-sibling/file.md"
                       "docs/project_docs/BOXP-203/..\\private"
                       "docs/project_docs/BOXP-203/file?secret=1"
                       "docs/project_docs/BOXP-203/%2e%2e/private/"
                       "docs/project_docs/BOXP-203/../BOXP-203/"
                       (str "docs/project_docs/BOXP-203/" (char 0) "secret")]]
    (is (invalid? (policy/validate-control
                    (assoc-in control [:scope :paths] [unsafe-path]) context))
        (str "unsafe path accepted: " (pr-str unsafe-path))))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:scope :repos] ["attacker/repo"]) context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:scope :operations] ["read" "deploy"]) context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:scope :operations] ["read" "delete"]) context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:budget :max_steps] 7) context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:budget :max_wall_minutes] 61) context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:objective :requirements] "Changed objective") context)))
  (is (invalid? (policy/validate-control
                  (assoc-in control [:objective :requirements_sha256] (apply str (repeat 64 "0")))
                  context)))
  (is (invalid? (policy/validate-control (assoc control :intent "resume") context))))

(deftest invalid-validation-is-silent
  (is (= "" (with-out-str (policy/validate-control
                             (assoc control :schema_version 99) context))))
  (is (= "" (with-out-str (policy/validate-decision
                             (assoc decision :issuance "template") decision-context))))
  (is (= "" (with-out-str (policy/validate-retry
                             (assoc retry-contract :category "invalid") decision-context))))
  (is (= "" (with-out-str (policy/validate-notification
                             (assoc notification :schema_version 99) context)))))

(deftest decision-issuance-expiration-placeholders-and-control-binding
  (is (invalid? (policy/validate-decision (assoc decision :issuance "template") decision-context)))
  (is (invalid? (policy/validate-decision
                  (assoc decision :artifact_head "<review-target>") decision-context)))
  (is (invalid? (policy/validate-decision
                  (assoc decision :expires_at "<seven-days-later>") decision-context)))
  (is (invalid? (policy/validate-decision
                  (assoc decision :expires_at "2026-09-30T09:59:59Z") decision-context)))
  (is (invalid? (policy/validate-decision
                  (assoc decision :ticket "BOXP-999") decision-context)))
  (is (invalid? (policy/validate-decision
                  decision (assoc decision-context :artifact-head
                                  "ffffffffffffffffffffffffffffffffffffffff")))
      "a packet bound to an old artifact head is rejected")
  (is (invalid? (policy/validate-decision
                  (assoc decision :control_revision 2) decision-context)))
  (is (invalid? (policy/validate-decision
                  decision (assoc decision-context :control
                                  (assoc-in control [:scope :operations] ["read" "test"])))))
  (is (invalid? (policy/validate-decision
                  (assoc decision :status "approved") decision-context)))
  (is (invalid? (policy/validate-decision
                  (assoc decision :artifact_head (apply str (repeat 40 "0"))) decision-context)))
  (is (invalid? (policy/validate-decision
                  (assoc decision :options [(first (:options decision))
                                            (first (:options decision))]) decision-context))))

(deftest retry-contract-expiration-and-control-binding
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :ticket "BOXP-999") decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :control_revision 2) decision-context)))
  (is (invalid? (policy/validate-retry
                  retry-contract (assoc decision-context :artifact-head
                                        "ffffffffffffffffffffffffffffffffffffffff")))
      "a retry bound to an old artifact head is rejected")
  (is (invalid? (policy/validate-retry
                  retry-contract (assoc decision-context :control
                                        (assoc control :revision 2)))))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :deadline "2026-09-30T09:59:00Z") decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :max_attempts 4) decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :reason "") decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :deadline "2026-10-02T10:00:01Z") decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc-in retry-contract [:retry_condition :resource_ref] "other/repo#203")
                  decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :category "auth") decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :resume_action "inspect-agent") decision-context)))
  (is (invalid? (policy/validate-retry
                  (assoc retry-contract :next_check "2026-10-01T10:00:01Z") decision-context)))
  (is (valid? (policy/validate-retry
                (assoc retry-contract :next_check "2026-09-30T09:00:00Z") decision-context))))

(deftest notification-bounds-and-exact-shape
  (is (invalid? (policy/validate-notification
                  (assoc-in notification [:wip :global] 3) context)))
  (is (invalid? (policy/validate-notification
                  (assoc-in notification [:wip :per_repo] 2) context)))
  (is (invalid? (policy/validate-notification
                  (assoc-in notification [:budget :max_steps] 7) context)))
  (is (invalid? (policy/validate-notification
                  (assoc-in notification [:notifications :max_reminders] 2) context))))

(deftest public-diagnostic-is-allowlisted
  (let [sentinels ["SYNTHETIC_SECRET_SENTINEL_9281"
                   "https://private.example.invalid/path?token=PRIVATE_URL_SENTINEL"
                   "EXCEPTION_BODY_SENTINEL"]
        diagnostic (policy/public-diagnostic
                           :secret-detected
                           {:ticket "BOXP-203"
                            :repo "boxp/arch"
                            :artifact_ref (first sentinels)
                            :secret (first sentinels)
                            :url (second sentinels)
                            :exception (last sentinels)})
        rendered (pr-str diagnostic)]
    (doseq [sentinel sentinels]
      (is (not (.contains rendered sentinel))))
    (is (not (.contains rendered "private.example.invalid")))
    (is (not (.contains rendered "token=")))
    (is (= :invalid-schema (:category diagnostic)))
    (is (= #{:category :code}
           (set (keys (policy/public-diagnostic :invalid-schema
                                                 {:exception (last sentinels)})))))
    (is (nil? (:artifact_ref (policy/public-diagnostic
                               :invalid-schema
                               {:artifact_ref (second sentinels)}))))))

(deftest caught-exceptions-cannot-publish-secret-data
  (doseq [exception [(Exception. "SYNTHETIC_SECRET_EXCEPTION https://private.invalid")
                     (ex-info "SYNTHETIC_SECRET_EXCEPTION"
                              {:category :SYNTHETIC_SECRET_CATEGORY})]]
    (let [output (java.io.StringWriter.)
          result (binding [*out* output *err* output]
                   (with-redefs [policy/sha256 (fn [_] (throw exception))]
                     (policy/validate-control control context)))]
      (is (invalid? result))
      (assert-safe-result result)
      (is (= "" (str output)))
      (is (not (.contains (pr-str result) "SYNTHETIC_SECRET")))
      (is (not (.contains (pr-str result) "private.invalid"))))))

(let [{:keys [fail error]} (run-tests)]
  (when (pos? (+ fail error)) (System/exit 1)))
