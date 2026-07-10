#!/usr/bin/env bb

(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[cheshire.core :as json]
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
(def supported-assignees #{"codex" "codex-sol" "codex-full" "codex-terra" "codex-mini" "fable"})

(def assignee->model
  ;; GPT-5.6 performance order: Sol > Terra > Luna.
  ;; codex (default) / codex-terra route to Terra (GPT-5.5-equivalent, cost-efficient default).
  ;; codex-sol / codex-full route to Sol (highest-performance, complex tasks only).
  ;; codex-mini routes to Luna (lightweight tier).
  {"codex"       "gpt-5.6-terra"
   "codex-sol"   "gpt-5.6-sol"
   "codex-full"  "gpt-5.6-sol"
   "codex-terra" "gpt-5.6-terra"
   "codex-mini"  "gpt-5.6-luna"})

(def board-mutex (Object.))
(def log-mutex (Object.))

(defn log! [message]
  (locking log-mutex
    (println message)))

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
  (locking board-mutex
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
        (write-lines! path moved)))))

(defn sync-board-statuses! []
  (locking board-mutex
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
        (write-lines! path new-lines)))))

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

(defn run-workspace-dir [ticket-id run-id]
  (fs/path (root) "workspaces" ticket-id run-id))

(defn state-path []
  (fs/path (root) "state.edn"))

(defn runner-state []
  (read-edn-file (state-path) {}))

(defn write-runner-state! [state]
  (write-edn-file! (state-path) state))

(defn env-long [k default]
  (Long/parseLong (env k default)))

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
    (when (fs/exists? (ticket-path ticket-id))
      (append-note! ticket-id (str "Codex run " stale-run " was marked interrupted after heartbeat timeout."))))
  (fs/delete-if-exists (lock-path ticket-id)))

(defn close-corrupt-lock! [ticket-id path error]
  (log! (str "closing corrupt lock: " ticket-id " (" (.getMessage error) ")"))
  (when (fs/exists? (ticket-path ticket-id))
    (append-note! ticket-id "Codex lock file was corrupt and was cleared so the runner can recover."))
  (fs/delete-if-exists path))

(defn lock-ticket-id [path]
  (second (re-find #"(BOXP-\d+)\.edn$" (str path))))

(defn cleanup-stale-locks! []
  (let [locks-dir (fs/path (root) "locks")]
    (when (fs/exists? locks-dir)
      (doseq [path (fs/list-dir locks-dir)
              :let [ticket-id (lock-ticket-id path)]
              :when ticket-id]
        (try
          (let [lock (read-edn-file path {})]
            (when (stale-lock? lock)
              (log! (str "closing stale lock: " ticket-id))
              (close-stale-lock! ticket-id lock)))
          (catch Exception e
            (close-corrupt-lock! ticket-id path e)))))))

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
      (try
        (let [existing (read-edn-file path {})]
          (if (stale-lock? existing)
            (do
              (close-stale-lock! ticket-id existing)
              (acquire-lock! ticket-id action lane))
            (do
              (log! (str "ticket already locked: " ticket-id))
              nil)))
        (catch Exception e
          (close-corrupt-lock! ticket-id path e)
          (acquire-lock! ticket-id action lane))))))

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

(defn pr-gate-retry-limit []
  (env-long "CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT" "2"))

(defn retry-fingerprint [review-gate]
  (str (:url review-gate) "|" (some-> (:gate review-gate) name) "|" (:message review-gate)))

