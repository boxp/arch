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
;; Conditions (BOXP-588): what has to hold during the whole work, kept as ticket items in
;; `## Conditions` instead of inside the Notes history. A line is `- CD-NN【kind】text` with
;; indented children (由来 = who registered it and where it came from).
(def condition-kinds {"承認" :approval, "制約" :constraint, "要確認" :unconfirmed, "取消" :cancelled})
(def condition-labels (into {} (map (fn [[k v]] [v k]) condition-kinds)))
(def owner-path-sources
  "Sources that relay or are the Owner. The commands take an approval, and the
  cancellation of an item that came from the Owner, from a caller that names one of
  these as its --source."
  #{"hermes-agent" "owner" "boxp"})
(defn parse-conditions
  "Every non-blank line of the section is one of three things: an item line in the exact
  form, an indented line under an item line of either kind (its child), or an unreadable line. Nothing in the
  section is skipped: a line with a bad or missing id, a line that is not a list item, a
  code fence and an indented line with no item above it are all unreadable. An unreadable
  line that carries no CD-NN id is named LINE-n after its place in the section."
  [text]
  (let [lines (str/split-lines (section text "Conditions"))
        item-like #"^\s*[-*]\s+(?:\[[^]]*\]\s+)?CD-"
        items (loop [idx 0, current nil, out []]
                (if (= idx (count lines))
                  out
                  (let [line (nth lines idx)
                        [_ id kind body] (re-matches #"^[-*]\s+(CD-\d+)【(承認|制約|要確認|取消)】(.*?)\s*" line)
                        child? (and current (re-find #"^\s+\S" line) (not (re-find item-like line)))]
                    (cond (str/blank? line) (recur (inc idx) nil out)
                          child?
                          (recur (inc idx) current
                                 (-> out
                                     (update-in [current :children] conj line)
                                     (update-in [current :child-indices] conj idx)))
                          :else
                          (recur (inc idx) (count out)
                                 (conj out {:id (or id
                                                    (second (re-find #"^[-*]\s+(?:\[[^]]*\]\s+)?(CD-\d+)" line))
                                                    (str "LINE-" (inc idx))),
                                            ;; An unreadable line or an empty text is never a usable condition.
                                            :kind (if (str/blank? body) :invalid (condition-kinds kind)),
                                            :text (or body line),
                                            :line line,
                                            :line-index idx,
                                            :children [],
                                            :child-indices []}))))))
        counts (frequencies (map :id items))]
    (mapv #(if (> (counts (:id %)) 1) (assoc % :kind :invalid) %) items)))
(defn condition-hash
  "Every child counts: the origin and the cancellation are part of what the item says."
  [item]
  (sha (str/join "|" [(:id item) (name (:kind item)) (norm (:text item))
                      (str/join " " (map norm (:children item)))])))
(defn condition-child
  [item label]
  (some #(second (re-find (re-pattern (str "^\\s*[-*]\\s*" label ":\\s*(\\S+)")) %)) (:children item)))
(defn condition-source [item] (condition-child item "由来"))
(defn owner-derived?
  [item]
  (or (= :approval (:kind item)) (contains? owner-path-sources (condition-source item))))
(defn owner-reply?
  "An approval has to point at the Owner's reply it came from."
  [item]
  (boolean (some #(re-find #"^\s*[-*]\s*由来:.*\b(?:reply_id|event)=\S" %) (:children item))))
(defn condition-problems
  "What stands in Conditions that cannot be used as it is written. It is judged from
  the ticket as it stands and from nothing else: a line that cannot be read (bad form,
  empty text, a repeated id), and an 【承認】 whose origin is not an Owner path source
  with the Owner's reply (reply_id or event). The source is the one written in the
  ticket, so this finds mistakes and hand edits, not a forged source.
  An item deleted, rewritten or turned into 【取消】 by hand is not found here: that
  is `seal-problems`."
  [conditions]
  (vec (sort (distinct
              (concat
               (for [c conditions :when (= :invalid (:kind c))] (str (:id c) ":invalid"))
               (for [c conditions
                     :when (and (= :approval (:kind c))
                                (not (and (contains? owner-path-sources (condition-source c)) (owner-reply? c))))]
                 (str (:id c) ":approval-without-owner-reply")))))))
(declare set-fm)
(defn condition-seal
  "The value of the front matter key `conditions_seal`: one `ID:hash` per line of the
  section as the commands left it."
  [conditions]
  (if (seq conditions)
    (str/join "," (map #(str (:id %) ":" (subs (condition-hash %) 0 12)) conditions))
    "-"))
(defn sealed
  "ID -> hash from `conditions_seal`, or nil for a ticket no command has sealed yet."
  [text]
  (when-let [v (get (frontmatter text) "conditions_seal")]
    (into {} (keep #(let [[k h] (str/split % #":" 2)] (when (and k h) [k h])) (str/split v #",")))))
(defn seal-problems
  "Stage 1.5: where Conditions differ from what the commands last wrote. `conditions add`
  and `conditions cancel` record a hash of the item they wrote in `conditions_seal`; an
  item whose line or children differ from its hash (a rewrite, a hand-written 【取消】,
  a changed 由来), a sealed id that is no longer in the section, and a line the commands
  did not write are reported. It is judged from the ticket as it stands: nothing is kept
  in the run directory and nothing is carried from one run to the next.
  The seal is a front matter line of the same file. This finds mistakes and hand edits of
  the section; it does not find an edit that also rewrites or deletes the seal, and a
  ticket with no `conditions_seal` key is not checked at all (see plan.md)."
  [text conditions]
  (if-let [seal (sealed text)]
    (let [by-id (group-by :id conditions)]
      (vec (sort (concat
                  (for [[id h] seal
                        :let [found (by-id id)]
                        :when (not (and (= 1 (count found)) (= h (subs (condition-hash (first found)) 0 12))))]
                    (str id (if found ":changed-outside-commands" ":removed-outside-commands")))
                  (for [id (keys by-id) :when (not (contains? seal id))]
                    (str id ":added-outside-commands"))))))
    []))
(defn seal-own-change
  "`new-text` with the seal brought up to date for what a command just wrote, and for
  nothing else: an item the command did not touch keeps the entry it had, so a difference
  that stood before the command still stands after it. A ticket that was never sealed
  gets its first seal from the section as it is now."
  [text new-text]
  (let [hashes (fn [t] (into {} (map (juxt :id #(subs (condition-hash %) 0 12)) (parse-conditions t))))
        before (hashes text)
        after (parse-conditions new-text)]
    (set-fm new-text "conditions_seal"
            (if-let [seal (sealed text)]
              (let [written (into {} (for [c after
                                           :let [h (subs (condition-hash c) 0 12)]
                                           :when (not= h (before (:id c)))]
                                       [(:id c) h]))
                    order (distinct (concat (map :id after) (keys seal)))]
                (or (not-empty (str/join "," (keep #(when-let [h (or (written %) (seal %))] (str % ":" h)) order)))
                    "-"))
              (condition-seal after)))))
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
        conditions (parse-conditions text)
        ;; A ticket with no non-blank line in Conditions keeps the revision it had before Conditions existed.
        hashes (into {"_BODY" (body-hash text mode)}
                     (concat (map (juxt :id item-hash) items) (map (juxt :id condition-hash) conditions)))
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
     :conditions (mapv #(assoc % :hash (get hashes (:id %)) :received? (same? (:id %))) conditions),
     :condition-problems (vec (concat (condition-problems conditions) (seal-problems text conditions))),
     :hashes hashes,
     :rev (revision hashes),
     :ack ack,
     :ack-rev (get fm "todo_ack_rev"),
     :diff {:added added, :changed changed, :removed removed}}))
(defn gate-decision
  [{:keys [view start-rev result]}]
  (let [{:keys [mode items rev ack-rev diff ack conditions condition-problems]} view
        ids (if (= mode :legacy)
              (if (and (not= rev start-rev) (not= rev ack-rev)) ["_BODY"] [])
              (vec (distinct (concat
                              ;; A new or changed condition not acknowledged yet.
                              (keep #(when-not (:received? %) (:id %)) conditions)
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
        ;; Acknowledging the revision does not make these usable: they hold a done result
        ;; in both modes for as long as they stand in the ticket, whenever they were
        ;; written. A blocked result is not held by them: it is how the worker hands them
        ;; to the Owner, who is the one that can repair them.
        ids (vec (concat ids (when (not= result "blocked") condition-problems)))
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
                                           (concat (:items view) (:conditions view))))))]
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
(defn die [s code] (binding [*out* *err*] (println s)) (System/exit code))
(defn require-value
  [v label]
  (or (not-empty v) (throw (ex-info (str "missing " label) {}))))
(defn replace-section-item
  [text section-name item replacement]
  (let [plan (section text section-name)
        lines (vec (str/split plan #"\n" -1))
        indices (set (cons (:line-index item) (:child-indices item)))
        new-plan (str/join "\n"
                           (keep-indexed (fn [idx line]
                                           (cond (= idx (:line-index item)) replacement
                                                 (indices idx) nil
                                                 :else line))
                                         lines))]
    (str/replace-first text
                       (re-pattern (str "(?ms)(^## " (java.util.regex.Pattern/quote section-name) "[^\n]*\n)"
                                        (java.util.regex.Pattern/quote plan)))
                       (fn [[_ header]] (str header new-plan)))))
(defn replace-item [text item replacement] (replace-section-item text "Plan" item replacement))
(defn in-worker-run?
  "Whether this process has CODEX_TASK_BOARD_RUN_ID, which the runner sets for the agent it
  starts; Hermes and a person at a shell have none. It says nothing about whether a run
  of the ticket is going on: the Owner path can register and cancel while a worker runs,
  and the worker receives that as a change of the revision. A process that unsets the
  variable is not recognised, so the refusals built on this stop mistakes, not intent."
  []
  (not (str/blank? (System/getenv "CODEX_TASK_BOARD_RUN_ID"))))
(defn one-line [s] (norm s))
(defn require-line
  "A value that still says something once it is on one line."
  [v label]
  (or (not-empty (one-line v)) (throw (ex-info (str "missing " label) {}))))
(defn condition-origin
  "The 由来/取消者 value: the source first, then where it came from."
  [o]
  (let [value #(not-empty (one-line (get o %)))]
    (str (:source o)
         (when-let [v (value :reply-id)] (str " reply_id=" v))
         (when-let [v (value :event)] (str " event=" v))
         (when-let [v (value :note-at)] (str " （Notes " v "）")))))
(defn ensure-conditions-section
  "Conditions sit between the completion criteria and the working sections."
  [text]
  (if (re-find #"(?m)^## Conditions[ \t]*$" text)
    text
    (let [m (re-matcher #"(?m)^## (?:Context|Plan|Notes)[ \t]*$" text)]
      (if (.find m)
        (str (subs text 0 (.start m)) "## Conditions\n\n" (subs text (.start m)))
        (str (str/trimr text) "\n\n## Conditions\n\n")))))
(defn note-line [source s] (str "- " (Instant/now) " UTC [" source "]: " s))
(defn conditions-add
  "New text with the condition registered, or the same text for a retry of the same item."
  [text o]
  (let [kind (or (condition-kinds (:kind o))
                 (throw (ex-info "choose --kind 承認, 制約 or 要確認" {})))
        _ (when (= :cancelled kind) (throw (ex-info "use conditions cancel to cancel an item" {})))
        body (require-line (:text o) "--text")
        source (:source o)
        _ (when-not (re-matches #"\S+" source) (throw (ex-info "--source must be one word" {})))
        _ (when (= :approval kind)
            (when-not (contains? owner-path-sources source)
              (die (str "【承認】 is registered only by the Owner path (" (str/join ", " (sort owner-path-sources))
                        "); register a 【制約】 or 【要確認】, or ask the Owner") 4))
            (when (in-worker-run?)
              (die "【承認】 is not registered by a Task Board worker (CODEX_TASK_BOARD_RUN_ID is set); ask the Owner" 4))
            (when-not (or (not-empty (one-line (:reply-id o))) (not-empty (one-line (:event o))))
              (die "【承認】 needs the Owner's reply it came from: --reply-id or --event" 4)))
        existing (parse-conditions text)
        same (some #(when (and (= kind (:kind %)) (= body (norm (:text %))) (= source (condition-source %))) %)
                   existing)]
    (if same
      text
      ;; A sealed id stays taken after its line is gone: a new item under that id would put its
      ;; own hash over the record, and the removal would no longer be reported.
      (let [id (format "CD-%02d" (inc (reduce max 0 (keep #(some-> (re-matches #"CD-(\d+)" %) second parse-long)
                                                           (concat (map :id existing) (keys (sealed text)))))))
            line (str "- " id "【" (condition-labels kind) "】" body)]
        (->> (-> (ensure-conditions-section text)
                 (append-section "Conditions" (str line "\n  - 由来: " (condition-origin o)))
                 (append-section "Notes" (note-line source (str "Conditions add " id "【" (condition-labels kind) "】" body))))
             (seal-own-change text))))))
(defn conditions-cancel
  "New text with the item turned into 【取消】. The line, its text and its origin stay."
  [text o cd-id]
  (let [item (or (some #(when (= cd-id (:id %)) %) (parse-conditions text))
                 (throw (ex-info "missing condition" {})))
        source (:source o)
        _ (when-not (re-matches #"\S+" source) (throw (ex-info "--source must be one word" {})))
        why (or (:reason-kind o) "取消")
        _ (when-not (#{"取消" "置換" "履行済み"} why)
            (throw (ex-info "--reason-kind is 取消, 置換 or 履行済み" {})))
        _ (when (and (= "置換" why)
                     (not (some #(and (= (:replaced-by o) (:id %)) (not= cd-id (:id %))
                                      (not (#{:cancelled :invalid} (:kind %))))
                                (parse-conditions text))))
            (die "置換 needs --replaced-by with the id of the item in force that replaces this one" 4))
        reason (require-line (:reason o) "--reason")
        owner? (contains? owner-path-sources source)]
    (when (= :invalid (:kind item))
      (die (str "unreadable condition line: " cd-id " cannot be cancelled as it is. Treat it as a constraint and leave the line as it is: its form is repaired through the Owner path, keeping its text. Return blocked for an Owner decision.") 4))
    (when (= :cancelled (:kind item)) (die (str cd-id " is already cancelled") 4))
    ;; The Owner path may cancel a line as it stands (that is how it withdraws an 【承認】
    ;; written by hand); for anyone else the command would seal a hand edit as its own.
    (when-not (and owner? (not (in-worker-run?)))
      (when-let [problem (some #(when (str/starts-with? % (str cd-id ":")) %) (seal-problems text (parse-conditions text)))]
        (die (str problem ": " cd-id " does not match what the commands last wrote, so a worker does not cancel it through the command."
                  " Leave it as it is and return blocked for an Owner decision: the Owner path puts it back, cancels it or accepts it (conditions accept).") 4)))
    (when (and (owner-derived? item) (or (not owner?) (in-worker-run?)))
      (die (str cd-id " came from the Owner: it is cancelled by the Owner path (" (str/join ", " (sort owner-path-sources))
                "), not by a Task Board worker (CODEX_TASK_BOARD_RUN_ID is set)."
                " Return blocked for an Owner decision.") 4))
    (when (and (not owner?) (not= source (condition-source item)))
      (die (str cd-id " was registered by " (condition-source item)
                ": only that source or the Owner path can cancel it") 4))
    (->> (-> (replace-section-item
         text "Conditions" item
         (str "- " cd-id "【取消】" (:text item)
              (when (seq (:children item)) (str "\n" (str/join "\n" (:children item))))
              "\n  - 取消理由: " why (when (= "置換" why) (str "（" (:replaced-by o) "）")) " " reason
              "\n  - 取消者: " (condition-origin o)))
        (append-section "Notes" (note-line source (str "Conditions cancel " cd-id " (" why ") " reason))))
         (seal-own-change text))))
(defn conditions-accept
  "The Owner path takes the section as it stands: the seal is written anew from every
  line, and the section itself is not touched. The differences it closes go to Notes."
  [text o]
  (let [source (:source o)
        reason (require-line (:reason o) "--reason")
        conditions (parse-conditions text)
        problems (seal-problems text conditions)]
    (when-not (contains? owner-path-sources source)
      (die (str "conditions accept is for the Owner path (" (str/join ", " (sort owner-path-sources)) "). Return blocked for an Owner decision.") 4))
    (when (in-worker-run?)
      (die "conditions accept is not run by a Task Board worker (CODEX_TASK_BOARD_RUN_ID is set). Return blocked for an Owner decision." 4))
    (if (and (sealed text) (empty? problems))
      text
      (-> text
          (set-fm "conditions_seal" (condition-seal conditions))
          (append-section "Notes" (note-line (condition-origin o)
                                             (str "Conditions accept (" (if (sealed text) (str/join ", " problems) "first seal") ") " reason)))))))
(defn parse-instant [s] (try (Instant/parse (str/trim (str s))) (catch Exception _ nil)))
(defn checkpoint-recorded?
  "Whether Notes has the line `conditions checkpoint` writes for this instant."
  [text through]
  (boolean (some #(when-let [[_ t] (re-matches #"- \S+ UTC \[[^\]]+\]: Conditions checkpoint through (\S+) .*" %)]
                    (= through (parse-instant t)))
                 (str/split-lines (section text "Notes")))))
(defn checkpoint-problems
  "Stage 3: why the Notes of this ticket are not left out of a prompt, or nil when they
  may be. The Conditions section is then the only carrier of what the older Notes said,
  so it has to be exactly what the commands wrote."
  [text]
  (let [conditions (parse-conditions text)
        through (get (frontmatter text) "conditions_through")]
    (cond (str/blank? through) "no conditions_through"
          (nil? (parse-instant through)) "conditions_through is not an instant"
          (nil? (sealed text)) "no conditions_seal"
          ;; The mark counts only with the Notes line `conditions checkpoint` wrote for this
          ;; very instant: a value put into the front matter by hand leaves nothing out.
          (not (checkpoint-recorded? text (parse-instant through))) "conditions_through has no checkpoint record in Notes"
          :else (when-let [problems (seq (concat (condition-problems conditions) (seal-problems text conditions)))]
                  (str/join ", " problems)))))
(defn note-entry-latest
  "The latest instant the Notes entry starting at this line can have been written at, or
  nil when the line does not say. A line with seconds can be up to a second later than
  it reads, and a line with only a date can be from any time of that day."
  [line]
  (or (when-let [[_ d t] (re-find #"^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC\b" line)]
        (some-> (parse-instant (str d "T" t "Z")) (.plusSeconds 1)))
      (when-let [[_ ts] (re-find #"^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s" line)]
        (parse-instant ts))
      (when-let [[_ d] (re-find #"^- (\d{4}-\d{2}-\d{2}):" line)]
        (some-> (parse-instant (str d "T00:00:00Z")) (.plusSeconds 86400)))))
(defn omit-checkpointed-notes
  "Stage 3: the ticket text for a prompt. Only a ticket with `conditions_through`, a
  `conditions_seal` and nothing to report in Conditions loses anything, and what it
  loses is the leading run of Notes entries that were all written by `conditions_through`.
  The run ends at the first entry that is later or whose line does not say when it was
  written, and everything from there on stays, whatever its date. No wording is looked
  at. The ticket file is not changed. Returns {:text, :omitted, :bytes, :through} or
  {:text (unchanged), :omitted 0, :kept-because why}."
  [text full-path]
  (if-let [why (checkpoint-problems text)]
    {:text text :omitted 0 :kept-because why}
    (let [through (parse-instant (get (frontmatter text) "conditions_through"))
          m (re-matcher #"(?m)^## Notes[ \t]*\r?\n" text)]
      (if-not (.find m)
        {:text text :omitted 0 :kept-because "no Notes section"}
        (let [start (.end m)
              m2 (doto (re-matcher #"(?m)^## " text) (.region start (count text)))
              end (if (.find m2) (.start m2) (count text))
              lines (str/split (subs text start end) #"(?<=\n)")
              entry? #(str/starts-with? % "- ")
              preamble (take-while (complement entry?) lines)
              ;; an entry is its first line and the lines up to the next entry
              entries (loop [xs (drop (count preamble) lines) out []]
                        (if (seq xs)
                          (let [[more rest-xs] (split-with (complement entry?) (rest xs))]
                            (recur rest-xs (conj out (cons (first xs) more))))
                          out))
              old? (fn [entry] (when-let [t (note-entry-latest (first entry))] (not (.isAfter t through))))
              omitted (take-while old? entries)
              kept (drop (count omitted) entries)]
          (if (empty? omitted)
            {:text text :omitted 0 :kept-because "no entry up to conditions_through"}
            (let [bytes (count (.getBytes (apply str (apply concat omitted)) "UTF-8"))]
              {:omitted (count omitted) :bytes bytes :through (str through)
               :text (str (subs text 0 start) (apply str preamble)
                          "- (not in this prompt) " (count omitted) " Notes entries (" (quot (+ bytes 512) 1024)
                          " KB) written up to conditions_through " through
                          " are left out: what they said that still holds was checked into the Conditions section above."
                          " They are history, not instructions; the file has them in full: " full-path "\n\n"
                          (apply str (apply concat kept))
                          (subs text end))})))))))
(defn conditions-checkpoint
  "Records that the Notes written up to --through were read and that what still holds in
  them is in Conditions. Stage 3 leaves those entries out of prompts. The mark only moves
  forward, and only on a ticket whose Conditions are as the commands wrote them."
  [text o]
  (let [source (:source o)
        _ (when-not (re-matches #"\S+" source) (throw (ex-info "--source must be one word" {})))
        reason (require-line (:reason o) "--reason")
        through (or (parse-instant (:through o))
                    (die "--through is a UTC instant such as 2026-11-18T05:42:37Z" 4))
        current (parse-instant (get (frontmatter text) "conditions_through"))
        conditions (parse-conditions text)]
    (when (.isAfter through (Instant/now)) (die "--through is in the future" 4))
    (when (and (not (str/blank? (get (frontmatter text) "conditions_through"))) (nil? current))
      (die "conditions_through in the ticket is not an instant: return blocked for an Owner decision" 4))
    (when (and current (.isBefore through current))
      (die (str "conditions_through only moves forward (it is " current "). To give the full Notes again, ask the Owner path.") 4))
    (when-not (sealed text)
      (die "no conditions_seal: register the conditions through conditions add first" 4))
    (when-let [problems (seq (concat (condition-problems conditions) (seal-problems text conditions)))]
      (die (str "Conditions are not as the commands wrote them (" (str/join ", " problems) "): no checkpoint. Return blocked for an Owner decision.") 4))
    (if (and (= through current) (checkpoint-recorded? text through))
      text
      (-> text
          (set-fm "conditions_through" (str through))
          (append-section "Notes" (note-line (condition-origin o) (str "Conditions checkpoint through " through " " reason)))))))
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
          ;; An acknowledgement does not open merge or deploy while one of these stands.
          problems (:condition-problems view)
          msg (str (diff-text view) "\n" (worker-commands (:ticket o) (:vault o) rev)
                   (when (seq problems)
                     (str "\nConditions that cannot be used as they are written: " (str/join ", " problems)
                          ". Leave those lines as they are and return blocked for an Owner decision: the Owner path"
                          " repairs an unreadable line keeping its text, registers an 【承認】 with the Owner's reply, and"
                          " for an item added, changed or removed outside the commands either puts it back or accepts the"
                          " section as it stands (conditions accept)."
                          " While one of them stands, merge and deploy are refused and a done result is held.")))
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
                (or (:hold? gate) (seq problems))
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
  (let [o (opts (rest args))
        ;; `conditions <add|cancel|accept|checkpoint|list> ID [CD-NN]`
        conditions? (= "conditions" (first args))
        cmd (if conditions? (str "conditions-" (first (:args o))) (first args))
        [id item-id] (if conditions? (rest (:args o)) (:args o))
        vault (if (= cmd "hook") (:vault o) (require-value (:vault o) "--vault"))
        path (when vault (fs/path vault "Tickets" (str id ".md")))]
    (if (= cmd "hook")
      (hook o)
      (if (#{"status" "conditions-list"} cmd)
        (let [v (ticket-view (slurp (str path)))]
          (println (cond (= cmd "conditions-list")
                         (if (:json o)
                           (json/generate-string (:conditions v))
                           (str/join "\n" (mapcat #(cons (:line %) (:children %)) (:conditions v))))
                         (:json o) (json/generate-string v)
                         :else (str (state-summary v) "\n" (diff-text v)))))
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
                      "conditions-add" (conditions-add text (assoc o :source (require-value (:source o) "--source")))
                      "conditions-accept" (conditions-accept text (assoc o :source (require-value (:source o) "--source")))
                      "conditions-checkpoint" (conditions-checkpoint text (assoc o :source (require-value (:source o) "--source")))
                      "conditions-cancel" (conditions-cancel text
                                                             (assoc o :source (require-value (:source o) "--source"))
                                                             (require-value item-id "condition id"))
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
