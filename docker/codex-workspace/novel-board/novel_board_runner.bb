#!/usr/bin/env bb

(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[clojure.edn :as edn]
         '[clojure.java.io :as io]
         '[clojure.string :as str])

(import '[java.nio.file Files StandardCopyOption StandardOpenOption]
        '[java.nio.file.attribute PosixFilePermissions]
        '[java.security MessageDigest]
        '[java.time Duration Instant ZoneId ZonedDateTime]
        '[java.time.format DateTimeFormatter]
        '[java.util UUID])

(def lane->status
  {"Backlog" "backlog"
   "Draft" "draft"
   "In Progress" "in-progress"
   "Review" "review"
   "Done" "done"})

(def status->lane (into {} (map (fn [[lane status]] [status lane]) lane->status)))
(def default-vault "/home/boxp/Documents/obsidian-headless/BOXP")
(def default-root "/home/boxp/.novel-board")
(def assignee->model
  {"codex" "gpt-5.6-terra"
   "codex-sol" "gpt-5.6-sol"
   "codex-full" "gpt-5.6-sol"
   "codex-terra" "gpt-5.6-terra"
   "codex-mini" "gpt-5.6-luna"})
(def reasoning-levels #{"minimal" "low" "medium" "high" "xhigh"})
(def board-mutex (Object.))
(def log-mutex (Object.))
(def lock-guard-mutexes (vec (repeatedly 256 #(Object.))))

(defn env [key default]
  (or (System/getenv key) default))

(defn env-long [key default]
  (Long/parseLong (env key default)))

(defn vault [] (env "CODEX_NOVEL_BOARD_VAULT" default-vault))
(defn root [] (env "CODEX_NOVEL_BOARD_ROOT" default-root))
(defn owner-id [] (env "CODEX_NOVEL_BOARD_OWNER_ID" (or (System/getenv "HOSTNAME") "unknown-owner")))
(def runner-instance-id (env "CODEX_NOVEL_BOARD_RUNNER_INSTANCE_ID" (str (UUID/randomUUID))))
(defn board-path [] (fs/path (vault) "Boards" "Novel Board.md"))
(defn board-lock-path [] (fs/path (root) "board.lock"))
(defn novels-dir [] (fs/path (vault) "Novels"))
(defn note-path [novel-id] (fs/path (novels-dir) (str novel-id ".md")))
(defn locks-dir [] (fs/path (root) "locks"))
(defn lock-guards-dir [] (fs/path (root) "lock-guards"))
(defn runs-dir [] (fs/path (root) "runs"))
(defn work-dir [novel-id] (fs/path (root) "work" novel-id))
(defn manuscript-path [novel-id] (fs/path (work-dir novel-id) "manuscript.md"))
(defn published-dir [] (fs/path (root) "published"))
(defn published-state-path [novel-id] (fs/path (published-dir) (str novel-id ".edn")))
(defn lock-path [novel-id] (fs/path (locks-dir) (str novel-id ".edn")))
(defn terminating-owners-dir [] (fs/path (root) "terminating-owners"))
(defn terminating-owner-path [] (fs/path (terminating-owners-dir) (str (str/replace (owner-id) #"[^A-Za-z0-9._-]" "_") ".edn")))
(defn lock-guard-path [novel-id] (fs/path (lock-guards-dir) (str novel-id ".lock")))
(defn lock-guard-mutex [novel-id]
  (nth lock-guard-mutexes
       (Math/floorMod (.hashCode (str novel-id)) (count lock-guard-mutexes))))

(defn log! [message]
  (locking log-mutex (println message)))

(defn now [] (Instant/now))
(defn now-str [] (str (now)))
(defn run-id []
  (str (.format (DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'") (ZonedDateTime/now (ZoneId/of "UTC")))
       "-" (UUID/randomUUID)))

(defn ensure-private-dir! [path]
  (fs/create-dirs path)
  (try
    (Files/setPosixFilePermissions (.toPath (io/file (str path)))
                                   (PosixFilePermissions/fromString "rwx------"))
    (catch UnsupportedOperationException _ nil))
  path)

(defn private-file! [path]
  (try
    (Files/setPosixFilePermissions (.toPath (io/file (str path)))
                                   (PosixFilePermissions/fromString "rw-------"))
    (catch UnsupportedOperationException _ nil))
  path)

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) "." (UUID/randomUUID) ".tmp"))]
    (spit (str tmp) content)
    (private-file! tmp)
    (try
      (Files/move (.toPath (io/file (str tmp)))
                  (.toPath (io/file (str path)))
                  (into-array StandardCopyOption [StandardCopyOption/ATOMIC_MOVE
                                                   StandardCopyOption/REPLACE_EXISTING]))
      (catch Exception _
        (Files/move (.toPath (io/file (str tmp)))
                    (.toPath (io/file (str path)))
                    (into-array StandardCopyOption [StandardCopyOption/REPLACE_EXISTING]))))
    (private-file! path)))

(defn write-edn! [path value]
  (atomic-spit! path (str (pr-str value) "\n")))

(defn with-board-lock [f]
  (ensure-private-dir! (root))
  (locking board-mutex
    (with-open [file (java.io.RandomAccessFile. (str (board-lock-path)) "rw")
                channel (.getChannel file)]
      (private-file! (board-lock-path))
      (let [_file-lock (.lock channel)]
        (f)))))

(defn read-edn [path fallback]
  (try
    (if (fs/exists? path) (edn/read-string (slurp (str path))) fallback)
    (catch Exception _ fallback)))

(defn ensure-root! []
  (doseq [path [(root) (locks-dir) (lock-guards-dir) (runs-dir) (published-dir) (fs/path (root) "work")
                (terminating-owners-dir)]]
    (ensure-private-dir! path))
  (fs/create-dirs (novels-dir)))

(defn read-lines [path]
  (if (fs/exists? path) (str/split-lines (slurp (str path))) []))

(defn write-lines! [path lines]
  (atomic-spit! path (str (str/join "\n" lines) "\n")))

(defn parse-frontmatter-lines [lines]
  (if (and (= "---" (first lines))
           (some #{"---"} (rest lines)))
    (let [end (inc (.indexOf (vec (rest lines)) "---"))]
      (reduce (fn [acc line]
                (if-let [[_ key value] (re-matches #"^([A-Za-z0-9_-]+):(?:[ ]?(.*))?$" line)]
                  (let [raw (or value "")
                        parsed (cond
                                 (and (str/starts-with? raw "\"")
                                      (str/ends-with? raw "\""))
                                 (try (edn/read-string raw)
                                      (catch Exception _ raw))

                                 (and (str/starts-with? raw "'")
                                      (str/ends-with? raw "'")
                                      (<= 2 (count raw)))
                                 (str/replace (subs raw 1 (dec (count raw))) "''" "'")

                                 :else raw)]
                    (assoc acc (keyword key) parsed))
                  acc))
              {}
              (subvec (vec lines) 1 end)))
    {}))

(defn note-frontmatter [novel-id]
  (parse-frontmatter-lines (vec (read-lines (note-path novel-id)))))

(defn yaml-value [value]
  (cond
    (nil? value) ""
    (true? value) "true"
    (false? value) "false"
    :else (pr-str (str value))))

(defn update-frontmatter! [novel-id updates]
  (let [path (note-path novel-id)
        lines (vec (read-lines path))
        end (when (= "---" (first lines)) (inc (.indexOf (vec (rest lines)) "---")))]
    (when-not (and end (pos? end))
      (throw (ex-info "management note has invalid frontmatter" {:novel-id novel-id})))
    (let [remaining (atom updates)
          body (mapv (fn [line]
                       (if-let [[_ key] (re-matches #"^([A-Za-z0-9_-]+):.*$" line)]
                         (let [k (keyword key)]
                           (if (contains? @remaining k)
                             (let [value (get @remaining k)]
                               (swap! remaining dissoc k)
                               (str key ": " (yaml-value value)))
                             line))
                         line))
                     (subvec lines 1 end))
          inserted (mapv (fn [[key value]] (str (name key) ": " (yaml-value value))) @remaining)
          next-lines (vec (concat ["---"] body inserted ["---"] (subvec lines (inc end))))]
      (write-lines! path next-lines))))

(defn append-history! [novel-id message]
  (let [path (note-path novel-id)
        content (slurp (str path))
        entry (str "- " (now-str) ": " message)]
    (when-not (str/includes? content message)
      (atomic-spit! path
                    (if-let [idx (str/index-of content "## Run History")]
                      (let [insert-at (+ idx (count "## Run History"))]
                        (str (subs content 0 insert-at) "\n\n" entry (subs content insert-at)))
                      (str content "\n## Run History\n\n" entry "\n"))))))

(defn valid-id? [value]
  (boolean (re-matches #"[A-Za-z0-9][A-Za-z0-9._-]*" (or value ""))))

(defn title-from-label [novel-id label]
  (let [prefix (str novel-id ":")]
    (if (str/starts-with? label prefix)
      (str/trim (subs label (count prefix)))
      (str/trim label))))

(defn token-present? [tail token]
  (boolean (re-find (re-pattern (str "(?:^|\\s)" (java.util.regex.Pattern/quote token) "(?:\\s|$)")) tail)))

(defn metadata-value [tail key]
  (some-> (re-find (re-pattern (str "(?:^|\\s)" key "::([^\\s]+)")) tail) second))

(defn parse-board-cards [lines]
  (loop [remaining lines lane nil cards []]
    (if-let [line (first remaining)]
      (cond
        (re-matches #"^## .+$" line)
        (recur (rest remaining) (subs line 3) cards)

        :else
        (if-let [[_ _ novel-id label tail]
                 (re-matches #"^- \[([ xX])\] \[\[Novels/([^]|]+)\|([^]]+)\]\](.*)$" line)]
          (if (and (contains? lane->status lane) (valid-id? novel-id) (token-present? tail "#novel"))
            (recur (rest remaining) lane
                   (conj cards {:novel-id novel-id
                                :title (title-from-label novel-id label)
                                :lane lane
                                :status (get lane->status lane)
                                :card-status (metadata-value tail "status")
                                :assignee (metadata-value tail "assignee")
                                :nsfw (token-present? tail "#nsfw")}))
            (recur (rest remaining) lane cards))
          (recur (rest remaining) lane cards)))
      cards)))

(defn replace-or-append-metadata [line key value]
  (let [pattern (re-pattern (str key "::[^\\s]+"))
        replacement (str key "::" value)]
    (if (re-find pattern line)
      (str/replace line pattern replacement)
      (str line " " replacement))))

(defn update-card-line [line novel-id status assignee]
  (if (re-find (re-pattern (str "\\[\\[Novels/" (java.util.regex.Pattern/quote novel-id) "(?:\\||\\]\\])")) line)
    (cond-> (replace-or-append-metadata line "status" status)
      assignee (replace-or-append-metadata "assignee" assignee))
    line))

(defn move-card-lines! [lines card-index novel-id target-status assignee]
  (let [path (board-path)
        target-lane (get status->lane target-status)]
    (when-not (and card-index target-lane)
      (throw (ex-info "card or target lane not found" {:novel-id novel-id :status target-status})))
    (let [without-card (vec (concat (subvec lines 0 card-index) (subvec lines (inc card-index))))
          lane-index (first (keep-indexed (fn [idx line] (when (= line (str "## " target-lane)) idx)) without-card))
          next-heading (first (filter #(and (> % lane-index) (str/starts-with? (nth without-card %) "## "))
                                      (range (inc lane-index) (count without-card))))
          insert-at (or next-heading (count without-card))
          card-line (update-card-line (nth lines card-index) novel-id target-status assignee)
          next-lines (vec (concat (subvec without-card 0 insert-at) [card-line] (subvec without-card insert-at)))]
      (write-lines! path next-lines))))

(defn card-index [lines novel-id]
  (first (keep-indexed (fn [idx line]
                         (when (re-find (re-pattern (str "\\[\\[Novels/" (java.util.regex.Pattern/quote novel-id) "(?:\\||\\]\\])")) line) idx))
                       lines)))

(defn move-card! [novel-id target-status assignee]
  (with-board-lock
   (fn []
     (let [lines (vec (read-lines (board-path)))]
       (move-card-lines! lines (card-index lines novel-id) novel-id target-status assignee)))))

(defn move-card-if-status! [novel-id expected-status target-status assignee]
  (with-board-lock
   (fn []
     (let [lines (vec (read-lines (board-path)))
           current (first (filter (fn [card] (= novel-id (:novel-id card)))
                                  (parse-board-cards lines)))]
       (when (= expected-status (:status current))
         (move-card-lines! lines (card-index lines novel-id) novel-id target-status assignee)
         true)))))

(defn create-note! [{:keys [novel-id title status assignee nsfw]}]
  (let [path (note-path novel-id)]
    (when-not (fs/exists? path)
      (fs/create-dirs (novels-dir))
      (atomic-spit! path
                    (str "---\n"
                         "id: " (yaml-value novel-id) "\n"
                         "type: novel\n"
                         "status: " (yaml-value status) "\n"
                         "title: " (yaml-value title) "\n"
                         "assignee: " (yaml-value (or assignee "boxp")) "\n"
                         "nsfw: " (yaml-value nsfw) "\n"
                         "work-dir: " (yaml-value (work-dir novel-id)) "\n"
                         "manuscript: " (yaml-value (manuscript-path novel-id)) "\n"
                         "published-path: \n"
                         "published-at: \n"
                         "---\n\n# " title "\n\n"
                         "## Requirements\n\n"
                         "- Title: " title "\n- Synopsis:\n- Characters:\n- Style and point of view:\n"
                         "- Target readers:\n- Target length:\n- Required elements:\n- Prohibited elements:\n"
                         "- References:\n- NSFW: " nsfw "\n\n"
                         "## Outline\n\n## Review Instructions\n\n## Change History\n\n## Run History\n")))))

(defn sync-card! [{:keys [novel-id]}]
  (with-board-lock
   (fn []
     (let [lines (vec (read-lines (board-path)))
           current (first (filter (fn [card] (= novel-id (:novel-id card)))
                                  (parse-board-cards lines)))]
       (when current
         (create-note! current)
         (let [fm (note-frontmatter novel-id)
               effective-assignee (or (:assignee current) (:assignee fm) "boxp")
               synced (assoc current :assignee effective-assignee)
               next-lines (mapv #(update-card-line % novel-id (:status current) effective-assignee) lines)]
           (when (not= lines next-lines) (write-lines! (board-path) next-lines))
           (update-frontmatter! novel-id
                                {:status (:status current)
                                 :title (:title current)
                                 :assignee effective-assignee
                                 :nsfw (:nsfw current)
                                 :work-dir (work-dir novel-id)
                                 :manuscript (manuscript-path novel-id)})
           synced))))))

(defn parse-codex-assignee [assignee]
  (cond
    (contains? assignee->model assignee) {:base-assignee assignee}
    :else
    (when-let [[_ base effort] (re-matches #"^(.*)-([^-]+)$" (or assignee ""))]
      (when (and (contains? assignee->model base) (contains? reasoning-levels effort))
        {:base-assignee base :reasoning-effort effort}))))

(defn supported-assignee? [assignee]
  (or (= assignee "fable") (= assignee "pi") (some? (parse-codex-assignee assignee))))

(defn assignee-route [assignee]
  (cond
    (= assignee "fable") :fable
    (= assignee "pi") :pi
    (parse-codex-assignee assignee) :codex
    :else nil))

(defn candidate-action [{:keys [status assignee]}]
  (cond
    (= status "done") :publish
    (not (supported-assignee? assignee)) nil
    (= status "backlog") :groom
    (= status "draft") :write
    (= status "in-progress") :write
    (= status "review") :revise
    :else nil))

(defn current-card [novel-id]
  (with-board-lock
   #(first (filter (fn [card] (= novel-id (:novel-id card)))
                   (parse-board-cards (vec (read-lines (board-path))))))))

(defn lock-data [novel-id action lane run]
  {:novel-id novel-id
   :run-id run
   :action action
   :lane lane
   :owner-id (owner-id)
   :runner-instance-id runner-instance-id
   :pid (.pid (java.lang.ProcessHandle/current))
   :started-at (now-str)
   :heartbeat-at (now-str)})

(defn with-lock-guard [novel-id f]
  (ensure-private-dir! (lock-guards-dir))
  (locking (lock-guard-mutex novel-id)
    (with-open [file (java.io.RandomAccessFile. (str (lock-guard-path novel-id)) "rw")
                channel (.getChannel file)]
      (let [_file-lock (.lock channel)]
        (f)))))

(defn acquire-lock! [novel-id action lane run]
  (ensure-root!)
  (let [path (lock-path novel-id)
        value (lock-data novel-id action lane run)]
    (with-lock-guard
      novel-id
      #(try
         (Files/writeString (.toPath (io/file (str path)))
                            (str (pr-str value) "\n")
                            (into-array StandardOpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))
         (private-file! path)
         value
         (catch java.nio.file.FileAlreadyExistsException _ nil)))))

(defn release-lock! [novel-id lock]
  (with-lock-guard
    novel-id
    #(let [path (lock-path novel-id)
           current (read-edn path {})]
       (when (and (= (:run-id current) (:run-id lock))
                  (= (:runner-instance-id current) (:runner-instance-id lock)))
         (fs/delete-if-exists path)))))

(defn heartbeat! [novel-id lock stop?]
  (future
    (while (not @stop?)
      (Thread/sleep (* 1000 (max 1 (env-long "CODEX_NOVEL_BOARD_HEARTBEAT_SECONDS" "30"))))
      (when-not @stop?
        (with-lock-guard
          novel-id
          #(let [path (lock-path novel-id)
                 current (read-edn path {})]
             (when (= (:run-id current) (:run-id lock))
               (write-edn! path (assoc current :heartbeat-at (now-str))))))))))

(defn instant-age-seconds [value]
  (try (.getSeconds (Duration/between (Instant/parse value) (now)))
       (catch Exception _ Long/MAX_VALUE)))

(defn mark-run! [novel-id run status data]
  (let [dir (fs/path (runs-dir) novel-id run)]
    (ensure-private-dir! dir)
    (write-edn! (fs/path dir "summary.edn")
                (merge {:novel-id novel-id :run-id run :status status :updated-at (now-str)} data))))

(defn recover-locks! []
  (ensure-root!)
  (let [markers (->> (fs/glob (terminating-owners-dir) "*.edn")
                     (map (fn [path] [path (read-edn path {})]))
                     (filter (fn [[_ marker]] (:owner-id marker)))
                     vec)
        owner->marker (into {} (map (fn [[path marker]] [(:owner-id marker) [path marker]]) markers))
        stale-seconds (env-long "CODEX_NOVEL_BOARD_LOCK_STALE_SECONDS" "180")]
    (doseq [path (fs/glob (locks-dir) "*.edn")]
      (let [initial (read-edn path {})
            novel-id (:novel-id initial)]
        (when (and novel-id (valid-id? novel-id))
          (with-lock-guard
            novel-id
            #(let [lock (read-edn path {})
                   [_ marker] (get owner->marker (:owner-id lock))
                   planned? (and marker (not= (:runner-instance-id marker) runner-instance-id))
                   stale? (> (instant-age-seconds (:heartbeat-at lock)) stale-seconds)]
               (when (or planned? stale?)
                 (let [reason (if planned? "planned owner shutdown" "stale heartbeat")]
                   (when (fs/exists? (note-path novel-id))
                     (append-history! novel-id (str "Interrupted run " (:run-id lock) " recovered after " reason ". Resume from the current Novel Board lane.")))
                   (when (:run-id lock)
                     (mark-run! novel-id (:run-id lock) :interrupted {:reason reason :lock lock}))
                   (fs/delete-if-exists path)
                   (log! (str "recovered " novel-id " lock after " reason)))))))))
    (doseq [[path marker] markers]
      (when (not= (:runner-instance-id marker) runner-instance-id)
        (fs/delete-if-exists path)))))

(defn prepare-shutdown! []
  (ensure-root!)
  (write-edn! (terminating-owner-path)
              {:owner-id (owner-id) :runner-instance-id runner-instance-id :created-at (now-str)}))

(defn codex-args [assignee cwd last-message]
  (let [{:keys [base-assignee reasoning-effort]} (parse-codex-assignee assignee)
        model (env "CODEX_NOVEL_BOARD_MODEL" (get assignee->model base-assignee))
        profile (System/getenv "CODEX_NOVEL_BOARD_PROFILE")]
    (cond-> ["codex" "exec" "--json" "--cd" (str cwd) "--skip-git-repo-check"
             "--output-last-message" (str last-message)]
      (= "true" (env "CODEX_NOVEL_BOARD_BYPASS_APPROVALS" "true"))
      (conj "--dangerously-bypass-approvals-and-sandbox")
      (not= "true" (env "CODEX_NOVEL_BOARD_BYPASS_APPROVALS" "true"))
      (into ["--sandbox" (env "CODEX_NOVEL_BOARD_SANDBOX" "workspace-write")
             "--add-dir" (vault)])
      model (into ["--model" model])
      profile (into ["--profile" profile])
      reasoning-effort (into ["-c" (str "model_reasoning_effort=" reasoning-effort)])
      true (conj "-"))))

(defn prompt-for [{:keys [novel-id title status lane assignee nsfw]} action]
  (let [note (slurp (str (note-path novel-id)))
        manuscript (manuscript-path novel-id)]
    (str "You are an automated Novel Board worker. Respond and edit prose in Japanese.\n"
         "Novel Board lane is the source of truth; do not edit Boards/Novel Board.md.\n"
         "Novel ID: " novel-id "\nTitle: " title "\nLane: " lane "\nStatus: " status
         "\nAssignee: " assignee "\nNSFW: " nsfw "\n"
         "Management note: " (note-path novel-id) "\n"
         "Manuscript path: " manuscript "\n"
         "Private work directory: " (work-dir novel-id) "\n\n"
         (case action
           :groom
           (str "Groom requirements only. Do not write any novel prose and do not create or edit the manuscript. "
                "Update the management note Requirements and Outline with title, synopsis, characters, style/viewpoint, target readers, target length, required elements, prohibited elements, references, NSFW classification, and a scene outline. Preserve review and history sections.\n")
           :write
           (str "Create or continue the first draft at the manuscript path. Read approved Requirements and Outline first. "
                "Produce a reviewable manuscript, then append a concise entry under Change History without deleting prior history.\n")
           :revise
           (str "Revise the existing manuscript in place using the latest Review Instructions. Preserve previous review instructions and append a concise Change History entry describing the changes.\n"))
         "Never write a draft into the SFW or NSFW publication folders. Do not edit existing novels, Task Board files, or daily cron files.\n"
         "If a human decision or missing requirement prevents completion, record the reason and exact resume condition in Run History.\n"
         "End your final response with exactly one line: NOVEL_BOARD_RESULT: review or NOVEL_BOARD_RESULT: blocked.\n\n"
         "Current management note:\n\n" note)))

(defn result-marker [message]
  (some->> (re-seq #"(?m)^NOVEL_BOARD_RESULT:\s*(review|blocked)\s*$" (or message "")) last second keyword))

(defn run-agent! [card action run]
  (let [novel-id (:novel-id card)
        dir (fs/path (runs-dir) novel-id run)
        prompt-path (fs/path dir "prompt.md")
        stdout-path (fs/path dir "stdout.log")
        stderr-path (fs/path dir "stderr.log")
        last-message-path (fs/path dir "last-message.md")
        pi-session-dir (fs/path dir "pi-session")
        prompt (prompt-for card action)
        route (assignee-route (:assignee card))]
    (ensure-private-dir! dir)
    (ensure-private-dir! (work-dir novel-id))
    (atomic-spit! prompt-path prompt)
    (mark-run! novel-id run :running {:action action :agent (:assignee card) :lane (:lane card)})
    (try
      (let [args (case route
                 :codex (codex-args (:assignee card) (work-dir novel-id) last-message-path)
                 :fable (cond-> ["claude" "--print" "--output-format" "text"
                                  "--add-dir" (vault) "--add-dir" (root)]
                          (= "true" (env "CODEX_NOVEL_BOARD_BYPASS_APPROVALS" "true"))
                          (conj "--dangerously-skip-permissions")
                          (System/getenv "CODEX_NOVEL_BOARD_FABLE_MODEL")
                          (into ["--model" (System/getenv "CODEX_NOVEL_BOARD_FABLE_MODEL")]))
                 :pi (cond-> ["pi" "--print" "--approve" "--mode" "text"
                              "--session-dir" (str pi-session-dir)]
                       (System/getenv "CODEX_NOVEL_BOARD_PI_MODEL")
                       (into ["--model" (System/getenv "CODEX_NOVEL_BOARD_PI_MODEL")])
                       true (conj prompt)))
          opts (cond-> {:out (io/file (str stdout-path))
                        :err (io/file (str stderr-path))}
                 (not= route :pi) (assoc :in (io/file (str prompt-path)))
                 (#{:fable :pi} route) (assoc :dir (str (work-dir novel-id))))
          proc @(p/process args opts)
          exit (:exit proc)
          _ (when (and (not= route :codex) (fs/exists? stdout-path))
              (io/copy (io/file (str stdout-path)) (io/file (str last-message-path))))
          last-message (when (fs/exists? last-message-path) (slurp (str last-message-path)))
          marker (result-marker last-message)]
      (doseq [path [stdout-path stderr-path last-message-path]]
        (when (fs/exists? path) (private-file! path)))
        (mark-run! novel-id run (if (zero? exit) :succeeded :failed)
                   {:action action :agent (:assignee card) :lane (:lane card)
                    :exit-code exit :result marker :finished-at (now-str)})
        {:exit exit :result marker :last-message last-message})
      (finally
        (when (fs/exists? (manuscript-path novel-id))
          (private-file! (manuscript-path novel-id)))))))

(defn sha256 [path]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (with-open [input (io/input-stream (str path))]
      (let [buf (byte-array 8192)]
        (loop []
          (let [n (.read input buf)]
            (when (pos? n)
              (.update digest buf 0 n)
              (recur))))))
    (apply str (map #(format "%02x" (bit-and % 0xff)) (.digest digest)))))

(defn sanitize-title [title]
  (-> (or title "")
      (str/replace #"[\\/\p{Cntrl}]" "_")
      (str/replace #"\s+" " ")
      str/trim))

(defn vault-relative [path]
  (str (.relativize (.toPath (io/file (vault))) (.toPath (io/file (str path))))))

(defn ensure-published-link! [novel-id path published-at]
  (update-frontmatter! novel-id {:published-path (str path) :published-at published-at})
  (append-history! novel-id (str "Published approved manuscript once: [[" (str/replace (vault-relative path) #"\.md$" "") "]].")))

(defn publish! [{:keys [novel-id title nsfw]}]
  (let [fm (note-frontmatter novel-id)
        manuscript (fs/path (or (not-empty (:manuscript fm)) (manuscript-path novel-id)))
        state-path (published-state-path novel-id)
        state (read-edn state-path {})
        recorded-path (or (not-empty (:published-path fm)) (:path state))]
    (cond
      (and recorded-path (fs/exists? recorded-path))
      (let [published-at (or (not-empty (:published-at fm)) (:published-at state) (now-str))
            next-state (merge state {:novel-id novel-id :path (str recorded-path)
                                     :published-at published-at :nsfw nsfw :status :published}
                              (when (fs/exists? manuscript) {:sha256 (sha256 manuscript)}))]
        (write-edn! state-path next-state)
        (ensure-published-link! novel-id recorded-path published-at)
        (log! (str novel-id " already published at " recorded-path))
        :already-published)

      (not (fs/exists? manuscript))
      (do (append-history! novel-id "Done publication is waiting: manuscript is missing. Restore the private manuscript and keep the card in Done for retry.")
          :missing-manuscript)

      (str/blank? (sanitize-title title))
      (do (append-history! novel-id "Done publication is waiting: title is empty after filename sanitization.")
          :invalid-title)

      :else
      (let [dest-dir (fs/path (vault) (if nsfw "NSFW/小説/AI執筆" "小説草案/AI執筆"))
            timestamp (.format (DateTimeFormatter/ofPattern "yyyy-MM-dd-HH-mm")
                               (ZonedDateTime/now (ZoneId/of "Asia/Tokyo")))
            dest (if recorded-path
                   (fs/path recorded-path)
                   (fs/path dest-dir (str timestamp "_" (sanitize-title title) ".md")))]
        (fs/create-dirs dest-dir)
        (if (and (not recorded-path) (fs/exists? dest))
          (do (append-history! novel-id (str "Done publication is waiting: destination already exists and was not overwritten: " dest))
              :collision)
          (do
            (let [published-at (or (:published-at state) (now-str))]
              (write-edn! state-path {:novel-id novel-id :path (str dest) :published-at published-at
                                      :nsfw nsfw :status :reserved}))
            (Files/copy (.toPath (io/file (str manuscript)))
                        (.toPath (io/file (str dest)))
                        (make-array StandardCopyOption 0))
            (let [published-at (or (:published-at (read-edn state-path {})) (now-str))
                  final-state {:novel-id novel-id :path (str dest) :sha256 (sha256 manuscript)
                               :published-at published-at :nsfw nsfw :status :published}]
              (write-edn! state-path final-state)
              (ensure-published-link! novel-id dest published-at)
              (log! (str "published " novel-id " to " dest))
              :published)))))))

(defn process-card! [card]
  (let [action (candidate-action card)]
    (when action
      (if (= action :publish)
        (let [novel-id (:novel-id card)
              run (run-id)
              lock (acquire-lock! novel-id action (:lane card) run)]
          (when lock
            (try
              (when-let [fresh-card (current-card novel-id)]
                (when (= action (candidate-action fresh-card))
                  (let [result (publish! fresh-card)]
                    (mark-run! novel-id run :succeeded {:action action :lane (:lane fresh-card)
                                                         :result result :finished-at (now-str)})
                    result)))
              (catch Exception e
                (append-history! novel-id (str "Done publication failed without changing the lane: " (.getMessage e) ". Retry after correcting the cause."))
                (mark-run! novel-id run :failed {:action action :lane (:lane card)
                                                  :error (.getMessage e) :finished-at (now-str)})
                :failed)
              (finally
                (release-lock! novel-id lock)))))
        (let [novel-id (:novel-id card)
              run (run-id)
              lock (acquire-lock! novel-id action (:lane card) run)]
          (when lock
            (let [stop? (atom false)
                  heartbeat (atom nil)]
              (try
                (when-let [fresh-card (current-card novel-id)]
                  (when (= action (candidate-action fresh-card))
                    (reset! heartbeat (heartbeat! novel-id lock stop?))
                    (when (#{:write :revise} action)
                      (move-card! novel-id "in-progress" (:assignee fresh-card))
                      (update-frontmatter! novel-id {:status "in-progress"}))
                    (append-history! novel-id (str "Novel Board run " run " started from " (:lane fresh-card) " with action " (name action) " using " (:assignee fresh-card) "."))
                    (let [expected-status (if (#{:write :revise} action) "in-progress" (:status fresh-card))
                          {:keys [exit result]} (run-agent! (assoc fresh-card :status expected-status) action run)
                          next-status (if (= action :groom) "draft" "review")
                          outcome (cond
                                    (not (zero? exit)) (str "agent exited " exit)
                                    (= result :blocked) "human decision or missing input requested"
                                    (nil? result) "result marker missing"
                                    :else "agent returned review")]
                      (if (move-card-if-status! novel-id expected-status next-status "boxp")
                        (do
                          (update-frontmatter! novel-id {:status next-status :assignee "boxp"})
                          (append-history! novel-id (str "Novel Board run " run " finished in " next-status ": " outcome ". Resume by recording instructions and assigning a supported agent.")))
                        (append-history! novel-id (str "Novel Board run " run " finished, but the Board no longer remained in " expected-status "; preserved the current lane instead of moving it to " next-status ".")))
                      true)))
                (catch Exception e
                  (let [expected-status (if (= action :groom) "backlog" "in-progress")
                        next-status (if (= action :groom) "draft" "review")]
                    (when (move-card-if-status! novel-id expected-status next-status "boxp")
                      (update-frontmatter! novel-id {:status next-status :assignee "boxp"})))
                  (append-history! novel-id (str "Novel Board run " run " failed: " (.getMessage e) ". Resume after correcting the cause and assigning a supported agent."))
                  (mark-run! novel-id run :failed {:action action :error (.getMessage e) :finished-at (now-str)})
                  true)
                (finally
                  (reset! stop? true)
                  (when-let [worker @heartbeat] (future-cancel worker))
                  (release-lock! novel-id lock))))))))))

(defn sync-all! []
  (ensure-root!)
  (when-not (fs/exists? (board-path))
    (throw (ex-info "Novel Board not found" {:path (board-path)})))
  (into [] (keep sync-card!) (parse-board-cards (vec (read-lines (board-path))))))

(defn record-unsupported! [card]
  (when (and (not= "done" (:status card))
             (not (supported-assignee? (:assignee card))))
    (append-history! (:novel-id card)
                     (str "Runner skipped unsupported or human assignee '" (:assignee card)
                          "'. Assign codex/codex-sol/codex-full/codex-terra/codex-mini (optionally with a reasoning suffix), fable, or pi to resume."))))

(defn tick! []
  (recover-locks!)
  (let [cards (sync-all!)]
    (doseq [card cards]
      (record-unsupported! card)
      (when (candidate-action card)
        (log! (str "processing " (:novel-id card) " from " (:lane card)))
        (process-card! card)))
    (sync-all!)
    (when (empty? cards) (log! "Novel Board has no cards"))))

(defn install-shutdown-hook! []
  (.addShutdownHook (Runtime/getRuntime)
                    (Thread. (fn []
                               (try (prepare-shutdown!)
                                    (catch Exception e
                                      (binding [*out* *err*]
                                        (println (str "failed to prepare Novel Board shutdown: " (.getMessage e))))))))))

(defn loop! []
  (install-shutdown-hook!)
  (recover-locks!)
  (log! (str "novel board runner started, vault=" (vault) ", root=" (root)
             ", owner=" (owner-id) ", instance=" runner-instance-id))
  (loop []
    (try (tick!)
         (catch Exception e
           (binding [*out* *err*] (println (str "novel-board tick failed: " (.getMessage e))))))
    (Thread/sleep (* 1000 (env-long "CODEX_NOVEL_BOARD_POLL_SECONDS" "60")))
    (recur)))

(defn usage []
  (println "usage: novel_board_runner.bb <tick|loop|sync|prepare-shutdown|recover>")
  (System/exit 2))

(case (or (first *command-line-args*) "tick")
  "tick" (tick!)
  "loop" (loop!)
  "sync" (sync-all!)
  "prepare-shutdown" (prepare-shutdown!)
  "recover" (recover-locks!)
  (usage))
