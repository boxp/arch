#!/usr/bin/env bb

(require '[babashka.fs :as fs]
         '[clojure.edn :as edn]
         '[clojure.string :as str])

(def default-vault "/home/boxp/Documents/obsidian-headless/BOXP")
(def allowed-lanes #{"Backlog" "Ready"})
(def required-fields
  [:id :title :description :schedule :time-zone :lead-days :priority :project
   :initial-lane :ticket-template :enabled])

(defn env [k default]
  (or (System/getenv k) default))

(defn vault []
  (or (System/getProperty "recurring.events.vault")
      (env "RECURRING_EVENTS_VAULT" (env "CODEX_TASK_BOARD_VAULT" default-vault))))

(defn fail [message]
  (binding [*out* *err*]
    (println (str "error: " message)))
  (System/exit 1))

(defn now-str []
  (str (java.time.Instant/now)))

(defn parse-date [s]
  (java.time.LocalDate/parse (str s)))

(defn valid-date? [s]
  (try
    (parse-date s)
    true
    (catch Exception _
      false)))

(defn today-for-zone [zone]
  (java.time.LocalDate/now (java.time.ZoneId/of zone)))

(defn recurring-root []
  (fs/path (vault) "Infrastructure" "Recurring Events"))

(defn events-dir []
  (fs/path (recurring-root) "Events"))

(defn state-path []
  (fs/path (recurring-root) "state.edn"))

(defn board-path []
  (fs/path (vault) "Boards" "Task Board.md"))

(defn tickets-dir []
  (fs/path (vault) "Tickets"))

(defn read-edn-file [path fallback]
  (if (fs/exists? path)
    (edn/read-string (slurp (str path)))
    fallback))

(defn write-edn-file! [path value]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (pr-str value) "\n")))

