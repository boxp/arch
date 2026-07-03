#!/usr/bin/env bb

(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[clojure.edn :as edn]
         '[clojure.java.io :as io]
         '[clojure.string :as str])

(def lane->status
  {"Backlog" "backlog"
   "Ready" "ready"
   "In Progress" "in-progress"
   "Blocked" "blocked"
   "Review" "review"
   "Done" "done"})

(def status->lane
  (into {} (map (fn [[lane status]] [status lane]) lane->status)))

(def default-vault "/home/boxp/Documents/obsidian-headless/BOXP")
(def default-root "/home/boxp/.codex-task-board")

(defn env [k default]
  (or (System/getenv k) default))

(defn root []
  (env "CODEX_TASK_BOARD_ROOT" default-root))

(defn vault []
  (env "CODEX_TASK_BOARD_VAULT" default-vault))

(defn board-path []
  (fs/path (vault) "Boards" "Task Board.md"))

(defn tickets-dir []
  (fs/path (vault) "Tickets"))

(defn now []
  (java.time.Instant/now))

(defn now-str []
  (str (now)))

(defn today []
  (str (java.time.LocalDate/now java.time.ZoneOffset/UTC)))

(defn run-id []
  (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
           (java.time.ZonedDateTime/now java.time.ZoneOffset/UTC)))

(defn fail [message]
  (binding [*out* *err*]
    (println (str "error: " message)))
  (System/exit 1))

(defn ensure-root! []
  (doseq [path [(root)
                (fs/path (root) "locks")
                (fs/path (root) "runs")]]
    (fs/create-dirs path)))

(defn read-edn-file [path fallback]
  (if (fs/exists? path)
    (edn/read-string (slurp (str path)))
    fallback))

(defn write-edn-file! [path value]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (pr-str value) "\n")))

(defn read-lines [path]
  (if (fs/exists? path)
    (str/split-lines (slurp (str path)))
    (fail (str "missing file: " path))))

(defn write-lines! [path lines]
  (spit (str path) (str (str/join "\n" lines) "\n")))

(defn section-index [lines heading]
  (first (keep-indexed (fn [idx line]
                         (when (= heading line) idx))
                       lines)))

