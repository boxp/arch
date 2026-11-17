#!/usr/bin/env bb
(require '[clojure.test :refer [deftest is testing run-tests]] '[clojure.string :as str] '[babashka.fs :as fs] '[cheshire.core :as json])
(System/setProperty "babashka.file" "/tmp/load-runner.bb")
(load-file "docker/codex-workspace/task-board/task_board_runner.bb")

(deftest notes-budget
  (let [prefix "---\nid: BOXP-1\n---\n## Summary\nsummary\n## Acceptance Criteria\ncriteria\n## Context\ncontext\n## Plan\nplan\n## Notes\n"
        suffix "## After\nafter\n"
        entries ["- 2020-01-01 old removable\n  continuation\n- 計算: attached\n"
                 "- 2020-01-02 [hermes-agent] keep\n"
                 "- 2020-01-03 [claude-opus] Owner原文『keep』\n"
                 "- 2020-01-04 reply_id keep\n"
                 "- 2020-01-05 家経由 keep\n"
                 "- 2020-01-06 停滞レビュー依頼 keep\n"
                 (str "- 2020-01-07 newest one " (apply str (repeat 3000 "あ")) "\n")
                 "- 2020-01-08 newest two\n"
                 "- 2020-01-09 newest three\n"]
        text (str prefix "preamble\n" (apply str entries) suffix)
        path "/tmp/full ticket.md"
        result (trim-ticket-notes text 500 path)]
    (is (= text (:text (trim-ticket-notes text (+ 1 (utf8-size text)) path))))
    (is (= text (:text (trim-ticket-notes text nil path))))
    (is (= text (:text (trim-ticket-notes text 0 path))))
    (is (:trimmed? result))
    (is (= 1 (:omitted-count result)))
    (is (= 5 (:kept-protected result)))
    (is (str/starts-with? (:text result) prefix))
    (is (str/ends-with? (:text result) suffix))
    (is (str/includes? (:text result) "preamble\n"))
    (is (not (str/includes? (:text result) "計算: attached")))
    (is (= 2 (count (re-seq (re-pattern (java.util.regex.Pattern/quote path)) (:text result)))))
    (is (str/includes? (:text result) "1 older Notes entries"))
    (doseq [entry (rest entries)] (is (str/includes? (:text result) entry)))
    (is (apply < (map #(.indexOf (:text result) %) (rest entries))))
    ))
(deftest notes-owner-constraints
  (doseq [entry ["- 2020-01-01 [claude-opus] Owner：外部送信は禁止\n"
                 "- 2020-01-01 Owner: no new billing\n"
                 "- 2020-01-01 本人：本番操作しない\n"
                 "- 2020-01-01 Ownerの承認範囲はrunner限定で他ticketへの変更は不可\n"
                 "- 2020-01-01 [claude-opus] Owner approved deployment to production\n"
                 "- 2020-01-01 [claude-opus] Owner requested no external transmission\n"
                 "- 2020-01-01 The owner said we must not add billing\n"
                 "- 2020-01-01 Owner's decision: keep the runner-only scope\n"
                 "- 2020-01-01 user denied the new permission\n"]]
    (is (re-find notes-protected-pattern entry) entry))
  (doseq [entry ["- 2020-01-01 [claude-opus] CI pass, PR作成\n" "- 2020-01-01 実装はCodex委譲中\n" "- 2020-01-01 run was interrupted after planned shutdown of owner 8d1dd655\n"]]
    (is (nil? (re-find notes-protected-pattern entry)) entry))
  (let [prefix "---\nid: BOXP-1\n---\n## Notes\n"
        constraint "- 2020-01-01 [claude-opus] Owner：外部送信は禁止\n"
        filler (str "- 2020-01-02 filler " (apply str (repeat 2000 "x")) "\n")
        newest (map #(str "- 2020-01-0" % " newest\n") [3 4 5])
        text (str prefix constraint filler (apply str newest))
        result (trim-ticket-notes text 600 "/tmp/t.md")]
    (is (:trimmed? result))
    (is (str/includes? (:text result) constraint))
    (is (not (str/includes? (:text result) "filler")))))
(deftest finding-files
  (doseq [[location expected] [["src/a.bb:12" "src/a.bb"] ["./src/a.bb:12-20" "src/a.bb"] ["b/src/a.py:3:4 some text" "src/a.py"] ["src/a.py#L10" "src/a.py"] ["area text" "area"]]]
    (is (= expected (review-finding-file location)))))
(deftest wiring
  (let [src (slurp "docker/codex-workspace/task-board/task_board_runner.bb")]
    (is (str/includes? src "(stagnation-prompt action ticket-id ticket-text)\n                    \"Ticket contents:\\n\\n\" (prompt-ticket-text ticket-id ticket-text)")))
  (with-redefs [env (fn [_ _] "0")] (is (nil? (prompt-notes-limit-bytes))) (is (nil? (same-file-review-threshold)))))
(deftest streaks
  (let [dir (fs/create-temp-dir) url "https://github.com/Boxp/Repo/pull/12" gate {:gate :codex-review :failure-kind :findings :url url :blocking-files ["src/a.bb"]}]
    (try
      (with-redefs [root (fn [] dir)]
        (doseq [run ["1" "2"]] (record-same-file-review-streak! "BOXP-1" run gate))
        (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
        (record-same-file-review-streak! "BOXP-1" "3" gate)
        (is (str/includes? (same-file-review-escalation-prompt "BOXP-1") "src/a.bb: 3 consecutive"))
        (record-same-file-review-streak! "BOXP-1" "ci" {:gate :ci})
        (is (str/includes? (same-file-review-escalation-prompt "BOXP-1") "3 consecutive"))
        (record-same-file-review-streak! "BOXP-1" "4" (assoc gate :blocking-files ["other"]))
        (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
        (is (nil? (get-in (read-same-file-review-streaks) [:streaks "BOXP-1" "boxp/repo#12" "src/a.bb"])))
        (with-redefs [env (fn [_ _] "0")]
          (record-same-file-review-streak! "BOXP-1" "5" gate)
          (is (nil? (same-file-review-escalation-prompt "BOXP-1")))
          (is (= 1 (get-in (read-same-file-review-streaks) [:streaks "BOXP-1" "boxp/repo#12" "src/a.bb" :count]))))
        (record-same-file-review-streak! "BOXP-1" "6" {:checked-pr-urls [url]})
        (is (nil? (get-in (read-same-file-review-streaks) [:streaks "BOXP-1" "boxp/repo#12"])))
        (let [events (map #(json/parse-string % true) (str/split-lines (slurp (str (fs/path dir "same-file-review-history.jsonl")))))]
          (is (= 5 (count (filter #(= "blocking" (:event %)) events))))
          (is (= 1 (count (filter #(= "reset" (:event %)) events)))))
        ;; A corrupt streak file must not break prompt generation.
        (spit (str (fs/path dir "same-file-review-streaks.edn")) "{:streaks {")
        (is (nil? (same-file-review-escalation-prompt "BOXP-1"))))
      (finally (fs/delete-tree dir)))))
(deftest notes-edge-cases
  (let [text (str "## Notes\n- 2020-01-01 removable-a\n- 2020-01-02 [owner] protected\n- 2020-01-03 removable-b\n- 2020-01-04 latest\n- 2020-01-05 latest\n- 2020-01-06 latest\n")
        result (trim-ticket-notes text 1 "/full")]
    (is (= 2 (:omitted-count result)))
    (is (= (+ (utf8-size "- 2020-01-01 removable-a\n") (utf8-size "- 2020-01-03 removable-b\n")) (:omitted-bytes result)))
    (is (= 2 (count (re-seq #"omitted from this prompt" (:text result)))))
    (is (str/includes? (:text result) "[owner] protected")))
  (let [text "## Notes\n- 2020-01-01 [owner] protected\n- 2020-01-02 latest\n"]
    (is (= text (:text (trim-ticket-notes text 1 "/full"))))
    (is (false? (:trimmed? (trim-ticket-notes text 1 "/full")))))
  (is (= "no heading" (:text (trim-ticket-notes "no heading" 1 "/full"))))
  (doseq [value ["0" "-1" "bad" "999999999999999999999"]]
    (with-redefs [env (fn [_ _] value)]
      (is (nil? (prompt-notes-limit-bytes)))
      (is (nil? (same-file-review-threshold))))))
(let [result (run-tests 'user)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
