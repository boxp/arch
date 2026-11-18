#!/usr/bin/env bb
;; BOXP-588 (3): consecutive P0/P1 codex review findings on the same file of the same PR.
(require '[clojure.test :refer [deftest is testing run-tests]] '[clojure.string :as str] '[babashka.fs :as fs] '[cheshire.core :as json])
(System/setProperty "babashka.file" "/tmp/load-runner.bb")
(load-file "docker/codex-workspace/task-board/task_board_runner.bb")

(deftest finding-files
  (doseq [[location expected] [["src/a.bb:12" "src/a.bb"] ["./src/a.bb:12-20" "src/a.bb"] ["b/src/a.py:3:4 some text" "src/a.py"] ["src/a.py#L10" "src/a.py"] ["src/a.py#L10-L12 note" "src/a.py"] ["area text" "area text"]
                               ["docs/Recurring Events/a b.md:3" "docs/Recurring Events/a b.md"] ["docs/Recurring Events/c.md:7 note" "docs/Recurring Events/c.md"]
                               ["docs/Recurring Events/a b.md" "docs/Recurring Events/a b.md"] ["docs/Recurring Events/c.md" "docs/Recurring Events/c.md"]]]
    (is (= expected (review-finding-file location)))))
(deftest threshold-setting
  (with-redefs [env (fn [_ default] default)] (is (= 3 (same-file-review-threshold))))
  (doseq [value ["0" "-1" "bad" "999999999999999999999"]]
    (with-redefs [env (fn [_ _] value)] (is (nil? (same-file-review-threshold))))))
(deftest ticket-contents-are-not-trimmed
  ;; This change adds an instruction only; the ticket text in the prompt stays the full text.
  (let [src (slurp "docker/codex-workspace/task-board/task_board_runner.bb")]
    (is (str/includes? src "\"Ticket contents:\\n\\n\" ticket-text \"\\n\\n\")"))))
(deftest streaks
  (let [dir (fs/create-temp-dir) url "https://github.com/Boxp/Repo/pull/12" gate {:gate :codex-review :failure-kind :findings :url url :blocking-files ["src/a.bb"]}]
    (try
      (with-redefs [root (fn [] dir)]
        (doseq [run ["1" "2"]] (record-same-file-review-streak! "BOXP-1" run gate))
        (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
        (testing "re-processing the same run does not count twice"
          (record-same-file-review-streak! "BOXP-1" "2" gate)
          (is (= 2 (get-in (read-same-file-review-streaks) [:streaks "BOXP-1" "boxp/repo#12" "src/a.bb" :count])))
          (is (nil? (same-file-review-escalation-prompt "BOXP-1"))))
        (record-same-file-review-streak! "BOXP-1" "3" gate)
        (is (str/includes? (same-file-review-escalation-prompt "BOXP-1") "src/a.bb: 3 consecutive"))
        (is (nil? (same-file-review-escalation-prompt "BOXP-2")))
        (testing "other gate failures neither count nor reset"
          (record-same-file-review-streak! "BOXP-1" "ci" {:gate :ci})
          (is (str/includes? (same-file-review-escalation-prompt "BOXP-1") "3 consecutive")))
        (testing "a streak that was not updated for 7 days is ignored"
          (let [state (read-same-file-review-streaks)]
            (write-same-file-review-streaks! (assoc-in state [:streaks "BOXP-1" "boxp/repo#12" "src/a.bb" :updated-at] (str (.minus (java.time.Instant/now) (java.time.Duration/ofDays 8)))))
            (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
            (write-same-file-review-streaks! (assoc-in state [:streaks "BOXP-1" "boxp/repo#12" "src/a.bb" :updated-at] "not a time"))
            (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
            (write-same-file-review-streaks! state)
            (is (some? (same-file-review-escalation-prompt "BOXP-1")))))
        (testing "findings on another file only end the streak"
          (record-same-file-review-streak! "BOXP-1" "4" (assoc gate :blocking-files ["other"]))
          (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
          (is (nil? (get-in (read-same-file-review-streaks) [:streaks "BOXP-1" "boxp/repo#12" "src/a.bb"]))))
        (testing "threshold 0 disables the instruction but keeps recording"
          (with-redefs [env (fn [_ _] "0")]
            (record-same-file-review-streak! "BOXP-1" "5" gate)
            (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
            (is (= 1 (get-in (read-same-file-review-streaks) [:streaks "BOXP-1" "boxp/repo#12" "src/a.bb" :count])))))
        (testing "a passed review of the PR resets it"
          (record-same-file-review-streak! "BOXP-1" "6" {:checked-pr-urls [url]})
          (is (nil? (get-in (read-same-file-review-streaks) [:streaks "BOXP-1" "boxp/repo#12"]))))
        (let [events (map #(json/parse-string % true) (str/split-lines (slurp (str (fs/path dir "same-file-review-history.jsonl")))))]
          (is (= 6 (count (filter #(= "blocking" (:event %)) events))))
          (is (= 1 (count (filter #(= "reset" (:event %)) events)))))
        (testing "a corrupt streak file does not break prompt generation"
          (spit (str (fs/path dir "same-file-review-streaks.edn")) "{:streaks {")
          (is (nil? (same-file-review-escalation-prompt "BOXP-1")))))
      (finally (fs/delete-tree dir)))))
(let [result (run-tests 'user)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