(defn next-section-index [lines start-idx]
  (or (first (keep-indexed (fn [idx line]
                             (when (and (> idx start-idx)
                                        (re-matches #"##\s+.+\s*" line))
                               idx))
                           lines))
      (count lines)))

(defn section-range [lines lane]
  (when-let [start (section-index lines (str "## " lane))]
    {:heading start
     :body-start (inc start)
     :end (next-section-index lines start)}))

(defn card-line? [line]
  (boolean (re-matches #"\s*-\s+\[[ xX]\]\s+.*" line)))

(defn ticket-id-from-card [line]
  (second (re-find #"\[\[Tickets/(BOXP-\d+)\|" line)))

(defn attr-value [line key]
  (second (re-find (re-pattern (str "(?:^|\\s)" key "::([^\\s]+)")) line)))

(defn parse-board-cards [lines]
  (->> lane->status
       keys
       (mapcat (fn [lane]
                 (let [status (lane->status lane)]
                   (when-let [{:keys [body-start end]} (section-range lines lane)]
                     (keep-indexed
                      (fn [idx line]
                        (when (and (card-line? line) (ticket-id-from-card line))
                          {:ticket-id (ticket-id-from-card line)
                           :lane lane
                           :status status
                           :done (attr-value line "done")
                           :line line
                           :idx (+ body-start idx)}))
                      (subvec (vec lines) body-start end))))))
       vec))

(defn replace-or-add-attr [line key value]
  (let [pattern (re-pattern (str "(?:^|\\s)" key "::[^\\s]+"))]
    (if (re-find pattern line)
      (str/replace line pattern (str " " key "::" value))
      (str line " " key "::" value))))

(defn remove-attr [line key]
  (-> line
      (str/replace (re-pattern (str "(?:^|\\s)" key "::[^\\s]+")) "")
      (str/replace #"\s+" " ")
      str/trim))

(defn normalize-card-line [line status]
  (let [line (str/replace line #"^\s*-\s+\[[ xX]\]" (if (= "done" status) "- [x]" "- [ ]"))
        line (replace-or-add-attr line "status" status)
        line (if (= "done" status)
               (if (attr-value line "done") line (replace-or-add-attr line "done" (today)))
               (remove-attr line "done"))]
    line))

(defn insert-after-heading [lines lane new-line]
  (let [{:keys [body-start]} (or (section-range lines lane)
                                 (fail (str "missing lane: " lane)))
        insertion-idx (loop [idx body-start]
                        (if (and (< idx (count lines))
                                 (str/blank? (nth lines idx)))
                          (recur (inc idx))
                          idx))]
    (vec (concat (subvec lines 0 insertion-idx)
                 [new-line]
                 (subvec lines insertion-idx)))))

(defn remove-index [lines idx]
  (vec (concat (subvec lines 0 idx) (subvec lines (inc idx)))))

(defn move-card! [ticket-id target-status]
  (let [path (board-path)
        lines (vec (read-lines path))
        card (first (filter #(= ticket-id (:ticket-id %)) (parse-board-cards lines)))
        target-lane (or (status->lane target-status)
                        (fail (str "invalid target status: " target-status)))]
    (when-not card
      (fail (str "ticket card not found: " ticket-id)))
    (let [new-line (normalize-card-line (:line card) target-status)
          without (remove-index lines (:idx card))
          moved (insert-after-heading without target-lane new-line)]
      (write-lines! path moved))))

(defn sync-board-statuses! []
  (let [path (board-path)
        lines (vec (read-lines path))
        cards (parse-board-cards lines)
        updates (into {} (map (fn [{:keys [idx line status]}]
                                [idx (normalize-card-line line status)])
                              cards))
        new-lines (mapv (fn [idx line] (get updates idx line))
                        (range (count lines))
                        lines)]
    (when (not= lines new-lines)
      (write-lines! path new-lines))))

(defn ticket-path [ticket-id]
  (fs/path (tickets-dir) (str ticket-id ".md")))

(defn frontmatter-range [lines]
  (when (= "---" (first lines))
    (when-let [end (first (keep-indexed (fn [idx line]
                                          (when (and (pos? idx) (= "---" line)) idx))
                                        lines))]
      {:start 0 :end end})))

(defn frontmatter-map [lines]
  (if-let [{:keys [end]} (frontmatter-range lines)]
    (->> (subvec (vec lines) 1 end)
         (keep (fn [line]
                 (when-let [[_ k v] (re-matches #"([A-Za-z0-9_-]+):\s*(.*)" line)]
                   [(keyword k) v])))
         (into {}))
    {}))

(defn set-frontmatter-key [fm-lines key value]
  (let [pattern (re-pattern (str "^" (name key) ":\\s*.*$"))
        replacement (str (name key) ": " value)]
    (if (some #(re-matches pattern %) fm-lines)
      (mapv #(if (re-matches pattern %) replacement %) fm-lines)
      (conj (vec fm-lines) replacement))))

(defn update-frontmatter! [ticket-id updates]
  (let [path (ticket-path ticket-id)
        lines (vec (read-lines path))
        {:keys [end]} (or (frontmatter-range lines)
                          (fail (str "missing frontmatter: " path)))
        before (subvec lines 0 (inc end))
        body (subvec lines (inc end))
        fm-lines (subvec before 1 end)
        new-fm (reduce (fn [acc [k v]] (set-frontmatter-key acc k v))
                       fm-lines
                       updates)
        new-lines (vec (concat ["---"] new-fm ["---"] body))]
    (when (not= lines new-lines)
      (write-lines! path new-lines))))

(defn ticket-frontmatter [ticket-id]
  (frontmatter-map (vec (read-lines (ticket-path ticket-id)))))

(defn append-note! [ticket-id note]
  (let [path (ticket-path ticket-id)
        lines (vec (read-lines path))
        bullet (str "- " (today) ": " note)
        idx (or (section-index lines "## Notes") (dec (count lines)))
        insert-idx (if (= "## Notes" (nth lines idx))
                     (count lines)
                     (count lines))
        new-lines (if (some #(= bullet %) lines)
                    lines
                    (vec (concat (subvec lines 0 insert-idx) [bullet] (subvec lines insert-idx))))]
    (write-lines! path new-lines)))

(defn sync-ticket-statuses! []
  (let [lines (vec (read-lines (board-path)))]
    (doseq [{:keys [ticket-id status done]} (parse-board-cards lines)
            :let [path (ticket-path ticket-id)]
            :when (fs/exists? path)]
      (let [updates (cond-> {:status status}
                      (= "done" status) (assoc :closed (or done (today))))]
        (update-frontmatter! ticket-id updates)))))

(defn sync-all! []
  (sync-board-statuses!)
  (sync-ticket-statuses!))

(defn lock-path [ticket-id]
  (fs/path (root) "locks" (str ticket-id ".edn")))

(defn run-dir [ticket-id run-id]
  (fs/path (root) "runs" ticket-id run-id))

(defn seconds-since [instant-str]
  (try
    (let [then (java.time.Instant/parse instant-str)]
      (.getSeconds (java.time.Duration/between then (now))))
    (catch Exception _
      Long/MAX_VALUE)))

(defn stale-lock? [lock]
  (> (seconds-since (:heartbeat-at lock))
     (Long/parseLong (env "CODEX_TASK_BOARD_LOCK_STALE_SECONDS" "1800"))))

(defn mark-run! [ticket-id run-id status extra]
  (let [summary (merge {:ticket ticket-id
                        :run-id run-id
                        :status status
                        :updated-at (now-str)}
                       extra)]
    (write-edn-file! (fs/path (run-dir ticket-id run-id) "summary.edn") summary)))

(defn close-stale-lock! [ticket-id lock]
  (when-let [stale-run (:run-id lock)]
    (mark-run! ticket-id stale-run :interrupted
               {:reason "heartbeat timeout"
                :previous-lock lock})
    (append-note! ticket-id (str "Codex run " stale-run " was marked interrupted after heartbeat timeout.")))
  (fs/delete-if-exists (lock-path ticket-id)))

(defn acquire-lock! [ticket-id action lane]
  (let [path (lock-path ticket-id)
        run (run-id)
        lock {:ticket ticket-id
              :run-id run
              :action action
              :lane lane
              :host (or (System/getenv "HOSTNAME") "unknown")
              :pid (.pid (java.lang.ProcessHandle/current))
              :started-at (now-str)
              :heartbeat-at (now-str)}]
    (fs/create-dirs (fs/parent path))
    (if (.createNewFile (io/file (str path)))
      (do
        (write-edn-file! path lock)
        lock)
      (let [existing (read-edn-file path {})]
        (if (stale-lock? existing)
          (do
            (close-stale-lock! ticket-id existing)
            (acquire-lock! ticket-id action lane))
          (do
            (println (str "ticket already locked: " ticket-id))
            nil))))))

(defn release-lock! [ticket-id]
  (fs/delete-if-exists (lock-path ticket-id)))

(defn heartbeat! [ticket-id lock stop?]
  (future
    (while (not @stop?)
      (write-edn-file! (lock-path ticket-id) (assoc lock :heartbeat-at (now-str)))
      (Thread/sleep 1000))))

(defn previous-run-summaries [ticket-id]
  (let [dir (fs/path (root) "runs" ticket-id)]
    (when (fs/exists? dir)
      (->> (fs/list-dir dir)
           (map #(fs/path % "summary.edn"))
           (filter fs/exists?)
           (map #(try (read-edn-file % nil) (catch Exception _ nil)))
           (remove nil?)
           (take-last 3)
           vec))))

(defn prompt-for [action ticket-id lane]
  (let [ticket-text (slurp (str (ticket-path ticket-id)))
        previous (previous-run-summaries ticket-id)
        common (str "You are running inside codex-workspace as an automated Task Board worker.\n"
                    "Respond in Japanese when editing notes or summaries for the user.\n"
                    "Task Board lane is the source of truth. Do not move Task Board cards directly; the runner will do that after this run.\n"
                    "Ticket: " ticket-id "\n"
                    "Current lane: " lane "\n\n"
                    "Previous run summaries:\n" (pr-str previous) "\n\n"
                    "Ticket contents:\n\n" ticket-text "\n\n")]
    (case action
      :groom
      (str common
           "Goal: clarify this backlog ticket only. Do not implement code, do not create commits, and do not open PRs.\n"
           "Update the ticket file so Summary, Acceptance Criteria, Context, Plan, and Notes are specific enough for a human to review.\n"
           "Keep the scope practical and preserve existing decisions.\n"
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: review\n")

      :review-fix
      (str common
           "Goal: address review feedback or requested changes for this ticket.\n"
           "First inspect the ticket Notes, relevant repos, current git state, PR state if referenced, and tests.\n"
           "Do the requested work end to end where possible.\n"
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n"
           "Use done only when all acceptance criteria are satisfied. Use review when human review is needed. Use blocked when external input or unavailable infrastructure blocks progress.\n")

      :blocked-retry
      (str common
           "Goal: retry or re-investigate the blocked work.\n"
           "First verify whether the blocker is actually cleared. If still blocked, update Notes with the concrete blocker.\n"
           "Do the work end to end where possible.\n"
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n")

      :implement
      (str common
           "Goal: implement or complete this ticket.\n"
           "First inspect the ticket Notes, relevant repos, current git state, and existing project conventions.\n"
           "Do the work end to end where possible, including focused validation.\n"
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n"
           "Use done only when all acceptance criteria are satisfied. Use review when human review is needed. Use blocked when external input or unavailable infrastructure blocks progress.\n"))))

(defn result-marker [text]
  (when-let [[_ value] (re-find #"(?im)^TASK_BOARD_RESULT:\s*(done|review|blocked)\s*$" (or text ""))]
    value))

(defn run-codex! [ticket-id action lane lock]
  (let [run (:run-id lock)
        dir (run-dir ticket-id run)
        prompt-path (fs/path dir "prompt.md")
        stdout-path (fs/path dir "events.jsonl")
        stderr-path (fs/path dir "stderr.log")
        last-message-path (fs/path dir "last-message.md")
        stop? (atom false)
        hb (heartbeat! ticket-id lock stop?)]
    (fs/create-dirs dir)
    (spit (str prompt-path) (prompt-for action ticket-id lane))
    (mark-run! ticket-id run :running {:action action :lane lane :started-at (now-str)})
    (try
      (let [args (cond-> ["codex" "exec" "--json" "--cd" "/home/boxp"
                          "--output-last-message" (str last-message-path)]
                   (= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (conj "--dangerously-bypass-approvals-and-sandbox")

                   (not= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (conj "--sandbox" (env "CODEX_TASK_BOARD_SANDBOX" "workspace-write"))

                   (seq (System/getenv "CODEX_TASK_BOARD_MODEL"))
                   (conj "--model" (System/getenv "CODEX_TASK_BOARD_MODEL"))

                   (seq (System/getenv "CODEX_TASK_BOARD_PROFILE"))
                   (conj "--profile" (System/getenv "CODEX_TASK_BOARD_PROFILE"))

                   true
                   (conj "-"))
            proc @(p/process args {:in (io/file (str prompt-path))
                                   :out (io/file (str stdout-path))
                                   :err (io/file (str stderr-path))})
            exit (:exit proc)
            last-message (when (fs/exists? last-message-path)
                           (slurp (str last-message-path)))
            marker (result-marker last-message)]
        (let [status (if (zero? exit) :succeeded :failed)]
          (mark-run! ticket-id run status
                     {:action action
                      :lane lane
                      :exit-code exit
                      :result marker
                      :finished-at (now-str)}))
        {:exit exit :result marker :run-id run :dir (str dir)})
      (finally
        (reset! stop? true)
        @hb))))

(defn candidate-action [{:keys [lane status]} assignee]
  (when (= "codex" assignee)
    (case status
      "backlog" :groom
      "ready" :implement
      "in-progress" :implement
      "review" :review-fix
      "blocked" :blocked-retry
      nil)))

(defn final-status [action result exit]
  (cond
    (not (zero? exit)) "blocked"
    (= :groom action) "ready"
    (#{"done" "review" "blocked"} result) result
    :else "review"))

(defn process-card! [{:keys [ticket-id lane status] :as card}]
  (let [fm (ticket-frontmatter ticket-id)
        assignee (:assignee fm)
        action (candidate-action card assignee)]
    (when action
      (when (#{"ready" "review" "blocked"} status)
        (move-card! ticket-id "in-progress")
        (update-frontmatter! ticket-id {:status "in-progress"}))
      (let [effective-lane (if (#{"ready" "review" "blocked"} status) "In Progress" lane)
            lock (acquire-lock! ticket-id action effective-lane)]
        (when lock
          (try
            (append-note! ticket-id (str "Codex task-board run " (:run-id lock) " started from " lane " with action " (name action) "."))
            (let [{:keys [exit result run-id]} (run-codex! ticket-id action effective-lane lock)
                  next-status (final-status action result exit)]
              (move-card! ticket-id next-status)
              (update-frontmatter! ticket-id (cond-> {:status next-status
                                                       :assignee "boxp"}
                                                (= "done" next-status) (assoc :closed (today))))
              (append-note! ticket-id (str "Codex task-board run " run-id " finished with result " next-status "."))
              true)
            (catch Exception e
              (move-card! ticket-id "blocked")
              (update-frontmatter! ticket-id {:status "blocked" :assignee "boxp"})
              (append-note! ticket-id (str "Codex task-board run " (:run-id lock) " failed: " (.getMessage e)))
              true)
            (finally
              (release-lock! ticket-id))))))))

(defn tick! []
  (ensure-root!)
  (sync-all!)
  (let [cards (parse-board-cards (vec (read-lines (board-path))))
        candidates (filter (fn [{:keys [ticket-id] :as card}]
                             (let [assignee (:assignee (ticket-frontmatter ticket-id))]
                               (some? (candidate-action card assignee))))
                           cards)]
    (if-let [card (first candidates)]
      (do
        (println (str "processing " (:ticket-id card) " from " (:lane card)))
        (process-card! card))
      (println "no codex-assigned Task Board tickets"))))

(defn loop! []
  (println (str "codex task-board runner started, vault=" (vault) ", root=" (root)))
  (loop []
    (try
      (tick!)
      (catch Exception e
        (binding [*out* *err*]
          (println (str "task-board tick failed: " (.getMessage e))))))
    (Thread/sleep (* 1000 (Long/parseLong (env "CODEX_TASK_BOARD_POLL_SECONDS" "60"))))
    (recur)))

(defn usage []
  (println "usage: task_board_runner.bb <tick|loop|sync>")
  (System/exit 2))

(case (or (first *command-line-args*) "tick")
  "tick" (tick!)
  "loop" (loop!)
  "sync" (do (ensure-root!) (sync-all!))
  (usage))
