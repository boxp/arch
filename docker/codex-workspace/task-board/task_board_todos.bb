#!/usr/bin/env bb
(ns task-board-todos
  (:require [clojure.string :as str]
            [clojure.edn :as edn]
            [cheshire.core :as json]
            [babashka.fs :as fs]
            [clojure.java.shell :as shell])
  (:import [java.security MessageDigest]
           [java.io RandomAccessFile]
           [java.nio.file Files StandardCopyOption]
           [java.time Instant]))

(defn sha
  [s]
  (apply str
         (map #(format "%02x" (bit-and 255 %))
              (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8")))))
(defn norm [s] (str/trim (str/replace (or s "") #"\s+" " ")))
(defn section
  [text name]
  (or (second (re-find (re-pattern (str "(?ms)^## "
                                        (java.util.regex.Pattern/quote name)
                                        "[ \\t]*\\r?\\n(.*?)(?=^## |\\z)"))
                       text))
      ""))
(defn frontmatter
  [text]
  (into {}
        (keep (fn [line]
                (when-let [[_ k v] (re-matches #"([^:]+):\s*(.*?)\s*" line)]
                  [k (str/replace v #"^[\"']|[\"']$" "")]))
              (str/split-lines (or (second (re-find #"(?s)^---\s*\n(.*?)\n---" text))
                                   "")))))
(defn parse-items
  [text]
  (let [lines (str/split-lines (section text "Plan"))
        items (loop [idx 0
                     fence nil
                     current nil
                     out []]
                (if (= idx (count lines))
                  out
                  (let [line (nth lines idx)
                        delimiter (re-find #"^\s*(```+|~~~+)" line)
                        candidate (re-find #"^[-*]\s+(?:\[[^]]*\]\s+)?(TD-\d+)" line)]
                    (cond delimiter
                          (let [marker (second delimiter)
                                closes? (and fence (= (first marker) (first fence))
                                             (>= (count marker) (count fence)))]
                            (recur (inc idx) (cond (nil? fence) marker closes? nil :else fence) nil out))
                          fence (recur (inc idx) fence nil out)
                          candidate
                          (let
                           [[_ mark id tag body]
                            (re-matches
                             #"^[-*]\s+\[([ xX])\]\s+(TD-\d+)【(必須|任意|取消)】(.*?)\s*"
                             line)
                            item {:id (or id (second candidate)),
                                  :tag (case tag
                                         "必須" :required
                                         "任意" :optional
                                         "取消" :cancelled
                                         :invalid),
                                  :text (or body line),
                                  :checked? (boolean (and mark (not= mark " "))),
                                  :line line,
                                  :line-index idx,
                                  :children [],
                                  :child-indices []}]
                            (recur (inc idx) fence (count out) (conj out item)))
                          (and current
                               (re-find #"^\s+\S" line)
                               (not (re-find #"^\s+[-*] \[[ xX]\]" line)))
                          (recur (inc idx)
                                 fence
                                 current
                                 (-> out
                                     (update-in [current :children] conj line)
                                     (update-in [current :child-indices] conj idx)))
                          (or (str/blank? line) (re-find #"^\S" line)) (recur (inc idx) fence nil out)
                          :else (recur (inc idx) fence current out)))))
        counts (frequencies (map :id items))]
    (mapv #(if (> (counts (:id %)) 1) (assoc % :tag :invalid) %) items)))
(defn item-hash
  [item]
  (sha (str/join "|"
                 [(:id item) (name (:tag item)) (norm (:text item))
                  (->> (:children item)
                       (remove #(re-find #"^\s*[-*]\s*(証拠|見送り|取消理由|由来):" %))
                       (map norm)
                       (str/join " "))])))
(defn body-hash
  [text mode]
  (sha (norm (str (section text "Summary")
                  " "
                  (section text "Acceptance Criteria")
                  (when (= mode :legacy)
                    (str " " (str/replace (section text "Plan") #"\[[ xX]\]" "[ ]")))))))
(defn revision
  [hashes]
  (subs (sha (str/join "\n" (map (fn [[k v]] (str k "=" v)) (sort-by key hashes)))) 0 12))
(defn ticket-view
  [text]
  (let [fm (frontmatter text)
        mode (if (= "v1" (get fm "todo_contract")) :v1 :legacy)
        items (if (= mode :v1) (parse-items text) [])
        hashes (into {"_BODY" (body-hash text mode)} (map (juxt :id item-hash) items))
        ack (into {}
                  (keep #(let [[k v] (str/split % #":" 2)] (when (and k v) [k v]))
                        (str/split (get fm "todo_ack_items" "") #",")))
        same? (fn [id]
                (= (get ack id)
                   (some-> (get hashes id)
                           (subs 0 8))))
        items (mapv (fn [i]
                      (assoc i
                             :hash (get hashes (:id i))
                             :state (cond (= :cancelled (:tag i)) :deferred
                                          (and (= :optional (:tag i))
                                               (some #(re-find #"^\s*[-*]\s*見送り:" %)
                                                     (:children i)))
                                          :deferred
                                          (not (same? (:id i))) :unreceived
                                          ;; A duplicate ID is :invalid but still has a checkbox
                                          ;; and evidence; it stays open until repaired.
                                          (and (:checked? i)
                                               (not= :invalid (:tag i))
                                               (some #(re-find #"^\s*[-*]\s*証拠:\s*\S" %)
                                                     (:children i)))
                                          :verified
                                          :else :received)))
                    items)
        added (vec (sort (remove #(contains? ack %) (keys hashes))))
        changed (vec (sort (filter #(and (contains? ack %) (not (same? %)))
                                   (keys hashes))))
        removed (vec (sort (remove #(contains? hashes %) (keys ack))))]
    {:mode mode,
     :items items,
     :hashes hashes,
     :rev (revision hashes),
     :ack ack,
     :ack-rev (get fm "todo_ack_rev"),
     :diff {:added added, :changed changed, :removed removed}}))
(defn gate-decision
  [{:keys [view start-rev result]}]
  (let [{:keys [mode items rev ack-rev diff ack]} view
        ids (if (= mode :legacy)
              (if (and (not= rev start-rev) (not= rev ack-rev)) ["_BODY"] [])
              (vec (distinct (concat
                              (when (not= (get ack "_BODY")
                                          (subs (get-in view [:hashes "_BODY"]) 0 8))
                                ["_BODY"])
                              (:removed diff)
                              (keep (fn [i]
                                      (when (or (and (= :cancelled (:tag i))
                                                     (contains? ack (:id i))
                                                     (not= (get ack (:id i))
                                                           (subs (:hash i) 0 8)))
                                                (and (#{:required :invalid} (:tag i))
                                                     (if (= result "blocked")
                                                       (= :unreceived (:state i))
                                                       (not= :verified (:state i)))))
                                        (:id i)))
                                    items)))))
        hold? (and (#{"done" "blocked"} result) (seq ids))]
    {:hold? (boolean hold?),
     :reason (if hold? :unreceived-or-open :clear),
     :blocking-ids ids}))
(defn state-summary
  [view]
  (let [states (frequencies (map :state (:items view)))]
    (str "rev=" (:rev view)
         " unreceived=" (get states :unreceived 0)
         " open=" (get states :received 0)
         " done=" (get states :verified 0)
         " deferred=" (get states :deferred 0))))
(defn diff-text
  [view]
  (let [s (str "TODO rev " (:rev view)
               " changes: " (pr-str (:diff view))
               "\n" (str/join "\n"
                              (map :line
                                   (filter #(some (set (concat (get-in view [:diff :added])
                                                               (get-in view
                                                                       [:diff :changed])))
                                                  [(:id %)])
                                           (:items view)))))]
    (if (> (count s) 1950)
      (str (subs s 0 1950) "\n... truncated; read the ticket for the rest.")
      s)))
(defn with-local-lock
  "Per-container lock in the temp dir; also what helpers without the shared lock take."
  [path f]
  (let [dir (fs/path (System/getProperty "java.io.tmpdir") "task-board-locks")
        name (str (subs (sha (.getCanonicalPath (java.io.File. (str path)))) 0 16)
                  "-"
                  (str/replace (str (fs/file-name path)) #"[^a-zA-Z0-9._-]" "_")
                  ".lock")]
    (fs/create-dirs dir)
    (with-open [r (RandomAccessFile. (str (fs/path dir name)) "rw")
                c (.getChannel r)]
      (let [_lock (.lock c)] (f)))))
(defn shared-lock-path
  "Lock for a ticket at <vault>/Tickets/<file>, on the vault's own volume. Containers
  sharing that volume have separate /tmp, so only this lock excludes them. It is named
  by file only because the volume can be mounted at more than one path."
  [ticket-path]
  (let [vault (fs/parent (fs/parent (fs/absolutize ticket-path)))]
    (fs/path vault
             ".task-board-locks"
             (str (str/replace (str (fs/file-name ticket-path)) #"[^a-zA-Z0-9._-]" "_")
                  ".lock"))))
(defn with-lock
  "Ticket lock: the shared lock, then the local one so helpers that only know the
  local lock are still excluded. Pods with their own volume cannot be locked out;
  write-if-unchanged covers those and the sync daemon."
  [path f]
  (let [lock-file (shared-lock-path path)]
    (fs/create-dirs (fs/parent lock-file))
    (with-open [r (RandomAccessFile. (str lock-file) "rw")
                c (.getChannel r)]
      (let [_lock (.lock c)] (with-local-lock path f)))))
(defn with-writer
  [path f]
  (if-let [dir (let [value (System/getenv "TASK_BOARD_VAULT_WRITER_LOCK_DIR")]
                 (when-not (str/blank? value) value))]
    (do (fs/create-dirs dir)
        (with-open [r (RandomAccessFile. (str (fs/path dir "vault-writer.lock")) "rw")
                    c (.getChannel r)]
          (let [_lock (.lock c)] (with-lock path f))))
    (with-lock path f)))
(defn file-owner [p] (Files/getOwner p (make-array java.nio.file.LinkOption 0)))
(defn set-owner! [p owner] (Files/setOwner p owner))
(defn file-group [p] (Files/getAttribute p "posix:group" (make-array java.nio.file.LinkOption 0)))
(defn owner-can-still-write?
  "Whether p's owner keeps write access to tmp without owning it: through other-write,
  or group-write with p's group, assuming the owner belongs to that group."
  [tmp p]
  (try (let [mode (fs/posix->str (fs/posix-file-permissions tmp))]
         (or (= \w (nth mode 7))
             (and (= \w (nth mode 4)) (= (file-group tmp) (file-group p)))))
       (catch Exception _ false)))
(defn keep-owner!
  "Renaming tmp over p makes tmp's owner the ticket's owner. Only root can hand a file
  over, so a writer who cannot must not replace a ticket its owner would lose access to
  (0644 owned by someone else): fail with the ticket untouched."
  [tmp p]
  (let [owner (file-owner p)]
    (when-not (or (= owner (file-owner tmp))
                  (try (set-owner! tmp owner) true (catch Exception _ false))
                  (owner-can-still-write? tmp p))
      (Files/deleteIfExists tmp)
      (throw (ex-info (str "cannot replace " p ": owned by " owner " who would lose write access; fix its owner or mode")
                      {:path (str p)})))))
(defn temp-copy
  "A hidden temp file beside p holding text. createTempFile is 0600: a ticket's mode,
  group and owner carry over so other readers and writers (runner, Hermes, sync) are
  not locked out. The owner goes last: only the file's owner can change the others."
  [p text]
  (let [tmp (Files/createTempFile (.getParent p)
                                  ".todo-"
                                  ".tmp"
                                  (make-array java.nio.file.attribute.FileAttribute 0))]
    (spit (str tmp) text)
    (when (Files/exists p (make-array java.nio.file.LinkOption 0))
      (try (fs/set-posix-file-permissions tmp (fs/posix-file-permissions p))
           (catch UnsupportedOperationException _ nil))
      (try (Files/setAttribute tmp "posix:group"
                               (file-group p)
                               (make-array java.nio.file.LinkOption 0))
           (catch Exception _ nil))
      (keep-owner! tmp p))
    tmp))
(defn replace-file
  [tmp p]
  (Files/move tmp
              p
              (into-array StandardCopyOption
                          [StandardCopyOption/REPLACE_EXISTING
                           StandardCopyOption/ATOMIC_MOVE])))
(defn atomic-write
  [path text]
  (let [p (.toPath (java.io.File. (str path)))
        tmp (temp-copy p text)]
    (try (replace-file tmp p)
         (finally (Files/deleteIfExists tmp)))))
(defn exchange-files
  "Atomically swap two paths (renameat2 RENAME_EXCHANGE through coreutils >= 9.5).
  False when the swap did not happen, including where it is unsupported."
  [a b]
  (try (zero? (:exit (shell/sh "mv" "--exchange" "--no-copy" "-T" "--" (str a) (str b))))
       (catch java.io.IOException _ false)))
(defn keep-conflict!
  "Move a copy no longer at the ticket path aside and fail loudly with its location."
  [tmp p detail]
  (let [kept (Files/createTempFile (.getParent p)
                                   ".todo-conflict-"
                                   ".md"
                                   (make-array java.nio.file.attribute.FileAttribute 0))]
    (replace-file tmp kept)
    (throw (ex-info (str detail "; other copy kept at " kept) {}))))
(defn write-if-unchanged
  "Compare-and-swap against writers outside our locks (ob sync, other containers).
  False means path no longer holds expected: re-read rather than overwrite.

  Swapping instead of renaming over path keeps whatever was displaced, so the compare
  happens on that file after the swap and cannot go stale. A rename-based writer that
  landed first is the displaced file. An in-place writer (ob sync: open with O_TRUNC)
  that opened path before the swap has already truncated the displaced file, so it
  cannot compare equal, and swapping back lets its remaining writes land at path.

  Without the swap (older coreutils, a filesystem lacking RENAME_EXCHANGE) a compare and
  a rename stay separate steps and a writer between them would be lost, so it refuses:
  the ticket stays as it is and the caller fails loudly."
  [path expected text]
  (when (= expected (slurp (str path)))
    (let [p (.toPath (java.io.File. (str path)))
          tmp (temp-copy p text)]
      (try
        (if (exchange-files tmp p)
          (or (= expected (slurp (str tmp)))
              (if (exchange-files tmp p)
                (if (= text (slurp (str tmp)))
                  false
                  ;; A later write landed on our copy, so tmp is the newer one: it goes
                  ;; back to path and the earlier one is kept.
                  (do (exchange-files tmp p)
                      (keep-conflict! tmp p "ticket changed twice during the write")))
                (keep-conflict! tmp p "could not restore the ticket after a conflict")))
          (throw (ex-info (str "cannot update " p " safely: atomic exchange is unavailable"
                               " (needs coreutils >= 9.5 and RENAME_EXCHANGE on this"
                               " filesystem); the ticket was not changed")
                          {:path (str p)})))
        (finally (Files/deleteIfExists tmp))))))
(defn with-conflict-retry
  "Run f again from a fresh read when it reports a :todo-conflict."
  [f]
  (loop [attempts 3]
    (let [result (try (f)
                      (catch clojure.lang.ExceptionInfo e
                        (if (and (:todo-conflict (ex-data e)) (> attempts 1))
                          ::conflict
                          (throw e))))]
      (if (= ::conflict result)
        (do (Thread/sleep 200) (recur (dec attempts)))
        result))))
(defn set-fm
  [text k v]
  (let [[_ fm rest] (re-find #"(?s)^---\s*\n(.*?)\n---(.*)$" text)]
    (when-not fm (throw (ex-info "missing frontmatter" {})))
    (str "---\n" (if (re-find (re-pattern (str "(?m)^" k ":")) fm)
                   (str/replace fm (re-pattern (str "(?m)^" k ":.*$")) (str k ": " v))
                   (str fm "\n" k ": " v))
         "\n---" rest)))
(defn append-section
  [text name line]
  (let [pattern (re-pattern (str "(?ms)(^## "
                                 (java.util.regex.Pattern/quote name)
                                 "[^\\n]*\\n)(.*?)(?=^## |\\z)"))]
    (if (re-find pattern text)
      (str/replace-first text
                         pattern
                         (fn [[_ h body]] (str h (str/trimr body) "\n" line "\n\n")))
      (str (str/trimr text) "\n\n## " name "\n\n" line "\n"))))
(defn replace-item
  [text item replacement]
  (let [plan (section text "Plan")
        lines (vec (str/split plan #"\n" -1))
        indices (set (cons (:line-index item) (:child-indices item)))
        new-plan (str/join "\n"
                           (keep-indexed (fn [idx line]
                                           (cond (= idx (:line-index item)) replacement
                                                 (indices idx) nil
                                                 :else line))
                                         lines))]
    (str/replace-first text
                       (re-pattern (str "(?ms)(^## Plan[^\n]*\n)"
                                        (java.util.regex.Pattern/quote plan)))
                       (fn [[_ header]] (str header new-plan)))))
(def tag-labels {:required "必須", :optional "任意", :cancelled "取消"})
(defn completion-child? [line] (boolean (re-find #"^\s*[-*]\s*(証拠|見送り):" line)))
(defn reopened-item
  "A completion or deferral belongs to the content it was recorded for, so new content
  starts open. Neither the mark nor these children are hashed: the revision is unchanged."
  [id tag body children]
  (str/join "\n" (cons (str "- [ ] " id "【" (tag-labels tag) "】" body)
                        (remove completion-child? children))))
(defn reopen-changed
  "Covers hand edits in the vault, which never pass through the change command."
  [text view]
  (reduce (fn [current id]
            (let [item (some #(when (= id (:id %)) %) (parse-items current))]
              (if (and item
                       (#{:required :optional} (:tag item))
                       (or (:checked? item) (some completion-child? (:children item))))
                (replace-item current item (reopened-item id (:tag item) (:text item) (:children item)))
                current)))
          text
          (get-in view [:diff :changed])))
(defn opts
  [args]
  (loop [xs args
         m {:args []}]
    (if-let [x (first xs)]
      (if (str/starts-with? x "--")
        (let [k (keyword (subs x 2))
              flag (#{:required :optional :json} k)]
          (recur (if flag (rest xs) (nnext xs)) (assoc m k (if flag true (second xs)))))
        (recur (rest xs) (update m :args conj x)))
      m)))
(defn die [s code] (binding [*out* *err*] (println s)) (System/exit code))
(defn require-value
  [v label]
  (or (not-empty v) (throw (ex-info (str "missing " label) {}))))
(def module-path *file*)
(defn worker-commands
  "A TODO can arrive after the prompt, on a ticket that was legacy at start, so the
  delivered message has to be self-sufficient."
  [ticket vault rev]
  (let [cmd (str "bb " module-path " %s " ticket " %s--vault " vault)]
    (str "Acknowledge: " (format cmd "ack" "") " --rev " rev " --run \"$CODEX_TASK_BOARD_RUN_ID\" --source worker\n"
         "After doing an item: " (format cmd "done" "TD-NN ") " --evidence TEXT\n"
         "Optional item you will not do: " (format cmd "skip" "TD-NN ") " --reason TEXT\n"
         "Required items cannot be skipped: return blocked. A result from an older revision will not be applied.")))
(defn hook
  [o]
  (try
    (let [input (json/parse-string (slurp *in*) true)
          path (fs/path (:vault o) "Tickets" (str (:ticket o) ".md"))
          view (ticket-view (slurp (str path)))
          dir (:run-dir o)
          delivery (fs/path dir "todo-delivery.edn")
          start (edn/read-string (slurp (str (fs/path dir "todo-start.edn"))))
          rev (:rev view)
          gate (gate-decision {:view view, :start-rev (:rev start), :result "blocked"})
          msg (str (diff-text view) "\n" (worker-commands (:ticket o) (:vault o) rev))
          event (:event o)]
      (with-local-lock delivery
        (fn []
          (let [state (if (fs/exists? delivery) (edn/read-string (slurp (str delivery))) {})]
            (case event
              "post" (when (not= rev (or (:notified state) (:rev start)))
                       (atomic-write delivery (pr-str (assoc state :notified rev)))
                       (println (json/generate-string {:hookSpecificOutput
                                                       {:hookEventName "PostToolUse",
                                                        :additionalContext msg}})))
              "pre"
              (when
               (and
                (:hold? gate)
                (re-find
                 #"(?im)(?:^|[;&|(]\s*)\s*(?:(?:\w+=\S*|env|timeout\s+\S+|sudo)\s+)*(?:gh\s+pr\s+merge\b|gh\s+api\b[^\n]*/merge\b|kubectl\s+apply\b|terraform\s+apply\b|git\s+push\b[^\n]*\b(?:main|master)\b)"
                 (or (get-in input [:tool_input :command]) "")))
                (println (json/generate-string {:hookSpecificOutput
                                                {:hookEventName "PreToolUse",
                                                 :permissionDecision "deny",
                                                 :permissionDecisionReason msg}})))
              "stop" (when (and (:hold? gate) (< (get-in state [:stops rev] 0) 2))
                       (atomic-write delivery
                                     (pr-str (update-in state [:stops rev] (fnil inc 0))))
                       (println (json/generate-string {:decision "block", :reason msg})))
              nil)))))
    (catch Throwable _ nil)))
(defn -main
  [& args]
  (let [cmd (first args)
        o (opts (rest args))
        [id item-id] (:args o)
        vault (if (= cmd "hook") (:vault o) (require-value (:vault o) "--vault"))
        path (when vault (fs/path vault "Tickets" (str id ".md")))]
    (if (= cmd "hook")
      (hook o)
      (if (= cmd "status")
        (let [v (ticket-view (slurp (str path)))]
          (println (if (:json o)
                     (json/generate-string v)
                     (str (state-summary v) "\n" (diff-text v)))))
        (do
          (when (let [result (try (shell/sh "id" "-u") (catch Throwable _ nil))
                      uid (some-> result
                                  :out
                                  str/trim)]
                  (if (and (= 0 (:exit result)) (re-matches #"[0-9]+" (or uid "")))
                    (boolean (re-matches #"0+" uid))
                    (= "root" (System/getProperty "user.name"))))
            (die "Root cannot run Task Board write commands" 1))
          (with-conflict-retry
           (fn []
            (with-writer
            path
            (fn []
              (let [text (slurp (str path))
                    view (ticket-view text)
                    items (:items view)
                    item (some #(when (= item-id (:id %)) %) items)
                    source (or (:source o) "task-board-todos")
                    _ (when (#{"add" "change" "cancel"} cmd)
                        (require-value (:source o) "--source"))
                    _ (when (and (#{"change" "cancel" "done" "skip"} cmd) (nil? item))
                        (throw (ex-info "missing item" {})))
                    ;; A malformed line must be repaired by a tag, never completed as is.
                    _ (when (and item (= :invalid (:tag item))
                                 (not (and (= cmd "change") (or (:required o) (:optional o)))))
                        (die (str "invalid TODO line; repair it with change --required or --optional: " item-id) 4))
                    tag (cond (:required o) :required
                              (:optional o) :optional
                              :else (:tag item))
                    label tag-labels
                    new-text
                    (case cmd
                      "add"
                      (let [tag (or tag
                                    (throw (ex-info "choose --required or --optional"
                                                    {})))
                            body (require-value (:text o) "--text")
                            ;; The parser only reads TD-<digits>; any other id would be a
                            ;; required line the gate cannot see.
                            _ (when (and (:id o) (not (re-matches #"TD-\d+" (:id o))))
                                (die (str "invalid TODO id (use TD-<digits>): " (:id o)) 4))
                            id (or (:id o)
                                   (format "TD-%02d"
                                           (inc (reduce max
                                                        0
                                                        (map #(parse-long (subs (:id %) 3))
                                                             (parse-items text))))))
                            line (str "- [ ] " id "【" (label tag) "】" body)
                            children (str (when (:ac o) (str "\n  - AC: " (:ac o)))
                                          (when (:priority o)
                                            (str "\n  - 優先度: " (:priority o))))
                            requested (map norm (remove str/blank? (str/split-lines children)))
                            ;; Without --id, the same text is a retry only when the item
                            ;; already holds every requested condition; otherwise the new
                            ;; AC/priority must be saved as its own item, never dropped.
                            existing (some #(when (or (= id (:id %))
                                                      (and (nil? (:id o))
                                                           (= tag (:tag %))
                                                           (= (norm body) (norm (:text %)))
                                                           (every? (set (map norm (:children %)))
                                                                   requested)))
                                              %)
                                           (parse-items text))]
                        (if existing
                          (if (or (nil? (:id o))
                                  (= (item-hash existing)
                                     (item-hash {:id id,
                                                 :tag tag,
                                                 :text body,
                                                 :children (remove str/blank?
                                                                   (str/split-lines
                                                                    children))})))
                            (set-fm text "todo_contract" "v1")
                            (throw (ex-info "ID already has different content" {})))
                          (-> text
                              (set-fm "todo_contract" "v1")
                              (append-section
                               "Plan"
                               (str line children "\n  - 由来: " source)))))
                      "change" (do (when (and (:expect-hash o)
                                              (not (str/starts-with? (:hash item)
                                                                     (:expect-hash o))))
                                     (die "hash mismatch" 3))
                                   (let [body (or (:text o) (:text item))
                                         unchanged? (= (:hash item)
                                                       (item-hash (assoc item :tag tag :text body)))]
                                     (replace-item
                                      text
                                      item
                                      (if unchanged?
                                        (str "- ["
                                             (if (:checked? item) "x" " ")
                                             "] "
                                             item-id
                                             "【"
                                             (label tag)
                                             "】"
                                             body
                                             (when (seq (:children item))
                                               (str "\n"
                                                    (str/join "\n" (:children item)))))
                                        (reopened-item item-id tag body (:children item))))))
                      "cancel" (replace-item text
                                             item
                                             (str "- [ ] " item-id
                                                  "【取消】" (:text item)
                                                  "\n" (str/join "\n" (:children item))
                                                  "\n  - 取消理由: " (require-value
                                                                  (:reason o)
                                                                  "--reason")))
                      "ack"
                      (do (when (not= (:rev view) (:rev o)) (die (diff-text view) 3))
                          (if (= (:ack-rev view) (:rev view))
                            text
                            (-> text
                                (reopen-changed view)
                                (set-fm "todo_ack_rev" (:rev view))
                                (set-fm "todo_ack_items"
                                        (str/join ","
                                                  (map (fn [[k v]]
                                                         (str k ":" (subs v 0 8)))
                                                       (sort-by key (:hashes view)))))
                                (set-fm "todo_ack_run" (or (:run o) ""))
                                (append-section
                                 "Notes"
                                 (str "- " (Instant/now)
                                      " UTC [" source
                                      "]: TODO ack "
                                      (str/join ", "
                                                (sort (keys (:hashes view)))))))))
                      "done" (do (when (not= (get (:ack view) item-id)
                                             (subs (:hash item) 0 8))
                                   (die "item is not acknowledged" 3))
                                 (replace-item
                                  text
                                  item
                                  (str "- [x] "
                                       item-id
                                       "【"
                                       (label (:tag item))
                                       "】"
                                       (:text item)
                                       (when-let [children (seq (remove #(re-find #"^\s*[-*]\s*証拠:" %)
                                                                        (:children item)))]
                                         (str "\n" (str/join "\n" children)))
                                       "\n  - 証拠: "
                                       (require-value (:evidence o) "--evidence"))))
                      "skip"
                      (do (when (not= :optional (:tag item))
                            (die "required TODO: return blocked for an Owner decision"
                                 4))
                          (replace-item
                           text
                           item
                           (str (:line item)
                                (when-let [children (seq (remove #(re-find #"^\s*[-*]\s*見送り:" %)
                                                                 (:children item)))]
                                  (str "\n" (str/join "\n" children)))
                                "\n  - 見送り: "
                                (require-value (:reason o) "--reason"))))
                      (throw (ex-info "unknown command" {})))]
                (let [new-text (set-fm new-text
                                       "todo_state"
                                       (state-summary (ticket-view new-text)))]
                  (when (and (not= text new-text) (not (write-if-unchanged path text new-text)))
                    (throw (ex-info "ticket changed during the write; retry" {:todo-conflict true}))))
                (println (state-summary (ticket-view new-text)))
                (when (and (= cmd "add")
                           (#{"done" "blocked"} (get (frontmatter text) "status")))
                  (println "Move the card with update to resume."))))))))))))
(when (= *file* (System/getProperty "babashka.file"))
  (try (apply -main *command-line-args*) (catch Throwable e (die (.getMessage e) 1))))
