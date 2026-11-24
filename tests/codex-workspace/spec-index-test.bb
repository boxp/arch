#!/usr/bin/env bb
;; BOXP-673: the index of current specs in the Obsidian vault (spec_index.bb).
;; The expected results come from the rules in
;; Projects/lean-spec-driven-testing/standard.md ("仕様書の置き方"), not from the script:
;;   1. one feature has exactly one current-spec note, and the index names it
;;   2. a proposal is tied to a ticket and is never the answer to "what applies now"
;;   3. a history note names the note that replaced it
;;   4. notes without the marks are left alone (no migration is required)
(require '[clojure.test :refer [deftest is testing run-tests]] '[clojure.string :as str]
         '[babashka.fs :as fs] '[babashka.process :as p])

(def module "docker/codex-workspace/task-board/spec_index.bb")
(def tmp (str (fs/create-temp-dir {:dir (or (System/getenv "TMPDIR") "/tmp") :prefix "spec-index-test-"})))
(defn cli [vault & args]
  @(p/process (into ["bb" module] (concat args ["--vault" vault])) {:out :string :err :string}))

(defn note! [vault rel front body]
  (let [path (fs/path vault rel)]
    (fs/create-dirs (fs/parent path))
    (spit (str path)
          (str (when front (str "---\n" (str/join "\n" (map (fn [[k v]] (str k ": " v)) front)) "\n---\n"))
               body "\n"))))

(defn vault!
  "A vault with one feature `budget`: a current spec, a proposal, a history note and an unmarked note."
  [name]
  (let [vault (str (fs/path tmp name))]
    (note! vault "Projects/spec-index.md" nil
           (str "# 現行仕様の索引\n\n説明の行。\n\n"
                "- budget :: [[Projects/budget/spec|予算の仕様]] — 失敗予算\n"))
    (note! vault "Projects/budget/spec.md" {"spec_feature" "budget" "spec_status" "current"} "# 現行")
    (note! vault "Projects/budget/proposal-9.md"
           {"spec_feature" "budget" "spec_status" "proposal" "spec_ticket" "BOXP-9"} "# 案")
    (note! vault "Projects/BOXP-1/plan.md"
           {"spec_feature" "budget" "spec_status" "history" "superseded_by" "\"[[Projects/budget/spec]]\""} "# 旧")
    (note! vault "Projects/other/notes.md" {"tags" "x"} "# 印のない既存資料")
    (note! vault "Projects/other/plain.md" nil "# frontmatter なし")
    vault))

(deftest a-consistent-vault-passes
  (let [vault (vault! "ok")
        r (cli vault "check")]
    (is (zero? (:exit r)) (str (:out r) (:err r)))))

