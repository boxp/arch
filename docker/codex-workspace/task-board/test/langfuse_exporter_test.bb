#!/usr/bin/env bb
(require '[clojure.test :refer [deftest is run-tests]] '[clojure.string :as str])
(load-file "docker/codex-workspace/task-board/langfuse_exporter.bb")

(deftest masks-secret-forms
  (doseq [secret [(str "sk-" "notarealsecret123")
                  (str "ghp_" "synthetic123456789")
                  (str "Bearer " "synthetic-token-123")
                  (str "password=" "synthetic-value")
                  (str "https://user:" "syntheticpass@example.test")
                  (str "AKIA" "1234567890ABCDEF")]]
    (is (not (str/includes? (:value (langfuse-exporter/redact secret [])) secret)))
    (is (false? (langfuse-exporter/guard-safe? secret []))))
  (let [secret (str "synthetic" "environmentvalue")]
    (is (= "[REDACTED:env]" (:value (langfuse-exporter/redact secret [secret]))))
    (is (false? (langfuse-exporter/guard-safe? secret [secret]))))
  (is (= (apply str (repeat 40 "a")) (:value (langfuse-exporter/redact (apply str (repeat 40 "a")) [])))))

(deftest structural-withholding
  (doseq [input ["cat /home/test/.ssh/id_rsa" "printenv" "gh auth token" "kubectl get secret"]]
    (is (langfuse-exporter/withhold-output? input)))
  (is (not (langfuse-exporter/withhold-output? "cat README.md"))))

(let [{:keys [fail error]} (run-tests)]
  (when (pos? (+ fail error)) (System/exit 1)))
