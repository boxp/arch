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
        '[java.util UUID]
        '[java.util.concurrent TimeUnit])

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
(def note-lock-mutexes (vec (repeatedly 256 #(Object.))))
(def publication-lock-mutexes (vec (repeatedly 256 #(Object.))))
(defn env [key default]
  (or (System/getenv key) default))

(defn env-long [key default]
  (Long/parseLong (env key default)))

(defn agent-timeout-seconds []
  (env-long "CODEX_NOVEL_BOARD_AGENT_TIMEOUT_SECONDS" "7200"))

(defn agent-shutdown-grace-seconds []
  (env-long "CODEX_NOVEL_BOARD_AGENT_SHUTDOWN_GRACE_SECONDS" "10"))

(defn agent-supervisor []
  (env "CODEX_NOVEL_BOARD_AGENT_SUPERVISOR" "/usr/local/bin/novel-agent-supervisor"))

(defn vault [] (env "CODEX_NOVEL_BOARD_VAULT" default-vault))
(defn root [] (env "CODEX_NOVEL_BOARD_ROOT" default-root))
(defn owner-id [] (env "CODEX_NOVEL_BOARD_OWNER_ID" (or (System/getenv "HOSTNAME") "unknown-owner")))
(def runner-instance-id (env "CODEX_NOVEL_BOARD_RUNNER_INSTANCE_ID" (str (UUID/randomUUID))))
(defn board-path [] (fs/path (vault) "Boards" "Novel Board.md"))
(defn board-lock-path [] (fs/path (root) "board.lock"))
(defn novels-dir [] (fs/path (vault) "Novels"))
(defn note-template-path [] (fs/path (vault) "Templates" "Novel Management.md"))
(defn note-path [novel-id] (fs/path (novels-dir) (str novel-id ".md")))
(defn locks-dir [] (fs/path (root) "locks"))
(defn lock-guards-dir [] (fs/path (root) "lock-guards"))
(defn runs-dir [] (fs/path (root) "runs"))
(defn work-dir [novel-id] (fs/path (root) "work" novel-id))
(defn manuscript-path [novel-id] (fs/path (work-dir novel-id) "manuscript.md"))
(defn note-locks-dir [] (fs/path (root) "note-locks"))
(defn note-lock-path [novel-id] (fs/path (note-locks-dir) (str novel-id ".lock")))
(defn note-lock-mutex [novel-id]
  (nth note-lock-mutexes
       (Math/floorMod (.hashCode (str novel-id)) (count note-lock-mutexes))))
(defn published-dir [] (fs/path (root) "published"))
(defn published-state-path [novel-id] (fs/path (published-dir) (str novel-id ".edn")))
(defn publication-locks-dir [] (fs/path (root) "publication-locks"))
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

(defn with-note-lock [novel-id f]
  (ensure-private-dir! (note-locks-dir))
  (locking (note-lock-mutex novel-id)
    (with-open [file (java.io.RandomAccessFile. (str (note-lock-path novel-id)) "rw")
                channel (.getChannel file)]
      (private-file! (note-lock-path novel-id))
      (let [_file-lock (.lock channel)]
        (f)))))

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
  (doseq [path [(root) (locks-dir) (lock-guards-dir) (note-locks-dir) (runs-dir) (published-dir) (publication-locks-dir)
                (fs/path (root) "work")
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
  (with-note-lock
    novel-id
    #(let [path (note-path novel-id)
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
         (write-lines! path next-lines)))))

(defn append-history! [novel-id message]
  (with-note-lock
    novel-id
    #(let [path (note-path novel-id)
           content (slurp (str path))
           entry (str "- " (now-str) ": " message)]
       (when-not (str/includes? content message)
         (atomic-spit! path
                       (if-let [idx (str/index-of content "## Run History")]
                         (let [insert-at (+ idx (count "## Run History"))]
                           (str (subs content 0 insert-at) "\n\n" entry (subs content insert-at)))
                         (str content "\n## Run History\n\n" entry "\n")))))))

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

(defn scaffold-title [body]
  (-> body
      (str/replace #"(?:^|\s)#novel(?=\s|$)" " ")
      (str/replace #"(?:^|\s)#nsfw(?=\s|$)" " ")
      (str/replace #"(?:^|\s)status::[^\s]+" " ")
      (str/replace #"(?:^|\s)assignee::[^\s]+" " ")
      (str/replace #"\s+" " ")
      str/trim))

(defn backlog-scaffold-cards [lines]
  (loop [idx 0 lane nil cards []]
    (if (< idx (count lines))
      (let [line (nth lines idx)]
        (cond
          (re-matches #"^## .+$" line)
          (recur (inc idx) (subs line 3) cards)

          (= lane "Backlog")
          (if-let [[_ _ body] (re-matches #"^- \[([ xX])\] (.+)$" line)]
            (let [title (scaffold-title body)]
              (if (and (not (str/includes? body "[["))
                       (not (token-present? body "#novel-rule"))
                       (not (str/blank? title)))
                (recur (inc idx) lane
                       (conj cards {:line-index idx
                                    :title title
                                    :assignee (or (metadata-value body "assignee") "boxp")
                                    :nsfw (token-present? body "#nsfw")}))
                (recur (inc idx) lane cards)))
            (recur (inc idx) lane cards))

          :else
          (recur (inc idx) lane cards)))
      cards)))

(defn existing-scaffold-numbers [lines]
  (let [board-numbers (keep (fn [line]
                              (some-> (re-find #"\[\[Novels/NOVEL-(\d+)(?:\||\]\])" line)
                                      second
                                      Long/parseLong))
                            lines)
        note-numbers (if (fs/exists? (novels-dir))
                       (keep (fn [path]
                               (some-> (re-matches #"NOVEL-(\d+)\.md" (str (fs/file-name path)))
                                       second
                                       Long/parseLong))
                             (fs/list-dir (novels-dir)))
                       [])]
    (concat board-numbers note-numbers)))

(defn scaffold-card-line [{:keys [novel-id title assignee nsfw]}]
  (str "- [ ] [[Novels/" novel-id "|" novel-id ": " title "]] #novel"
       (when nsfw " #nsfw")
       " status::backlog assignee::" assignee))

(defn scaffold-backlog-cards! []
  (with-board-lock
   (fn []
     (let [lines (vec (read-lines (board-path)))
           drafts (backlog-scaffold-cards lines)]
       (when (seq drafts)
         (let [start-number (inc (reduce max 0 (existing-scaffold-numbers lines)))
               cards (map-indexed (fn [offset card]
                                    (assoc card :novel-id (str "NOVEL-" (+ start-number offset))))
                                  drafts)
               replacements (into {} (map (juxt :line-index scaffold-card-line) cards))
               next-lines (mapv (fn [idx line] (get replacements idx line))
                                (range (count lines))
                                lines)]
           (write-lines! (board-path) next-lines)
           (doseq [{:keys [novel-id title]} cards]
             (log! (str "scaffolded " novel-id " from Backlog title: " title)))
           (count cards)))))))

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

(defn update-card-nsfw
  "Add or remove the #nsfw tag in the tail of a board card line for the given novel-id.
  Only the portion after the closing ]] is modified to avoid touching the card label."
  [line novel-id nsfw]
  (if-not (re-find (re-pattern (str "\\[\\[Novels/" (java.util.regex.Pattern/quote novel-id) "(?:\\||\\]\\])")) line)
    line
    (let [bracket-end (some-> (str/index-of line "]]") (+ 2))]
      (if-not bracket-end
        line
        (let [prefix (subs line 0 bracket-end)
              tail (subs line bracket-end)
              has-nsfw (token-present? tail "#nsfw")]
          (cond
            (and nsfw (not has-nsfw))
            (str prefix (str/replace-first tail #"(#novel)(?=\s|$)" "$1 #nsfw"))
            (and (not nsfw) has-nsfw)
            (str prefix (str/replace tail #"\s#nsfw(?=\s|$)" ""))
            :else line))))))

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

(defn replace-template-line [content pattern replacement]
  (str/replace content pattern (fn [_] replacement)))

(defn render-template-frontmatter [content updates]
  (let [lines (vec (str/split-lines content))
        end (when (= "---" (first lines)) (inc (.indexOf (vec (rest lines)) "---")))]
    (when-not (and end (pos? end))
      (throw (ex-info "Novel Management template has invalid frontmatter" {:path (note-template-path)})))
    (let [remaining (atom updates)
          frontmatter (mapv (fn [line]
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
          rendered (str/join "\n" (concat ["---"] frontmatter inserted ["---"] (subvec lines (inc end))))]
      (if (str/ends-with? content "\n") (str rendered "\n") rendered))))

(defn render-note-template [{:keys [novel-id title status assignee nsfw]}]
  (let [template-path (note-template-path)]
    (when-not (fs/exists? template-path)
      (throw (ex-info "Novel Management template not found" {:path template-path})))
    (let [content (render-template-frontmatter
                   (slurp (str template-path))
                   {:id novel-id
                    :type "novel"
                    :status status
                    :title title
                    :assignee (or assignee "boxp")
                    :nsfw nsfw
                    :work-dir (work-dir novel-id)
                    :manuscript (manuscript-path novel-id)})]
      (-> content
          (replace-template-line #"(?m)^# Novel[ \t]*$" (str "# " title))
          (replace-template-line #"(?m)^- Title:.*$" (str "- Title: " title))
          (replace-template-line #"(?m)^- NSFW:.*$" (str "- NSFW: " nsfw))))))

(defn create-note! [{:keys [novel-id] :as card}]
  (let [path (note-path novel-id)]
    (when-not (fs/exists? path)
      (fs/create-dirs (novels-dir))
      (let [content (render-note-template card)]
        (atomic-spit! path (if (str/ends-with? content "\n") content (str content "\n")))))))

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
               ;; nsfw is bidirectional: note frontmatter can set #nsfw on the board card.
               ;; Either source being true makes the novel NSFW. To clear NSFW, remove
               ;; #nsfw from the board card and set nsfw: false in the management note.
               ;; Note: parse-frontmatter-lines returns the string "true"/"false" for
               ;; unquoted YAML booleans, so compare explicitly with = "true".
               note-nsfw (= "true" (str (:nsfw fm)))
               effective-nsfw (or (:nsfw current) note-nsfw false)
               synced (assoc current :assignee effective-assignee :nsfw effective-nsfw)
               next-lines (mapv #(-> %
                                     (update-card-line novel-id (:status current) effective-assignee)
                                     (update-card-nsfw novel-id effective-nsfw))
                                lines)]
           (when (not= lines next-lines) (write-lines! (board-path) next-lines))
           (update-frontmatter! novel-id
                                {:status (:status current)
                                 :title (:title current)
                                 :assignee effective-assignee
                                 :nsfw effective-nsfw
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

(defn section-content [content heading]
  (->> (str/split-lines content)
       (drop-while #(not= % (str "## " heading)))
       rest
       (take-while #(not (str/starts-with? % "## ")))
       (str/join "\n")
       str/trim))

(defn review-instructions-present? [novel-id]
  (let [path (note-path novel-id)]
    (and (fs/exists? path)
         (not (str/blank? (section-content (slurp (str path)) "Review Instructions"))))))

(def obsidian-image-pattern
  #"(?i)!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp))(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")

(def markdown-image-pattern
  #"(?i)!\[[^\]]*\]\(\s*(?:<([^>]+\.(?:png|jpe?g|gif|webp))>|([^\s)]+\.(?:png|jpe?g|gif|webp)))(?:\s+[\"'][^\"']*[\"'])?\s*\)")

(defn embedded-image-references [content]
  (concat (map second (re-seq obsidian-image-pattern content))
          (map (fn [match] (or (nth match 1 nil) (nth match 2 nil)))
               (re-seq markdown-image-pattern content))))

(defn canonical-file [path]
  (.getCanonicalFile (io/file (str path))))

(defn vault-local-regular-file? [file]
  (let [vault-path (.toPath (canonical-file (vault)))
        canonical (canonical-file file)
        file-path (.toPath canonical)]
    (and (.startsWith file-path vault-path)
         (.isFile canonical))))

(defn unique-vault-file [filename]
  (let [matches (->> (file-seq (io/file (vault)))
                     (filter #(.isFile %))
                     (filter #(= filename (.getName %)))
                     (take 2)
                     vec)]
    (when (= 1 (count matches)) (first matches))))

(defn resolve-reference-image [novel-id reference]
  (let [reference (str/trim reference)
        raw-file (io/file reference)
        candidates (if (.isAbsolute raw-file)
                     [raw-file]
                     [(io/file (vault) reference)
                      (io/file (str (fs/parent (note-path novel-id))) reference)])
        existing (first (filter vault-local-regular-file? candidates))
        basename-match (when (and (nil? existing)
                                  (not (str/includes? reference "/"))
                                  (not (str/includes? reference "\\")))
                         (unique-vault-file reference))]
    (some-> (or existing basename-match) canonical-file str)))

(defn reference-image-paths [novel-id]
  (let [content (slurp (str (note-path novel-id)))
        reference-content (str/join "\n"
                                    (map #(section-content content %)
                                         ["Requirements" "Outline" "Review Instructions"]))]
    (->> (embedded-image-references reference-content)
         (keep #(resolve-reference-image novel-id %))
         distinct
         vec)))

(defn assignee-route [assignee]
  (cond
    (= assignee "fable") :fable
    (= assignee "pi") :pi
    (parse-codex-assignee assignee) :codex
    :else nil))

(defn candidate-action [{:keys [novel-id status assignee]}]
  (cond
    (= status "done") :publish
    (not (supported-assignee? assignee)) nil
    (= status "backlog") :groom
    (= status "draft") :write
    (= status "in-progress") :write
    (and (= status "review") (review-instructions-present? novel-id)) :revise
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
               (when stale?
                 (let [reason (if planned? "planned owner shutdown with stale heartbeat" "stale heartbeat")]
                   (when (fs/exists? (note-path novel-id))
                     (append-history! novel-id (str "Interrupted run " (:run-id lock) " recovered after " reason ". Resume from the current Novel Board lane.")))
                   (when (:run-id lock)
                     (mark-run! novel-id (:run-id lock) :interrupted {:reason reason :lock lock}))
                   (fs/delete-if-exists path)
                   (log! (str "recovered " novel-id " lock after " reason)))))))))
    (let [locked-owner-ids (->> (fs/glob (locks-dir) "*.edn")
                                (keep (fn [path] (:owner-id (read-edn path {}))))
                                set)]
      (doseq [[path marker] markers]
        (when (and (not= (:runner-instance-id marker) runner-instance-id)
                   (not (contains? locked-owner-ids (:owner-id marker))))
          (fs/delete-if-exists path))))))

(defn prepare-shutdown! []
  (ensure-root!)
  (write-edn! (terminating-owner-path)
              {:owner-id (owner-id) :runner-instance-id runner-instance-id :created-at (now-str)}))

(defn bypass-approvals? []
  (= "true" (env "CODEX_NOVEL_BOARD_BYPASS_APPROVALS" "false")))

(defn codex-args [assignee cwd last-message]
  (let [{:keys [base-assignee reasoning-effort]} (parse-codex-assignee assignee)
        model (env "CODEX_NOVEL_BOARD_MODEL" (get assignee->model base-assignee))
        profile (System/getenv "CODEX_NOVEL_BOARD_PROFILE")]
    (cond-> ["codex" "exec" "--json" "--cd" (str cwd) "--skip-git-repo-check"
             "--output-last-message" (str last-message)]
      (bypass-approvals?)
      (conj "--dangerously-bypass-approvals-and-sandbox")
      (not (bypass-approvals?))
      (into ["--sandbox" (env "CODEX_NOVEL_BOARD_SANDBOX" "workspace-write")
             "--add-dir" (vault)])
      model (into ["--model" model])
      profile (into ["--profile" profile])
      reasoning-effort (into ["-c" (str "model_reasoning_effort=" reasoning-effort)])
      true (conj "-"))))

(defn prompt-for [{:keys [novel-id title status lane assignee nsfw]} action reference-images]
  (let [note (slurp (str (note-path novel-id)))
        manuscript (manuscript-path novel-id)]
    (str "You are an automated Novel Board worker. Respond and edit prose in Japanese.\n"
         "Novel Board lane is the source of truth; do not edit Boards/Novel Board.md.\n"
         "Novel ID: " novel-id "\nTitle: " title "\nLane: " lane "\nStatus: " status
         "\nAssignee: " assignee "\nNSFW: " nsfw "\n"
         "Management note: " (note-path novel-id) "\n"
         "Manuscript path: " manuscript "\n"
         "Private work directory: " (work-dir novel-id) "\n\n"
         (when (seq reference-images)
           (str "Reference images attached to the agent:\n"
                (str/join "\n" (map #(str "- " %) reference-images)) "\n\n"))
         (case action
           :groom
           (str "Groom requirements only. Do not write any novel prose and do not create or edit the manuscript. "
                "Update the management note Requirements and Outline with title, synopsis, characters, style/viewpoint, target readers, target length, required elements, prohibited elements, references, NSFW classification, and a scene outline. Preserve review and history sections.\n")
           :write
           (str "Create or continue the first draft at the manuscript path. Read approved Requirements and Outline first. "
                "Produce a reviewable manuscript, then append a concise entry under Change History without deleting prior history.\n")
           :revise
           (str "Revise the existing manuscript in place using the latest Review Instructions. Preserve previous review instructions and append a concise Change History entry describing the changes.\n"))
         "File editing: prefer bash (e.g. printf '%s' 'CONTENT' > 'PATH') or the write tool (path, content) for whole-file writes. "
         "If using the edit tool, its required schema is: {\"path\": \"/abs/path\", \"edits\": [{\"oldText\": \"text to replace\", \"newText\": \"replacement\"}]}.\n"
         "Never write a draft into the SFW or NSFW publication folders. Do not edit existing novels, Task Board files, or daily cron files.\n"
         "If a human decision or missing requirement prevents completion, record the reason and exact resume condition in Run History.\n"
         "End your final response with exactly one line: NOVEL_BOARD_RESULT: review or NOVEL_BOARD_RESULT: blocked.\n\n"
         "Current management note:\n\n" note)))

(defn result-marker [message]
  (some->> (re-seq #"(?m)^NOVEL_BOARD_RESULT:\s*(review|blocked)\s*$" (or message "")) last second keyword))

(defn await-agent! [args opts]
  ;; The shell supervisor runs below tini's Linux child-subreaper boundary. A
  ;; child cannot erase this ancestry boundary by clearing its environment,
  ;; calling setsid, or double-forking: orphaned descendants are reparented to
  ;; tini, while the readable shell loop waits for and terminates every process.
  (let [grace-seconds (agent-shutdown-grace-seconds)
        supervisor-args [(agent-supervisor) "--grace-ms"
                         (str (* grace-seconds 1000)) "--"]
        handle (p/process (into supervisor-args args) opts)
        process (:proc handle)
        timeout-seconds (agent-timeout-seconds)]
    (if (.waitFor process timeout-seconds TimeUnit/SECONDS)
      {:process-result @handle :timed-out? false}
      (let [cleanup-error (try
                            (.destroy process)
                            nil
                            (catch Exception e {:message (.getMessage e)
                                                :data (ex-data e)}))
            ;; Do not release the card lock while a supervised descendant can
            ;; still modify its work directory. The caller's heartbeat remains
            ;; active during this wait. The supervisor applies TERM/KILL itself
            ;; and exits only after every descendant has been reaped.
            _ (.waitFor process)]
        {:process-result {:exit 124}
         :timed-out? true
         :cleanup-error cleanup-error}))))

(defn run-agent! [card action run]
  (let [novel-id (:novel-id card)
        dir (fs/path (runs-dir) novel-id run)
        prompt-path (fs/path dir "prompt.md")
        stdout-path (fs/path dir "stdout.log")
        stderr-path (fs/path dir "stderr.log")
        last-message-path (fs/path dir "last-message.md")
        pi-session-dir (fs/path dir "pi-session")
        route (assignee-route (:assignee card))
        reference-images (if (= route :pi) (reference-image-paths novel-id) [])
        prompt (prompt-for card action reference-images)]
    (ensure-private-dir! dir)
    (ensure-private-dir! (work-dir novel-id))
    (atomic-spit! prompt-path prompt)
    (mark-run! novel-id run :running {:action action :agent (:assignee card) :lane (:lane card)})
    (try
      (let [args (case route
                 :codex (codex-args (:assignee card) (work-dir novel-id) last-message-path)
                 :fable (cond-> ["claude" "--print" "--output-format" "text"
                                  "--add-dir" (vault) "--add-dir" (root)]
                          (bypass-approvals?)
                          (conj "--dangerously-skip-permissions")
                          (System/getenv "CODEX_NOVEL_BOARD_FABLE_MODEL")
                          (into ["--model" (System/getenv "CODEX_NOVEL_BOARD_FABLE_MODEL")]))
                 :pi (cond-> ["pi"
                              "--no-extensions" "--no-skills"
                              "--no-prompt-templates" "--no-context-files"
                              "--print" "--approve" "--mode" "text"
                              "--session-dir" (str pi-session-dir)]
                       (System/getenv "CODEX_NOVEL_BOARD_PI_MODEL")
                       (into ["--model" (System/getenv "CODEX_NOVEL_BOARD_PI_MODEL")])
                       (seq reference-images)
                       (into (map #(str "@" %) reference-images))
                       true (conj prompt)))
          opts (cond-> {:out (io/file (str stdout-path))
                        :err (io/file (str stderr-path))}
                 (= route :pi) (assoc :in (io/file "/dev/null"))
                 (not= route :pi) (assoc :in (io/file (str prompt-path)))
                 (#{:fable :pi} route) (assoc :dir (str (work-dir novel-id))))
          {:keys [process-result timed-out? cleanup-error]} (await-agent! args opts)
          exit (:exit process-result)
          _ (when timed-out?
              (spit (str stderr-path)
                    (str "Novel Board runner terminated the agent after "
                         (agent-timeout-seconds) " seconds.\n")
                    :append true))
          _ (when cleanup-error
              (spit (str stderr-path)
                    (str "Agent timeout cleanup was incomplete: "
                         (:message cleanup-error) "\n")
                    :append true))
          _ (when (and (not= route :codex) (fs/exists? stdout-path))
              (io/copy (io/file (str stdout-path)) (io/file (str last-message-path))))
          last-message (when (fs/exists? last-message-path) (slurp (str last-message-path)))
          marker (result-marker last-message)]
      (doseq [path [stdout-path stderr-path last-message-path]]
        (when (fs/exists? path) (private-file! path)))
      (mark-run! novel-id run (if (zero? exit) :succeeded :failed)
                 (cond-> {:action action :agent (:assignee card) :lane (:lane card)
                          :exit-code exit :timed-out timed-out?
                          :result marker :finished-at (now-str)}
                   cleanup-error (assoc :cleanup-error cleanup-error)))
      (cond-> {:exit exit :timed-out? timed-out? :result marker :last-message last-message}
        cleanup-error (assoc :cleanup-error cleanup-error)))
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

(defn sha256-string [value]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (.update digest (.getBytes (str value) "UTF-8"))
    (apply str (map #(format "%02x" (bit-and % 0xff)) (.digest digest)))))

(defn canonical-path [path]
  (.getCanonicalPath (io/file (str path))))

(defn publication-destination-dir [nsfw]
  (fs/path (vault) (if nsfw "NSFW/小説/AI執筆" "小説草案/AI執筆")))

(defn publication-path-in-dir? [path dest-dir]
  (and (some? path)
       (= (canonical-path (fs/parent (fs/path path)))
          (canonical-path dest-dir))))

(defn reusable-publication-state? [novel-id state dest-dir nsfw]
  (and (#{:reserved :published} (:status state))
       (= novel-id (:novel-id state))
       (= nsfw (:nsfw state))
       (not-empty (:path state))
       (publication-path-in-dir? (:path state) dest-dir)))

(defn publication-key [dest]
  (sha256-string (canonical-path dest)))

(defn publication-lock-guard-path [dest]
  (fs/path (publication-locks-dir) (str (publication-key dest) ".lock")))

(defn publication-reservation-path [dest]
  (fs/path (publication-locks-dir) (str (publication-key dest) ".edn")))

(defn publication-lock-mutex [dest]
  (nth publication-lock-mutexes
       (Math/floorMod (.hashCode (canonical-path dest)) (count publication-lock-mutexes))))

(defn with-publication-lock [dest f]
  (ensure-private-dir! (publication-locks-dir))
  (locking (publication-lock-mutex dest)
    (let [guard-path (publication-lock-guard-path dest)]
      (with-open [file (java.io.RandomAccessFile. (str guard-path) "rw")
                  channel (.getChannel file)]
        (private-file! guard-path)
        (let [_file-lock (.lock channel)]
          (f))))))

(defn publication-owned-by-other? [novel-id dest]
  (let [reservation (read-edn (publication-reservation-path dest) {})]
    (and (seq reservation)
         (or (not= novel-id (:novel-id reservation))
             (not= (canonical-path dest) (:canonical-path reservation))))))

(defn reserve-publication-destination! [novel-id dest expected-sha]
  (let [path (publication-reservation-path dest)
        reservation (read-edn path {})]
    (when (empty? reservation)
      (write-edn! path {:novel-id novel-id
                        :path (str dest)
                        :canonical-path (canonical-path dest)
                        :sha256 expected-sha
                        :reserved-at (now-str)}))))

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

(defn publication-temp-path [novel-id dest]
  (fs/path (fs/parent dest) (str "." (fs/file-name dest) "." novel-id ".publishing")))

(defn atomic-publish-copy! [novel-id manuscript dest expected-sha]
  (let [tmp (publication-temp-path novel-id dest)]
    (Files/copy (.toPath (io/file (str manuscript)))
                (.toPath (io/file (str tmp)))
                (into-array StandardCopyOption [StandardCopyOption/REPLACE_EXISTING]))
    (private-file! tmp)
    (let [staged-sha (sha256 tmp)]
      (when-not (= expected-sha staged-sha)
        (throw (ex-info "staged publication checksum does not match the reserved manuscript"
                        {:expected expected-sha :actual staged-sha :path (str tmp)}))))
    (Files/move (.toPath (io/file (str tmp)))
                (.toPath (io/file (str dest)))
                (into-array StandardCopyOption [StandardCopyOption/ATOMIC_MOVE]))
    (let [published-sha (sha256 dest)]
      (when-not (= expected-sha published-sha)
        (throw (ex-info "published file checksum does not match the reserved manuscript"
                        {:expected expected-sha :actual published-sha :path (str dest)}))))))

(defn finalize-publication! [novel-id dest published-at nsfw expected-sha]
  (write-edn! (published-state-path novel-id)
              {:novel-id novel-id :path (str dest) :sha256 expected-sha
               :published-at published-at :nsfw nsfw :status :published})
  (ensure-published-link! novel-id dest published-at)
  (log! (str "published " novel-id " to " dest)))

(defn publish! [{:keys [novel-id title nsfw]}]
  (let [fm (note-frontmatter novel-id)
        manuscript (fs/path (or (not-empty (:manuscript fm)) (manuscript-path novel-id)))
        state-path (published-state-path novel-id)
        state (read-edn state-path {})
        dest-dir (publication-destination-dir nsfw)
        reusable-state? (reusable-publication-state? novel-id state dest-dir nsfw)
        recorded-path (when reusable-state? (:path state))
        reserved? (= :reserved (:status state))
        published-at (or (when reusable-state? (:published-at state)) (now-str))]
    (cond
      (and (seq state) (not reusable-state?))
      (do
        (append-history! novel-id "Done publication is waiting: runner publication state does not match this card or its designated SFW/NSFW directory. Correct or clear the private publication state before retrying.")
        :invalid-publication-state)

      (and reserved? (not (fs/exists? manuscript)))
      (do (append-history! novel-id "Done publication is waiting: manuscript is missing. Restore the private manuscript and keep the card in Done for retry.")
          :missing-manuscript)

      (and reserved? (:sha256 state) (not= (:sha256 state) (sha256 manuscript)))
      (do
        (append-history! novel-id "Done publication is waiting: the private manuscript changed after its publication path was reserved. Restore the reserved manuscript or explicitly clear the reservation before retrying.")
        :reserved-manuscript-mismatch)

      (and recorded-path (fs/exists? recorded-path) (:sha256 state)
           (= (:sha256 state) (sha256 recorded-path)))
      (do
        (finalize-publication! novel-id recorded-path published-at nsfw (:sha256 state))
        :already-published)

      (and recorded-path (fs/exists? recorded-path) (= :published (:status state)))
      (if (:sha256 state)
        (do
          (append-history! novel-id (str "Done publication is waiting: published file checksum differs from its completed state and was not overwritten: " recorded-path))
          :published-checksum-mismatch)
        (let [published-sha (sha256 recorded-path)]
          (finalize-publication! novel-id recorded-path published-at nsfw published-sha)
          :already-published))

      (not (fs/exists? manuscript))
      (do (append-history! novel-id "Done publication is waiting: manuscript is missing. Restore the private manuscript and keep the card in Done for retry.")
          :missing-manuscript)

      (str/blank? (sanitize-title title))
      (do (append-history! novel-id "Done publication is waiting: title is empty after filename sanitization.")
          :invalid-title)

      :else
      (let [manuscript-sha (sha256 manuscript)
            timestamp (.format (DateTimeFormatter/ofPattern "yyyy-MM-dd-HH-mm")
                               (ZonedDateTime/now (ZoneId/of "Asia/Tokyo")))
            dest (if recorded-path
                   (fs/path recorded-path)
                   (fs/path dest-dir (str timestamp "_" (sanitize-title title) ".md")))
            expected-sha (or (:sha256 state) manuscript-sha)]
        (fs/create-dirs dest-dir)
        (with-publication-lock
          dest
          #(cond
             (publication-owned-by-other? novel-id dest)
             (do
               (append-history! novel-id (str "Done publication is waiting: destination is reserved by another novel and was not overwritten: " dest))
               :collision)

             (and reserved? (fs/exists? dest) (= expected-sha (sha256 dest)))
             (do
               (reserve-publication-destination! novel-id dest expected-sha)
               (finalize-publication! novel-id dest published-at nsfw expected-sha)
               :already-published)

             (and (fs/exists? dest) (not reserved?))
             (do (append-history! novel-id (str "Done publication is waiting: destination already exists and was not overwritten: " dest))
                 :collision)

             :else
             (do
               (reserve-publication-destination! novel-id dest manuscript-sha)
               (write-edn! state-path {:novel-id novel-id :path (str dest) :sha256 manuscript-sha
                                       :published-at published-at :nsfw nsfw :status :reserved})
               (when (and reserved? (fs/exists? dest))
                 (Files/delete (.toPath (io/file (str dest)))))
               (atomic-publish-copy! novel-id manuscript dest manuscript-sha)
               (finalize-publication! novel-id dest published-at nsfw manuscript-sha)
               :published)))))))

(defn process-card! [card]
  (let [action (candidate-action card)]
    (when action
      (if (= action :publish)
        (let [novel-id (:novel-id card)
              run (run-id)
              lock (acquire-lock! novel-id action (:lane card) run)]
          (when lock
            (let [stop? (atom false)
                  heartbeat (heartbeat! novel-id lock stop?)]
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
                  (reset! stop? true)
                  (future-cancel heartbeat)
                  (release-lock! novel-id lock))))))
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
                          {:keys [exit result timed-out? cleanup-error]} (run-agent! (assoc fresh-card :status expected-status) action run)
                          next-status (if (= action :groom) "draft" "review")
                          outcome (cond
                                    timed-out? (str "agent timed out after " (agent-timeout-seconds) " seconds"
                                                    (when cleanup-error
                                                      (str "; cleanup was incomplete: " (:message cleanup-error))))
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
  (scaffold-backlog-cards!)
  (into [] (keep sync-card!) (parse-board-cards (vec (read-lines (board-path))))))

(defn record-unsupported! [card]
  (when (and (not= "done" (:status card))
             (not (supported-assignee? (:assignee card))))
    (append-history! (:novel-id card)
                     (str "Runner skipped unsupported or human assignee '" (:assignee card)
                          "'. Assign codex/codex-sol/codex-full/codex-terra/codex-mini (optionally with a reasoning suffix), fable, or pi to resume."))))

(defn record-missing-review-instructions! [{:keys [novel-id status assignee]}]
  (when (and (= status "review")
             (supported-assignee? assignee)
             (not (review-instructions-present? novel-id)))
    (append-history! novel-id
                     "Runner kept the card in Review because Review Instructions are empty. Record concrete revision instructions and keep a supported agent assigned to resume.")))

(defn tick! []
  (recover-locks!)
  (let [cards (sync-all!)]
    (doseq [card cards]
      (record-unsupported! card)
      (record-missing-review-instructions! card)
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