(defn scalar [value]
  (let [v (str/trim (or value ""))]
    (cond
      (= "" v) nil
      (#{"true" "false"} (str/lower-case v)) (= "true" (str/lower-case v))
      (re-matches #"-?\d+" v) (Long/parseLong v)
      (and (str/starts-with? v "\"") (str/ends-with? v "\"")) (subs v 1 (dec (count v)))
      (and (str/starts-with? v "'") (str/ends-with? v "'")) (subs v 1 (dec (count v)))
      :else v)))

(defn kv-line [line]
  (when-let [[_ k v] (re-matches #"\s*([A-Za-z0-9_-]+):(?:\s*(.*))?" line)]
    [(keyword k) (scalar v)]))

(defn parse-simple-map [lines indent]
  (->> lines
       (keep (fn [line]
               (when (str/starts-with? line (apply str (repeat indent " ")))
                 (kv-line line))))
       (into {})))

(defn parse-items [lines]
  (loop [remaining lines
         current nil
         items []]
    (if-let [line (first remaining)]
      (if-let [[_ rest-line] (re-matches #"\s*-\s+(.*)" line)]
        (recur (rest remaining)
               (into {} (keep identity [(kv-line rest-line)]))
               (cond-> items current (conj current)))
        (recur (rest remaining)
               (if-let [[k v] (kv-line line)] (assoc current k v) current)
               items))
      (cond-> items current (conj current)))))

(defn top-blocks [lines]
  (loop [remaining lines
         current nil
         blocks []]
    (if-let [line (first remaining)]
      (if-let [[_ k v] (re-matches #"^([A-Za-z0-9_-]+):(?:\s*(.*))?$" line)]
        (recur (rest remaining)
               {:key (keyword k) :value (scalar v) :lines []}
               (cond-> blocks current (conj current)))
        (recur (rest remaining)
               (update current :lines conj line)
               blocks))
      (cond-> blocks current (conj current)))))

(defn parse-frontmatter [text]
  (let [lines (str/split-lines text)]
    (when-not (= "---" (first lines))
      (fail "event note is missing YAML frontmatter"))
    (let [end (or (first (keep-indexed #(when (and (pos? %1) (= "---" %2)) %1) lines))
                  (fail "event note frontmatter is not closed"))
          fm-lines (subvec (vec lines) 1 end)
          body (str/join "\n" (subvec (vec lines) (inc end)))]
      {:frontmatter
       (reduce
        (fn [m {:keys [key value lines]}]
          (assoc m key
                 (case key
                   :schedule
                   (let [base (parse-simple-map lines 2)
                         item-start (.indexOf lines "  items:")
                         item-lines (if (neg? item-start) [] (subvec (vec lines) (inc item-start)))]
                     (cond-> base
                       (seq item-lines) (assoc :items (parse-items item-lines))))

                   :ticket-template
                   (parse-simple-map lines 2)

                   (if (seq lines) (parse-simple-map lines 2) value))))
        {}
        (top-blocks fm-lines))
       :body body})))

(defn event-files []
  (if (fs/exists? (events-dir))
    (->> (fs/list-dir (events-dir) "*.md") sort vec)
    []))

(defn section [body heading]
  (let [lines (vec (str/split-lines body))
        start (first (keep-indexed #(when (= heading %2) %1) lines))
        next-heading (when start
                       (first (keep-indexed #(when (and (> %1 start) (re-matches #"##\s+.*" %2)) %1) lines)))]
    (when start
      (str/trim (str/join "\n" (subvec lines (inc start) (or next-heading (count lines))))))))

(defn valid-occurrence-items [items]
  (mapcat
   (fn [idx item]
     (let [prefix (str "schedule.items[" idx "]")]
       (cond-> []
         (str/blank? (str (:key item))) (conj (str prefix ".key is required"))
         (str/blank? (str (:scheduled-date item))) (conj (str prefix ".scheduled-date is required"))
         (and (not (str/blank? (str (:scheduled-date item))))
              (not (valid-date? (:scheduled-date item))))
         (conj (str prefix ".scheduled-date must be YYYY-MM-DD"))
         (str/blank? (str (:target-period item))) (conj (str prefix ".target-period is required"))
         (str/blank? (str (:title-suffix item))) (conj (str prefix ".title-suffix is required")))))
   (range)
   items))

(defn valid-event [fm]
  (let [missing (remove #(contains? fm %) required-fields)
        schedule (:schedule fm)
        occurrence-items (:items schedule)
        errors (cond-> []
                 (seq missing) (conj (str "missing required field(s): " (str/join ", " (map name missing))))
                 (not (integer? (:lead-days fm))) (conj "lead-days must be an integer")
                 (and (integer? (:lead-days fm)) (neg? (:lead-days fm))) (conj "lead-days must be >= 0")
                 (not (allowed-lanes (:initial-lane fm))) (conj "initial-lane must be Backlog or Ready")
                 (not (#{"cron" "occurrences"} (:type schedule))) (conj "schedule.type must be cron or occurrences")
                 (and (= "cron" (:type schedule))
                      (not (re-matches #"\S+\s+\S+\s+\S+\s+\S+\s+\S+" (or (:value schedule) ""))))
                 (conj "schedule.value must be a 5-field cron")
                 (and (= "occurrences" (:type schedule))
                      (empty? occurrence-items))
                 (conj "schedule.items must not be empty"))]
    (try
      (java.time.ZoneId/of (:time-zone fm))
      (cond-> errors
        (= "occurrences" (:type schedule)) (into (valid-occurrence-items occurrence-items)))
      (catch Exception e
        (cond-> (conj errors (str "invalid time-zone: " (.getMessage e)))
          (= "occurrences" (:type schedule)) (into (valid-occurrence-items occurrence-items)))))))

(defn cron-values [field min max]
  (if (= "*" field)
    :any
    (letfn [(expand [part]
            (let [[base step-s] (str/split part #"/" 2)
                  step (Long/parseLong (or step-s "1"))
                  [a b] (cond
                          (= "*" base) [min max]
                          (str/includes? base "-") (mapv #(Long/parseLong %) (str/split base #"-" 2))
                          :else (let [n (Long/parseLong base)] [n n]))]
              (range a (inc b) step)))]
      (set (mapcat expand (str/split field #","))))))

(defn cron-match? [values n]
  (or (= :any values) (contains? values n)))

(defn cron-values-valid? [values]
  (or (= :any values) (seq values)))

(defn cron-day-match? [dom-values dow-values date]
  (let [d (.getDayOfMonth date)
        w (let [v (.getValue (.getDayOfWeek date))] (if (= 7 v) 0 v))
        dom-match (cron-match? dom-values d)
        dow-match (or (cron-match? dow-values w)
                      (and (= 0 w) (cron-match? dow-values 7)))]
    (cond
      (and (= :any dom-values) (= :any dow-values)) true
      (= :any dom-values) dow-match
      (= :any dow-values) dom-match
      :else (or dom-match dow-match))))

(defn cron-date? [cron date]
  (let [[minute hour dom month dow] (str/split cron #"\s+")
        m (.getMonthValue date)
        minute-values (cron-values minute 0 59)
        hour-values (cron-values hour 0 23)
        dom-values (cron-values dom 1 31)
        month-values (cron-values month 1 12)
        dow-values (cron-values dow 0 7)]
    (and (cron-values-valid? minute-values)
         (cron-values-valid? hour-values)
         (cron-match? month-values m)
         (cron-day-match? dom-values dow-values date))))

(defn cron-occurrences [fm today]
  (let [lead (:lead-days fm)
        cron (get-in fm [:schedule :value])]
    (->> (range 0 (inc lead))
         (map #(.plusDays today %))
         (filter #(cron-date? cron %))
         (map (fn [date]
                {:event-id (:id fm)
                 :scheduled-date (str date)
                 :occurrence-key (str (:id fm) ":" date)
                 :reason (str "scheduled-date - lead-days <= today <= scheduled-date; cron matched " date)})))))

(defn explicit-occurrences [fm today]
  (let [lead (:lead-days fm)]
    (->> (get-in fm [:schedule :items])
         (map (fn [item]
                (let [scheduled (parse-date (:scheduled-date item))
                      start (.minusDays scheduled lead)]
                  (merge item
                         {:event-id (:id fm)
                          :scheduled-date (str scheduled)
                          :occurrence-key (str (:id fm) ":" (:key item))
                          :in-window? (and (not (.isBefore today start))
                                           (not (.isAfter today scheduled)))
                          :reason (str "scheduled-date - lead-days <= today <= scheduled-date; window "
                                       start ".." scheduled)})))))))

(defn due-occurrences [fm today]
  (case (get-in fm [:schedule :type])
    "cron" (cron-occurrences fm today)
    "occurrences" (filter :in-window? (explicit-occurrences fm today))
    []))

(defn state []
  (read-edn-file (state-path) {:version 1 :created-occurrences {}}))

(defn next-ticket-id []
  (let [nums (if (fs/exists? (tickets-dir))
               (->> (fs/list-dir (tickets-dir) "BOXP-*.md")
                    (keep #(some-> (re-find #"BOXP-(\d+)\.md$" (str %)) second Long/parseLong)))
               [])]
    (str "BOXP-" (inc (apply max 0 nums)))))

(defn ticket-exists-for-occurrence? [occurrence-key]
  (boolean
   (when (fs/exists? (tickets-dir))
     (some #(str/includes? (slurp (str %)) occurrence-key)
           (fs/list-dir (tickets-dir) "BOXP-*.md")))))

(defn board-contains-occurrence? [occurrence-key]
  (and (fs/exists? (board-path))
       (str/includes? (slurp (str (board-path))) occurrence-key)))

(defn render-template [s occ]
  (reduce (fn [acc [k v]]
            (str/replace acc (str "{{" (name k) "}}") (str v)))
          (or s "")
          occ))

(defn normalize-ticket-template [tmpl occ]
  (-> (render-template tmpl occ)
      (str/replace #"(?m)^###\s+" "## ")))

(defn ticket-body [ticket-id fm body occ dry-run?]
  (let [title (render-template (or (get-in fm [:ticket-template :title]) (:title fm)) occ)
        tmpl (normalize-ticket-template (or (section body "## Ticket Template") "") occ)
        meta (str "- 元イベントファイル: " (:source-file occ) "\n"
                  "- event-id: " (:id fm) "\n"
                  "- occurrence-key: " (:occurrence-key occ) "\n"
                  "- scheduled-date: " (:scheduled-date occ) "\n"
                  "- target-period: " (or (:target-period occ) "") "\n"
                  "- lead-days: " (:lead-days fm) "\n"
                  "- generated-at: " (now-str) "\n"
                  "- dry-run候補理由: " (:reason occ) "\n")]
    (str "---\n"
         "id: " ticket-id "\n"
         "type: task\n"
         "status: " (str/lower-case (:initial-lane fm)) "\n"
         "priority: " (:priority fm) "\n"
         "assignee: " (or (:assignee fm) "boxp") "\n"
         "reporter: recurring-events\n"
         "project: " (:project fm) "\n"
         "epic:\n"
         "sprint:\n"
         "repo: " (or (:repo fm) "") "\n"
         "estimate:\n"
         "created: " (str (today-for-zone (:time-zone fm))) "\n"
         "due: " (:scheduled-date occ) "\n"
         "closed:\n"
         "tags:\n"
         "  - ticket\n"
         "  - recurring-event\n"
         "---\n\n"
         "# " ticket-id ": " title "\n\n"
         (if (str/blank? tmpl)
           (str "## Summary\n\n" (:description fm) "\n\n"
                "## Acceptance Criteria\n\n- [ ] 作業を完了する\n\n"
                "## Context\n\n" meta "\n"
                "## Plan\n\n- [ ] 内容を確認する\n\n"
                "## Notes\n\n")
           (str tmpl "\n\n## Notes\n\n"))
         (when-not (str/includes? tmpl "元イベントファイル")
           (str "- recurring-events metadata\n" meta))
         (when dry-run?
           "- dry-run: この本文は候補表示であり、まだ作成されていません。\n"))))

(defn card-line [ticket-id title fm]
  (str "- [ ] [[Tickets/" ticket-id "|" ticket-id ": " title "]] #ticket status::"
       (str/lower-case (:initial-lane fm)) " priority::" (:priority fm)
       (when-let [repo (not-empty (:repo fm))] (str " repo::" repo))))

(defn insert-card [board lane line]
  (let [lines (vec (str/split-lines board))
        heading (str "## " lane)
        start (or (first (keep-indexed #(when (= heading %2) %1) lines))
                  (fail (str "missing lane: " lane)))]
    (vec (concat (subvec lines 0 (inc start))
                 ["" line]
                 (subvec lines (inc start))))))

(defn apply-occurrence! [fm body occ]
  (when (or (ticket-exists-for-occurrence? (:occurrence-key occ))
            (board-contains-occurrence? (:occurrence-key occ)))
    (fail (str "needs-human-check: ticket or card already exists for " (:occurrence-key occ))))
  (let [ticket-id (next-ticket-id)
        title (render-template (or (get-in fm [:ticket-template :title]) (:title fm)) occ)
        ticket (ticket-body ticket-id fm body occ false)
        tmp (fs/path (tickets-dir) (str "." ticket-id ".tmp.md"))
        final (fs/path (tickets-dir) (str ticket-id ".md"))
        board (slurp (str (board-path)))
        new-board (str (str/join "\n" (insert-card board (:initial-lane fm) (card-line ticket-id title fm))) "\n")]
    (fs/create-dirs (tickets-dir))
    (spit (str tmp) ticket)
    (spit (str (board-path)) new-board)
    (fs/move tmp final)
    (write-edn-file! (state-path)
                     (assoc-in (state) [:created-occurrences (:occurrence-key occ)]
                               {:event-id (:id fm)
                                :scheduled-date (:scheduled-date occ)
                                :created-ticket ticket-id
                                :created-at (now-str)
                                :source-file (:source-file occ)}))
    {:ticket-id ticket-id :title title :lane (:initial-lane fm)}))

(defn evaluate-event [path today-override]
  (let [{:keys [frontmatter body]} (parse-frontmatter (slurp (str path)))
        fm frontmatter
        errors (valid-event fm)
        created (get (state) :created-occurrences {})]
    (cond
      (seq errors)
      [{:status :invalid :event fm :source-file (str path) :errors errors}]

      (false? (:enabled fm))
      [{:status :disabled :event fm :source-file (str path)}]

      :else
      (let [today (if today-override (parse-date today-override) (today-for-zone (:time-zone fm)))
            occs (map #(assoc % :source-file (str path)) (due-occurrences fm today))]
        (if (empty? occs)
          [{:status :not-yet :event fm :source-file (str path)}]
          (mapv (fn [occ]
                  (cond
                    (contains? created (:occurrence-key occ))
                    {:status :already-created :event fm :occurrence occ :source-file (str path)}

                    (or (ticket-exists-for-occurrence? (:occurrence-key occ))
                        (board-contains-occurrence? (:occurrence-key occ)))
                    {:status :needs-human-check :event fm :occurrence occ :source-file (str path)}

                    :else
                    {:status :candidate :event fm :body body :occurrence occ :source-file (str path)}))
                occs))))))

(defn print-result [r]
  (let [fm (:event r)
        occ (:occurrence r)]
    (println (str (name (:status r)) "\t" (:id fm)
                  (when occ (str "\t" (:occurrence-key occ)))))
    (doseq [e (:errors r)] (println (str "  - " e)))
    (when (= :candidate (:status r))
      (let [ticket-id "BOXP-N"
            title (render-template (or (get-in fm [:ticket-template :title]) (:title fm)) occ)]
        (println (str "  lane: " (:initial-lane fm)))
        (println (str "  title: " title))
        (println "  ticket:")
        (println (ticket-body ticket-id fm (:body r) occ true))))))

(defn parse-args [args]
  (loop [args args opts {} pos []]
    (cond
      (empty? args) {:opts opts :pos pos}
      (= "--vault" (first args)) (do (System/setProperty "recurring.events.vault" (second args))
                                     (recur (drop 2 args) opts pos))
      (= "--today" (first args)) (recur (drop 2 args) (assoc opts :today (second args)) pos)
      :else (recur (rest args) opts (conj pos (first args))))))

(defn dry-run! [today]
  (let [results (mapcat #(evaluate-event % today) (event-files))]
    (doseq [r results] (print-result r))
    (when (empty? results) (println "no events"))))

(defn apply! [today]
  (doseq [r (mapcat #(evaluate-event % today) (event-files))]
    (if (= :candidate (:status r))
      (let [created (apply-occurrence! (:event r) (:body r) (:occurrence r))]
        (println (str "created\t" (:ticket-id created) "\t" (:lane created) "\t" (:title created))))
      (print-result r))))

(let [{:keys [opts pos]} (parse-args *command-line-args*)
      command (or (first pos) "dry-run")]
  (case command
    "dry-run" (dry-run! (:today opts))
    "apply" (apply! (:today opts))
    (fail "usage: recurring_events.bb [--vault PATH] [--today YYYY-MM-DD] <dry-run|apply>")))