(deftest show-answers-with-the-current-spec-only
  (let [vault (vault! "show")
        r (cli vault "show" "budget")
        lines (str/split-lines (:out r))]
    (is (zero? (:exit r)) (:err r))
    (is (= (str (fs/path vault "Projects/budget/spec.md")) (first lines))
        "the first line is the path of the current spec, so a caller can read just that")
    (is (some #(and (str/includes? % "proposal") (str/includes? % "proposal-9.md") (str/includes? % "BOXP-9")) (rest lines))
        "proposals are listed, marked as not applied")
    (is (some #(and (str/includes? % "history") (str/includes? % "BOXP-1/plan.md")) (rest lines)))
    (is (not-any? #(str/includes? % "other/") lines) "unmarked notes are not part of any feature"))
  (let [r (cli (vault! "unknown") "show" "nope")]
    (is (= 1 (:exit r)) "an unknown feature is an error, not an empty answer")
    (is (str/includes? (:err r) "nope"))))

(deftest show-refuses-an-entry-that-is-not-the-current-spec
  ;; The answer of `show` is read as "what applies now", so a broken entry must not be answered.
  (testing "the indexed note was replaced and the index still points at it"
    (let [vault (vault! "show-history")]
      (note! vault "Projects/budget/spec.md"
             {"spec_feature" "budget" "spec_status" "history" "superseded_by" "\"[[Projects/budget/proposal-9]]\""} "# 旧")
      (let [r (cli vault "show" "budget")]
        (is (= 1 (:exit r)))
        (is (str/blank? (:out r)) "no path is printed")
        (is (str/includes? (:err r) "Projects/budget/spec.md")))))
  (testing "the indexed note is missing, or belongs to another feature"
    (let [vault (vault! "show-missing")]
      (fs/delete (fs/path vault "Projects/budget/spec.md"))
      (is (= 1 (:exit (cli vault "show" "budget")))))
    (let [vault (vault! "show-other")]
      (note! vault "Projects/budget/spec.md" {"spec_feature" "lock" "spec_status" "current"} "# lock")
      (is (= 1 (:exit (cli vault "show" "budget"))))))
  (testing "two notes claim to be current: neither is answered"
    (let [vault (vault! "show-two")]
      (note! vault "Projects/BOXP-2/spec.md" {"spec_feature" "budget" "spec_status" "current"} "# もう一つ")
      (let [r (cli vault "show" "budget")]
        (is (= 1 (:exit r)))
        (is (str/blank? (:out r)))))))

(deftest list-prints-every-indexed-feature
  (let [r (cli (vault! "list") "list")]
    (is (zero? (:exit r)))
    (is (= ["budget\tProjects/budget/spec.md\t失敗予算"] (str/split-lines (:out r))))))

(defn problems [vault]
  (let [r (cli vault "check")]
    (is (= 1 (:exit r)) "a problem fails the check")
    (:out r)))

(deftest check-finds-what-would-mislead-a-reader
  (testing "the index points at a note that does not exist"
    (let [vault (vault! "missing")]
      (fs/delete (fs/path vault "Projects/budget/spec.md"))
      (is (str/includes? (problems vault) "budget"))))
  (testing "the indexed note is not marked current (for example it was replaced and the index was not updated)"
    (let [vault (vault! "not-current")]
      (note! vault "Projects/budget/spec.md"
             {"spec_feature" "budget" "spec_status" "history" "superseded_by" "\"[[Projects/budget/proposal-9]]\""} "# 旧")
      (is (str/includes? (problems vault) "Projects/budget/spec.md"))))
  (testing "two notes claim to be the current spec of one feature"
    (let [vault (vault! "two-current")]
      (note! vault "Projects/BOXP-2/spec.md" {"spec_feature" "budget" "spec_status" "current"} "# もう一つの現行")
      (is (str/includes? (problems vault) "Projects/BOXP-2/spec.md"))))
  (testing "a current spec of a feature that is not in the index cannot be found"
    (let [vault (vault! "unindexed")]
      (note! vault "Projects/lock/spec.md" {"spec_feature" "lock" "spec_status" "current"} "# lock")
      (is (str/includes? (problems vault) "Projects/lock/spec.md"))))
  (testing "the same feature twice in the index"
    (let [vault (vault! "duplicate")]
      (spit (str (fs/path vault "Projects/spec-index.md"))
            "- budget :: [[Projects/budget/spec]] — a\n- budget :: [[Projects/budget/proposal-9]] — b\n")
      (is (str/includes? (problems vault) "budget"))))
  (testing "a history note that does not say what replaced it, or names a note that is gone"
    (let [vault (vault! "history")]
      (note! vault "Projects/BOXP-1/plan.md" {"spec_feature" "budget" "spec_status" "history"} "# 旧")
      (is (str/includes? (problems vault) "Projects/BOXP-1/plan.md")))
    (let [vault (vault! "history-dangling")]
      (note! vault "Projects/BOXP-1/plan.md"
             {"spec_feature" "budget" "spec_status" "history" "superseded_by" "\"[[Projects/gone]]\""} "# 旧")
      (is (str/includes? (problems vault) "Projects/BOXP-1/plan.md"))))
  (testing "a proposal without its ticket"
    (let [vault (vault! "proposal")]
      (note! vault "Projects/budget/proposal-9.md" {"spec_feature" "budget" "spec_status" "proposal"} "# 案")
      (is (str/includes? (problems vault) "Projects/budget/proposal-9.md"))))
  (testing "a status that is not one of the three, or a mark without a feature"
    (let [vault (vault! "status")]
      (note! vault "Projects/budget/x.md" {"spec_feature" "budget" "spec_status" "draft"} "# x")
      (is (str/includes? (problems vault) "Projects/budget/x.md")))
    (let [vault (vault! "no-feature")]
      (note! vault "Projects/budget/y.md" {"spec_status" "proposal" "spec_ticket" "BOXP-9"} "# y")
      (is (str/includes? (problems vault) "Projects/budget/y.md")))))

(deftest a-vault-without-an-index-is-an-error
  (let [vault (str (fs/path tmp "empty"))]
    (fs/create-dirs (fs/path vault "Projects"))
    (is (= 1 (:exit (cli vault "check"))))
    (is (= 1 (:exit (cli vault "list"))))))

(let [{:keys [fail error]} (run-tests)]
  (fs/delete-tree tmp)
  (System/exit (if (zero? (+ fail error)) 0 1)))