(defn latest-pr-gate-retry [ticket-id]
  (let [retries (get-in (runner-state) [:pr-gate-retries ticket-id])]
    (when (seq retries)
      (->> (vals retries)
           (sort-by #(or (:updated-at %) ""))
           last))))

(defn pr-gate-retry-prompt [ticket-id]
  (when-let [{:keys [pr-url gate message run-id run-dir count limit agent]} (latest-pr-gate-retry ticket-id)]
    (str "Pending PR gate retry instruction:\n"
         "- Target PR URL: " pr-url "\n"
         "- Failed gate: " gate "\n"
         "- Failure reason: " message "\n"
         "- Retry agent: " (or agent "codex") "\n"
         "- Retry count for this same PR/gate/reason: " count "/" limit "\n"
         "- Previous run summary: " run-dir "/summary.edn\n"
         "- Previous run logs: " run-dir "/events.jsonl and " run-dir "/stderr.log\n"
         "- Expected completion state: update the same PR until draft/mergeability/CI/codex-review gates pass, then return TASK_BOARD_RESULT: review with the PR URL.\n\n")))

(defn record-pr-gate-failure! [ticket-id run-id agent review-gate]
  (let [limit (pr-gate-retry-limit)
        fingerprint (retry-fingerprint review-gate)
        path [:pr-gate-retries ticket-id fingerprint]
        state (runner-state)
        current (get-in state path)
        count (inc (long (or (:count current) 0)))
        record {:pr-url (:url review-gate)
                :gate (some-> (:gate review-gate) name)
                :message (:message review-gate)
                :run-id run-id
                :run-dir (str (run-dir ticket-id run-id))
                :agent agent
                :count count
                :limit limit
                :updated-at (now-str)}
        next-state (assoc-in state path record)]
    (write-runner-state! next-state)
    (assoc review-gate
           :retry-count count
           :retry-limit limit
           :retry-exhausted? (> count limit))))

(defn clear-pr-gate-retries! [ticket-id]
  (let [state (runner-state)
        retries (dissoc (:pr-gate-retries state) ticket-id)
        next-state (if (seq retries)
                     (assoc state :pr-gate-retries retries)
                     (dissoc state :pr-gate-retries))]
    (when (not= state next-state)
      (write-runner-state! next-state))))

(defn ticket-repos [ticket-id]
  (->> (str/split (or (:repo (ticket-frontmatter ticket-id)) "") #"[,\s]+")
       (map str/trim)
       (remove str/blank?)
       vec))

(defn local-repo-path [repo]
  (let [[owner name] (str/split repo #"/" 2)]
    (when (and owner name)
      (fs/path "/home/boxp/ghq/github.com" owner name))))

(defn ticket-worktree-branch [ticket-id run-id]
  (str "codex-task-board/" ticket-id "-" run-id))

(defn git-path [repo-path rev-parse-arg]
  (let [proc @(p/process ["git" "-C" (str repo-path) "rev-parse" rev-parse-arg]
                         {:out :string :err :string})]
    (when (zero? (:exit proc))
      (let [path (str/trim (:out proc))]
        (if (fs/absolute? path)
          path
          (str (fs/path repo-path path)))))))

(defn prepare-repo-worktree! [workspace-dir ticket-id run-id repo]
  (let [source (local-repo-path repo)
        target (fs/path workspace-dir "ghq/github.com" repo)
        branch (ticket-worktree-branch ticket-id run-id)]
    (if-not (and source (fs/exists? source))
      {:repo repo
       :missing true
       :message (str "Local checkout was not found at " source ". Clone or prepare this repository inside the run workspace if needed.")}
      (do
        (fs/create-dirs (fs/parent target))
        (let [proc @(p/process ["git" "-C" (str source) "worktree" "add" "-b" branch (str target) "HEAD"]
                               {:out :string :err :string})]
          (if (zero? (:exit proc))
            {:repo repo
             :path (str target)
             :branch branch
             :git-dirs (vec (distinct (remove str/blank?
                                               [(git-path target "--git-dir")
                                                (git-path target "--git-common-dir")])))}
            {:repo repo
             :worktree-failed true
             :message (str "Could not create a per-run worktree: " (:err proc)
                           " Clone or prepare this repository inside the run workspace if needed.")}))))))

(defn prepare-run-workspace! [ticket-id run-id]
  (let [workspace-dir (run-workspace-dir ticket-id run-id)
        repos (ticket-repos ticket-id)]
    (fs/create-dirs workspace-dir)
    {:workspace-dir (str workspace-dir)
     :repo-worktrees (mapv #(prepare-repo-worktree! workspace-dir ticket-id run-id %) repos)}))

(defn workspace-prompt [workspace]
  (let [repo-worktrees (:repo-worktrees workspace)
        prepared (filter :path repo-worktrees)
        unavailable (remove :path repo-worktrees)]
    (str "Ticket run workspace: " (:workspace-dir workspace) "\n"
         (if (seq prepared)
           (str "Repository worktrees for this run:\n"
                (str/join "" (map (fn [{:keys [repo path branch]}]
                                    (str "- " repo " -> " path " (branch " branch ")\n"))
                                  prepared))
                "Use these per-run worktrees for repository changes. Do not edit shared checkouts under /home/boxp/ghq for this task.\n")
           "No repository worktree was prepared for this ticket.\n")
         (when (seq unavailable)
           (str "Repositories that need preparation inside this run workspace:\n"
                (str/join "" (map (fn [{:keys [repo message]}]
                                    (str "- " repo ": " message "\n"))
                                  unavailable)))))))

(defn workspace-add-dirs [workspace]
  (->> (:repo-worktrees workspace)
       (mapcat :git-dirs)
       (remove str/blank?)
       distinct
       vec))

(defn fable-policy-prompt []
  (str "Fable routing policy:\n"
       "- You are the Claude Code fable entry point for this Task Board run.\n"
       "- Minimize fable token and limit consumption. Keep your own work focused on short judgment, routing, review perspective, and concise direction.\n"
       "- Delegate long investigation, implementation, file editing, and test execution to Codex whenever practical. If no explicit Codex model is supplied, use the default Codex route: gpt-5.6-terra (GPT-5.5-equivalent, cost-efficient), unless CODEX_TASK_BOARD_MODEL overrides it. Reserve gpt-5.6-sol (via codex-sol/codex-full assignees) for high-complexity tasks. Use the prepared workspace and repository worktrees from this prompt.\n"
       "- If Codex is delegated work, preserve the Task Board runner contract: include a concise delegated-work summary in your final response and end with exactly one TASK_BOARD_RESULT marker that the runner can parse.\n"
       "- For repository changes, make sure a GitHub PR URL is included before returning TASK_BOARD_RESULT: review. If no repository changes were made, include TASK_BOARD_REVIEW_PR: none.\n\n"))

(defn codex-sol-policy-prompt [agent]
  (str "High-cost model routing policy:\n"
       "- You are the " agent " high-cost entry point for this Task Board run.\n"
       "- Focus your own effort on task decomposition, results integration, critical decisions, and final review.\n"
       "- Delegate independent investigation, implementation, and verification to lower-cost models whenever practical. Use the codex (gpt-5.6-terra) assignee as the default delegation route, unless CODEX_TASK_BOARD_MODEL overrides it.\n"
       "- Do NOT delegate: tasks smaller than the delegation overhead, tasks requiring shared context or elevated permissions, and tasks requiring final judgment or acceptance.\n"
       "- If a delegated subtask fails, produces insufficient quality, or is unavailable: re-instruct once, verify the result, or handle it directly. Avoid recursive or unbounded delegation chains.\n"
       "- If Codex is delegated work, preserve the Task Board runner contract: include a concise delegated-work summary in your final response and end with exactly one TASK_BOARD_RESULT marker that the runner can parse.\n"
       "- For repository changes, make sure a GitHub PR URL is included before returning TASK_BOARD_RESULT: review. If no repository changes were made, include TASK_BOARD_REVIEW_PR: none.\n\n"))

(defn prompt-for [action ticket-id lane workspace agent]
  (let [ticket-text (slurp (str (ticket-path ticket-id)))
        previous (previous-run-summaries ticket-id)
        common (str "You are running inside codex-workspace as an automated Task Board worker.\n"
                    "Respond in Japanese when editing notes or summaries for the user.\n"
                    "Task Board lane is the source of truth. Do not move Task Board cards directly; the runner will do that after this run.\n"
                    "Ticket: " ticket-id "\n"
                    "Task Board assignee/agent: " agent "\n"
                    "Current lane: " lane "\n\n"
                    (workspace-prompt workspace) "\n"
                    "Previous run summaries:\n" (pr-str previous) "\n\n"
                    (or (pr-gate-retry-prompt ticket-id) "")
                    (when (= "fable" agent) (fable-policy-prompt))
                    (when (contains? #{"codex-sol" "codex-full"} agent) (codex-sol-policy-prompt agent))
                    "Ticket contents:\n\n" ticket-text "\n\n")
        review-contract (str "When repository changes are part of the work, create or update a GitHub PR before returning TASK_BOARD_RESULT: review.\n"
                             "If you return TASK_BOARD_RESULT: review, include either a GitHub PR URL or exactly one line TASK_BOARD_REVIEW_PR: none when no repository changes were made.\n")]
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
           review-contract
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n"
           "Use done only when all acceptance criteria are satisfied. Use review when human review is needed. Use blocked when external input or unavailable infrastructure blocks progress.\n")

      :blocked-retry
      (str common
           "Goal: retry or re-investigate the blocked work.\n"
           "First verify whether the blocker is actually cleared. If still blocked, update Notes with the concrete blocker.\n"
           "Do the work end to end where possible.\n"
           review-contract
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n")

      :implement
      (str common
           "Goal: implement or complete this ticket.\n"
           "First inspect the ticket Notes, relevant repos, current git state, and existing project conventions.\n"
           "Do the work end to end where possible, including focused validation.\n"
           review-contract
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n"
           "Use done only when all acceptance criteria are satisfied. Use review when human review is needed. Use blocked when external input or unavailable infrastructure blocks progress.\n"))))

(defn result-marker [text]
  (when-let [[_ value] (re-find #"(?im)^TASK_BOARD_RESULT:\s*(done|review|blocked)\s*$" (or text ""))]
    value))

(defn github-pr-url? [text]
  (boolean (re-find #"https://github\.com/[^/\s]+/[^/\s]+/pull/\d+" (or text ""))))

(defn github-pr-urls [text]
  (->> (re-seq #"https://github\.com/[^/\s]+/[^/\s]+/pull/\d+" (or text ""))
       distinct
       vec))

(defn no-repo-review-marker? [text]
  (boolean (re-find #"(?im)^TASK_BOARD_REVIEW_PR:\s*none\s*$" (or text ""))))

(defn review-ready? [text]
  (or (github-pr-url? text)
      (no-repo-review-marker? text)))

(defn pr-gate-timeout-seconds []
  (env-long "CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS" "1800"))

(defn pr-gate-poll-seconds []
  (env-long "CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS" "15"))

(defn run-string! [args opts]
  (let [proc @(p/process args (merge {:out :string :err :string} opts))]
    (if (zero? (:exit proc))
      (:out proc)
      (throw (ex-info (str "command failed: " (str/join " " args) "\n" (:err proc))
                      {:args args :exit (:exit proc) :err (:err proc)})))))

(defn get-codex-model [assignee env-model]
  (or (when (seq env-model) env-model)
      (get assignee->model assignee)))

(defn codex-model-profile-args
  ([] (codex-model-profile-args nil))
  ([assignee]
   (let [env-model (env "CODEX_TASK_BOARD_MODEL" nil)
         env-profile (env "CODEX_TASK_BOARD_PROFILE" nil)]
     (codex-model-profile-args assignee env-model env-profile)))
  ([assignee env-model env-profile]
   (let [model (get-codex-model assignee env-model)]
     (cond-> []
       model
       (conj "--model" model)

       (seq env-profile)
       (conj "--profile" env-profile)))))

(defn pr-view [pr-url]
  (-> (run-string! ["gh" "pr" "view" pr-url "--json" "url,isDraft,mergeStateStatus,statusCheckRollup"] {})
      (json/parse-string true)))

(defn check-name [check]
  (or (:name check)
      (:context check)
      (:workflowName check)
      (:displayName check)
      "unknown check"))

(def successful-check-conclusions
  #{"SUCCESS" "SKIPPED" "NEUTRAL"})

(defn check-completed? [check]
  (or (= "COMPLETED" (some-> (:status check) str/upper-case))
      (contains? #{"SUCCESS" "FAILURE" "ERROR"}
                 (some-> (:state check) str/upper-case))))

(defn check-successful? [check]
  (and (check-completed? check)
       (or (contains? successful-check-conclusions
                     (some-> (:conclusion check) str/upper-case))
           (= "SUCCESS" (some-> (:state check) str/upper-case)))))

(defn check-failed? [check]
  (and (check-completed? check)
       (not (check-successful? check))))

(defn ci-state [checks]
  (let [checks (vec checks)
        failed (filter check-failed? checks)
        pending (remove check-completed? checks)]
    (cond
      (empty? checks)
      {:state :pending
       :message "No CI checks have been reported for this PR yet."}

      (seq failed)
      {:state :failed
       :message (str "CI checks failed: "
                     (str/join ", " (map (fn [check]
                                            (str (check-name check) "=" (:conclusion check)))
                                          failed)))}

      (seq pending)
      {:state :pending
       :message (str "CI checks still pending: "
                     (str/join ", " (map check-name pending)))}

      :else
      {:state :passed
       :message (str "CI checks passed: " (str/join ", " (map check-name checks)))})))

(defn merge-state [pr]
  (let [state (some-> (:mergeStateStatus pr) str/upper-case)]
    (cond
      (:isDraft pr)
      {:state :failed
       :gate :mergeability
       :message "GitHub reports this PR is still a draft."}

      (= "DIRTY" state)
      {:state :failed
       :gate :conflict
       :message "GitHub reports mergeStateStatus=DIRTY, which indicates conflicts with the base branch."}

      (#{"UNKNOWN" "BEHIND"} state)
      {:state :pending
       :gate :mergeability
       :message (str "GitHub mergeStateStatus=" state " is not ready yet.")}

      (#{"CLEAN" "HAS_HOOKS" "BLOCKED" "UNSTABLE"} state)
      {:state :passed
       :message (str "GitHub mergeStateStatus=" state ".")}

      :else
      {:state :failed
       :gate :mergeability
       :message (str "GitHub mergeStateStatus=" (or state "missing") " is not review-ready.")})))

(defn wait-for-pr-state! [pr-url]
  (let [deadline (+ (System/currentTimeMillis) (* 1000 (pr-gate-timeout-seconds)))]
    (loop []
      (let [pr (pr-view pr-url)
            merge (merge-state pr)
            ci (ci-state (:statusCheckRollup pr))]
        (cond
          (= :failed (:state merge))
          {:ok? false
           :gate (:gate merge)
           :url pr-url
           :retryable? true
           :message (:message merge)}

          (= :failed (:state ci))
          {:ok? false
           :gate :ci
           :url pr-url
           :retryable? true
           :message (:message ci)}

          (and (= :passed (:state merge))
               (= :passed (:state ci)))
          {:ok? true
           :url pr-url
           :message (str (:message merge) " " (:message ci))}

          (> (System/currentTimeMillis) deadline)
          {:ok? false
           :gate (if (= :pending (:state merge)) (:gate merge) :ci)
           :url pr-url
           :retryable? true
           :message (str "Timed out waiting for PR gates. " (:message merge) " " (:message ci))}

          :else
          (do
            (Thread/sleep (* 1000 (pr-gate-poll-seconds)))
            (recur)))))))

(defn codex-review-clean? [text]
  (boolean (re-find #"(?im)^CODEX_REVIEW_RESULT:\s*clean\s*$" (or text ""))))

(defn codex-review-summary [text]
  (->> (str/split-lines (or text ""))
       (remove #(re-find #"(?im)^CODEX_REVIEW_RESULT:" %))
       (remove str/blank?)
       (take 6)
       (str/join " ")))

(defn run-codex-review! [run-dir pr-url]
  (let [diff (run-string! ["gh" "pr" "diff" pr-url] {})
        review-path (fs/path run-dir (str "codex-review-" (last (str/split pr-url #"/")) ".md"))
        prompt (str "CODEX_REVIEW_GATE\n"
                    "Review this GitHub PR diff for actionable bugs, regressions, missing tests, or acceptance-criteria gaps.\n"
                    "Return CODEX_REVIEW_RESULT: clean only if there are no actionable findings.\n"
                    "Return CODEX_REVIEW_RESULT: issues when any actionable finding remains, followed by a concise summary.\n\n"
                    "PR: " pr-url "\n\n"
                    diff)
        proc @(p/process (cond-> ["codex" "exec"
                                  "--skip-git-repo-check"
                                  "--output-last-message" (str review-path)]
                           true
                           (into (codex-model-profile-args "codex"))

                           true
                           (conj "-"))
                         {:in prompt :out :string :err :string})
        last-message (when (fs/exists? review-path)
                       (slurp (str review-path)))]
    (cond
      (not (zero? (:exit proc)))
      {:ok? false
       :gate :codex-review
       :url pr-url
       :retryable? false
       :message (str "codex review command failed: " (:err proc))}

      (codex-review-clean? last-message)
      {:ok? true
       :url pr-url
       :message "codex review reported no actionable findings."}

      :else
      {:ok? false
       :gate :codex-review
       :url pr-url
       :retryable? true
       :message (str "codex review reported actionable findings"
                     (when-let [summary (not-empty (codex-review-summary last-message))]
                       (str ": " summary)))})))

(defn review-gate! [run-dir last-message]
  (try
    (let [pr-urls (github-pr-urls last-message)]
      (cond
        (seq pr-urls)
        (loop [remaining pr-urls
               passed []]
          (if-let [pr-url (first remaining)]
            (let [pr-state (wait-for-pr-state! pr-url)]
              (if-not (:ok? pr-state)
                (assoc pr-state
                       :checked-pr-urls passed
                       :pr-urls pr-urls)
                (let [review (run-codex-review! run-dir pr-url)
                      passed-message (str pr-url ": " (:message pr-state) " " (:message review))]
                  (if-not (:ok? review)
                    (assoc review
                           :checked-pr-urls passed
                           :pr-urls pr-urls
                           :message (str pr-url ": " (:message pr-state) " " (:message review)))
                    (recur (rest remaining) (conj passed passed-message))))))
            {:ok? true
             :pr-urls pr-urls
             :message (str "All PR gates passed for "
                           (count pr-urls)
                           " PR(s): "
                           (str/join " | " passed))}))

        (no-repo-review-marker? last-message)
        {:ok? true
         :message "TASK_BOARD_REVIEW_PR: none was provided; PR gates were skipped because no repository changes were reported."}

        :else
        {:ok? false
         :gate :pr-url
         :retryable? false
         :message "Review was requested without a GitHub PR URL or TASK_BOARD_REVIEW_PR: none marker."}))
    (catch Exception e
      {:ok? false
       :gate :pr-gate
       :retryable? false
       :message (.getMessage e)})))

(defn fable-model-args []
  ;; Fable runs via the `claude` CLI. Model defaults to claude CLI's built-in default
  ;; (claude-sonnet-4-6) unless CODEX_TASK_BOARD_FABLE_MODEL overrides it.
  (let [model (System/getenv "CODEX_TASK_BOARD_FABLE_MODEL")
        agent (env "CODEX_TASK_BOARD_FABLE_AGENT" "fable")
        extra (System/getenv "CODEX_TASK_BOARD_FABLE_EXTRA_ARGS")]
    (cond-> []
      (seq model)
      (into ["--model" model])

      (seq agent)
      (into ["--agent" agent])

      (seq extra)
      (into (str/split extra #"\s+")))))

(defn run-agent! [ticket-id action lane agent lock]
  (let [run (:run-id lock)
        dir (run-dir ticket-id run)
        workspace (prepare-run-workspace! ticket-id run)
        prompt-path (fs/path dir "prompt.md")
        stdout-path (fs/path dir "events.jsonl")
        stderr-path (fs/path dir "stderr.log")
        last-message-path (fs/path dir "last-message.md")]
    (fs/create-dirs dir)
    (spit (str prompt-path) (prompt-for action ticket-id lane workspace agent))
    (mark-run! ticket-id run :running {:action action :agent agent :lane lane :started-at (now-str)})
    (let [args (case agent
                 "fable"
                 (cond-> ["claude" "--print" "--output-format" "text"]
                   (= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (conj "--dangerously-skip-permissions")

                   (not= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (into (mapcat (fn [dir] ["--add-dir" dir])
                                 (cons (vault) (workspace-add-dirs workspace))))

                   true
                   (into (fable-model-args)))

                 (cond-> ["codex" "exec" "--json" "--cd" (:workspace-dir workspace)
                          "--skip-git-repo-check"
                          "--output-last-message" (str last-message-path)]
                   (= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (conj "--dangerously-bypass-approvals-and-sandbox")

                   (not= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (into ["--sandbox" (env "CODEX_TASK_BOARD_SANDBOX" "workspace-write")
                          "--add-dir" (vault)])

                   (not= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (into (mapcat (fn [dir] ["--add-dir" dir]) (workspace-add-dirs workspace)))

                   true
                   (into (codex-model-profile-args agent))

                   true
                   (conj "-")))
          proc @(p/process args (cond-> {:in (io/file (str prompt-path))
                                         :out (io/file (str stdout-path))
                                         :err (io/file (str stderr-path))}
                                  (= "fable" agent)
                                  (assoc :dir (:workspace-dir workspace))))
          exit (:exit proc)
          _ (when (and (= "fable" agent) (fs/exists? stdout-path))
              (io/copy (io/file (str stdout-path))
                       (io/file (str last-message-path))))
          last-message (when (fs/exists? last-message-path)
                         (slurp (str last-message-path)))
          marker (result-marker last-message)]
      (let [status (if (zero? exit) :succeeded :failed)]
        (mark-run! ticket-id run status
                   {:action action
                    :agent agent
                    :lane lane
                    :exit-code exit
                    :result marker
                    :finished-at (now-str)}))
      {:exit exit :result marker :run-id run :dir (str dir) :last-message last-message})))

(defn candidate-action [{:keys [lane status]} assignee]
  (when (contains? supported-assignees assignee)
    (case status
      "backlog" :groom
      "ready" :implement
      "in-progress" :implement
      "review" :review-fix
      "blocked" :blocked-retry
      nil)))

(defn final-status [action result exit review-gate]
  (let [intended (cond
                   (not (zero? exit)) "blocked"
                   (= :groom action) "ready"
                   (#{"done" "review" "blocked"} result) result
                   :else "review")]
    (cond
      (and (= "review" intended)
           (not (:ok? review-gate))
           (:retryable? review-gate)
           (not (:retry-exhausted? review-gate)))
      "in-progress"

      (and (= "review" intended) (not (:ok? review-gate)))
      "blocked"

      :else
      intended)))

(defn final-note [run-id next-status result last-message review-gate]
  (let [base (str "Codex task-board run " run-id " finished with result " next-status ".")
        pr-urls (github-pr-urls last-message)]
    (cond
      (and (= "blocked" next-status)
           (not (#{"done" "blocked"} result))
           (not (:ok? review-gate)))
      (str base " Review gate failed"
           (when-let [gate (:gate review-gate)]
             (str " (" (name gate) ")"))
           (when-let [url (:url review-gate)]
             (str " for " url))
           ": " (:message review-gate))

      (and (= "in-progress" next-status)
           (not (:ok? review-gate))
           (:retryable? review-gate))
      (str base " Review gate failed"
           (when-let [gate (:gate review-gate)]
             (str " (" (name gate) ")"))
           (when-let [url (:url review-gate)]
             (str " for " url))
           ": " (:message review-gate)
           " Retrying with Codex instruction "
           (:retry-count review-gate) "/" (:retry-limit review-gate) ".")

      (and (= "review" next-status) (seq pr-urls))
      (str base " PR: " (str/join ", " pr-urls) ". Review gates passed: " (:message review-gate))

      :else
      base)))

(defn process-card! [{:keys [ticket-id lane status] :as card}]
  (let [fm (ticket-frontmatter ticket-id)
        assignee (:assignee fm)
        action (candidate-action card assignee)]
    (when action
      (let [effective-lane (if (#{"ready" "review" "blocked"} status) "In Progress" lane)
            lock (acquire-lock! ticket-id action effective-lane)]
        (when lock
          (let [stop? (atom false)
                hb (heartbeat! ticket-id lock stop?)]
            (try
              (when (#{"ready" "review" "blocked"} status)
                (move-card! ticket-id "in-progress")
                (update-frontmatter! ticket-id {:status "in-progress"}))
              (append-note! ticket-id (str "Codex task-board run " (:run-id lock) " started from " lane " with action " (name action) " using " assignee "."))
              (let [{:keys [exit result run-id dir last-message]} (run-agent! ticket-id action effective-lane assignee lock)
                    intended (cond
                               (not (zero? exit)) "blocked"
                               (= :groom action) "ready"
                               (#{"done" "review" "blocked"} result) result
                               :else "review")
                    review-gate (if (= "review" intended)
                                  (let [gate-result (review-gate! dir last-message)]
                                    (if (and (not (:ok? gate-result))
                                             (:retryable? gate-result))
                                      (record-pr-gate-failure! ticket-id run-id assignee gate-result)
                                      gate-result))
                                  {:ok? true})
                    next-status (final-status action result exit review-gate)]
                (when (= "review" intended)
                  (mark-run! ticket-id run-id (cond
                                                (:ok? review-gate) :succeeded
                                                (= "in-progress" next-status) :retrying
                                                :else :blocked)
                             {:action action
                              :agent assignee
                              :lane effective-lane
                              :exit-code exit
                              :result result
                              :review-gate review-gate
                              :finished-at (now-str)}))
                (when (:ok? review-gate)
                  (clear-pr-gate-retries! ticket-id))
                (move-card! ticket-id next-status)
                (update-frontmatter! ticket-id (cond-> {:status next-status
                                                         :assignee (if (= "in-progress" next-status) assignee "boxp")}
                                                  (= "done" next-status) (assoc :closed (today))))
                (append-note! ticket-id (final-note run-id next-status result last-message review-gate))
                true)
              (catch Exception e
                (move-card! ticket-id "blocked")
                (update-frontmatter! ticket-id {:status "blocked" :assignee "boxp"})
                (append-note! ticket-id (str "Codex task-board run " (:run-id lock) " failed: " (.getMessage e)))
                true)
              (finally
                (reset! stop? true)
                @hb
                (release-lock! ticket-id)))))))))

(defn ticket-assignee [ticket-id]
  (let [path (ticket-path ticket-id)]
    (if (fs/exists? path)
      (:assignee (ticket-frontmatter ticket-id))
      (do
        (log! (str "ticket file not found, skipping card: " ticket-id))
        nil))))

(defn candidate-cards []
  (let [cards (parse-board-cards (vec (read-lines (board-path))))]
    (->> cards
         (filter (fn [{:keys [ticket-id] :as card}]
                   (some? (candidate-action card (ticket-assignee ticket-id)))))
         vec)))

(defn tick! []
  (ensure-root!)
  (cleanup-stale-locks!)
  (sync-all!)
  (let [candidates (candidate-cards)
        runs (doall
              (for [card candidates]
                (future
                  (log! (str "processing " (:ticket-id card) " from " (:lane card)))
                  (let [started? (process-card! card)]
                    (when-not started?
                      (log! (str "candidate could not start, leaving it for a future tick: " (:ticket-id card))))
                    {:ticket-id (:ticket-id card)
                     :started? (boolean started?)}))))
        results (doall (map deref runs))
        processed (count (filter :started? results))]
    (sync-all!)
    (log! (cond
            (empty? candidates) "no supported-agent-assigned Task Board tickets"
            (zero? processed) "no supported-agent-assigned Task Board tickets could start"
            :else (str "processed " processed " supported-agent-assigned Task Board ticket(s) in parallel")))))

(defn loop! []
  (log! (str "codex task-board runner started, vault=" (vault) ", root=" (root)))
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

(defn arg-value [args flag]
  (let [idx (.indexOf args flag)]
    (when (>= idx 0) (nth args (inc idx)))))

(defn run-tests! []
  (let [failures (atom [])]
    (doseq [[assignee expected-model] [["codex"       "gpt-5.6-terra"]
                                       ["codex-sol"   "gpt-5.6-sol"]
                                       ["codex-full"  "gpt-5.6-sol"]
                                       ["codex-terra" "gpt-5.6-terra"]
                                       ["codex-mini"  "gpt-5.6-luna"]]]
      (let [actual-model (get-codex-model assignee nil)]
        (if (= actual-model expected-model)
          (println (str "PASS: " assignee " -> " actual-model))
          (do
            (println (str "FAIL: " assignee " expected=" expected-model " actual=" actual-model))
            (swap! failures conj assignee)))))
    (let [args (codex-model-profile-args "codex-full" "gpt-test-override" nil)
          actual-model (arg-value args "--model")]
      (if (= actual-model "gpt-test-override")
        (println (str "PASS: CODEX_TASK_BOARD_MODEL overrides assignee model -> " actual-model))
        (do
          (println (str "FAIL: CODEX_TASK_BOARD_MODEL override expected=gpt-test-override actual=" actual-model))
          (swap! failures conj "CODEX_TASK_BOARD_MODEL override"))))
    ;; Verify run-codex-review! default: codex-model-profile-args "codex" without env override
    (let [args (codex-model-profile-args "codex" nil nil)
          actual-model (arg-value args "--model")]
      (if (= actual-model "gpt-5.6-terra")
        (println (str "PASS: codex-review gate default model -> " actual-model))
        (do
          (println (str "FAIL: codex-review gate default model expected=gpt-5.6-terra actual=" actual-model))
          (swap! failures conj "codex-review default model"))))
    (if (seq @failures)
      (do (println (str "FAILED: " (count @failures) " test(s) failed")) (System/exit 1))
      (println "All assignee model tests passed."))))

(case (or (first *command-line-args*) "tick")
  "tick" (tick!)
  "loop" (loop!)
  "sync" (do (ensure-root!) (sync-all!))
  "test" (run-tests!)
  (usage))
