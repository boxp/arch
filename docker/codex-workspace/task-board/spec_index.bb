#!/usr/bin/env bb
;; BOXP-673: where the specification that applies now is written.
;;
;; Design notes pile up per change (a plan per ticket), so an old plan can be read as
;; the current behaviour. The vault therefore keeps one note per feature that states
;; what applies now, an index of those notes, and three marks in note frontmatter:
;;
;;   spec_feature: <key>                 the feature the note is about
;;   spec_status: current|proposal|history
;;   spec_ticket: BOXP-N                 (proposal) the ticket that would apply it
;;   superseded_by: "[[Projects/...]]"   (history) the note that replaced it
;;
;; The index is Projects/spec-index.md, one line per feature:
;;   - <key> :: [[Projects/<...>/spec]] — <one-line description>
;;
;; Notes without the marks are not touched and not required to be migrated.
;; The rules are in Projects/lean-spec-driven-testing/standard.md. Read-only.
;;
;;   bb spec_index.bb list --vault DIR          key, path and description of every feature
;;   bb spec_index.bb show KEY --vault DIR      first line: the current spec; then proposals and history
;;   bb spec_index.bb check --vault DIR         exit 1 and one line per problem
(ns spec-index
  (:require [babashka.fs :as fs] [clojure.string :as str]))

(def index-rel "Projects/spec-index.md")
(def statuses #{"current" "proposal" "history"})

(defn frontmatter
  "The top-level `key: value` lines of a note's frontmatter, or nil without one."
  [path]
  (with-open [r (clojure.java.io/reader (str path))]
    (let [lines (line-seq r)]
      (when (= "---" (some-> (first lines) str/trim))
        (->> (rest lines)
             (take-while #(not= "---" (str/trim %)))
             (keep #(re-matches #"([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)" %))
             (map (fn [[_ k v]] [k (str/trim (str/replace (str/trim v) #"^[\"'](.*)[\"']$" "$1"))]))
             (into {}))))))

(defn link-rel
  "`[[Projects/a/b|alias]]` or `Projects/a/b` -> `Projects/a/b.md`."
  [text]
  (when-let [[_ target] (or (re-find #"\[\[([^\]|#]+)" (str text))
                            (re-matches #"\s*([^\[\]|#]+?)\s*" (str text)))]
    (let [target (str/trim target)]
      (when (seq target)
        (if (str/ends-with? target ".md") target (str target ".md"))))))

(defn read-index
  "The entries of the index in file order, or nil when the vault has no index."
  [vault]
  (let [path (fs/path vault index-rel)]
    (when (fs/exists? path)
      (vec (keep (fn [line]
                   (when-let [[_ k target desc] (re-matches #"\s*[-*]\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s+::\s+(\[\[[^\]]+\]\])\s*(?:[—–-]+\s*(.*))?" line)]
                     {:feature k :rel (link-rel target) :description (str/trim (or desc ""))}))
                 (str/split-lines (slurp (str path))))))))

(defn marked-notes
  "Every note under Projects/ that carries spec_status or spec_feature."
  [vault]
  (let [base (fs/path vault "Projects")]
    (->> (when (fs/exists? base) (fs/glob base "**.md"))
         (keep (fn [path]
                 (let [fm (try (frontmatter path) (catch Exception _ nil))]
                   (when (or (contains? fm "spec_status") (contains? fm "spec_feature"))
                     {:rel (str (fs/relativize vault path))
                      :feature (get fm "spec_feature")
                      :status (get fm "spec_status")
                      :ticket (get fm "spec_ticket")
                      :superseded-by (get fm "superseded_by")}))))
         (sort-by :rel)
         vec)))

(defn problems [vault]
  (let [index (read-index vault)
        notes (marked-notes vault)
        by-rel (into {} (map (juxt :rel identity)) notes)
        indexed (into {} (map (juxt :feature :rel)) index)]
    (if (nil? index)
      [(str index-rel ": the index is missing")]
      (vec
       (concat
        (for [[k n] (frequencies (map :feature index)) :when (> n 1)]
          (str index-rel ": feature " k " is listed " n " times"))
        (for [{:keys [feature rel]} index
              :let [note (get by-rel rel)]
              :when (not (and (fs/exists? (fs/path vault rel))
                              (= "current" (:status note)) (= feature (:feature note))))]
          (str index-rel ": feature " feature " points at " rel
               (cond (not (fs/exists? (fs/path vault rel))) ", which does not exist"
                     :else (str ", which is not marked spec_status: current for spec_feature: " feature))))
        (for [{:keys [rel feature status ticket superseded-by]} notes
              problem [(cond
                         (str/blank? feature) "spec_status without spec_feature"
                         (not (contains? statuses status)) (str "spec_status is not one of " (str/join ", " (sort statuses)))
                         (and (= "current" status) (not= rel (get indexed feature)))
                         (str "marked current for " feature ", but the index "
                              (if-let [other (get indexed feature)] (str "names " other) "does not list that feature"))
                         (and (= "proposal" status) (str/blank? ticket)) "a proposal needs spec_ticket"
                         (and (= "history" status)
                              (not (some-> (link-rel superseded-by) (->> (fs/path vault)) fs/exists?)))
                         "a history note needs superseded_by naming an existing note")]
              :when problem]
          (str rel ": " problem)))))))

(defn arg [args flag] (second (drop-while #(not= flag %) args)))

(defn fail! [& message]
  (binding [*out* *err*] (apply println message))
  (System/exit 1))

(defn -main [& args]
  (let [[command key] (remove #(str/starts-with? % "--") (remove #{(arg args "--vault")} args))
        vault (or (arg args "--vault") (System/getenv "CODEX_TASK_BOARD_VAULT"))]
    (when (str/blank? vault) (fail! "--vault DIR is required"))
    (case command
      "list" (if-let [index (read-index vault)]
               (doseq [{:keys [feature rel description]} index]
                 (println (str/join "\t" [feature rel description])))
               (fail! (str index-rel ": the index is missing")))
      "show" (let [entry (first (filter #(= key (:feature %)) (read-index vault)))]
               (when-not entry
                 (fail! (str "no feature " (pr-str key) " in " index-rel "; run `list`. A feature without a current-spec note has none yet.")))
               ;; The answer is read as "what applies now": refuse it when the index or the
               ;; marks of this feature are inconsistent, instead of answering with a stale note.
               (when-let [found (seq (filter #(or (str/includes? % (str "feature " key " "))
                                                  (str/includes? % (str "marked current for " key ",")))
                                             (problems vault)))]
                 (apply fail! (str "the current spec of " key " cannot be determined:") (map #(str "\n  " %) found)))
               (println (str (fs/path vault (:rel entry))))
               (doseq [{:keys [rel feature status ticket]} (marked-notes vault)
                       :when (and (= key feature) (not= rel (:rel entry)))]
                 (println (str (case status
                                 "proposal" (str "proposal (not applied; " (or ticket "no ticket") ")")
                                 "history" "history (replaced; not the current behaviour)"
                                 (str status))
                               "\t" rel))))
      "check" (let [found (problems vault)]
                (doseq [p found] (println p))
                (when (seq found) (System/exit 1))
                (println "ok"))
      (fail! "usage: spec_index.bb (list | show KEY | check) --vault DIR"))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
