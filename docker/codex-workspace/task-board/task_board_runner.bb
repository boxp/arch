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
(def assignee->model
  ;; Model performance order: gpt-6-astra > gpt-6.1-sol > gpt-5.6-terra > gpt-5.6-luna.
  ;; codex (default) / codex-terra route to Terra (GPT-5.5-equivalent, cost-efficient default).
  ;; codex-sol / codex-full route to gpt-6.1-sol (GPT-6.1 Sol, nearly matches Astra at lower cost; complex tasks only).
  ;; codex-mini routes to Luna (lightweight tier).
  ;; codex-astra routes to gpt-6-astra (GPT-6 generation, most capable, highest cost).
  {"codex"       "gpt-5.6-terra"
   "codex-sol"   "gpt-6.1-sol"
   "codex-full"  "gpt-6.1-sol"
   "codex-terra" "gpt-5.6-terra"
   "codex-mini"  "gpt-5.6-luna"
   "codex-astra" "gpt-6-astra"})

(def reasoning-levels #{"minimal" "low" "medium" "high" "xhigh"})

;; I1 introduces only a structural validator. Activation requires the later
;; authenticated control/writer gates; no environment value can enable it here.
(defn autonomy-v2-enabled? [] false)

;; gpt-6-astra supports only low/medium/high reasoning efforts.
(def astra-reasoning-levels #{"low" "medium" "high"})

;; gpt-6.1-sol rejects minimal; runner exposes low/medium/high/xhigh.
(def sol-reasoning-levels #{"low" "medium" "high" "xhigh"})

;; Per-assignee override; assignees not listed here accept all reasoning-levels.
(def assignee->reasoning-levels
  {"codex-astra" astra-reasoning-levels
   "codex-sol"   sol-reasoning-levels
   "codex-full"  sol-reasoning-levels})

(def board-mutex (Object.))
(def log-mutex (Object.))

;; Fixed pool of 256 lock objects (striped locking). Serializes all ticket-scoped
;; mutations in this JVM, including frontmatter / Notes writes and the process-shared
;; lock guard, with bounded memory regardless of the number of distinct ticket IDs.
(def ^:private ticket-lock-stripes
  (vec (repeatedly 256 #(Object.))))

(def ^:private owner-lock-stripes
  (vec (repeatedly 256 #(Object.))))

(defn ticket-mutex [ticket-id]
  (nth ticket-lock-stripes
       (Math/floorMod (.hashCode (str ticket-id)) (count ticket-lock-stripes))))

(defn owner-mutex [owner]
  (nth owner-lock-stripes
       (Math/floorMod (.hashCode (str owner)) (count owner-lock-stripes))))

(defn log! [message]
  (locking log-mutex
    (println message)))

(defn env [k default]
  (or (System/getenv k) default))

(defn parse-codex-assignee [assignee]
  (cond
    (contains? assignee->model assignee)
    {:base-assignee assignee}

    :else
    (when-let [[_ base-assignee reasoning-effort]
               (re-matches #"^(.*)-([^-]+)$" (or assignee ""))]
      (let [allowed-levels (get assignee->reasoning-levels base-assignee reasoning-levels)]
        (when (and (contains? assignee->model base-assignee)
                   (contains? allowed-levels reasoning-effort))
          {:base-assignee base-assignee
           :reasoning-effort reasoning-effort})))))

(def claude-assignee->model
  {"claude-fable" "claude-fable-5-1"
   "claude-opus" "claude-opus-5-5"
   "claude-sonnet" "claude-sonnet-5-5"})

(defn claude-assignee? [assignee]
  (or (= "fable" assignee)
      (contains? claude-assignee->model assignee)))

(defn supported-assignee? [assignee]
  (or (claude-assignee? assignee)
      (some? (parse-codex-assignee assignee))))

(defn root []
  (env "CODEX_TASK_BOARD_ROOT" default-root))

(defn owner-id []
  (env "CODEX_TASK_BOARD_OWNER_ID"
       (or (System/getenv "HOSTNAME") "unknown-owner")))

(def runner-instance-id
  (env "CODEX_TASK_BOARD_RUNNER_INSTANCE_ID"
       (str (java.util.UUID/randomUUID))))

(defn safe-owner-id [value]
  (str/replace (str value) #"[^A-Za-z0-9._-]" "_"))

(defn owners-dir []
  (fs/path (root) "owners"))

(defn terminating-owners-dir []
  (fs/path (root) "terminating-owners"))

(defn lock-guards-dir []
  (fs/path (root) "lock-guards"))

(defn owner-lock-guards-dir []
  (fs/path (root) "owner-lock-guards"))

(defn owner-state-path
  ([] (owner-state-path (owner-id)))
  ([value] (fs/path (owners-dir) (str (safe-owner-id value) ".edn"))))

(defn shutdown-marker-path
  ([] (shutdown-marker-path (owner-id)))
  ([value] (fs/path (terminating-owners-dir) (str (safe-owner-id value) ".edn"))))

(defn owner-lock-guard-path [value]
  (fs/path (owner-lock-guards-dir) (str (safe-owner-id value) ".lock")))

(defn with-owner-lock-guard [value f]
  ;; Planned-shutdown marker changes and every lock acquisition for an owner must
  ;; share one cross-process critical section. Ticket guards cannot close the gap
  ;; between a directory-wide rescan and deleting the owner marker.
  (let [guard-key (safe-owner-id value)]
    (locking (owner-mutex guard-key)
      (fs/create-dirs (owner-lock-guards-dir))
      (with-open [file (java.io.RandomAccessFile. (str (owner-lock-guard-path guard-key)) "rw")
                  channel (.getChannel file)]
        (let [_file-lock (.lock channel)]
          (f))))))

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

(defn run-timestamp []
  (env "CODEX_TASK_BOARD_RUN_TIMESTAMP"
       (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
                (java.time.ZonedDateTime/now java.time.ZoneOffset/UTC))))

(defn unique-run-id [timestamp]
  (str timestamp "-" (java.util.UUID/randomUUID)))

(defn run-id []
  (unique-run-id (run-timestamp)))

(defn fail [message]
  (binding [*out* *err*]
    (println (str "error: " message)))
  (System/exit 1))

(defn ensure-root! []
  (doseq [path [(root)
                (fs/path (root) "locks")
                (fs/path (root) "runs")
                (owners-dir)
                (terminating-owners-dir)
                (lock-guards-dir)
                (owner-lock-guards-dir)]]
    (fs/create-dirs path)))

(defn read-edn-file [path fallback]
  (if (fs/exists? path)
    (edn/read-string (slurp (str path)))
    fallback))

(defn write-edn-file! [path value]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (pr-str value) "\n")))

(defn activate-owner! []
  (with-owner-lock-guard
   (owner-id)
   #(write-edn-file! (owner-state-path)
                     {:owner-id (owner-id)
                      :instance-id runner-instance-id
                      :status :active
                      :host (or (System/getenv "HOSTNAME") "unknown")
                      :pid (.pid (java.lang.ProcessHandle/current))
                      :started-at (now-str)})))

(defn prepare-shutdown! []
  (ensure-root!)
  (with-owner-lock-guard
   (owner-id)
   (fn []
     (let [active (try
                    (read-edn-file (owner-state-path) {})
                    (catch Exception _ {}))
           instance (or (:instance-id active) runner-instance-id)
           requested-at (now-str)
           marker {:owner-id (owner-id)
                   :instance-id instance
                   :host (or (:host active) (System/getenv "HOSTNAME") "unknown")
                   :requested-at requested-at}]
       (write-edn-file! (owner-state-path)
                        (merge active
                               {:owner-id (owner-id)
                                :instance-id instance
                                :status :terminating
                                :shutdown-requested-at requested-at}))
       (write-edn-file! (shutdown-marker-path) marker)
       (log! (str "prepared shutdown for owner " (:owner-id marker)
                  ", instance=" (or (:instance-id marker) "unknown")))
       marker))))

(def shutdown-hook-installed? (atom false))

(defn install-shutdown-hook! []
  (when (compare-and-set! shutdown-hook-installed? false true)
    (.addShutdownHook
     (Runtime/getRuntime)
     (Thread.
      ^Runnable
      (fn []
        (try
          (prepare-shutdown!)
          (catch Exception e
            (binding [*out* *err*]
              (println (str "failed to prepare task-board shutdown: " (.getMessage e)))))))))))

(defn current-runner-marker? [marker]
  (and (= (owner-id) (:owner-id marker))
       (= runner-instance-id (:instance-id marker))))

(defn current-owner-marker? [marker]
  (= (owner-id) (:owner-id marker)))

(defn previous-runner-marker? [marker]
  (and (current-owner-marker? marker)
       (not (current-runner-marker? marker))))

(defn stopping-owner-state? [state]
  (and (= (owner-id) (:owner-id state))
       (contains? #{:terminating :terminated} (:status state))))

(defn draining? []
  (try
    (or (when (fs/exists? (shutdown-marker-path))
          (current-owner-marker? (read-edn-file (shutdown-marker-path) {})))
        (when (fs/exists? (owner-state-path))
          (stopping-owner-state? (read-edn-file (owner-state-path) {}))))
    (catch Exception _ false)))

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
  (locking (ticket-mutex ticket-id)
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
        (write-lines! path new-lines)))))

(defn ticket-frontmatter [ticket-id]
  (frontmatter-map (vec (read-lines (ticket-path ticket-id)))))

(defn append-note! [ticket-id note]
  (locking (ticket-mutex ticket-id)
    ;; Deterministic black-box failure hook; unset in deployment.
    (when (and (= "true" (System/getenv "CODEX_TASK_BOARD_TEST_FAIL_BLOCKER_NOTE"))
               (str/includes? note "Blocked transition recorded:"))
      (throw (ex-info "forced blocker Notes write failure" {})))
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
      (write-lines! path new-lines))))

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
     (Long/parseLong (env "CODEX_TASK_BOARD_LOCK_STALE_SECONDS" "180"))))

(defn current-runner-lock? [lock]
  (and (= (owner-id) (:owner-id lock))
       (= runner-instance-id (:owner-instance-id lock))))

(defn same-ticket-lock? [expected actual]
  (and (= (:ticket expected) (:ticket actual))
       (= (:run-id expected) (:run-id actual))
       (= (:owner-id expected) (:owner-id actual))
       (= (:owner-instance-id expected) (:owner-instance-id actual))))

(defn ticket-lock-guard-path [ticket-id]
  (fs/path (lock-guards-dir) (str (safe-owner-id ticket-id) ".lock")))

(defn with-ticket-lock-guard [ticket-id f]
  ;; `locking` serializes threads in this JVM. FileLock extends the same critical
  ;; section to helper commands and replacement runner JVMs sharing the PVC.
  (locking (ticket-mutex ticket-id)
    (fs/create-dirs (lock-guards-dir))
    (with-open [file (java.io.RandomAccessFile. (str (ticket-lock-guard-path ticket-id)) "rw")
                channel (.getChannel file)]
      (let [_file-lock (.lock channel)]
        ;; Closing the channel releases all of its locks; Babashka does not expose
        ;; FileLock.release on the JDK's internal FileLock implementation.
        (f)))))

(defn delete-lock-if-matches-under-guard! [ticket-id expected]
  (let [path (lock-path ticket-id)
        actual (try
                 (read-edn-file path nil)
                 (catch Exception _ nil))]
    (when (same-ticket-lock? expected actual)
      ;; Deterministic black-box race hook; unset in the deployment.
      (when-let [signal-path (System/getenv "CODEX_TASK_BOARD_TEST_BEFORE_LOCK_DELETE_SIGNAL")]
        (spit signal-path "ready\n"))
      (when-let [hold-ms (System/getenv "CODEX_TASK_BOARD_TEST_BEFORE_LOCK_DELETE_MILLIS")]
        (Thread/sleep (Long/parseLong hold-ms)))
      (fs/delete-if-exists path)
      true)))

(defn delete-lock-if-matches! [ticket-id expected]
  (with-ticket-lock-guard
   ticket-id
   #(delete-lock-if-matches-under-guard! ticket-id expected)))

(defn mark-run! [ticket-id run-id status extra]
  (let [path (fs/path (run-dir ticket-id run-id) "summary.edn")
        ;; Later lifecycle transitions replace the summary. Keep the selected
        ;; assignee so failed and blocked runs remain attributable in history.
        previous-agent (try
                         (select-keys (read-edn-file path {}) [:agent])
                         (catch Exception _ {}))
        summary (merge previous-agent
                       {:ticket ticket-id
                        :run-id run-id
                        :status status
                        :updated-at (now-str)}
                       extra)]
    (write-edn-file! path summary)))

(defn close-interrupted-lock! [ticket-id lock reason note]
  (when-let [interrupted-run (:run-id lock)]
    (mark-run! ticket-id interrupted-run :interrupted
               {:reason reason
                :previous-lock lock})
    (when (fs/exists? (ticket-path ticket-id))
      (append-note! ticket-id (str "Codex run " interrupted-run " " note))))
  (delete-lock-if-matches-under-guard! ticket-id lock))

(defn close-stale-lock! [ticket-id lock]
  (close-interrupted-lock! ticket-id lock
                           "heartbeat timeout"
                           "was marked interrupted after heartbeat timeout."))

(defn close-planned-shutdown-lock! [ticket-id lock marker]
  (close-interrupted-lock! ticket-id lock
                           "planned workspace shutdown"
                           (str "was marked interrupted after planned workspace shutdown of owner "
                                (:owner-id marker) ".")))

(defn close-corrupt-lock! [ticket-id path error]
  (log! (str "closing corrupt lock: " ticket-id " (" (.getMessage error) ")"))
  (when (fs/exists? (ticket-path ticket-id))
    (append-note! ticket-id "Codex lock file was corrupt and was cleared so the runner can recover."))
  (fs/delete-if-exists path))

(defn lock-ticket-id [path]
  (second (re-find #"(BOXP-\d+)\.edn$" (str path))))

(defn shutdown-marker-owner-key [path]
  (str/replace (str (.getFileName (fs/path path))) #"\.edn$" ""))

(defn cleanup-stale-locks! []
  (let [locks-dir (fs/path (root) "locks")]
    (when (fs/exists? locks-dir)
      (doseq [path (fs/list-dir locks-dir)
              :let [ticket-id (lock-ticket-id path)]
              :when ticket-id]
        (with-ticket-lock-guard
         ticket-id
         (fn []
          (try
            (let [lock (read-edn-file path {})]
              (when (and (stale-lock? lock)
                         (not (current-runner-lock? lock)))
                (log! (str "closing stale lock: " ticket-id))
                (close-stale-lock! ticket-id lock)))
            (catch Exception e
              (close-corrupt-lock! ticket-id path e)))))))))

(defn read-shutdown-markers []
  (let [dir (terminating-owners-dir)]
    (if-not (fs/exists? dir)
      []
      (reduce (fn [markers path]
                (with-owner-lock-guard
                 (shutdown-marker-owner-key path)
                 (fn []
                   (try
                     (let [marker (read-edn-file path {})]
                       (if (and (seq (:owner-id marker))
                                (seq (:instance-id marker)))
                         (conj markers (assoc marker :path path))
                         (do
                           (log! (str "discarding incomplete shutdown marker: " path))
                           (fs/delete-if-exists path)
                           markers)))
                     (catch Exception e
                       (log! (str "discarding corrupt shutdown marker " path ": " (.getMessage e)))
                       (fs/delete-if-exists path)
                       markers)))))
              []
              (fs/list-dir dir)))))

(defn matching-shutdown-marker [markers lock]
  (first (filter #(and (= (:owner-id %) (:owner-id lock))
                       (= (:instance-id %) (:owner-instance-id lock)))
                 markers)))

(defn same-shutdown-marker? [expected actual]
  (and (= (:owner-id expected) (:owner-id actual))
       (= (:instance-id expected) (:instance-id actual))
       (= (:requested-at expected) (:requested-at actual))))

(defn owner-instance-for-lock-under-guard []
  (let [state (try
                (read-edn-file (owner-state-path) {})
                (catch Exception _ {}))]
    (if (and (= (owner-id) (:owner-id state))
             (seq (:instance-id state))
             (not (contains? #{:terminating :terminated} (:status state))))
      (:instance-id state)
      runner-instance-id)))

(defn owner-accepting-locks-under-guard? []
  (let [state (try
                (read-edn-file (owner-state-path) {})
                (catch Exception _ {}))]
    (and (not (fs/exists? (shutdown-marker-path)))
         (not (stopping-owner-state? state)))))

(defn matching-shutdown-lock-exists? [marker]
  (let [locks-dir (fs/path (root) "locks")]
    (and (fs/exists? locks-dir)
         (boolean
          (some (fn [path]
                  (when-let [ticket-id (lock-ticket-id path)]
                    (with-ticket-lock-guard
                     ticket-id
                     (fn []
                       (try
                         (some? (matching-shutdown-marker [marker]
                                                          (read-edn-file path {})))
                         (catch Exception _ false))))))
                (fs/list-dir locks-dir))))))

(defn retire-owner-under-guard! [marker]
  (let [path (owner-state-path (:owner-id marker))
        state (try
                (read-edn-file path {})
                (catch Exception _ {}))]
    ;; Do not overwrite a newer instance if an owner ID was unexpectedly reused.
    (when (or (empty? state)
              (= (:instance-id marker) (:instance-id state)))
      (write-edn-file! path
                       (merge state
                              {:owner-id (:owner-id marker)
                               :instance-id (:instance-id marker)
                               :status :terminated
                               :terminated-at (now-str)}))
      true)))

(defn recover-planned-shutdown-marker! [marker retire-empty-marker?]
  (with-owner-lock-guard
   (:owner-id marker)
   (fn []
     ;; The marker may have been replaced while marker paths were enumerated. Only
     ;; consume the exact generation observed by this recovery pass.
     (let [current-marker (try
                            (read-edn-file (:path marker) {})
                            (catch Exception _ {}))
           recovered? (atom false)
           locks-dir (fs/path (root) "locks")]
       (when (same-shutdown-marker? marker current-marker)
         (when (fs/exists? locks-dir)
           (doseq [path (fs/list-dir locks-dir)
                   :let [ticket-id (lock-ticket-id path)]
                   :when ticket-id]
             (with-ticket-lock-guard
              ticket-id
              (fn []
                (try
                  (let [lock (read-edn-file path {})]
                    (when (matching-shutdown-marker [marker] lock)
                      (log! (str "closing lock from planned owner shutdown: " ticket-id
                                 " owner=" (:owner-id marker)))
                      (when (close-planned-shutdown-lock! ticket-id lock marker)
                        (reset! recovered? true))))
                  (catch Exception e
                    (close-corrupt-lock! ticket-id path e)))))))
         ;; Give deterministic black-box tests a point to create a second matching lock
         ;; after the first directory scan but before the final guarded recheck.
         (when @recovered?
           (when-let [signal-path (System/getenv "CODEX_TASK_BOARD_TEST_BEFORE_MARKER_DELETE_SIGNAL")]
             (spit signal-path "ready\n"))
           (when-let [hold-ms (System/getenv "CODEX_TASK_BOARD_TEST_BEFORE_MARKER_DELETE_MILLIS")]
             (Thread/sleep (Long/parseLong hold-ms))))
         ;; Lock creation for this owner takes the same owner guard. Marking the owner
         ;; terminated before deleting the marker also prevents a waiter from creating
         ;; a lock immediately after this critical section ends.
         (when (and (or @recovered? retire-empty-marker?)
                    (not (matching-shutdown-lock-exists? marker))
                    (same-shutdown-marker? marker
                                           (try
                                             (read-edn-file (:path marker) {})
                                             (catch Exception _ {})))
                    (retire-owner-under-guard! marker))
           (fs/delete-if-exists (:path marker))))))))

(defn recover-planned-shutdown-locks!
  ([] (recover-planned-shutdown-locks! false))
  ([runner-startup?]
   (let [markers (read-shutdown-markers)
         ;; Helper commands keep excluding the whole current owner. Only loop startup
         ;; may recover a previous instance that reused the Pod UID.
         current-marker? (if runner-startup?
                           current-runner-marker?
                           current-owner-marker?)
         recoverable-markers (remove current-marker? markers)]
     (doseq [marker recoverable-markers]
       ;; A replacement loop starts only after the old container process exited. Under
       ;; the owner guard it may therefore retire an old same-owner marker even when
       ;; that instance had no in-flight locks. Other owners retain empty markers so a
       ;; late matching lock can still be recovered on a future scan.
       (recover-planned-shutdown-marker!
        marker
        (and runner-startup? (previous-runner-marker? marker)))))))

(defn recover-locks!
  ([] (recover-locks! false))
  ([runner-startup?]
   (ensure-root!)
   (recover-planned-shutdown-locks! runner-startup?)
   (cleanup-stale-locks!)))

(defn create-lock-under-guard! [path lock]
  (when (.createNewFile (io/file (str path)))
    (write-edn-file! path lock)
    lock))

(defn acquire-lock! [ticket-id action lane]
  (with-owner-lock-guard
   (owner-id)
   (fn []
     (when (owner-accepting-locks-under-guard?)
       (with-ticket-lock-guard
        ticket-id
        (fn []
         (let [path (lock-path ticket-id)
               run (run-id)
               lock {:ticket ticket-id
                     :run-id run
                     :action action
                     :lane lane
                     :owner-id (owner-id)
                     :owner-instance-id (owner-instance-for-lock-under-guard)
                     :host (or (System/getenv "HOSTNAME") "unknown")
                     :pid (.pid (java.lang.ProcessHandle/current))
                     :started-at (now-str)
                     :heartbeat-at (now-str)}]
           (fs/create-dirs (fs/parent path))
           (if-let [created (create-lock-under-guard! path lock)]
             created
             (try
               (let [existing (read-edn-file path {})]
                 (if (and (stale-lock? existing)
                          (not (current-runner-lock? existing)))
                   (do
                     (close-stale-lock! ticket-id existing)
                     (or (create-lock-under-guard! path lock)
                         (do
                           (log! (str "ticket lock changed while recovering: " ticket-id))
                           nil)))
                   (do
                     (log! (str "ticket already locked: " ticket-id))
                     nil)))
               (catch Exception e
                 (close-corrupt-lock! ticket-id path e)
                 (or (create-lock-under-guard! path lock)
                     (do
                       (log! (str "ticket lock changed while clearing corruption: " ticket-id))
                       nil))))))))))))

(defn release-lock! [ticket-id lock]
  (delete-lock-if-matches! ticket-id lock))

(defn heartbeat! [ticket-id lock stop?]
  (future
    (while (not @stop?)
      (with-ticket-lock-guard
       ticket-id
       (fn []
        (let [path (lock-path ticket-id)
              existing (try
                         (read-edn-file path nil)
                         (catch Exception _ nil))]
          (if (same-ticket-lock? lock existing)
            (write-edn-file! path (assoc existing :heartbeat-at (now-str)))
            (do
              (log! (str "heartbeat stopped because lock ownership changed: " ticket-id))
              (reset! stop? true))))))
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

(defn persisted-review-gate [review-gate]
  ;; Gate results can contain CLI stderr or review-agent text. Persist only
  ;; structured status so run summaries and retry state never copy secrets.
  (select-keys review-gate [:ok? :gate :url :retryable? :retry-count
                            :retry-limit :retry-exhausted? :checked-pr-urls
                            :pr-urls :diagnostic]))

(defn pr-gate-diagnostic [review-gate]
  ;; A gate's :message may contain gh stderr or review-agent text.  Keep a
  ;; useful but entirely derived diagnosis: it identifies the failing class
  ;; and next action without retaining any untrusted diagnostic text.
  (let [gate (:gate review-gate)]
    {:format-version 1
     :gate (some-> gate name)
     :pr-url (:url review-gate)
     :category (case gate
                 :ci "ci-check-failure"
                 :mergeability "mergeability"
                 :conflict "merge-conflict"
                 :codex-review "codex-review-findings"
                 :pr-url "missing-pr-url"
                 :pr-gate "pr-gate-api-error"
                 "pr-gate-failure")
     :detail (case gate
               :ci "One or more required CI checks failed. Inspect the PR checks."
               :mergeability "The PR is not mergeable yet. Inspect its merge state."
               :conflict "The PR has merge conflicts. Resolve conflicts and update the PR."
               :codex-review "Codex review reported actionable findings. Inspect the review artifact."
               :pr-url "Review was requested without a GitHub PR URL."
               :pr-gate "PR gate evaluation failed. Re-run the gate after checking GitHub availability."
               "PR gate failed; inspect the PR and referenced run artifacts.")}))

(defn persist-pr-gate-diagnostic! [ticket-id run-id review-gate]
  (when (and (not (:ok? review-gate)) (:gate review-gate))
    (let [path (fs/path (run-dir ticket-id run-id) "pr-gate-diagnostic.edn")
          diagnostic (assoc (pr-gate-diagnostic review-gate) :recorded-at (now-str))]
      (write-edn-file! path diagnostic)
      {:path (str path)
       :category (:category diagnostic)
       :detail (:detail diagnostic)})))

(defn persisted-review-gate-reason [review-gate]
  (cond
    (:ok? review-gate) "Review gates passed."
    (:gate review-gate) "PR gate failed; inspect the referenced run artifacts."
    :else "reason unavailable"))

(defn retry-fingerprint [review-gate]
  ;; The key is persisted in state, so retain no diagnostic text.  Its digest
  ;; still distinguishes separate failures of the same PR gate, preventing a
  ;; new failure from consuming the retry budget of an earlier one.
  (let [digest (java.security.MessageDigest/getInstance "SHA-256")
        reason (str (or (:message review-gate) "reason unavailable"))
        reason-hash (->> (.digest digest (.getBytes reason "UTF-8"))
                         (map #(format "%02x" (bit-and 0xff %)))
                         (apply str))]
    (str (:url review-gate) "|" (some-> (:gate review-gate) name)
         "|" reason-hash)))

(defn latest-pr-gate-retry [ticket-id]
  (let [retries (get-in (runner-state) [:pr-gate-retries ticket-id])]
    (when (seq retries)
      (->> (vals retries)
           (sort-by #(or (:updated-at %) ""))
           last))))

(defn pr-gate-retry-prompt [ticket-id]
  (when-let [{:keys [pr-url gate message diagnostic run-id run-dir count limit agent]} (latest-pr-gate-retry ticket-id)]
    (str "Pending PR gate retry instruction:\n"
         "- Target PR URL: " pr-url "\n"
         "- Failed gate: " gate "\n"
         "- Failure reason: " message "\n"
         (when diagnostic
           (str "- Safe diagnostic: " (:path diagnostic)
                " (category=" (:category diagnostic) "; detail=" (:detail diagnostic) ")\n"))
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
                :message (persisted-review-gate-reason review-gate)
                :diagnostic (:diagnostic review-gate)
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
       "- Delegate long investigation, implementation, file editing, and test execution to Codex whenever practical. If no explicit Codex model is supplied, use the default Codex route: gpt-5.6-terra (GPT-5.5-equivalent, cost-efficient), unless CODEX_TASK_BOARD_MODEL overrides it. Reserve gpt-6.1-sol (via codex-sol/codex-full assignees) for high-complexity tasks. Reserve gpt-6-astra (via codex-astra assignee) for the most demanding tasks requiring the highest capability. Use the prepared workspace and repository worktrees from this prompt.\n"
       "- If Codex is delegated work, preserve the Task Board runner contract: include a concise delegated-work summary in your final response and end with exactly one TASK_BOARD_RESULT marker that the runner can parse.\n"
       "- For repository changes, make sure a GitHub PR URL is included before returning TASK_BOARD_RESULT: review. If no repository changes were made, include TASK_BOARD_REVIEW_PR: none.\n"
       "- Progress logging: at each milestone (investigation complete, approach decided, PR created, blocker encountered), append a note to the ticket Notes by running: bb ~/.claude/skills/obsidian-task-board/bin/task-board.bb append-note TICKET_ID --vault \"$CODEX_TASK_BOARD_VAULT\" --source fable --note \"<milestone summary>\". For lengthy work, log a concise checkpoint before CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS elapses; an entirely idle run is stopped and retried.\n\n"))

(defn claude-policy-prompt [agent]
  (str "Claude Code routing policy:\n"
       "- You are the " agent " entry point for this Task Board run. Complete the task using the explicitly selected Claude model.\n"
       "- Preserve the Task Board runner contract: include a concise work summary in your final response and end with exactly one TASK_BOARD_RESULT marker that the runner can parse.\n"
       "- For repository changes, make sure a GitHub PR URL is included before returning TASK_BOARD_RESULT: review. If no repository changes were made, include TASK_BOARD_REVIEW_PR: none.\n\n"))

(defn codex-sol-policy-prompt [agent]
  (str "High-cost model routing policy:\n"
       "- You are the " agent " high-cost entry point for this Task Board run.\n"
       "- Focus your own effort on task decomposition, results integration, critical decisions, and final review.\n"
       "- Delegate independent investigation, implementation, and verification to lower-cost models whenever practical. Use the codex (gpt-5.6-terra) assignee as the default delegation route, unless CODEX_TASK_BOARD_MODEL overrides it.\n"
       "- Do NOT delegate: tasks smaller than the delegation overhead, tasks requiring shared context or elevated permissions, and tasks requiring final judgment or acceptance.\n"
       "- If a delegated subtask fails, produces insufficient quality, or is unavailable: re-instruct once, verify the result, or handle it directly. Avoid recursive or unbounded delegation chains.\n"
       "- If Codex is delegated work, preserve the Task Board runner contract: include a concise delegated-work summary in your final response and end with exactly one TASK_BOARD_RESULT marker that the runner can parse.\n"
       "- For repository changes, make sure a GitHub PR URL is included before returning TASK_BOARD_RESULT: review. If no repository changes were made, include TASK_BOARD_REVIEW_PR: none.\n"
       "- Progress logging: at each milestone (investigation complete, approach decided, PR created, blocker encountered), append a note to the ticket Notes by running: bb ~/.codex/skills/obsidian-task-board/bin/task-board.bb append-note TICKET_ID --vault \"$CODEX_TASK_BOARD_VAULT\" --source codex --note \"<milestone summary>\"\n\n"))

(defn codex-astra-policy-prompt [agent]
  (str "Highest-capability model routing policy:\n"
       "- You are the " agent " top-tier entry point for this Task Board run. You run on gpt-6-astra, the most capable and highest-cost model available.\n"
       "- Reserve your own compute for the most demanding subtasks: complex reasoning, cross-cutting architectural decisions, synthesis of ambiguous requirements, and final acceptance checks.\n"
       "- Aggressively delegate to lower-cost models for any work that does not require gpt-6-astra capability. Use codex-sol (gpt-6.1-sol) for high-complexity subtasks, codex (gpt-5.6-terra) for standard implementation and investigation.\n"
       "- Do NOT delegate: tasks requiring your full reasoning capacity, tasks with shared context that cannot be serialized, and final quality judgments.\n"
       "- If a delegated subtask fails or produces insufficient quality: re-instruct with clearer requirements once, then escalate to a higher-tier model or handle directly. Avoid unbounded delegation chains.\n"
       "- If Codex is delegated work, preserve the Task Board runner contract: include a concise delegated-work summary in your final response and end with exactly one TASK_BOARD_RESULT marker that the runner can parse.\n"
       "- For repository changes, make sure a GitHub PR URL is included before returning TASK_BOARD_RESULT: review. If no repository changes were made, include TASK_BOARD_REVIEW_PR: none.\n"
       "- Progress logging: at each milestone (investigation complete, approach decided, PR created, blocker encountered), append a note to the ticket Notes by running: bb ~/.codex/skills/obsidian-task-board/bin/task-board.bb append-note TICKET_ID --vault \"$CODEX_TASK_BOARD_VAULT\" --source " agent " --note \"<milestone summary>\"\n\n"))

(defn append-note-instruction [agent ticket-id]
  (let [helper (if (claude-assignee? agent)
                 "~/.claude/skills/obsidian-task-board/bin/task-board.bb"
                 "~/.codex/skills/obsidian-task-board/bin/task-board.bb")]
    (str "Progress logging: at each milestone during your work (investigation complete, approach decided, PR created, blocker encountered), "
         "and before CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS elapses during lengthy work, "
         "append a note to this ticket's Notes by running:\n"
         "  bb " helper " append-note " ticket-id " --vault \"$CODEX_TASK_BOARD_VAULT\" --source " agent " --note \"<milestone summary>\"\n")))

(defn prompt-for [action ticket-id lane workspace agent]
  (let [ticket-text (slurp (str (ticket-path ticket-id)))
        previous (previous-run-summaries ticket-id)
        base-agent (:base-assignee (parse-codex-assignee agent))
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
                    (when (contains? claude-assignee->model agent) (claude-policy-prompt agent))
                    (when (contains? #{"codex-sol" "codex-full"} base-agent) (codex-sol-policy-prompt agent))
                    (when (= "codex-astra" base-agent) (codex-astra-policy-prompt agent))
                    "Ticket contents:\n\n" ticket-text "\n\n")
        review-contract (str "When repository changes are part of the work, create or update a GitHub PR before returning TASK_BOARD_RESULT: review.\n"
                             "If you return TASK_BOARD_RESULT: review, include either a GitHub PR URL or exactly one line TASK_BOARD_REVIEW_PR: none when no repository changes were made.\n")]
    (case action
      :groom
      (str common
           "Goal: clarify this backlog ticket only. Do not implement code, do not create commits, and do not open PRs.\n"
           "First investigate before writing: read ticket Notes and related Obsidian documents, inspect relevant GitHub repository state (issues, PRs, discussions via gh CLI), check related repo/git conventions, run Web searches for key technologies if needed, and for infra tickets check kubectl pod/deployment state; for performance/incident tickets check Grafana metrics.\n"
           "Then update the ticket file so Summary, Acceptance Criteria, Context, Plan, and Notes are specific enough for a human to review. Fill Context with investigation findings (system state, related docs, design rationale). Fill Plan with concrete implementation steps derived from findings.\n"
           "Keep the scope practical and preserve existing decisions.\n"
           (append-note-instruction agent ticket-id)
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: review\n")

      :review-fix
      (str common
           "Goal: address review feedback or requested changes for this ticket.\n"
           "First inspect the ticket Notes, relevant repos, current git state, PR state if referenced, and tests.\n"
           "Do the requested work end to end where possible.\n"
           (append-note-instruction agent ticket-id)
           review-contract
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n"
           "Use done only when all acceptance criteria are satisfied. Use review when human review is needed. Use blocked when external input or unavailable infrastructure blocks progress.\n")

      :blocked-retry
      (str common
           "Goal: retry or re-investigate the blocked work.\n"
           "First verify whether the blocker is actually cleared. If still blocked, update Notes with the concrete blocker.\n"
           "Do the work end to end where possible.\n"
           (append-note-instruction agent ticket-id)
           review-contract
           "End your final message with exactly one marker line: TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: review, or TASK_BOARD_RESULT: blocked\n")

      :implement
      (str common
           "Goal: implement or complete this ticket.\n"
           "First inspect the ticket Notes, relevant repos, current git state, and existing project conventions.\n"
           "Do the work end to end where possible, including focused validation.\n"
           (append-note-instruction agent ticket-id)
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

(defn agent-idle-timeout-seconds []
  ;; Task duration is not a useful failure signal: valid implementation work can
  ;; take many hours.  Only interrupt an agent when neither its output nor the
  ;; ticket itself has changed for this long. Set to 0 to disable the watchdog.
  (let [seconds (env-long "CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS" "7200")]
    (when (neg? seconds)
      (throw (ex-info "CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS must not be negative"
                      {:value seconds})))
    seconds))

(defn latest-modification-millis [paths]
  (reduce max 0 (map (fn [path]
                       (let [file (io/file (str path))]
                         (if (.exists file) (.lastModified file) 0)))
                     paths)))

(defn signal-agent-process-group! [process signal]
  ;; `run-agent!` starts the CLI through `setsid`, making its PID the process
  ;; group ID. Signalling the negative PID covers all current and subsequently
  ;; spawned children, including those created while the agent handles TERM.
  (let [result @(p/process ["/bin/kill" (str "-" signal) "--"
                            (str "-" (.pid process))]
                           {:out :string :err :string})]
    (when-not (zero? (:exit result))
      (log! (str "failed to send " signal " to idle agent process group: "
                 (str/trim (:err result)))))))

(defn await-agent! [proc progress-paths idle-timeout-seconds]
  (let [process (:proc proc)
        started-at (System/currentTimeMillis)]
    (loop [last-progress-at (max started-at (latest-modification-millis progress-paths))]
      (if-not (.isAlive process)
        {:proc @proc :idle-timeout? false}
        (do
          (Thread/sleep 1000)
          (let [observed-at (latest-modification-millis progress-paths)
                last-progress-at (max last-progress-at observed-at)
                idle-millis (- (System/currentTimeMillis) last-progress-at)]
            (cond
              ;; The process can finish during the polling sleep. Check again
              ;; immediately before the timeout action so a valid final response
              ;; is not discarded as an idle retry.
              (not (.isAlive process))
              {:proc @proc :idle-timeout? false}

              (and (pos? idle-timeout-seconds)
                   (>= idle-millis (* 1000 idle-timeout-seconds)))
              (do
                (log! (str "stopping idle agent after " idle-timeout-seconds
                           " seconds without progress"))
                (do
                  (signal-agent-process-group! process "TERM")
                (Thread/sleep 5000)
                  ;; Send KILL even if the agent itself exited: its process group
                  ;; can still contain a TERM-resistant or late-created child.
                  (signal-agent-process-group! process "KILL")
                  {:proc @proc :idle-timeout? true}))

              :else
              (recur last-progress-at))))))))

(defn no-ci-repos []
  ;; Explicit opt-in list of repos (owner/name) known to have no PR CI workflows.
  ;; When a PR belongs to a listed repo and mergeStateStatus=CLEAN with no checks,
  ;; the CI gate is skipped rather than relying on a time-based grace period.
  ;; Set via CODEX_TASK_BOARD_NO_CI_REPOS=owner/repo1,owner/repo2
  (let [val (env "CODEX_TASK_BOARD_NO_CI_REPOS" "")]
    (when (seq val)
      (set (map str/trim (str/split val #","))))))

(defn run-string! [args opts]
  (let [proc @(p/process args (merge {:out :string :err :string} opts))]
    (if (zero? (:exit proc))
      (:out proc)
      (throw (ex-info (str "command failed: " (str/join " " args) "\n" (:err proc))
                      {:args args :exit (:exit proc) :err (:err proc)})))))

(defn get-codex-model [assignee env-model]
  (or (when (seq env-model) env-model)
      (some-> assignee parse-codex-assignee :base-assignee assignee->model)))

(defn codex-model-profile-args
  ([] (codex-model-profile-args nil))
  ([assignee]
   (let [env-model (env "CODEX_TASK_BOARD_MODEL" nil)
         env-profile (env "CODEX_TASK_BOARD_PROFILE" nil)]
     (codex-model-profile-args assignee env-model env-profile)))
  ([assignee env-model env-profile]
   (let [model (get-codex-model assignee env-model)
         reasoning-effort (:reasoning-effort (parse-codex-assignee assignee))]
     (cond-> []
       model
       (conj "--model" model)

       reasoning-effort
       (into ["-c" (str "model_reasoning_effort=" reasoning-effort)])

       (seq env-profile)
       (conj "--profile" env-profile)))))

(defn repo-from-pr-url [pr-url]
  ;; Extract "owner/repo" from a GitHub PR URL like https://github.com/owner/repo/pull/N
  (second (re-find #"github\.com/([^/]+/[^/]+)/pull/" (str pr-url))))

(defn no-ci-repo? [pr-url]
  (let [repos (no-ci-repos)
        repo (repo-from-pr-url pr-url)]
    (and (seq repos) repo (contains? repos repo))))

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
  (let [deadline (+ (System/currentTimeMillis) (* 1000 (pr-gate-timeout-seconds)))
        skip-ci? (no-ci-repo? pr-url)]
    (loop []
      (let [pr (pr-view pr-url)
            merge (merge-state pr)
            ci (ci-state (:statusCheckRollup pr))
            no-checks? (empty? (:statusCheckRollup pr))]
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

          ;; Explicit opt-in: repo is listed in CODEX_TASK_BOARD_NO_CI_REPOS and
          ;; mergeStateStatus=CLEAN — skip CI gate without relying on timing.
          ;; Only CLEAN is accepted here; HAS_HOOKS/BLOCKED/UNSTABLE still require real CI checks.
          (and skip-ci? no-checks? (= "CLEAN" (some-> (:mergeStateStatus pr) str/upper-case)))
          {:ok? true
           :url pr-url
           :message (str (:message merge) " CI skipped: repo listed in CODEX_TASK_BOARD_NO_CI_REPOS.")}

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
                (let [review (run-codex-review! run-dir pr-url)]
                  (if-not (:ok? review)
                    (assoc review
                           :checked-pr-urls passed
                           :pr-urls pr-urls
                           :message (str pr-url ": " (:message pr-state) " " (:message review)))
                    ;; This field is persisted in summaries, so it must remain a
                    ;; URL list rather than carrying arbitrary check/review text.
                    (recur (rest remaining) (conj passed pr-url))))))
            {:ok? true
             :pr-urls pr-urls
             :checked-pr-urls passed
             :message "PR gates passed."}))

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
  ;; or account configuration unless CODEX_TASK_BOARD_FABLE_MODEL overrides it.
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

(defn claude-model-args [agent]
  (if (= "fable" agent)
    (fable-model-args)
    ["--model" (get claude-assignee->model agent)]))

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
    (let [agent-args (if (claude-assignee? agent)
                       (cond-> [(env "CODEX_TASK_BOARD_CLAUDE_BIN" "claude") "--print" "--output-format" "text"]
                   (= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (conj "--dangerously-skip-permissions")

                   (not= "true" (env "CODEX_TASK_BOARD_BYPASS_APPROVALS" "true"))
                   (into (mapcat (fn [dir] ["--add-dir" dir])
                                 (cons (vault) (workspace-add-dirs workspace))))

                   true
                   (into (claude-model-args agent)))

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
          idle-timeout-seconds (agent-idle-timeout-seconds)
          proc (p/process (into ["setsid"] agent-args) (cond-> {:in (io/file (str prompt-path))
                                              :out (io/file (str stdout-path))
                                              :err (io/file (str stderr-path))}
                                       (claude-assignee? agent)
                                       (assoc :dir (:workspace-dir workspace))))
          {:keys [proc idle-timeout?]} (await-agent! proc [stdout-path stderr-path (ticket-path ticket-id)] idle-timeout-seconds)
          exit (:exit proc)
          _ (when (and (claude-assignee? agent) (fs/exists? stdout-path))
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
                    :idle-timeout? idle-timeout?
                    :result marker
                    :finished-at (now-str)}))
      {:exit exit
       :result marker
       :run-id run
       :dir (str dir)
       :last-message last-message
       :idle-timeout? idle-timeout?})))

(defn candidate-action [{:keys [lane status]} assignee]
  (when (supported-assignee? assignee)
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

(defn final-note [run-id next-status result last-message review-gate idle-timeout?]
  (let [base (str "Codex task-board run " run-id " finished with result " next-status ".")
        pr-urls (github-pr-urls last-message)]
    (cond
      idle-timeout?
      (str base " No agent progress was logged before the idle timeout; "
           "the run was stopped and will be retried automatically.")

      (and (= "blocked" next-status)
           (not (#{"done" "blocked"} result))
           (not (:ok? review-gate)))
      (str base " Review gate failed"
           (when-let [gate (:gate review-gate)]
             (str " (" (name gate) ")"))
           (when-let [url (:url review-gate)]
             (str " for " url))
           ": " (persisted-review-gate-reason review-gate)
           (when-let [diagnostic (:diagnostic review-gate)]
             (str " Safe diagnostic: " (:path diagnostic)
                  " (category=" (:category diagnostic) "; detail=" (:detail diagnostic) ").")))

      (and (= "in-progress" next-status)
           (not (:ok? review-gate))
           (:retryable? review-gate))
      (str base " Review gate failed"
           (when-let [gate (:gate review-gate)]
             (str " (" (name gate) ")"))
           (when-let [url (:url review-gate)]
             (str " for " url))
           ": " (persisted-review-gate-reason review-gate)
           (when-let [diagnostic (:diagnostic review-gate)]
             (str " Safe diagnostic: " (:path diagnostic)
                  " (category=" (:category diagnostic) "; detail=" (:detail diagnostic) ")."))
           " Retrying with Codex instruction "
           (:retry-count review-gate) "/" (:retry-limit review-gate) ".")

      (and (= "review" next-status) (seq pr-urls))
      (str base " PR: " (str/join ", " pr-urls) ". "
           (persisted-review-gate-reason review-gate))

      :else
      base)))

(defn sanitize-blocker-reason [reason]
  ;; Notes are user-visible. Keep a compact diagnosis while never copying agent
  ;; output or stderr verbatim, because either can contain credentials.
  (let [value (-> (or reason "reason unavailable")
                  str
                  (str/replace #"[\r\n\t]+" " ")
                  (str/replace #"(?i)(authorization:\s*(?:bearer\s+)?)[^\s]+" "$1[REDACTED]")
                  (str/replace #"(?i)\b[A-Z0-9_]*(?:token|secret|password|api(?:[_-]|\s)+key|credential)[A-Z0-9_]*\s*[=:]\s*[^\s,;]+" "[REDACTED]")
                  (str/replace #"\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b" "[REDACTED]"))]
    (if (str/blank? (str/trim value))
      "reason unavailable"
      (subs value 0 (min 600 (count value))))))

(defn blocker-category [result exit review-gate exception]
  (cond
    exception "runner-internal-error"
    (not (zero? (long (or exit 0)))) "agent-process-error"
    (= "blocked" result) "agent-reported-blocked"
    (:retry-exhausted? review-gate) "pr-gate-retry-limit"
    (:gate review-gate) (str "pr-gate-" (name (:gate review-gate)))
    :else "reason-unavailable"))

(defn blocker-safe-reason [result exit review-gate exception]
  ;; Do not copy agent, CLI, or exception text into user-visible Notes or run
  ;; summaries.  Those strings are untrusted and can contain credentials.
  (cond
    exception "Runner internal error; inspect the referenced run artifacts."
    (not (zero? (long (or exit 0)))) "Agent process exited unsuccessfully; inspect the referenced run artifacts."
    (= "blocked" result) "Agent reported blocked; inspect the referenced run artifacts."
    (:gate review-gate) "PR gate failed; inspect the referenced run artifacts."
    :else "reason unavailable"))

(defn blocker-note [ticket-id run-id action category reason]
  (let [dir (str (run-dir ticket-id run-id))]
    (str "Blocked transition recorded: ticket=" ticket-id
         "; run=" run-id
         "; transition-id=" ticket-id "/" run-id
         "; action=" (name action)
         "; at=" (now-str)
         "; category=" category
         "; reason=" (sanitize-blocker-reason reason)
         "; inspect run artifacts: " dir "/summary.edn, " dir "/last-message.md, "
         dir "/events.jsonl, " dir "/stderr.log.")))

(defn blocked-transition-recorded? [ticket-id run-id]
  ;; The note is the durable audit boundary.  If a later state transition
  ;; throws and the outer error handler retries, do not append a second audit
  ;; note for the same run.
  (let [marker (str "transition-id=" ticket-id "/" run-id)]
    (and (fs/exists? (ticket-path ticket-id))
         (some #(str/includes? % marker) (read-lines (ticket-path ticket-id))))))

(defn record-blocked-transition! [ticket-id run-id action result exit review-gate exception]
  (let [category (blocker-category result exit review-gate exception)
        reason (blocker-safe-reason result exit review-gate exception)]
    (try
      (when-not (blocked-transition-recorded? ticket-id run-id)
        (append-note! ticket-id (blocker-note ticket-id run-id action category reason)))
      true
      (catch Exception e
        ;; A Blocked card without this audit record is worse than leaving the
        ;; current lane intact. Persist the failure where operators can inspect it.
        (try
          (mark-run! ticket-id run-id :blocker-note-failed
                     {:action action
                      :blocker-category category
                      :blocker-reason (sanitize-blocker-reason reason)
                      :notes-error "blocker Notes write failed"
                      :finished-at (now-str)})
          (catch Exception mark-error
            (log! (str "could not record blocker note failure for " ticket-id "/" run-id
                       ": " (.getMessage mark-error)))))
        (log! (str "blocked transition withheld for " ticket-id "/" run-id
                   " because Notes recording failed"))
        false))))

(defn block-ticket! [ticket-id run-id action result exit review-gate exception]
  (when (record-blocked-transition! ticket-id run-id action result exit review-gate exception)
    ;; Keep the post-audit transition inside this boundary.  Otherwise a
    ;; failure here escapes to process-card!'s catch, which invokes this
    ;; function again and can duplicate the audit record.
    (try
      ;; Do not confirm the run as blocked until both durable ticket states
      ;; have been updated.  A later card/frontmatter failure is recovered to
      ;; the prior lane by process-card!, so recording :blocked beforehand
      ;; would leave summary.edn contradicting the restored ticket state.
      (move-card! ticket-id "blocked")
      ;; Deterministic black-box failure hook; unset in deployment.
      (when (= "true" (System/getenv "CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE"))
        (throw (ex-info "forced blocked state update failure" {})))
      (update-frontmatter! ticket-id {:status "blocked" :assignee "boxp"})
      ;; run-agent! records a zero-exit agent as succeeded before its result is
      ;; interpreted. Correct that provisional status only after the Blocked
      ;; transition itself has succeeded.
      (mark-run! ticket-id run-id :blocked
                 {:action action
                  :exit-code exit
                  :result result
                  :review-gate (persisted-review-gate review-gate)
                  :blocker-category (blocker-category result exit review-gate exception)
                  :blocker-reason (blocker-safe-reason result exit review-gate exception)
                  :finished-at (now-str)})
      true
      (catch Exception e
        (log! (str "blocked transition state update failed for " ticket-id "/" run-id
                   "; preserving/restoring the prior card state: " (.getMessage e)))
        false))))

(defn restore-card-state! [ticket-id status assignee]
  (move-card! ticket-id status)
  (update-frontmatter! ticket-id {:status status :assignee assignee}))

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
              (let [{:keys [exit result run-id dir last-message idle-timeout?]} (run-agent! ticket-id action effective-lane assignee lock)
                    _ (when (= "true" (System/getenv "CODEX_TASK_BOARD_TEST_FORCE_RUNNER_EXCEPTION"))
                        ;; Deterministic black-box failure hook; unset in deployment.
                        (throw (ex-info (env "CODEX_TASK_BOARD_TEST_RUNNER_EXCEPTION_MESSAGE"
                                             "forced runner internal error token=super-secret-token") {})))
                    intended (cond
                               (not (zero? exit)) "blocked"
                               (= :groom action) "ready"
                               (#{"done" "review" "blocked"} result) result
                               :else "review")
                    review-gate (if (= "review" intended)
                                  (let [gate-result (review-gate! dir last-message)
                                        gate-result (assoc gate-result :diagnostic
                                                           (persist-pr-gate-diagnostic! ticket-id run-id gate-result))]
                                    (if (and (not (:ok? gate-result))
                                             (:retryable? gate-result))
                                      (record-pr-gate-failure! ticket-id run-id assignee gate-result)
                                      gate-result))
                                  {:ok? true})
                    next-status (if idle-timeout?
                                  "in-progress"
                                  (final-status action result exit review-gate))]
                (when idle-timeout?
                  (mark-run! ticket-id run-id :retrying
                             {:action action
                              :agent assignee
                              :lane effective-lane
                              :exit-code exit
                              :result result
                              :idle-timeout? true
                              :finished-at (now-str)}))
                ;; A non-retryable review-gate failure reaches block-ticket!.
                ;; Let that function write :blocked only after the card and
                ;; frontmatter transition have both succeeded.  Writing it
                ;; here would leave summary.edn at :blocked when a later
                ;; blocked-state failure restores the original lane.
                (when (and (= "review" intended)
                           (not= "blocked" next-status))
                  (mark-run! ticket-id run-id (cond
                                                (:ok? review-gate) :succeeded
                                                (= "in-progress" next-status) :retrying
                                                :else :succeeded)
                             {:action action
                              :agent assignee
                              :lane effective-lane
                              :exit-code exit
                              :result result
                              :review-gate (persisted-review-gate review-gate)
                              :finished-at (now-str)}))
                (when (:ok? review-gate)
                  (clear-pr-gate-retries! ticket-id))
                (if (= "blocked" next-status)
                  (when-not (block-ticket! ticket-id run-id action result exit review-gate nil)
                    (restore-card-state! ticket-id status assignee))
                  (do
                    (move-card! ticket-id next-status)
                    (update-frontmatter! ticket-id (cond-> {:status next-status
                                                             :assignee (if (= "in-progress" next-status) assignee "boxp")}
                                                      (= "done" next-status) (assoc :closed (today))))
                    (append-note! ticket-id (final-note run-id next-status result last-message review-gate idle-timeout?))))
                true)
              (catch Exception e
                (when-not (block-ticket! ticket-id (:run-id lock) action nil nil nil e)
                  (restore-card-state! ticket-id status assignee))
                true)
              (finally
                (reset! stop? true)
                @hb
                (release-lock! ticket-id lock)))))))))

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

;; ---------------------------------------------------------------------------
;; Run workspace pruning (BOXP-209)
;;
;; Every run leaves `workspaces/<ticket>/<run-id>/` plus a worktree and a
;; `codex-task-board/<ticket>-<run-id>` branch in the source repository. Nothing
;; else removes them, so the loop periodically prunes the run workspaces of
;; tickets that have been done for longer than the retention period. A run is
;; only deleted when every checkout in it is clean and all of its local commits
;; exist on GitHub; anything that cannot be verified is kept and logged.
;; ---------------------------------------------------------------------------

(def default-workspace-retention-days 3)
(def default-workspace-prune-interval-seconds 21600)
(def max-unpushed-commits-per-checkout 200)

(defn parse-prune-enabled [value]
  (let [v (some-> value str/trim str/lower-case)]
    (cond
      (or (nil? v) (= "" v)) {:value true}
      (contains? #{"1" "true" "yes" "on"} v) {:value true}
      (contains? #{"0" "false" "no" "off"} v) {:value false}
      :else {:value true :invalid? true})))

(defn parse-bounded-long [value default minimum]
  (if (str/blank? value)
    {:value default}
    (let [parsed (try
                   (Long/parseLong (str/trim value))
                   (catch Exception _ nil))]
      (if (and parsed (>= parsed minimum))
        {:value parsed}
        {:value default :invalid? true}))))

(def warned-prune-settings (atom #{}))

(defn prune-setting [k parse]
  ;; Unlike CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS, a bad value here must
  ;; not stop the runner: fall back to the default and warn once per value.
  (let [raw (System/getenv k)
        {:keys [value invalid?]} (parse raw)]
    (when (and invalid? (not (contains? @warned-prune-settings [k raw])))
      (swap! warned-prune-settings conj [k raw])
      (log! (str "prune: warning invalid " k "=" (pr-str raw) ", using default " value)))
    value))

(defn workspace-prune-enabled? []
  (prune-setting "CODEX_TASK_BOARD_WORKSPACE_PRUNE" parse-prune-enabled))

(defn workspace-retention-days []
  (prune-setting "CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS"
                 #(parse-bounded-long % default-workspace-retention-days 0)))

(defn workspace-prune-interval-seconds []
  (prune-setting "CODEX_TASK_BOARD_WORKSPACE_PRUNE_INTERVAL_SECONDS"
                 #(parse-bounded-long % default-workspace-prune-interval-seconds 1)))

(defn workspaces-dir []
  (fs/path (root) "workspaces"))

(def run-id-timestamp-formatter
  (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'"))

(defn run-id-instant [run-id]
  ;; Runs created before unique-run-id have no UUID suffix.
  (when-let [[_ timestamp] (re-matches #"^(\d{8}T\d{6}Z)(?:-.+)?$" (str run-id))]
    (try
      (.toInstant (java.time.LocalDateTime/parse timestamp run-id-timestamp-formatter)
                  java.time.ZoneOffset/UTC)
      (catch Exception _ nil))))

(defn parse-closed-date [value]
  (try
    (java.time.LocalDate/parse (str/replace (str/trim (str value)) #"^[\"']|[\"']$" ""))
    (catch Exception _ nil)))

(defn prune-ticket-decision
  "Ticket-level eligibility from frontmatter. `closed` alone is not trusted:
  reopened tickets keep a stale `closed`, so it only counts with status done."
  [frontmatter today-date retention-days]
  (let [status (some-> (:status frontmatter) str/trim)
        closed (parse-closed-date (:closed frontmatter))]
    (cond
      (nil? frontmatter) {:eligible? false :reason "ticket-missing"}
      (not= "done" status) {:eligible? false :reason "not-done"}
      (nil? closed) {:eligible? false :reason "closed-missing"}
      (.isAfter closed (.minusDays today-date retention-days))
      {:eligible? false :reason "within-retention"}
      :else {:eligible? true})))

(defn prune-run-decision
  "Run-level eligibility. The run-id timestamp keeps the grace period for a
  ticket that was reopened and finished again while `closed` stayed old."
  [run-id now-instant retention-days]
  (let [started (run-id-instant run-id)]
    (cond
      (nil? started) {:eligible? false :reason "run-id-timestamp-unparseable"}
      (.isAfter started (.minus now-instant (java.time.Duration/ofDays retention-days)))
      {:eligible? false :reason "within-retention"}
      :else {:eligible? true})))

(defn github-repo-from-remote-url [url]
  (when-let [[_ owner repo]
             (re-find #"^(?:(?:https?|ssh|git)://(?:[^@/\s]+@)?|[^@/\s]+@)github\.com[:/]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$"
                      (str/trim (str url)))]
    (str owner "/" repo)))

(defn command-result
  "Runs a command without throwing. Timeouts and spawn failures are reported
  as a non-zero exit so callers treat them as `could not verify`."
  ([args] (command-result args {}))
  ([args {:keys [timeout-seconds] :or {timeout-seconds 120}}]
   (try
     (let [proc (p/process args {:out :string
                                 :err :string
                                 :extra-env {"GIT_OPTIONAL_LOCKS" "0"}})
           result (deref proc (* 1000 timeout-seconds) ::timeout)]
       (if (= ::timeout result)
         (do
           (p/destroy-tree proc)
           {:exit -1 :out "" :err (str "timed out after " timeout-seconds "s")})
         {:exit (:exit result) :out (or (:out result) "") :err (or (:err result) "")}))
     (catch Exception e
       {:exit -1 :out "" :err (str (.getMessage e))}))))

(defn one-line [text]
  ;; Keeps every prune log entry on a single line.
  (str/trim (str/replace (str text) #"\s+" " ")))

(defn github-commit-status
  "Returns :exists, :missing or :unknown. Local remote-tracking refs are often
  stale, so GitHub is asked directly; results are cached for one prune pass."
  [cache repo sha]
  (let [k [repo sha]]
    (or (get @cache k)
        (let [{:keys [exit out err]} (command-result
                                      ["gh" "api" (str "repos/" repo "/commits/" sha) "--jq" ".sha"]
                                      {:timeout-seconds 60})
              status (cond
                       (and (zero? exit) (= sha (str/trim out))) :exists
                       (re-find #"HTTP (404|422)" (str err out)) :missing
                       :else :unknown)]
          (swap! cache assoc k status)
          status))))

(defn find-checkouts
  "Directories under `dir` that contain `.git` (file or directory), deepest
  first. Symlinks are not followed and `.git` itself is not descended into,
  but the rest of a checkout is: a clone nested inside another checkout (for
  example one the parent gitignores) is invisible to the parent's
  `git status` and has to be inspected on its own."
  [dir]
  (let [found (volatile! [])]
    (letfn [(git-entry? [entry] (= ".git" (fs/file-name entry)))
            (visit [current]
              (let [entries (fs/list-dir current)]
                (when (some git-entry? entries)
                  (vswap! found conj current))
                ;; Keep walking below a checkout; only `.git` is skipped.
                (doseq [entry entries
                        :when (and (not (git-entry? entry))
                                   (fs/directory? entry {:nofollow-links true}))]
                  (visit entry))))]
      (visit dir))
    ;; Deepest first so a nested worktree is detached before its parent goes.
    (vec (sort-by (fn [path] [(- (count (seq (fs/path path)))) (str path)]) @found))))

(defn inspect-checkout
  "Returns {:hold reason} when the checkout must be kept, otherwise its repo
  and, for a worktree of a repository outside the run, :external-common-dir."
  [run-real checkout gh-cache]
  (let [git (fn [& args] (command-result (into ["git" "-C" (str checkout)] args)))
        toplevel (git "rev-parse" "--show-toplevel")
        git-dir (git-path checkout "--git-dir")
        common-dir (git-path checkout "--git-common-dir")]
    (cond
      (or (not (zero? (:exit toplevel))) (nil? git-dir) (nil? common-dir))
      {:hold "git-error"}

      (not= (fs/real-path (str/trim (:out toplevel))) (fs/real-path checkout))
      {:hold "git-toplevel-mismatch"}

      :else
      (let [git-dir (fs/real-path git-dir)
            common-dir (fs/real-path common-dir)
            linked? (not= git-dir common-dir)
            ;; A clone whose git dir lives in the run loses every local ref
            ;; and reflog when the run is deleted, so all of them count. A
            ;; worktree only loses its own HEAD and that HEAD's reflog.
            owned-clone? (and (not linked?) (fs/starts-with? git-dir run-real))
            status (git "status" "--porcelain")
            origin (git "remote" "get-url" "origin")
            repo (when (zero? (:exit origin))
                   (github-repo-from-remote-url (:out origin)))
            stash (when owned-clone?
                    (git "rev-parse" "--verify" "--quiet" "refs/stash"))
            ;; Commits dropped by reset, amend or rebase stay recoverable
            ;; through the reflog until the run is deleted.
            reflog (apply git "log" "-g" "--format=%H" (if owned-clone? ["--all"] ["HEAD"]))
            reflog-shas (distinct (remove str/blank? (str/split-lines (:out reflog))))
            rev-list (apply git "rev-list"
                            (str "--max-count=" (inc max-unpushed-commits-per-checkout))
                            (concat ["HEAD"]
                                    (if owned-clone? ["--all" "--reflog"] reflog-shas)
                                    ["--not" "--remotes"]))
            ;; Remote-tracking refs can be stale or belong to another remote,
            ;; so they are no proof by themselves: the tips are always checked
            ;; on GitHub, which also covers every ancestor.
            tips (apply git "rev-parse" "HEAD"
                        (when owned-clone? ["--branches"]))
            shas (distinct (remove str/blank? (concat (str/split-lines (:out tips))
                                                      reflog-shas
                                                      (str/split-lines (:out rev-list)))))]
        (cond
          (not (zero? (:exit status))) {:hold "git-error"}
          (not (str/blank? (:out status))) {:hold "uncommitted-changes"}
          (nil? repo) {:hold "origin-not-github"}
          (and stash (zero? (:exit stash))) {:hold "stash-present"}
          (some #(not (zero? (:exit %))) [tips reflog rev-list]) {:hold "git-error"}
          (> (count shas) max-unpushed-commits-per-checkout) {:hold "too-many-unpushed-commits"}
          :else
          (or (some (fn [sha]
                      (case (github-commit-status gh-cache repo sha)
                        :exists nil
                        :missing {:hold (str "commit-not-on-github sha=" sha)}
                        {:hold (str "github-check-failed sha=" sha)}))
                    shas)
              {:repo repo
               :external-common-dir (when (and linked?
                                               (not (fs/starts-with? common-dir run-real)))
                                      (str common-dir))}))))))

(defn safe-run-workspace-path?
  "True only when `run-path` really is <root>/workspaces/<ticket>/<run-id>."
  [ticket-id run-id run-path]
  (and (fs/directory? run-path {:nofollow-links true})
       (= (fs/real-path run-path)
          (fs/path (fs/real-path (workspaces-dir)) ticket-id run-id))))

(defn prune-run-branch!
  "Deletes the run's own branch from the source repository only when its tip
  and every commit in its reflog (which goes away with the branch) are on
  GitHub. Branches with any other name are never touched."
  [{:keys [dry-run? gh-cache stats]} common-dir repo branch]
  (let [git (fn [& args] (command-result (into ["git" "--git-dir" common-dir] args)))
        ref (str "refs/heads/" branch)
        tip (git "rev-parse" "--verify" "--quiet" ref)
        sha (str/trim (:out tip))
        on-github? (fn [sha] (= :exists (github-commit-status gh-cache repo sha)))
        keep! (fn [reason] (log! (str "prune: keep-branch " common-dir " " branch " reason=" reason)))]
    (when (and (zero? (:exit tip)) (not (str/blank? sha)))
      (if-let [reason (if-not (on-github? sha)
                        (str "tip-not-on-github sha=" sha)
                        (let [reflog (git "log" "-g" "--format=%H" ref)
                              reflog-shas (distinct (remove str/blank? (str/split-lines (:out reflog))))]
                          (cond
                            (not (zero? (:exit reflog))) "git-error"
                            (> (count reflog-shas) max-unpushed-commits-per-checkout) "too-many-reflog-commits"
                            :else (some #(when-not (on-github? %)
                                           (str "reflog-commit-not-on-github sha=" %))
                                        reflog-shas))))]
        (keep! reason)
        (if dry-run?
          (do
            (swap! stats update :branches inc)
            (log! (str "prune: delete-branch " common-dir " " branch " (dry-run)")))
          (let [deleted (git "branch" "-D" branch)]
            (if (zero? (:exit deleted))
              (do
                (swap! stats update :branches inc)
                (log! (str "prune: delete-branch " common-dir " " branch)))
              (keep! (str "branch-delete-failed " (one-line (:err deleted)))))))))))

(defn delete-run-workspace!
  "Returns nil on success or a hold reason when the run could not be removed."
  [{:keys [affected-repos]} run-path checkouts]
  (or (some (fn [{:keys [path external-common-dir]}]
              (when external-common-dir
                (swap! affected-repos conj external-common-dir)
                (let [removed (command-result
                               ["git" "--git-dir" external-common-dir
                                "worktree" "remove" "--force" (str path)]
                               {:timeout-seconds 600})]
                  (when-not (zero? (:exit removed))
                    (str "worktree-remove-failed checkout=" path " " (one-line (:err removed)))))))
            checkouts)
      (try
        (fs/delete-tree run-path)
        nil
        (catch Exception e
          (str "delete-failed " (one-line (.getMessage e)))))))

(defn ticket-frontmatter-or-nil [ticket-id]
  ;; `ticket-frontmatter` exits the process on a missing file; pruning also
  ;; visits workspace directories whose ticket no longer exists.
  (let [path (ticket-path ticket-id)]
    (when (fs/exists? path)
      (try
        (frontmatter-map (vec (str/split-lines (slurp (str path)))))
        (catch Exception _ nil)))))

(defn board-card-lanes
  "Headings of the lanes holding the ticket's cards (empty when it has no
  card), or nil when the board cannot be read. Unlike parse-board-cards this
  also sees lanes the runner does not manage, such as Draft."
  [ticket-id]
  (try
    (let [path (board-path)]
      (when (fs/exists? path)
        ;; board-mutex keeps a half-written board from this JVM out of the read.
        (let [lines (locking board-mutex
                      (str/split-lines (slurp (str path))))]
          (:lanes (reduce (fn [{:keys [lane] :as acc} line]
                            (if-let [[_ heading] (re-matches #"##\s+(.*?)\s*" line)]
                              (assoc acc :lane heading)
                              (cond-> acc
                                (and (card-line? line) (= ticket-id (ticket-id-from-card line)))
                                (update :lanes conj lane))))
                          {:lane nil :lanes []}
                          lines)))))
    (catch Exception _ nil)))

(defn prune-ticket-status [{:keys [today-date retention-days]} ticket-id]
  (let [card-lanes (board-card-lanes ticket-id)]
    (cond
      (fs/exists? (lock-path ticket-id)) {:eligible? false :reason "locked"}
      (nil? card-lanes) {:eligible? false :reason "board-unreadable"}
      ;; The board lane is the source of truth and frontmatter only follows at
      ;; the next sync, so a card moved out of Done wins over `status: done`.
      ;; Tickets without a card are judged by frontmatter alone.
      (some #(not= "Done" %) card-lanes) {:eligible? false :reason "not-done"}
      :else (prune-ticket-decision (ticket-frontmatter-or-nil ticket-id) today-date retention-days))))

(defn prune-run-under-guard!
  "Must run inside with-ticket-lock-guard so no run of the ticket can start
  between the lock check and the deletion. Returns {:result ...}."
  [{:keys [dry-run? now-instant retention-days gh-cache planned] :as ctx} ticket-id run-id]
  (let [run-path (run-workspace-dir ticket-id run-id)
        ticket (prune-ticket-status ctx ticket-id)
        run (prune-run-decision run-id now-instant retention-days)
        hold (fn [reason] {:result :held :reason reason})]
    (cond
      (not (fs/exists? run-path {:nofollow-links true})) {:result :gone}
      (not (:eligible? ticket)) {:result :ticket-skipped :reason (:reason ticket)}
      (= "within-retention" (:reason run)) {:result :recent}
      (not (:eligible? run)) (hold (:reason run))
      (not (safe-run-workspace-path? ticket-id run-id run-path)) (hold "unsafe-path")
      :else
      (let [run-real (fs/real-path run-path)
            checkouts (mapv (fn [checkout]
                              (assoc (inspect-checkout run-real checkout gh-cache) :path checkout))
                            (find-checkouts run-path))
            held (first (filter :hold checkouts))
            branch (ticket-worktree-branch ticket-id run-id)
            branch-repos (distinct (keep (fn [{:keys [external-common-dir repo]}]
                                           (when external-common-dir
                                             [external-common-dir repo]))
                                         checkouts))
            ;; Inspection can take a while (GitHub lookups); look once more
            ;; for a reopened ticket right before anything is removed.
            recheck (delay (prune-ticket-status ctx ticket-id))]
        (cond
          held
          (hold (str (:hold held) " checkout=" (fs/relativize run-path (:path held))))

          dry-run?
          (do
            (swap! planned conj (str run-path))
            (log! (str "prune: delete " run-path " (dry-run)"))
            (doseq [[common-dir repo] branch-repos]
              (prune-run-branch! ctx common-dir repo branch))
            {:result :deleted})

          (not (:eligible? @recheck))
          {:result :ticket-skipped :reason (:reason @recheck)}

          :else
          (if-let [reason (delete-run-workspace! ctx run-path checkouts)]
            (hold reason)
            (do
              (log! (str "prune: delete " run-path))
              (doseq [[common-dir repo] branch-repos]
                (prune-run-branch! ctx common-dir repo branch))
              {:result :deleted})))))))

(defn child-directories [dir]
  (if (fs/directory? dir)
    (->> (fs/list-dir dir)
         (filter #(fs/directory? % {:nofollow-links true}))
         (sort-by str)
         vec)
    []))

(defn prune-ticket-workspaces! [{:keys [stats stop?] :as ctx} ticket-id]
  (let [skip-ticket! (fn [reason]
                       (swap! stats update-in [:skipped reason] (fnil inc 0)))
        pre (prune-ticket-status ctx ticket-id)
        run-ids (map fs/file-name (child-directories (fs/path (workspaces-dir) ticket-id)))]
    (cond
      (empty? run-ids) nil
      (not (:eligible? pre)) (skip-ticket! (:reason pre))
      :else
      (loop [[run-id & more] run-ids]
        (when (and run-id (not (stop?)))
          (let [run-path (run-workspace-dir ticket-id run-id)
                {:keys [result reason]}
                (try
                  (with-ticket-lock-guard
                   ticket-id
                   #(prune-run-under-guard! ctx ticket-id run-id))
                  (catch Exception e
                    {:result :held :reason (str "error " (one-line (.getMessage e)))}))]
            (case result
              :deleted (swap! stats update :deleted inc)
              :recent (swap! stats update :recent inc)
              :held (do
                      (swap! stats update :held inc)
                      (log! (str "prune: hold " run-path " reason=" reason)))
              :ticket-skipped (skip-ticket! reason)
              nil)
            (when-not (= :ticket-skipped result)
              (recur more))))))))

(defn prune-empty-ticket-dir!
  "Removes workspaces/<ticket>/ once no run is left, whatever the ticket status.
  The delete is non-recursive, so a directory that is not empty is never touched."
  [{:keys [dry-run? planned stats]} ticket-dir]
  (let [ticket-id (fs/file-name ticket-dir)]
    (with-ticket-lock-guard
     ticket-id
     (fn []
       (when (and (fs/directory? ticket-dir {:nofollow-links true})
                  (not (fs/exists? (lock-path ticket-id))))
         (let [entries (fs/list-dir ticket-dir)]
           (cond
             (and dry-run? (every? #(contains? @planned (str %)) entries))
             (do
               (swap! stats update :empty-dirs inc)
               (log! (str "prune: delete-empty " ticket-dir " (dry-run)")))

             (and (not dry-run?) (empty? entries))
             (do
               (fs/delete ticket-dir)
               (swap! stats update :empty-dirs inc)
               (log! (str "prune: delete-empty " ticket-dir))))))))))

(defn prune-workspaces!
  ([] (prune-workspaces! {}))
  ([{:keys [dry-run? stop?] :or {dry-run? false stop? (constantly false)}}]
   (let [retention-days (workspace-retention-days)
         ctx {:dry-run? dry-run?
              :stop? stop?
              :retention-days retention-days
              :today-date (java.time.LocalDate/now java.time.ZoneOffset/UTC)
              :now-instant (now)
              :gh-cache (atom {})
              :affected-repos (atom #{})
              :planned (atom #{})
              :stats (atom {:deleted 0 :held 0 :recent 0 :branches 0 :empty-dirs 0 :skipped {}})}
         guarded (fn [label path f]
                   (try
                     (f)
                     (catch Exception e
                       (log! (str "prune: error " label " " path " " (one-line (.getMessage e)))))))]
     (log! (str "prune: start retention-days=" retention-days " dry-run=" dry-run?))
     (doseq [ticket-dir (child-directories (workspaces-dir))
             :when (not (stop?))]
       (guarded "ticket" ticket-dir
                #(prune-ticket-workspaces! ctx (fs/file-name ticket-dir))))
     (doseq [ticket-dir (child-directories (workspaces-dir))
             :when (not (stop?))]
       (guarded "empty-dir" ticket-dir
                #(prune-empty-ticket-dir! ctx ticket-dir)))
     (doseq [common-dir (sort @(:affected-repos ctx))]
       (let [pruned (command-result ["git" "--git-dir" common-dir "worktree" "prune"])]
         (when-not (zero? (:exit pruned))
           (log! (str "prune: error worktree-prune " common-dir " " (one-line (:err pruned)))))))
     (when (stop?)
       (log! "prune: stopped early because the runner is draining"))
     (let [{:keys [deleted held recent branches empty-dirs skipped]} @(:stats ctx)]
       (log! (str "prune: summary deleted=" deleted
                  " held=" held
                  " skipped=" (reduce + 0 (vals skipped))
                  " recent-runs=" recent
                  " branches=" branches
                  " empty-dirs=" empty-dirs
                  " dry-run=" dry-run?
                  (when (seq skipped)
                    (str " skipped-detail="
                         (str/join "," (map (fn [[reason n]] (str reason ":" n))
                                            (sort-by key skipped)))))))
       @(:stats ctx)))))

;; Background prune started by `loop!`. The last start time lives only in this
;; JVM: state.edn is shared with pr-gate-retries and is not written atomically,
;; and one extra idempotent pass after a pod restart is harmless.
(def workspace-prune-run (atom {:future nil :last-started-nanos nil}))

(defn workspace-prune-due? [{:keys [future last-started-nanos]} now-nanos interval-seconds]
  (and (or (nil? future) (realized? future))
       (or (nil? last-started-nanos)
           (>= (- now-nanos last-started-nanos) (* interval-seconds 1000000000)))))

(defn maybe-start-workspace-prune! []
  (when (and (workspace-prune-enabled?)
             (workspace-prune-due? @workspace-prune-run (System/nanoTime)
                                   (workspace-prune-interval-seconds))
             (not (draining?)))
    (reset! workspace-prune-run
            {:last-started-nanos (System/nanoTime)
             :future (future
                       (try
                         (prune-workspaces! {:stop? draining?})
                         (catch Throwable t
                           (log! (str "prune: failed: " (.getMessage t))))))})))

;; Map of ticket-id -> future for currently running process-card! calls.
;; Persists across tick! invocations so the loop can detect new candidates
;; without blocking on already-running tickets.
(def in-flight-futures (atom {}))

(defn collect-completed-futures! []
  (let [snapshot @in-flight-futures
        completed (filter (fn [[_id f]] (future-done? f)) snapshot)
        completed-ids (mapv first completed)]
    (doseq [[ticket-id f] completed]
      (try @f
           (catch Exception e
             (log! (str "in-flight future for " ticket-id " completed with error: " (.getMessage e))))))
    (when (seq completed-ids)
      (swap! in-flight-futures #(apply dissoc % completed-ids)))
    completed-ids))

(defn tick! []
  (recover-locks!)
  (if (draining?)
    (log! (str "runner owner " (owner-id) " is draining; not accepting new tickets"))
    (do
      (sync-all!)
      (let [done (collect-completed-futures!)
            in-flight-ids (set (keys @in-flight-futures))
            candidates (candidate-cards)
            new-candidates (remove #(contains? in-flight-ids (:ticket-id %)) candidates)]
        (doseq [card new-candidates]
          (let [f (future
                    (log! (str "processing " (:ticket-id card) " from " (:lane card)))
                    (let [started? (process-card! card)]
                      (when-not started?
                        (log! (str "candidate could not start, leaving it for a future tick: " (:ticket-id card))))
                      {:ticket-id (:ticket-id card)
                       :started? (boolean started?)}))]
            (swap! in-flight-futures assoc (:ticket-id card) f)))
        (sync-all!)
        (when (seq done)
          (log! (str "collected " (count done) " completed ticket(s): " (str/join ", " done))))
        (log! (cond
                (empty? candidates)
                "no supported-agent-assigned Task Board tickets"

                (and (empty? new-candidates) (seq in-flight-ids))
                (str (count in-flight-ids) " ticket(s) already in flight, no new candidates this tick")

                (empty? new-candidates)
                "no supported-agent-assigned Task Board tickets could start"

                :else
                (str "started " (count new-candidates) " new ticket(s), "
                     (count @in-flight-futures) " total in flight")))))))

(defn loop! []
  ;; Register before recovery or owner activation so direct SIGTERM during startup
  ;; can still persist the planned-shutdown marker.
  (install-shutdown-hook!)
  (recover-locks! true)
  (activate-owner!)
  (log! (str "codex task-board runner started, vault=" (vault) ", root=" (root)
             ", owner=" (owner-id) ", instance=" runner-instance-id))
  (log! (if (workspace-prune-enabled?)
          (str "workspace prune enabled, retention-days=" (workspace-retention-days)
               ", interval-seconds=" (workspace-prune-interval-seconds))
          "workspace prune disabled by CODEX_TASK_BOARD_WORKSPACE_PRUNE"))
  (loop []
    (try
      (tick!)
      (catch Exception e
        (binding [*out* *err*]
          (println (str "task-board tick failed: " (.getMessage e))))))
    ;; After the tick so the first pass never delays startup; one-shot `tick`
    ;; does not prune.
    (try
      (maybe-start-workspace-prune!)
      (catch Exception e
        (log! (str "prune: failed to start: " (.getMessage e)))))
    (Thread/sleep (* 1000 (Long/parseLong (env "CODEX_TASK_BOARD_POLL_SECONDS" "60"))))
    (recur)))

(defn usage []
  (println "usage: task_board_runner.bb <tick|loop|sync|prepare-shutdown|recover|prune-workspaces [--dry-run]>")
  (System/exit 2))

(defn arg-value [args flag]
  (let [idx (.indexOf args flag)]
    (when (>= idx 0) (nth args (inc idx)))))

(defn run-tests! []
  (let [failures (atom [])]
    (when (autonomy-v2-enabled?)
      (swap! failures conj "I1 autonomy v2 must remain disabled"))
    ;; Versioned projections cannot affect legacy candidate selection while off.
    ;; Include every existing route and lane, plus unsupported/new v2 routes.
    (doseq [[lane status] lane->status
            assignee (concat (keys assignee->model) (keys claude-assignee->model)
                             ["fable" "codex-sol-high" "claude-fable" "unknown"])
            intent ["run" "pause" "cancel" "wait-human"]]
      (let [expected (when (supported-assignee? assignee)
                       (get {"backlog" :groom "ready" :implement
                             "in-progress" :implement "review" :review-fix
                             "blocked" :blocked-retry} status))
            action (candidate-action {:lane lane :status status
                                      :autonomy_version 2 :execution_intent intent
                                      :control_revision "malformed"}
                                     assignee)]
        (when (not= expected action)
          (swap! failures conj "feature-off candidate compatibility"))))
    (println "PASS: autonomy v2 remains off; legacy lane/route/intent matrix is unchanged")
    (let [calls (atom [])]
      (try
        (with-redefs [install-shutdown-hook! #(swap! calls conj :install-shutdown-hook)
                      recover-locks! (fn [& _] (swap! calls conj :recover-locks))
                      activate-owner! #(do
                                         (swap! calls conj :activate-owner)
                                         (throw (ex-info "stop loop startup test" {})))]
          (loop!))
        (catch Exception _))
      (if (= [:install-shutdown-hook :recover-locks :activate-owner] @calls)
        (println "PASS: loop installs shutdown hook before recovery and owner activation")
        (do
          (println (str "FAIL: loop startup order expected hook/recover/activate got=" @calls))
          (swap! failures conj "loop startup shutdown hook order"))))

    (let [timestamp "20260710T000000Z"
          first-id (unique-run-id timestamp)
          second-id (unique-run-id timestamp)
          expected-pattern #"^20260710T000000Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"]
      (if (and (not= first-id second-id)
               (re-matches expected-pattern first-id)
               (re-matches expected-pattern second-id))
        (println "PASS: run IDs remain unique within the same second")
        (do
          (println (str "FAIL: same-second run IDs must be unique: " first-id " / " second-id))
          (swap! failures conj "same-second run ID uniqueness"))))

    (doseq [[assignee expected-model] claude-assignee->model]
      (let [args (claude-model-args assignee)
            actual-model (arg-value args "--model")]
        (if (and (= expected-model actual-model)
                 (supported-assignee? assignee)
                 (not-any? #{"--agent"} args))
          (println (str "PASS: " assignee " -> " actual-model " without legacy fable agent"))
          (do
            (println (str "FAIL: " assignee " expected=" expected-model " args=" args))
            (swap! failures conj assignee)))))
    (if (and (claude-assignee? "fable")
             (not (contains? claude-assignee->model "fable")))
      (println "PASS: legacy fable remains a separate Claude route")
      (do
        (println "FAIL: legacy fable must remain separate from explicit Claude model mappings")
        (swap! failures conj "legacy fable route")))

    (doseq [[assignee expected-model] [["codex-astra" "gpt-6-astra"]
                                       ["codex"       "gpt-5.6-terra"]
                                       ["codex-sol"   "gpt-6.1-sol"]
                                       ["codex-full"  "gpt-6.1-sol"]
                                       ["codex-terra" "gpt-5.6-terra"]
                                       ["codex-mini"  "gpt-5.6-luna"]]]
      (let [actual-model (get-codex-model assignee nil)]
        (if (= actual-model expected-model)
          (println (str "PASS: " assignee " -> " actual-model))
          (do
            (println (str "FAIL: " assignee " expected=" expected-model " actual=" actual-model))
            (swap! failures conj assignee)))))
    ;; Only iterate levels allowed per assignee (e.g. no minimal for sol/astra); rejected suffixes are checked below.
    (doseq [[base-assignee expected-model] assignee->model
            reasoning-effort (get assignee->reasoning-levels base-assignee reasoning-levels)]
      (let [assignee (str base-assignee "-" reasoning-effort)
            args (codex-model-profile-args assignee nil nil)
            actual-model (arg-value args "--model")
            actual-reasoning (arg-value args "-c")]
        (if (and (= actual-model expected-model)
                 (= actual-reasoning (str "model_reasoning_effort=" reasoning-effort))
                 (supported-assignee? assignee))
          (println (str "PASS: " assignee " -> " actual-model ", " actual-reasoning))
          (do
            (println (str "FAIL: " assignee " expected model=" expected-model " reasoning level=" reasoning-effort " args=" args))
            (swap! failures conj assignee)))))
    (doseq [assignee (keys assignee->model)]
      (let [args (codex-model-profile-args assignee nil nil)]
        (if (nil? (arg-value args "-c"))
          (println (str "PASS: " assignee " keeps Codex reasoning default"))
          (do
            (println (str "FAIL: " assignee " unexpectedly overrides reasoning: " args))
            (swap! failures conj assignee)))))
    (doseq [[lane status expected-action] [["Backlog" "backlog" :groom]
                                           ["Ready" "ready" :implement]
                                           ["In Progress" "in-progress" :implement]
                                           ["Review" "review" :review-fix]
                                           ["Blocked" "blocked" :blocked-retry]]]
      (let [action (candidate-action {:lane lane :status status} "codex-sol-high")]
        (if (= action expected-action)
          (println (str "PASS: " lane " recognizes codex-sol-high"))
          (do
            (println (str "FAIL: " lane " expected action=" expected-action " actual=" action))
            (swap! failures conj lane)))))
    (doseq [assignee ["codex-invalid" "codex-terra-ultra" "unknown-high" "fable-high"
                      "claude-opus-high" "claude-sonnet-5-5" "claude-unknown"
                      "codex-astra-minimal" "codex-astra-xhigh"
                      "codex-sol-minimal" "codex-full-minimal"]]
      (if (not (supported-assignee? assignee))
        (println (str "PASS: unsupported assignee ignored: " assignee))
        (do
          (println (str "FAIL: invalid assignee was supported: " assignee))
          (swap! failures conj assignee))))
    ;; Test: codex-astra suffix assignees (valid levels only) resolve to codex-astra base for policy injection
    (doseq [assignee ["codex-astra" "codex-astra-low" "codex-astra-medium" "codex-astra-high"]]
      (let [base (:base-assignee (parse-codex-assignee assignee))]
        (if (= "codex-astra" base)
          (println (str "PASS: " assignee " -> base-assignee=" base " (astra policy applies)"))
          (do
            (println (str "FAIL: " assignee " expected base-assignee=codex-astra actual=" base))
            (swap! failures conj (str "astra-base:" assignee))))))
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

    ;; Test: collect-completed-futures! collects done futures and leaves pending ones
    (reset! in-flight-futures {})
    (let [p (promise)
          f-pending (future @p)
          f-done (future 42)]
      (Thread/sleep 50)
      (swap! in-flight-futures assoc "TEST-DONE" f-done "TEST-PENDING" f-pending)
      (let [done (collect-completed-futures!)]
        (cond
          (not= ["TEST-DONE"] done)
          (do (println (str "FAIL: collect-completed-futures! done expected=[TEST-DONE] got=" done))
              (swap! failures conj "collect-completed-futures! done list"))

          (not (contains? @in-flight-futures "TEST-PENDING"))
          (do (println "FAIL: collect-completed-futures! removed pending future")
              (swap! failures conj "collect-completed-futures! pending kept"))

          (contains? @in-flight-futures "TEST-DONE")
          (do (println "FAIL: collect-completed-futures! kept done future")
              (swap! failures conj "collect-completed-futures! done removed"))

          :else
          (println "PASS: collect-completed-futures! collects done and keeps pending")))
      (deliver p :done)
      @f-pending)
    (reset! in-flight-futures {})

    ;; Test: tick! starts new candidates alongside already in-flight tickets
    ;; and does NOT restart in-flight tickets
    (reset! in-flight-futures {})
    (let [p-a (promise)
          f-a (future @p-a)
          started-ids (atom [])
          test-candidates [{:ticket-id "TEST-A" :lane "In Progress" :status "in-progress"}
                           {:ticket-id "TEST-B" :lane "In Progress" :status "in-progress"}]]
      (swap! in-flight-futures assoc "TEST-A" f-a)
      (with-redefs [candidate-cards (fn [] test-candidates)
                    recover-locks! (fn [] nil)
                    draining? (fn [] false)
                    sync-all! (fn [] nil)
                    process-card! (fn [{:keys [ticket-id]}]
                                    (swap! started-ids conj ticket-id)
                                    true)]
        (tick!)
        ;; Wait for started futures to complete within the with-redefs scope
        ;; so process-card! is still redefined when futures execute
        (Thread/sleep 200))
      (doseq [[_ f] @in-flight-futures]
        (when (future-done? f) (try @f (catch Exception _))))
      (cond
        (not (contains? (set @started-ids) "TEST-B"))
        (do (println "FAIL: tick! did not start new candidate TEST-B while TEST-A was in flight")
            (swap! failures conj "tick! starts new candidate alongside in-flight"))

        (contains? (set @started-ids) "TEST-A")
        (do (println "FAIL: tick! restarted in-flight ticket TEST-A")
            (swap! failures conj "tick! skips in-flight ticket"))

        :else
        (println "PASS: tick! starts new candidates without restarting in-flight tickets"))
      (deliver p-a :done)
      @f-a)
    (reset! in-flight-futures {})

    ;; Test: concurrent update-frontmatter! and append-note! on the same ticket do not lose writes.
    ;; Uses a CountDownLatch hook inside write-lines! to force update-frontmatter! to pause
    ;; AFTER its read and BEFORE its write, while append-note! runs concurrently.
    ;; A separate releaser thread delivers write-proceed after a short delay so there is no
    ;; deadlock even when append-note! blocks on the mutex.  Without the mutex this test would
    ;; deterministically lose the appended note; with the mutex both writes are preserved.
    (let [tmp-dir (fs/create-temp-dir)
          ticket-id "TEST-RACE"
          ticket-file (fs/path tmp-dir (str ticket-id ".md"))
          initial-content "---\nstatus: init\nassignee: codex\n---\n\n## Notes\n"]
      (spit (str ticket-file) initial-content)
      (with-redefs [tickets-dir (fn [] tmp-dir)]
        (let [first-write-latch (java.util.concurrent.CountDownLatch. 1)
              write-proceed (promise)
              first-write? (atom true)
              orig-write write-lines!]
          (with-redefs [write-lines! (fn [path lines]
                                       ;; On the first write call (from update-frontmatter!),
                                       ;; signal that the read is done and pause before writing.
                                       ;; This creates a deterministic race window.
                                       (when (compare-and-set! first-write? true false)
                                         (.countDown first-write-latch)
                                         @write-proceed)
                                       (orig-write path lines))]
            ;; f1: update-frontmatter! -- will pause inside write-lines! hook
            (let [f1 (future (update-frontmatter! ticket-id {:status "updated"}))
                  ;; Releaser thread: delivers write-proceed after a delay so f1 can finish
                  ;; regardless of whether the main thread is blocked on the mutex.
                  f-release (future
                              (.await first-write-latch)
                              (Thread/sleep 50)
                              (deliver write-proceed :go))]
              ;; Wait for f1 to have completed its read (inside its lock window)
              (.await first-write-latch)
              ;; Call append-note! now: with mutex it blocks until f1 finishes;
              ;; without mutex it reads the stale file and its write gets overwritten by f1.
              (append-note! ticket-id "important-note")
              @f-release
              @f1)))
        (let [content (slurp (str ticket-file))
              has-update (str/includes? content "status: updated")
              has-note   (str/includes? content "important-note")]
          (cond
            (not has-update)
            (do (println "FAIL: concurrent write lost frontmatter update")
                (swap! failures conj "ticket-file-race: frontmatter update preserved"))
            (not has-note)
            (do (println "FAIL: concurrent write lost appended note")
                (swap! failures conj "ticket-file-race: appended note preserved"))
            :else
            (println "PASS: mutex prevented concurrent write race; both frontmatter and note preserved")))))

    ;; Test: workspace prune eligibility, settings and scheduling (pure functions)
    (let [today-date (java.time.LocalDate/parse "2026-10-01")
          now-instant (java.time.Instant/parse "2026-10-01T12:00:00Z")
          cases [["prune: missing ticket is not eligible"
                  (prune-ticket-decision nil today-date 3)
                  {:eligible? false :reason "ticket-missing"}]
                 ["prune: done ticket closed exactly retention days ago is eligible"
                  (prune-ticket-decision {:status "done" :closed "2026-09-28"} today-date 3)
                  {:eligible? true}]
                 ["prune: done ticket inside retention is not eligible"
                  (prune-ticket-decision {:status "done" :closed "2026-09-29"} today-date 3)
                  {:eligible? false :reason "within-retention"}]
                 ["prune: stale closed on a non-done ticket is not eligible"
                  (prune-ticket-decision {:status "blocked" :closed "2026-07-15"} today-date 3)
                  {:eligible? false :reason "not-done"}]
                 ["prune: done ticket without closed is not eligible"
                  (prune-ticket-decision {:status "done" :closed ""} today-date 3)
                  {:eligible? false :reason "closed-missing"}]
                 ["prune: old run is eligible"
                  (prune-run-decision "20260928T120000Z-a8f301d6-92b8-4218-b605-b9680d35ff4a" now-instant 3)
                  {:eligible? true}]
                 ["prune: run inside retention is not eligible"
                  (prune-run-decision "20260928T120001Z-a8f301d6-92b8-4218-b605-b9680d35ff4a" now-instant 3)
                  {:eligible? false :reason "within-retention"}]
                 ["prune: legacy run id without UUID suffix is eligible"
                  (prune-run-decision "20260709T124714Z" now-instant 3)
                  {:eligible? true}]
                 ["prune: run without timestamp is not eligible"
                  (prune-run-decision "manual-run" now-instant 3)
                  {:eligible? false :reason "run-id-timestamp-unparseable"}]
                 ["prune: ssh origin maps to owner/repo"
                  (github-repo-from-remote-url "git@github.com:boxp/arch.git\n")
                  "boxp/arch"]
                 ["prune: https origin maps to owner/repo"
                  (github-repo-from-remote-url "https://github.com/boxp/is01-linux")
                  "boxp/is01-linux"]
                 ["prune: non-GitHub origin is rejected"
                  (github-repo-from-remote-url "https://notgithub.com/boxp/arch.git")
                  nil]
                 ["prune: local path origin is rejected"
                  (github-repo-from-remote-url "/tmp/github.com/boxp/arch")
                  nil]
                 ["prune: enabled by default" (parse-prune-enabled nil) {:value true}]
                 ["prune: 0 disables" (parse-prune-enabled "0") {:value false}]
                 ["prune: invalid enabled flag falls back to default"
                  (parse-prune-enabled "maybe") {:value true :invalid? true}]
                 ["prune: retention days parsed" (parse-bounded-long "7" 3 0) {:value 7}]
                 ["prune: negative retention falls back to default"
                  (parse-bounded-long "-1" 3 0) {:value 3 :invalid? true}]
                 ["prune: non-numeric interval falls back to default"
                  (parse-bounded-long "6h" 21600 1) {:value 21600 :invalid? true}]
                 ["prune: first pass is due"
                  (workspace-prune-due? {:future nil :last-started-nanos nil} 0 21600) true]
                 ["prune: not due before the interval"
                  (workspace-prune-due? {:future (doto (promise) (deliver :done)) :last-started-nanos 0}
                                        (* 21599 1000000000) 21600)
                  false]
                 ["prune: due after the interval"
                  (workspace-prune-due? {:future (doto (promise) (deliver :done)) :last-started-nanos 0}
                                        (* 21600 1000000000) 21600)
                  true]
                 ["prune: not due while the previous pass is running"
                  (workspace-prune-due? {:future (promise) :last-started-nanos 0}
                                        (* 99999 1000000000) 21600)
                  false]]]
      (doseq [[label actual expected] cases]
        (if (= expected actual)
          (println (str "PASS: " label))
          (do
            (println (str "FAIL: " label " expected=" (pr-str expected) " actual=" (pr-str actual)))
            (swap! failures conj label)))))

    (if (seq @failures)
      (do (println (str "FAILED: " (count @failures) " test(s) failed")) (System/exit 1))
      (println "All tests passed."))))

(defn drain-in-flight! []
  (doseq [[ticket-id f] @in-flight-futures]
    (try @f
         (catch Exception e
           (log! (str "error completing " ticket-id ": " (.getMessage e))))))
  (reset! in-flight-futures {}))

(case (or (first *command-line-args*) "tick")
  "tick" (do (recover-locks!) (tick!) (drain-in-flight!) (sync-all!))
  "loop" (loop!)
  "sync" (do (ensure-root!) (sync-all!))
  "prepare-shutdown" (prepare-shutdown!)
  "recover" (recover-locks!)
  "prune-workspaces" (let [args (rest *command-line-args*)]
                       (when-not (contains? #{[] ["--dry-run"]} (vec args))
                         (usage))
                       (prune-workspaces! {:dry-run? (= ["--dry-run"] (vec args))}))
  "test" (run-tests!)
  (usage))
