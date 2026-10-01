(ns vault-writer
  "Shared vault writer lock, atomic file replacement and write-ahead transition
  journal for the proposed Task Board autonomy v2 (BOXP-201 I3).

  Nothing here authorizes execution. The runner does not call this library on
  its production path; it is exercised against temporary vaults only until the
  I7 writer-generation switch. Results carry a fixed-shape diagnostic and never
  include file content, exception text or paths."
  (:require [babashka.fs :as fs]
            [clojure.edn :as edn]
            [clojure.string :as str])
  (:import [java.io RandomAccessFile]
           [java.nio ByteBuffer]
           [java.nio.channels FileChannel]
           [java.nio.file CopyOption Files LinkOption OpenOption
            StandardCopyOption StandardOpenOption]
           [java.security MessageDigest]
           [java.time Instant LocalDate ZoneOffset]))

(def lock-file-name
  "Lock file shared by every cooperating writer (runner, helper, this library)."
  "vault-writer.lock")
(def journal-file-name "transitions.journal")
(def journal-version 1)

(def lane->status
  {"Backlog" "backlog"
   "Ready" "ready"
   "In Progress" "in-progress"
   "Blocked" "blocked"
   "Review" "review"
   "Done" "done"})

(def ^:private diagnostic-codes
  {:ok "ok"
   :conflict "conflict"
   :stale-generation "stale-generation"
   :unavailable "unavailable"
   :invalid-request "invalid-request"
   :invalid-vault-state "invalid-vault-state"
   :journal-corrupt "journal-corrupt"
   :lease-lost "lease-lost"
   :unresolved-journal "unresolved-journal"})

(defn- diagnostic [category]
  (let [category (if (contains? diagnostic-codes category) category :unavailable)]
    {:category category :code (get diagnostic-codes category)}))

(defn- ok
  ([] (ok {}))
  ([extra] (merge extra {:ok? true :diagnostic (diagnostic :ok)})))

(defn- failed [category]
  {:ok? false :diagnostic (diagnostic category)})

(defn- reject! [category]
  (throw (ex-info "vault writer rejected" {::category category})))

(defn- guarded
  "Run f, converting rejections into fixed diagnostics. Unexpected exceptions
  fail closed as :unavailable without exposing their message."
  [f]
  (try
    (f)
    (catch clojure.lang.ExceptionInfo e
      (failed (or (::category (ex-data e)) :unavailable)))
    (catch Exception _ (failed :unavailable))))

