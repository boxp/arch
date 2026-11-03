#!/usr/bin/env bb
;; BOXP-395: move Task Board Review cards to the lane each decision names.
;; Dry-run by default. Re-reads every card first, so a card that moved, is running,
;; or got new Notes since the decision is held instead of overwritten. Re-running is
;; safe: anything no longer in Review is reported and left alone.
;;
;; usage: migrate.bb --decisions FILE --results FILE [--ids A,B | --limit N] [--apply]
(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[clojure.edn :as edn]
         '[clojure.string :as str])

(def args (vec *command-line-args*))
(defn opt [flag] (let [i (.indexOf args flag)] (when (>= i 0) (get args (inc i)))))
(def apply? (some #{"--apply"} args))
(def vault (or (System/getenv "CODEX_TASK_BOARD_VAULT") "/home/boxp/Documents/obsidian-headless/BOXP"))
(def state-root (or (System/getenv "CODEX_TASK_BOARD_ROOT") "/home/boxp/.codex-task-board"))
(def helper (or (System/getenv "TASK_BOARD_HELPER")
                (str (fs/path (System/getProperty "user.home") ".claude/skills/obsidian-task-board/bin/task-board.bb"))))
(def migration-mark "[BOXP-395 移行]")

(defn board-lane [id]
  (let [lane (atom nil) found (atom [])]
    (doseq [line (str/split-lines (slurp (str (fs/path vault "Boards" "Task Board.md"))))]
      (when-let [[_ h] (re-find #"^##\s+(.+?)\s*$" line)] (reset! lane h))
      (when (str/includes? line (str "[[Tickets/" id "|")) (swap! found conj @lane)))
    @found))

(defn ticket-text [id] (slurp (str (fs/path vault "Tickets" (str id ".md")))))

(defn frontmatter [text k]
  (some-> (re-find (re-pattern (str "(?m)^" k ":[ \\t]*(.*)$")) text) second str/trim))

(defn last-note
  "Last Notes line that is not this migration's own, so a crash between the
  audit note and the move does not make the card look changed."
  [text]
  (let [notes (or (second (str/split text #"(?m)^## Notes\s*$" 2)) "")]
    (->> (str/split-lines notes)
         (remove str/blank?)
         (remove #(str/includes? % migration-mark))
         last)))

(defn running? [id] (fs/exists? (fs/path state-root "locks" (str id ".edn"))))

(defn check [{:keys [id expected-last-note expected-assignee]}]
  (let [lanes (board-lane id)
        text (ticket-text id)]
    (cond
      (not= 1 (count lanes)) {:hold "card-count"}
      (not= "Review" (first lanes)) {:hold "not-in-review" :lane (first lanes)}
      (running? id) {:hold "running"}
      (not= expected-last-note (last-note text)) {:hold "notes-changed"}
      (not= expected-assignee (frontmatter text "assignee")) {:hold "assignee-changed"}
      :else {:ok? true})))

(defn note-for [{:keys [lane assignee evidence next-action decision needed-input resolver done-kind successor missing-check]}]
  (str migration-mark " Review 廃止に伴い " lane " へ移行（担当 " assignee "）。根拠: " evidence
       (case lane
         "Ready" (str " 次action: " next-action)
         "Blocked" (str (when missing-check (str " 根拠不足で判定不能。必要な確認: " missing-check))
                        (when decision (str " 判断点: " decision))
                        (when needed-input (str " 必要入力: " needed-input))
                        " 解消責任者: " (or resolver "boxp")
                        " 解除後: " next-action)
         "Done" (str " 終了種別: " done-kind (when successor (str " 後続: " successor)) " 残件: " next-action))))

(defn helper! [& xs]
  (let [{:keys [exit err out]} @(p/process (into ["bb" helper] xs) {:out :string :err :string})]
    (when-not (zero? exit)
      (throw (ex-info (str "helper failed: " (str/trim (str err out))) {})))
    out))

(defn migrate! [{:keys [id lane assignee] :as d}]
  ;; Always previews first; the helper rejects anything it would not apply.
  (helper! "update" id "--vault" vault "--lane" lane "--assignee" assignee "--dry-run")
  (when apply?
    ;; Audit note first, state second: same order as the runner's blocked path.
    (helper! "append-note" id "--vault" vault "--source" "claude-opus" "--note" (note-for d))
    (helper! "update" id "--vault" vault "--lane" lane "--assignee" assignee)
    (let [text (ticket-text id)]
      {:read-back-lanes (board-lane id)
       :read-back-status (frontmatter text "status")
       :read-back-assignee (frontmatter text "assignee")})))

(let [decisions (edn/read-string (slurp (opt "--decisions")))
      results-path (opt "--results")
      previous (if (and results-path (fs/exists? results-path)) (edn/read-string (slurp results-path)) {})
      ids (some-> (opt "--ids") (str/split #",") set)
      selected (cond->> decisions
                 ids (filter #(ids (:id %)))
                 (opt "--limit") (take (parse-long (opt "--limit"))))
      results (vec (for [d selected]
                     (let [c (check d)]
                       (try
                         (if (:ok? c)
                           (assoc (merge {:id (:id d) :to (:lane d) :assignee (:assignee d)
                                          :outcome (if apply? :applied :would-apply)}
                                         (migrate! d))
                                  :at (str (java.time.Instant/now)))
                           {:id (:id d) :outcome :held :reason (:hold c) :lane (:lane c)})
                         (catch Exception e
                           {:id (:id d) :outcome :failed :reason (.getMessage e)})))))]
  (doseq [r results] (prn r))
  (when (and apply? results-path)
    (spit results-path (with-out-str
                         (clojure.pprint/pprint
                          (reduce (fn [acc r]
                                    ;; An applied result is never replaced by a later "held".
                                    (if (and (= :applied (get-in acc [(:id r) :outcome])) (not= :applied (:outcome r)))
                                      acc
                                      (assoc acc (:id r) r)))
                                  previous results)))))
  (println (frequencies (map :outcome results)))
  (when (some #(= :failed (:outcome %)) results) (System/exit 1)))
