#!/usr/bin/env bb
;; BOXP-588 offline replay (no model calls, read-only on the inputs).
;;
;;   bb replay.bb notes  <runner.bb> <ticket.md>...
;;       Applies the runner's trim-ticket-notes to each ticket file and checks
;;       that every protected Notes entry and every non-Notes section survives.
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
    "notes"
    (doseq [path args]
      (let [text (slurp path)
            limit (* 40 1024)
            {:keys [text trimmed? omitted-count omitted-bytes kept-protected] :as r}
            ((resolve 'user/trim-ticket-notes) text limit (str path))
            original (slurp path)
            notes-start (or (some-> (re-find #"(?m)^## Notes[ \t]*$" original) (#(str/index-of original %))) (count original))
            head (subs original 0 notes-start)
            entries (->> (str/split (subs original notes-start) #"(?m)(?=^- \d{4}-\d{2}-\d{2})")
                         (filter #(re-find #"^- \d{4}-\d{2}-\d{2}" %)))
            protected (filter #(re-find @(resolve 'user/notes-protected-pattern) %) entries)
            missing (remove #(str/includes? text (str/trimr %)) protected)
            newest (take-last 3 entries)
            missing-new (remove #(str/includes? text (str/trimr %)) newest)]
        (println (str (fs/file-name path)
                      "\toriginal_kb=" (quot (count (.getBytes original "UTF-8")) 1024)
                      "\tprompt_kb=" (quot (count (.getBytes text "UTF-8")) 1024)
                      "\ttrimmed=" trimmed?
                      "\tentries=" (count entries)
                      "\tomitted=" (or omitted-count 0)
                      "\tomitted_kb=" (quot (or omitted-bytes 0) 1024)
                      "\tprotected=" (count protected)
                      "\tprotected_missing=" (count missing)
                      "\tnewest3_missing=" (count missing-new)
                      "\thead_kept=" (str/starts-with? text head)
                      "\tmarker_has_path=" (or (not trimmed?) (str/includes? text (str "full text: " path)))))))

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
