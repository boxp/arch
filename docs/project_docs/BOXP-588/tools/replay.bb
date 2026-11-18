#!/usr/bin/env bb
;; BOXP-588 offline replay (no model calls, read-only on the inputs).
;;
;;   bb replay.bb streak <runner.bb> <runs-root> <TICKET>...
;;       Replays the recorded review gates of past runs (summary.edn and the
;;       blocking artifacts) through record-same-file-review-streak! in a
;;       temporary state root, and lists where the escalation prompt would
;;       have been added to the following run.
(require '[babashka.fs :as fs]
         '[clojure.edn :as edn]
         '[clojure.string :as str])

(let [[cmd runner & args] *command-line-args*]
  (System/setProperty "babashka.file" "/tmp/load-runner.bb")
  (load-file runner)
  (case cmd
    "streak"
    (let [[runs-root & tickets] args
          tmp (str (fs/create-temp-dir {:prefix "boxp588-replay"}))]
      (do (alter-var-root (resolve (quote user/root)) (constantly (fn [] (fs/path tmp))))
        (doseq [ticket tickets
                run-dir (sort (map str (fs/list-dir (fs/path runs-root ticket))))
                :let [summary (try (edn/read-string (slurp (str (fs/path run-dir "summary.edn")))) (catch Exception _ nil))
                      gate (:review-gate summary)
                      run-id (str (fs/file-name run-dir))
                      blocking-path (get-in gate [:blocking-findings :path])
                      blocking-path (when blocking-path
                                      (let [p (fs/path run-dir (fs/file-name blocking-path))]
                                        (when (fs/exists? p) (str p))))
                      findings (when blocking-path
                                 (filter #(#{"P0" "P1"} (:severity %))
                                         ((resolve 'user/codex-review-findings) (slurp blocking-path))))
                      gate-result (when gate
                                    (cond-> (select-keys gate [:ok? :gate :url :checked-pr-urls :merged-pr-urls])
                                      (seq findings) (assoc :failure-kind :findings
                                                            :blocking-files (vec (distinct (map #((resolve 'user/review-finding-file) (:location %)) findings))))))]
                :when gate-result]
          ((resolve 'user/record-same-file-review-streak!) ticket run-id gate-result)
          (when-let [p ((resolve 'user/same-file-review-escalation-prompt) ticket)]
            (println (str ticket "\t" run-id "\tescalation-after-this-run\t"
                          (str/join " ; " (map str/trim (filter #(str/starts-with? % "- ") (str/split-lines p))))))))
        (println "history:" (str (fs/path tmp "same-file-review-history.jsonl")))))))