(defn sha256 [^String value]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256") (.getBytes value "UTF-8"))]
    (apply str (map #(format "%02x" (bit-and 0xff %)) digest))))

;; --- lock and atomic replacement -------------------------------------------

(def ^:private jvm-lock (Object.))
(def ^:private ^:dynamic *held-locks* #{})

(defn with-file-lock
  "Run f while holding an exclusive cross-process lock on dir/name. Reentrant on
  the calling thread; f must not hand the critical section to another thread."
  [dir name f]
  (fs/create-dirs dir)
  (let [lock-path (str (fs/path (fs/canonicalize dir) name))]
    (if (contains? *held-locks* lock-path)
      (f)
      ;; FileLock is per JVM, so threads of this process serialize on a monitor.
      (locking jvm-lock
        (with-open [file (RandomAccessFile. lock-path "rw")
                    channel (.getChannel file)]
          (let [_file-lock (.lock channel)]
            ;; Closing the channel releases the lock; Babashka does not expose
            ;; FileLock.release on the JDK's internal implementation.
            (binding [*held-locks* (conj *held-locks* lock-path)]
              (f))))))))

(defn with-vault-lock [lock-dir f]
  (with-file-lock lock-dir lock-file-name f))

(defn- write-fully! [^FileChannel channel ^String content]
  (let [buffer (ByteBuffer/wrap (.getBytes content "UTF-8"))]
    (while (.hasRemaining buffer)
      (.write channel buffer))
    (.force channel true)))

(defn- sync-dir! [dir]
  ;; Best effort: persists the rename on filesystems that support it.
  (try
    (with-open [channel (FileChannel/open (fs/path dir)
                                          (into-array OpenOption [StandardOpenOption/READ]))]
      (.force channel true))
    (catch Exception _ nil)))

(defn atomic-write!
  "Replace path with content through a synced temp file and an atomic rename, so
  readers observe either the old or the new content, never a partial write."
  [path ^String content]
  (let [target (fs/path path)
        dir (fs/parent target)
        tmp (fs/path dir (str "." (fs/file-name target) "." (random-uuid) ".tmp"))]
    (try
      (with-open [channel (FileChannel/open
                           tmp (into-array OpenOption [StandardOpenOption/CREATE_NEW
                                                       StandardOpenOption/WRITE]))]
        (write-fully! channel content))
      (when (fs/exists? target)
        (try
          (Files/setPosixFilePermissions
           tmp (Files/getPosixFilePermissions target (make-array LinkOption 0)))
          (catch UnsupportedOperationException _ nil)))
      (Files/move tmp target (into-array CopyOption [StandardCopyOption/ATOMIC_MOVE
                                                     StandardCopyOption/REPLACE_EXISTING]))
      (sync-dir! dir)
      (finally
        (fs/delete-if-exists tmp)))))

;; --- vault parsing ----------------------------------------------------------

(defn- valid-ticket-id? [ticket]
  (and (string? ticket) (some? (re-matches #"[A-Z][A-Z0-9]{0,15}-[0-9]{1,9}" ticket))))

(defn- board-path [writer]
  (fs/path (:vault writer) "Boards" "Task Board.md"))

(defn- ticket-path [writer ticket]
  (fs/path (:vault writer) "Tickets" (str ticket ".md")))

(defn- split-lines
  "Lossless split: unlike clojure.string/split-lines this keeps trailing blanks."
  [content]
  (str/split content #"\n" -1))

(defn- join-lines [lines]
  (str/join "\n" lines))

(defn- card-line? [line]
  (boolean (re-matches #"\s*-\s+\[[ xX]\]\s+.*" line)))

(defn- card-ticket [line]
  (second (re-find #"\[\[Tickets/([A-Z][A-Z0-9]*-\d+)\|" line)))

(defn- lane-of-heading [line]
  (when-let [[_ title] (re-matches #"##\s+(.+?)\s*" line)]
    title))

(defn- board-cards
  "Cards of ticket found under the known lanes, as {:lane :idx :line}."
  [lines ticket]
  (:cards
   (reduce (fn [{:keys [lane] :as acc} [idx line]]
             (if-let [title (lane-of-heading line)]
               (assoc acc :lane (when (contains? lane->status title) title))
               (if (and lane (card-line? line) (= ticket (card-ticket line)))
                 (update acc :cards conj {:lane lane :idx idx :line line})
                 acc)))
           {:lane nil :cards []}
           (map-indexed vector lines))))

(defn- replace-or-add-attr [line key value]
  (let [pattern (re-pattern (str "(?:^|\\s)" key "::[^\\s]+"))]
    (if (re-find pattern line)
      (str/replace line pattern (str " " key "::" value))
      (str line " " key "::" value))))

(defn- remove-attr [line key]
  (-> line
      (str/replace (re-pattern (str "(?:^|\\s)" key "::[^\\s]+")) "")
      (str/replace #"\s+" " ")
      str/trim))

(defn- normalize-card-line [line status today]
  (let [line (str/replace line #"^\s*-\s+\[[ xX]\]" (if (= "done" status) "- [x]" "- [ ]"))
        line (replace-or-add-attr line "status" status)]
    (if (= "done" status)
      (if (re-find #"(?:^|\s)done::[^\s]+" line) line (replace-or-add-attr line "done" today))
      (remove-attr line "done"))))

(defn- move-card-lines [lines card to-lane today]
  (let [heading (first (keep-indexed (fn [idx line]
                                       (when (= to-lane (lane-of-heading line)) idx))
                                     lines))]
    (when-not heading (reject! :invalid-vault-state))
    (let [new-line (normalize-card-line (:line card) (lane->status to-lane) today)
          without (vec (concat (subvec lines 0 (:idx card)) (subvec lines (inc (:idx card)))))
          heading (if (< (:idx card) heading) (dec heading) heading)
          insert-at (loop [idx (inc heading)]
                      (if (and (< idx (count without)) (str/blank? (nth without idx)))
                        (recur (inc idx))
                        idx))]
      (vec (concat (subvec without 0 insert-at) [new-line] (subvec without insert-at))))))

(defn- frontmatter-end [lines]
  (when (= "---" (first lines))
    (first (keep-indexed (fn [idx line] (when (and (pos? idx) (= "---" line)) idx)) lines))))

(defn- frontmatter-value [lines key]
  (when-let [end (frontmatter-end lines)]
    (some (fn [line]
            (when-let [[_ k v] (re-matches #"([A-Za-z0-9_-]+):\s*(.*)" line)]
              (when (= k key) v)))
          (subvec lines 1 end))))

(defn- set-frontmatter [lines updates]
  (when-not (frontmatter-end lines) (reject! :invalid-vault-state))
  (reduce (fn [lines [key value]]
            (let [end (frontmatter-end lines)
                  new-line (str key ": " value)
                  idx (first (keep-indexed
                              (fn [idx line]
                                (when (and (< 0 idx end)
                                           (re-matches (re-pattern (str key ":\\s*.*")) line))
                                  idx))
                              lines))]
              (if idx
                (assoc lines idx new-line)
                (vec (concat (subvec lines 0 end) [new-line] (subvec lines end))))))
          lines
          (sort-by key updates)))

(defn- append-note-line
  "Append line at the end of the Notes section. Idempotent on the exact line so
  journal recovery can re-apply it."
  [lines line]
  (if (some #(= line %) lines)
    lines
    (if-let [start (first (keep-indexed (fn [idx l] (when (= "## Notes" l) idx)) lines))]
      (let [end (or (first (keep-indexed (fn [idx l]
                                           (when (and (> idx start) (str/starts-with? l "## ")) idx))
                                         lines))
                    (count lines))
            ;; Insert after the last non-blank line of the section.
            insert-at (loop [idx end]
                        (if (and (> idx (inc start)) (str/blank? (nth lines (dec idx))))
                          (recur (dec idx))
                          idx))
            entry (if (= insert-at (inc start)) ["" line] [line])
            tail (subvec lines insert-at)]
        (vec (concat (subvec lines 0 insert-at) entry (if (seq tail) tail [""]))))
      (let [body (if (str/blank? (peek lines)) (pop lines) lines)]
        (vec (concat body ["" "## Notes" "" line ""]))))))

(defn- valid-frontmatter-updates? [updates]
  (and (map? updates)
       (every? (fn [[k v]]
                 (and (string? k) (re-matches #"[A-Za-z0-9_-]+" k)
                      (string? v) (not (re-find #"[\r\n]" v))))
               updates)))

(defn- valid-note? [note]
  (or (nil? note)
      (and (string? note) (not (str/blank? note)) (not (re-find #"[\r\n]" note)))))

(defn- edit-ticket
  "Pure, idempotent ticket edit used by both the first attempt and recovery."
  [content {:keys [frontmatter note]}]
  (let [lines (vec (split-lines content))
        lines (if (seq frontmatter) (set-frontmatter lines frontmatter) lines)
        lines (if note (append-note-line lines note) lines)]
    (join-lines lines)))

(defn- read-ticket [writer ticket]
  (let [path (ticket-path writer ticket)]
    (when-not (fs/regular-file? path) (reject! :invalid-vault-state))
    (slurp (str path))))

(defn- ticket-revision
  "control_revision projected in the ticket frontmatter, or nil. The projection
  is only compared for CAS; it never grants authorization."
  [content]
  (when-let [value (frontmatter-value (vec (split-lines content)) "control_revision")]
    (when (re-matches #"[1-9][0-9]{0,8}" value) (Long/parseLong value))))

(defn- single-card
  "The ticket's only card. Duplicate or missing cards are never auto-repaired."
  [board-lines ticket]
  (let [cards (board-cards board-lines ticket)]
    (when (not= 1 (count cards)) (reject! :invalid-vault-state))
    (first cards)))

(defn- read-board-lines [writer]
  (let [path (board-path writer)]
    (when-not (fs/regular-file? path) (reject! :invalid-vault-state))
    (vec (split-lines (slurp (str path))))))

;; --- journal ----------------------------------------------------------------

(defn- journal-path [writer]
  (fs/path (:state-dir writer) journal-file-name))

(defn- parse-journal-line [line]
  (try
    (when-let [[_ digest body] (re-matches #"([a-f0-9]{64}) (.*)" line)]
      (when (= digest (sha256 body))
        (let [record (edn/read-string body)]
          (when (map? record) record))))
    (catch Exception _ nil)))

(defn- read-journal
  "Checksummed records. A damaged final line is an interrupted append: its
  transition never reached the vault, so it is ignored and later truncated. Any
  other damage or an unknown version fails closed."
  [writer]
  (let [path (journal-path writer)]
    (if-not (fs/exists? path)
      {:records [] :good-bytes 0}
      (let [bytes (fs/read-all-bytes path)
            text (String. ^bytes bytes "UTF-8")
            complete? (or (zero? (count text)) (str/ends-with? text "\n"))
            lines (vec (if (zero? (count text)) [] (str/split text #"\n" -1)))
            lines (if (and (seq lines) complete?) (pop lines) lines)
            parsed (mapv parse-journal-line lines)
            torn? (and (seq parsed) (or (nil? (peek parsed)) (not complete?)))
            good (if torn? (pop parsed) parsed)
            good-lines (if torn? (pop lines) lines)]
        (when (or (some nil? good)
                  (some #(not= journal-version (:journal-version %)) good))
          (reject! :journal-corrupt))
        {:records good
         :good-bytes (reduce + (map #(inc (count (.getBytes ^String % "UTF-8"))) good-lines))}))))

(declare verify-generation!)

(defn- append-journal! [writer record]
  (verify-generation! writer)
  (let [{:keys [good-bytes]} (read-journal writer)
        body (pr-str (assoc record :journal-version journal-version))
        line (str (sha256 body) " " body "\n")]
    (fs/create-dirs (:state-dir writer))
    (with-open [channel (FileChannel/open
                         (journal-path writer)
                         (into-array OpenOption [StandardOpenOption/CREATE
                                                 StandardOpenOption/WRITE]))]
      ;; Drop an interrupted tail before appending so it cannot become a
      ;; damaged middle record.
      (.truncate channel good-bytes)
      (.position channel (long good-bytes))
      (write-fully! channel line))))

(def ^:private terminal-phases #{:committed :aborted :recovered :superseded})

(defn- pending-records [records]
  (let [closed (set (map :id (filter #(contains? terminal-phases (:phase %)) records)))]
    (vec (remove #(contains? closed (:id %)) (filter #(= :prepared (:phase %)) records)))))

;; --- writer -----------------------------------------------------------------

(defn open-writer
  "A writer bound to one vault, one restricted state dir (lock and journal) and
  one writer generation. :verify-generation is called with the generation before
  every journal or vault write and must return true only for the current one."
  [{:keys [vault state-dir generation verify-generation now failpoint]}]
  {:vault (str vault)
   :state-dir (str state-dir)
   :generation generation
   :verify-generation verify-generation
   :now (or now #(Instant/now))
   :failpoint (or failpoint (fn [_step] nil))})

(defn- verify-generation! [writer]
  (let [verify (:verify-generation writer)
        current? (try
                   (and (fn? verify) (true? (verify (:generation writer))))
                   (catch Exception _ (reject! :unavailable)))]
    (when-not current? (reject! :stale-generation))))

(defn- checked-write!
  "Every vault or state write re-verifies the writer generation first."
  [writer path content]
  (verify-generation! writer)
  (atomic-write! path content))

(defn- now-str [writer]
  (str ((:now writer))))

(defn- today [writer]
  (str (LocalDate/ofInstant ((:now writer)) ZoneOffset/UTC)))

(defn- locked [writer f]
  (guarded #(with-vault-lock (:state-dir writer) f)))

(defn pending-transitions
  "Prepared transitions without a terminal journal record."
  [writer]
  (locked writer #(ok {:pending (pending-records (:records (read-journal writer)))})))

(defn- require-no-pending! [writer ticket]
  (when (some #(= ticket (:ticket %)) (pending-records (:records (read-journal writer))))
    (reject! :unresolved-journal)))

(defn- check-revision! [content expected-revision]
  (when (some? expected-revision)
    (when-not (= expected-revision (ticket-revision content))
      (reject! :conflict))))

(defn update-ticket!
  "Update frontmatter scalars and/or append one Notes line under the vault lock.
  expected-revision, when given, must equal the projected control_revision."
  [writer {:keys [ticket frontmatter note expected-revision]}]
  (locked
   writer
   (fn []
     (when-not (and (valid-ticket-id? ticket)
                    (valid-frontmatter-updates? (or frontmatter {}))
                    (valid-note? note)
                    (or (seq frontmatter) note)
                    (or (nil? expected-revision) (pos-int? expected-revision)))
       (reject! :invalid-request))
     (verify-generation! writer)
     (require-no-pending! writer ticket)
     (let [content (read-ticket writer ticket)
           _ (check-revision! content expected-revision)
           updated (edit-ticket content {:frontmatter frontmatter :note note})]
       (when (not= content updated)
         (checked-write! writer (ticket-path writer ticket) updated))
       (ok)))))

(defn write-state!
  "Serializable swap of an EDN state file: (f old) under the vault lock, written
  atomically. file-name is a plain name directly inside the writer's state dir;
  the lock and journal files cannot be targeted. old is nil when the file does
  not exist."
  [writer file-name f]
  (locked
   writer
   (fn []
     (when-not (and (string? file-name)
                    (re-matches #"[A-Za-z0-9][A-Za-z0-9._-]{0,99}" file-name)
                    (not (contains? #{lock-file-name journal-file-name} file-name))
                    (fn? f))
       (reject! :invalid-request))
     (verify-generation! writer)
     (let [path (fs/path (:state-dir writer) file-name)
           old (when (fs/exists? path) (edn/read-string (slurp (str path))))
           new (f old)]
       (checked-write! writer path (str (pr-str new) "\n"))
       (ok)))))

(defn- ticket-edit-of [record]
  {:frontmatter (assoc (or (:frontmatter record) {})
                       "status" (lane->status (:to-lane record)))
   :note (:note record)})

(defn transition!
  "Move a ticket's card between lanes and project the result into the ticket.

  The Board lane is the source of truth and is written first. The intended
  change is journaled before any vault write so a crash between the two files is
  resolved by `recover!` against the current lane. :guard, when given, runs under
  the lock and must return true (for example: the caller still owns its lease);
  it must not take other locks."
  [writer {:keys [ticket from-lane to-lane frontmatter note expected-revision guard]}]
  (locked
   writer
   (fn []
     (when-not (and (valid-ticket-id? ticket)
                    (contains? lane->status from-lane)
                    (contains? lane->status to-lane)
                    (not= from-lane to-lane)
                    (valid-frontmatter-updates? (or frontmatter {}))
                    (not (contains? (or frontmatter {}) "status"))
                    (valid-note? note)
                    (or (nil? expected-revision) (pos-int? expected-revision))
                    (or (nil? guard) (fn? guard)))
       (reject! :invalid-request))
     (verify-generation! writer)
     (require-no-pending! writer ticket)
     (when (and guard (not (true? (guard)))) (reject! :lease-lost))
     (let [board-lines (read-board-lines writer)
           card (single-card board-lines ticket)
           ticket-content (read-ticket writer ticket)
           _ (when (not= from-lane (:lane card)) (reject! :conflict))
           _ (check-revision! ticket-content expected-revision)
           record {:id (str (random-uuid))
                   :phase :prepared
                   :ticket ticket
                   :from-lane from-lane
                   :to-lane to-lane
                   :expected-revision expected-revision
                   ;; Recovery replays :frontmatter only over this exact content.
                   :ticket-sha256 (sha256 ticket-content)
                   :frontmatter (or frontmatter {})
                   :note note
                   :writer-generation (:generation writer)
                   :at (now-str writer)}
           new-board (join-lines (move-card-lines board-lines card to-lane (today writer)))
           new-ticket (edit-ticket ticket-content (ticket-edit-of record))
           failpoint (:failpoint writer)]
       (append-journal! writer record)
       (failpoint :after-prepare)
       ;; A generation change at any later step stops this writer immediately:
       ;; it writes nothing more, not even a journal record, and the entry stays
       ;; prepared for the current generation's recover!.
       (checked-write! writer (board-path writer) new-board)
       (failpoint :after-board)
       (when (not= ticket-content new-ticket)
         (checked-write! writer (ticket-path writer ticket) new-ticket))
       (failpoint :after-ticket)
       (append-journal! writer {:id (:id record) :phase :committed :at (now-str writer)})
       (ok {:transition-id (:id record)})))))

(defn- recover-record!
  "Resolve one prepared transition against the current lane. Returns the terminal
  phase, or nil when the vault state must be resolved by a human first."
  [writer record]
  (let [ticket (:ticket record)
        cards (board-cards (read-board-lines writer) ticket)
        ticket-file (ticket-path writer ticket)]
    (when (and (= 1 (count cards)) (fs/regular-file? ticket-file))
      (let [lane (:lane (first cards))
            content (slurp (str ticket-file))]
        (cond
          ;; The Board is written first: an unchanged lane means nothing was applied.
          (= lane (:from-lane record)) :aborted

          ;; Board applied and no competing control change: finish the projection.
          ;; The journaled frontmatter is older than any later writer's update, so
          ;; it is replayed only over the content the transition was prepared
          ;; against. On a changed ticket, recovery may still add the status of
          ;; the current lane and the note, which overwrite nobody's value.
          (and (= lane (:to-lane record))
               (or (nil? (:expected-revision record))
                   (= (:expected-revision record) (ticket-revision content))))
          (let [lines (vec (split-lines content))
                updated (edit-ticket content (ticket-edit-of record))]
            (if (or (= (:ticket-sha256 record) (sha256 content))
                    (every? (fn [[k v]] (= v (frontmatter-value lines k)))
                            (:frontmatter record)))
              (do (when (not= content updated)
                    (checked-write! writer ticket-file updated))
                  :recovered)
              :superseded))

          ;; The lane, control revision or ticket was changed by someone else.
          ;; Never replay over it; the current lane stays authoritative.
          :else :superseded)))))

(defn recover!
  "Resolve interrupted transitions. Only the current writer generation may
  recover. Entries whose vault state is broken stay pending and are reported."
  [writer]
  (locked
   writer
   (fn []
     (verify-generation! writer)
     (let [pending (pending-records (:records (read-journal writer)))
           outcomes (mapv (fn [record]
                            (let [phase (try
                                          (recover-record! writer record)
                                          (catch clojure.lang.ExceptionInfo e
                                            ;; Only a broken vault leaves the entry
                                            ;; for a human. A lost generation or an
                                            ;; unavailable verifier stops recovery.
                                            (when-not (= :invalid-vault-state
                                                         (::category (ex-data e)))
                                              (throw e))))]
                              (when phase
                                (append-journal! writer {:id (:id record)
                                                         :phase phase
                                                         :at (now-str writer)}))
                              {:id (:id record) :ticket (:ticket record)
                               :outcome (or phase :unresolved)}))
                          pending)]
       (ok {:outcomes outcomes})))))
