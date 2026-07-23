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
  ;; GPT-5.6 performance order: Sol > Terra > Luna.
  ;; codex (default) / codex-terra route to Terra (GPT-5.5-equivalent, cost-efficient default).
  ;; codex-sol / codex-full route to Sol (highest-performance, complex tasks only).
  ;; codex-mini routes to Luna (lightweight tier).
  {"codex"       "gpt-5.6-terra"
   "codex-sol"   "gpt-5.6-sol"
   "codex-full"  "gpt-5.6-sol"
   "codex-terra" "gpt-5.6-terra"
   "codex-mini"  "gpt-5.6-luna"})

(def reasoning-levels #{"minimal" "low" "medium" "high" "xhigh"})

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
      (when (and (contains? assignee->model base-assignee)
                 (contains? reasoning-levels reasoning-effort))
        {:base-assignee base-assignee
         :reasoning-effort reasoning-effort}))))

(defn supported-assignee? [assignee]
  (or (= "fable" assignee)
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
  (let [summary (merge {:ticket ticket-id
                        :run-id run-id
                        :status status
                        :updated-at (now-str)}
                       extra)]
    (write-edn-file! (fs/path (run-dir ticket-id run-id) "summary.edn") summary)))

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
       "- For repository changes, make sure a GitHub PR URL is included before returning TASK_BOARD_RESULT: review. If no repository changes were made, include TASK_BOARD_REVIEW_PR: none.\n"
       "- Progress logging: at each milestone (investigation complete, approach decided, PR created, blocker encountered), append a note to the ticket Notes by running: bb ~/.claude/skills/obsidian-task-board/bin/task-board.bb append-note TICKET_ID --vault \"$CODEX_TASK_BOARD_VAULT\" --source fable --note \"<milestone summary>\"\n\n"))

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

(defn append-note-instruction [agent ticket-id]
  (let [helper (if (= "fable" agent)
                 "~/.claude/skills/obsidian-task-board/bin/task-board.bb"
                 "~/.codex/skills/obsidian-task-board/bin/task-board.bb")]
    (str "Progress logging: at each milestone during your work (investigation complete, approach decided, PR created, blocker encountered), "
         "append a note to this ticket's Notes by running:\n"
         "  bb " helper " append-note " ticket-id " --vault \"$CODEX_TASK_BOARD_VAULT\" --source " agent " --note \"<milestone summary>\"\n")))

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
  (loop []
    (try
      (tick!)
      (catch Exception e
        (binding [*out* *err*]
          (println (str "task-board tick failed: " (.getMessage e))))))
    (Thread/sleep (* 1000 (Long/parseLong (env "CODEX_TASK_BOARD_POLL_SECONDS" "60"))))
    (recur)))

(defn usage []
  (println "usage: task_board_runner.bb <tick|loop|sync|prepare-shutdown|recover>")
  (System/exit 2))

(defn arg-value [args flag]
  (let [idx (.indexOf args flag)]
    (when (>= idx 0) (nth args (inc idx)))))

(defn run-tests! []
  (let [failures (atom [])]
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
    (doseq [[base-assignee expected-model] assignee->model
            reasoning-effort reasoning-levels]
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
    (doseq [assignee ["codex-invalid" "codex-terra-ultra" "unknown-high" "fable-high"]]
      (if (not (supported-assignee? assignee))
        (println (str "PASS: unsupported assignee ignored: " assignee))
        (do
          (println (str "FAIL: invalid assignee was supported: " assignee))
          (swap! failures conj assignee))))
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
  "test" (run-tests!)
  (usage))
