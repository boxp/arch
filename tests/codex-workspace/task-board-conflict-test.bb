#!/usr/bin/env bb
(require '[clojure.test :refer [deftest is run-tests]] '[clojure.string :as str]
         '[babashka.fs :as fs] '[babashka.process :as p] '[cheshire.core :as json])
(load-file "docker/codex-workspace/task-board/task_board_conflict.bb")
(def module "docker/codex-workspace/task-board/task_board_conflict.bb")
(def root (str (fs/create-temp-dir {:dir (or (System/getenv "TMPDIR") "/tmp") :prefix "conflict-test-"})))
(defn cli [& args] @(p/process (into ["bb" module] args) {:out :string :err :string}))
(deftest keys-test
  (is (every? task-board-conflict/valid-key? ["code:arch" "code:arch:a/b" "spec:foo/bar" "deploy:a" "res:a"]))
  (is (not-any? task-board-conflict/valid-key? ["code:arch:/a" "code:arch:a/" "x:a" "code:arch:"]))
  (is (= ["code:arch"] (task-board-conflict/file-keys "arch" "file")))
  (is (= ["code:arch:a/b/c/d/e"] (task-board-conflict/file-keys "arch" "a/b/c/d/e/f/g")))
  (doseq [[repo path key] [["arch" "apps/kohako-studio/a" "deploy:kohako-studio"] ["arch" "docker/codex-workspace/a" "deploy:codex-workspace"] ["arch" "docker/hermes-agent/a" "deploy:hermes-agent"] ["arch" "docker/foo/a" "deploy:foo"] ["arch" "apps/bar/a" "deploy:bar"] ["lolice" "argoproj/x/a" "deploy:x"]]]
    (is (some #{key} (task-board-conflict/file-keys repo path))))
  (is (some #{"spec:test"} (task-board-conflict/pre-keys {:repos ["boxp/arch"] :text "conflict_keys: spec:test, bad\nhermes"})))
  (is (some #{"deploy:hermes-agent"} (task-board-conflict/pre-keys {:text "## Summary\nhermes-agent"})))
  (is (= ["code:arch"] (task-board-conflict/pre-keys {:repos ["boxp/arch"] :text "## Summary\nx\n## Notes\n- [hermes-agent]: codex-workspace"})))
  (is (= ["code:arch"] (task-board-conflict/pre-keys {:repos ["boxp/arch"] :text "---\nassignee: hermes-agent\nreporter: hermes-agent\n---\n## Plan\n- [ ] TD-01 x\n  - 由来: hermes-agent\n"})))
  (is (some #{"deploy:hermes-agent"} (task-board-conflict/pre-keys {:repos ["boxp/arch"] :text "## Plan\n- [ ] hermes-agent の配送を直す\n  - 由来: hermes-agent\n"})))
  (is (task-board-conflict/keys-overlap? "code:arch:a" "code:arch:a/b"))
  (is (not (task-board-conflict/keys-overlap? "code:arch:a" "code:arch:ab")))
  (is (not (task-board-conflict/keys-overlap? "code:arch" "code:lolice"))))
(deftest recording-test
  (task-board-conflict/record-pre! root {:ticket "A" :run "r" :repos ["boxp/arch"] :text "secret text"})
  (task-board-conflict/record-declared! root {:ticket "A" :keys ["spec:a"] :source "test"})
  (task-board-conflict/record-pr! root {:ticket "A" :pr "https://github.com/boxp/arch/pull/1" :files ["a/b"] :gate-ok true})
  (let [events (:events (task-board-conflict/read-events root))] (is (= 3 (count events))) (is (not (str/includes? (pr-str events) "secret text"))))
  (is (zero? (:exit (cli "declare" "B" "--root" root "--keys" "code:arch,spec:abc"))))
  (let [before (slurp (task-board-conflict/event-path root))]
    (is (= 2 (:exit (cli "declare" "B" "--root" root "--keys" "bad"))))
    (is (= before (slurp (task-board-conflict/event-path root)))))
  (let [r @(p/process ["bb" module "status" "--root" root "--json"] {:out :string :err :string :extra-env {"CODEX_TASK_BOARD_CONFLICT_OBSERVE" "off"}})]
    (is (false? (:enabled (json/parse-string (:out r) true))))))
(deftest report-test
  (let [r (str (fs/create-temp-dir {:dir (or (System/getenv "TMPDIR") "/tmp") :prefix "conflict-report-"}))
        url "https://github.com/boxp/arch/pull/1"]
    (is (zero? (:exit (cli "report" "--root" r))))
    (doseq [id ["A" "B" "C"]] (task-board-conflict/record-pre! r {:ticket id :repos ["boxp/arch"] :text "## Summary\nkohako-home"}))
    ;; D shares only the repo with the others: a bare repo key predicts nothing.
    (task-board-conflict/record-pre! r {:ticket "D" :repos ["boxp/arch"] :text "## Summary\nother"})
    (task-board-conflict/record-pr! r {:ticket "A" :pr url :files ["a/f"] :gate "conflict"})
    (task-board-conflict/record-pr! r {:ticket "B" :pr url :files ["a/f"] :gate-ok true})
    (task-board-conflict/record-pr! r {:ticket "C" :pr url :files ["z/f"] :gate-ok true})
    (let [data (json/parse-string (:out (cli "report" "--root" r "--json")) true)]
      (is (= 1 (get-in data [:conflict_summary :explained])))
      (is (= 1 (get-in data [:conflict_summary :predicted :pr])))
      (is (= 3 (get-in data [:stages :pre :predicted_pairs])))
      (is (= 2 (get-in data [:stages :pre :needless]))))))
(deftest large-pr-and-matching-test
  (let [files (vec (concat (map #(str "other/" % ".txt") (range 300)) ["docker/hermes-agent/last.txt"])) r (str (fs/create-temp-dir {:dir (or (System/getenv "TMPDIR") "/tmp") :prefix "conflict-large-"}))]
    (task-board-conflict/record-pr! r {:ticket "X" :pr "https://github.com/boxp/arch/pull/2" :files files})
    (let [event (first (:events (task-board-conflict/read-events r)))]
      (is (= 301 (count (:files event)))) (is (= 301 (:files_count event))) (is (true? (:files_complete event))) (is (some #{"deploy:hermes-agent"} (:keys event))))
    (fs/delete-tree r))
  (is (= "arch" (task-board-conflict/repo-name-from-pr-url "https://github.com/boxp/arch/pull/7")))
  (is (some #{"deploy:kohako-studio"} (task-board-conflict/pre-keys {:repos ["boxp/arch"] :text "家画面"}))))
(defn write-events! [r events]
  (fs/create-dirs (fs/parent (task-board-conflict/event-path r)))
  (spit (task-board-conflict/event-path r) (str/join (map #(str (json/generate-string %) "\n") events))))
(defn report-json [r] (json/parse-string (:out (cli "report" "--root" r "--json")) true))
(deftest open-pr-and-full-file-list-test
  (let [r (str (fs/create-temp-dir {:dir (or (System/getenv "TMPDIR") "/tmp") :prefix "conflict-open-"}))
        hot ["code:arch:apps/kohako-studio/verify/home"]
        many (mapv #(str "other/" % ".txt") (range 300))
        p-pr {:ticket "P" :stage "pr" :at "2026-01-01T01:00:00Z" :pr "https://github.com/boxp/arch/pull/1" :pr_created_at "2026-01-01T01:00:00Z" :files (conj many "apps/x/late.txt") :files_count 301 :files_complete true :keys ["code:arch:apps/x"]}
        base [{:ticket "P" :stage "pre" :at "2026-01-01T00:00:00Z" :keys hot}
              {:ticket "Q" :stage "pre" :at "2026-01-02T00:00:00Z" :keys hot}
              {:ticket "Q" :stage "pr" :at "2026-01-02T01:00:00Z" :pr "https://github.com/boxp/arch/pull/2" :pr_created_at "2026-01-02T01:00:00Z" :pr_merged_at "2026-01-02T02:00:00Z" :files ["apps/x/late.txt"] :files_count 1 :files_complete true :keys ["code:arch:apps/x"]}]]
    ;; P's PR is still open when Q starts a day later: the two are concurrent, and
    ;; the shared file is the 301st of P's list.
    (write-events! r (conj base p-pr))
    (let [data (report-json r)]
      (is (= 1 (:pairs data))) (is (= 1 (:open_pr_tickets data)))
      (is (true? (:actual_overlap (first (:pair_details data)))))
      (is (= 0 (get-in data [:stages :pre :needless])))
      (is (pos? (get-in data [:stages :pre :wait_hours]))))
    ;; Merged before Q started: not concurrent.
    (write-events! r (conj base (assoc p-pr :pr_merged_at "2026-01-01T02:00:00Z")))
    (is (= 0 (:pairs (report-json r))))
    ;; A later record of the same PR supersedes the open one.
    (write-events! r (conj base p-pr (assoc p-pr :at "2026-01-01T03:00:00Z" :pr_closed_at "2026-01-01T03:00:00Z")))
    (is (= 0 (:pairs (report-json r))))
    ;; An incomplete file list cannot prove "no overlap".
    (write-events! r (conj base (assoc p-pr :files many :files_count 300 :files_complete false)))
    (let [data (report-json r)]
      (is (= 1 (:incomplete_file_tickets data)))
      (is (= 0 (get-in data [:stages :pre :known_pairs])))
      (is (= 1 (get-in data [:stages :pre :unconfirmed]))))
    (fs/delete-tree r)))
(deftest fetch-pr-files-test
  ;; The PR number must match so the paginated listing is actually requested.
  (let [calls (atom [])]
    (with-redefs [task-board-conflict/gh-out (fn [args _] (swap! calls conj args) "a/b.clj\n\nc.md\n")]
      (is (= ["a/b.clj" "c.md"] (task-board-conflict/fetch-pr-files "https://github.com/boxp/arch/pull/15024")))
      (is (= ["api" "--paginate" "repos/boxp/arch/pulls/15024/files?per_page=100" "--jq" ".[].filename"] (first @calls)))
      (is (nil? (task-board-conflict/fetch-pr-files "https://github.com/boxp/arch/issues/1")))
      (is (= 1 (count @calls))))))
(let [r (run-tests)] (fs/delete-tree root) (System/exit (if (zero? (+ (:fail r) (:error r))) 0 1)))
