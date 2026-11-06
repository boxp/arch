#!/usr/bin/env bb

(ns task-board
  (:require [babashka.fs :as fs]
            [clojure.edn :as edn]
            [clojure.java.shell :as shell]
            [clojure.string :as str])
  (:import [java.io RandomAccessFile PushbackReader StringReader]
           [java.security MessageDigest]))

(def lanes
  {"Backlog" "backlog"
   "Ready" "ready"
   "In Progress" "in-progress"
   "Blocked" "blocked"
   "Done" "done"})

;; BOXP-395: Review is retired and cannot be a destination. A leftover card stays
;; readable so it can be moved out rather than vanish from the board.
(def readable-lanes (assoc lanes "Review" "review"))

(def status->lane (into {} (map (fn [[lane status]] [status lane]) lanes)))

(def codex-request-lanes #{"Backlog" "Ready" "Blocked"})

(def section-names
  {"summary" "Summary"
   "acceptance" "Acceptance Criteria"
   "context" "Context"
   "plan" "Plan"
   "notes" "Notes"})

(defn die [message]
  (binding [*out* *err*]
    (println message))
  (System/exit 1))

(defn new-rev []
  (str (Long/toString (System/currentTimeMillis) 36) "-" (format "%04x" (rand-int 65536))))

(defn now-date []
  (subs (.toString (java.time.LocalDate/now)) 0 10))

(defn now-timestamp []
  (.format (java.time.ZonedDateTime/now)
           (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM-dd HH:mm:ss z")))

(defn json-escape [s]
  (-> (str s)
      (str/replace "\\" "\\\\")
      (str/replace "\"" "\\\"")
      (str/replace "\b" "\\b")
      (str/replace "\f" "\\f")
      (str/replace "\n" "\\n")
      (str/replace "\r" "\\r")
      (str/replace "\t" "\\t")))

(declare ->json)

(defn ->json [v]
  (cond
    (nil? v) "null"
    (string? v) (str "\"" (json-escape v) "\"")
    (keyword? v) (->json (name v))
    (number? v) (str v)
    (true? v) "true"
    (false? v) "false"
    (map? v) (str "{"
                  (str/join "," (map (fn [[k val]]
                                         (str (->json (name k)) ":" (->json val)))
                                       v))
                  "}")
    (sequential? v) (str "[" (str/join "," (map ->json v)) "]")
    :else (->json (str v))))

(defn print-result [opts data]
  (if (:json opts)
    (println (->json data))
    (println (pr-str data))))

(defn parse-args [args]
  (loop [xs args opts {:positionals []}]
    (if (empty? xs)
      opts
      (let [[x & more] xs]
        (case x
          "--vault" (recur (nnext xs) (assoc opts :vault (first more)))
          "--lane" (recur (nnext xs) (assoc opts :lane (first more)))
          "--title" (recur (nnext xs) (assoc opts :title (first more)))
          "--summary" (recur (nnext xs) (assoc opts :summary (first more)))
          "--summary-file" (recur (nnext xs) (assoc opts :summary (slurp (first more))))
          "--acceptance" (recur (nnext xs) (assoc opts :acceptance (first more)))
          "--acceptance-file" (recur (nnext xs) (assoc opts :acceptance (slurp (first more))))
          "--context" (recur (nnext xs) (assoc opts :context (first more)))
          "--context-file" (recur (nnext xs) (assoc opts :context (slurp (first more))))
          "--plan" (recur (nnext xs) (assoc opts :plan (first more)))
          "--plan-file" (recur (nnext xs) (assoc opts :plan (slurp (first more))))
          "--notes" (recur (nnext xs) (assoc opts :notes (first more)))
          "--notes-file" (recur (nnext xs) (assoc opts :notes (slurp (first more))))
          "--note" (recur (nnext xs) (assoc opts :note (first more)))
          "--note-file" (recur (nnext xs) (assoc opts :note (slurp (first more))))
          "--source" (recur (nnext xs) (assoc opts :source (first more)))
          "--intent" (recur (nnext xs) (assoc opts :intent (first more)))
          "--source-root" (recur (nnext xs) (assoc opts :source-root (first more)))
          "--expected-ticket-sha256" (recur (nnext xs) (assoc opts :expected-ticket-sha256 (first more)))
          "--expected-board-sha256" (recur (nnext xs) (assoc opts :expected-board-sha256 (first more)))
          "--expected-after-board-sha256" (recur (nnext xs) (assoc opts :expected-after-board-sha256 (first more)))
          "--expected-source-sha256" (recur (nnext xs) (assoc opts :expected-source-sha256 (first more)))
          "--expected-helper-sha256" (recur (nnext xs) (assoc opts :expected-helper-sha256 (first more)))
          "--expected-rev" (recur (nnext xs) (assoc opts :expected-rev (first more)))
          "--expected-revision" (recur (nnext xs) (assoc opts :expected-revision (first more)))
          "--actor" (recur (nnext xs) (assoc opts :actor (first more)))
          "--writer-generation" (recur (nnext xs) (assoc opts :writer-generation (first more)))
          "--priority" (recur (nnext xs) (assoc opts :priority (first more)))
          "--assignee" (recur (nnext xs) (assoc opts :assignee (first more)))
          "--repo" (recur (nnext xs) (assoc opts :repo (first more)))
          "--force-plan" (recur more (assoc opts :force-plan true))
          "--dry-run" (recur more (assoc opts :dry-run true))
          "--confirm" (recur more (assoc opts :confirm true))
          "--json" (recur more (assoc opts :json true))
          (recur more (update opts :positionals conj x)))))))

(defn vault-path [opts]
  (or (:vault opts)
      (System/getenv "BOXP_OBSIDIAN_VAULT")
      "/home/boxp/Documents/obsidian-headless/BOXP"))

(defn board-path [vault]
  (fs/file vault "Boards" "Task Board.md"))

(defn tickets-dir [vault]
  (fs/file vault "Tickets"))

(defn ticket-path [vault id]
  (fs/file (tickets-dir vault) (str id ".md")))

(defn require-lane [lane]
  (when-not (contains? lanes lane)
    (die (str "Unsupported lane: " lane ". Expected one of " (str/join ", " (keys lanes)))))
  lane)

(defn read-text [path]
  (when-not (fs/exists? path)
    (die (str "Missing file: " path)))
  (slurp (str path)))

(defn write-text! [path content]
  (fs/create-dirs (fs/parent path))
  (spit (str path) content))

(defn ticket-lock-dir []
  (fs/path (System/getProperty "java.io.tmpdir") "task-board-locks"))

(defn canonical-path-hash [path]
  (let [canonical (.getCanonicalPath (java.io.File. (str path)))
        digest (MessageDigest/getInstance "SHA-256")
        hash-bytes (.digest digest (.getBytes canonical "UTF-8"))]
    (subs (apply str (map #(format "%02x" (bit-and % 0xff)) hash-bytes)) 0 16)))

(defn with-file-lock [path f]
  (let [safe-name (str/replace (str (fs/file-name path)) #"[^a-zA-Z0-9._-]" "_")
        phash (canonical-path-hash path)
        lock-file (str (fs/path (ticket-lock-dir) (str phash "-" safe-name ".lock")))]
    (fs/create-dirs (ticket-lock-dir))
    (with-open [raf (RandomAccessFile. lock-file "rw")
                channel (.getChannel raf)]
      (let [_lock (.lock channel)]
        (f)))))

(defn with-ticket-lock
  "Also takes the lock on the vault's volume (see task_board_todos.bb with-lock), which
  separate containers share. A dry-run writes nothing and must not create it in the vault."
  [opts ticket-path f]
  (if (:dry-run opts)
    (with-file-lock ticket-path f)
    (let [vault (fs/parent (fs/parent (fs/absolutize ticket-path)))
          safe-name (str/replace (str (fs/file-name ticket-path)) #"[^a-zA-Z0-9._-]" "_")
          lock-file (fs/path vault ".task-board-locks" (str safe-name ".lock"))]
      (fs/create-dirs (fs/parent lock-file))
      (with-open [raf (RandomAccessFile. (str lock-file) "rw")
                  channel (.getChannel raf)]
        (let [_lock (.lock channel)]
          (with-file-lock ticket-path f))))))
(defn with-board-lock [board-path f] (with-file-lock board-path f))

;; BOXP-201 I3: opt-in lock shared with the runner and vault_writer.bb. Unset in
;; deployment, where the per-file locks above behave exactly as before. It is
;; taken before any per-file lock.
(defn with-vault-writer-lock [opts f]
  (let [dir (System/getenv "TASK_BOARD_VAULT_WRITER_LOCK_DIR")]
    ;; A dry-run writes nothing, so it must not create the lock dir or file either.
    (if (or (str/blank? dir) (:dry-run opts))
      (f)
      (do
        (fs/create-dirs dir)
        (with-open [raf (RandomAccessFile. (str (fs/path dir "vault-writer.lock")) "rw")
                    channel (.getChannel raf)]
          (let [_lock (.lock channel)]
            (f)))))))

(defn present [s]
  (when-not (str/blank? (str s)) s))

(defn parse-frontmatter [content]
  (let [lines (str/split-lines content)]
    (when-not (= "---" (first lines))
      (die "Ticket is missing frontmatter start delimiter"))
    (let [end-idx (first (keep-indexed (fn [idx line]
                                         (when (and (pos? idx) (= "---" line)) idx))
                                       lines))]
      (when-not end-idx
        (die "Ticket is missing frontmatter end delimiter"))
      {:frontmatter-lines (subvec (vec lines) 1 end-idx)
       :body-lines (subvec (vec lines) (inc end-idx))})))

(defn fm-get [fm-lines k]
  (some (fn [line]
          (when-let [[_ key value] (re-matches #"^([A-Za-z0-9_-]+):\s*(.*)$" line)]
            (when (= key k) value)))
        fm-lines))

(defn fm-set [fm-lines k value]
  (let [needle (str k ":")
        value (or value "")
        new-line (if (str/blank? value) needle (str k ": " value))
        replaced (atom false)
        out (mapv (fn [line]
                    (if (str/starts-with? line needle)
                      (do (reset! replaced true) new-line)
                      line))
                  fm-lines)]
    (if @replaced
      out
      (conj out new-line))))

(defn render-ticket [fm-lines body-lines]
  (str "---\n"
       (str/join "\n" fm-lines)
       "\n---\n"
       (str/join "\n" body-lines)
       (when-not (str/ends-with? (str/join "\n" body-lines) "\n") "\n")))

(defn ticket-id-from-path [path]
  (second (re-find #"(BOXP-\d+)\.md$" (str path))))

(defn parse-heading [body-lines]
  (some (fn [line]
          (second (re-find #"^#\s+BOXP-\d+:\s*(.+)$" line)))
        body-lines))

(defn replace-heading [body-lines id title]
  (mapv (fn [line]
          (if (re-find #"^#\s+BOXP-\d+:" line)
            (str "# " id ": " title)
            line))
        body-lines))

(defn find-section-range [body-lines section]
  (let [header (str "## " section)
        start (first (keep-indexed #(when (= %2 header) %1) body-lines))]
    (when start
      (let [end (or (first (keep-indexed (fn [idx line]
                                           (when (and (> idx start) (str/starts-with? line "## "))
                                             idx))
                                         body-lines))
                    (count body-lines))]
        [start end]))))

(defn replace-section [body-lines section content]
  (let [content-lines (if (str/blank? (or content ""))
                        []
                        (str/split-lines (str/trimr content)))
        new-lines (vec (concat [(str "## " section) ""] content-lines))]
    (if-let [[start end] (find-section-range body-lines section)]
      (vec (concat (subvec body-lines 0 start)
                   new-lines
                   [""]
                   (drop-while str/blank? (subvec body-lines end))))
      (vec (concat body-lines [""] new-lines [""])))))

(defn append-note-lines [body-lines source note]
  (let [source (or source "hermes-agent")
        entry (str "- " (now-timestamp) " [" source "]: " (str/trim (or note "")))]
    (if-let [[_ end] (find-section-range body-lines "Notes")]
      (vec (concat (subvec body-lines 0 end)
                   (cond-> []
                     (not= "" (get body-lines (dec end) "")) (conj "")
                     true (conj entry))
                   (subvec body-lines end)))
      (vec (concat body-lines ["" "## Notes" "" entry])))))

(defn ticket-data [vault id]
  (let [path (ticket-path vault id)
        content (read-text path)
        {:keys [frontmatter-lines body-lines]} (parse-frontmatter content)]
    {:id id
     :path (str path)
     :frontmatter-lines frontmatter-lines
     :body-lines body-lines
     :title (parse-heading body-lines)
     :status (fm-get frontmatter-lines "status")
     :priority (fm-get frontmatter-lines "priority")
     :assignee (fm-get frontmatter-lines "assignee")
     :repo (fm-get frontmatter-lines "repo")
     :rev (present (fm-get frontmatter-lines "board_rev"))}))

(defn card-line? [line]
  (boolean (re-find #"- \[[ xX]\] \[\[Tickets/BOXP-\d+\|" line)))

(defn encode-card-title [title]
  (-> (str title)
      (str/replace "\\" "\\\\")
      (str/replace "]" "\\]")))

(defn decode-card-title [title]
  (str/replace title #"\\(.)" "$1"))

(defn parse-card [lane line]
  (when-let [[_ done id title rest] (re-find #"- \[([ xX])\] \[\[Tickets/(BOXP-\d+)\|BOXP-\d+:\s*((?:\\.|[^\]])+)\]\](.*)$" line)]
    {:id id
     :title (str/trim (decode-card-title title))
     :lane lane
     :done (= "x" (str/lower-case done))
     :status (second (re-find #"status::([^\s]+)" rest))
     :priority (second (re-find #"priority::([^\s]+)" rest))
     :assignee (second (re-find #"assignee::([^\s]+)" rest))
     :rev (second (re-find #"(?:^|\s)rev::([^\s]+)" rest))
     :done-date (second (re-find #"done::([^\s]+)" rest))
     :repo (vec (map second (re-seq #"repo::([^\s]+)" rest)))
     :raw line}))

(defn board-cards [board]
  (loop [lines (str/split-lines board)
         lane nil
         cards []]
    (if (empty? lines)
      cards
      (let [line (first lines)
            heading (second (re-find #"^##\s+(.+?)\s*$" line))
            ;; A non-lane heading (e.g. "## Notes") ends the current lane: cards
            ;; below it belong to no lane, matching the runner's parse-board-cards.
            lane (cond
                   (nil? heading) lane
                   (contains? readable-lanes heading) heading
                   :else nil)
            card (and lane (parse-card lane line))]
        (recur (rest lines) lane (cond-> cards card (conj card)))))))

(defn card-for [board id]
  (let [cards (filter #(= id (:id %)) (board-cards board))]
    (when (> (count cards) 1)
      (die (str "Multiple board cards found for " id)))
    (first cards)))

(defn remove-card [lines id]
  ;; Foreign sections can contain copies that must survive lane updates.
  (loop [remaining lines lane nil result []]
    (if (empty? remaining)
      result
      (let [line (first remaining)
            heading (second (re-find #"^##\s+(.+?)\s*$" line))
            lane (cond (nil? heading) lane (contains? readable-lanes heading) heading :else nil)]
        (recur (rest remaining) lane
               (if (and lane (card-line? line) (str/includes? line (str "[[Tickets/" id "|")))
                 result
                 (conj result line)))))))

(defn repo-values [repo]
  (cond
    (nil? repo) []
    (sequential? repo) (vec (remove str/blank? repo))
    :else (vec (remove str/blank? (map str/trim (str/split (str repo) #","))))))

(defn card-line [{:keys [id title lane priority assignee repo rev done done-date]}]
  (let [status (lanes (require-lane lane))
        checkbox (if (or done (= lane "Done")) "x" " ")
        done-date (or done-date (when (= lane "Done") (now-date)))
        meta (cond-> [(str "status::" status)
                      (str "priority::" (or priority "medium"))]
               (seq assignee) (conj (str "assignee::" assignee))
               (seq (repo-values repo)) (into (map #(str "repo::" %) (repo-values repo)))
               (seq rev) (conj (str "rev::" rev)))]
    (str "- [" checkbox "] [[Tickets/" id "|" id ": " (encode-card-title title) "]] #ticket " (str/join " " meta)
         (when (and (= lane "Done") (seq done-date)) (str " done::" done-date)))))

(defn insert-card [board id card]
  (let [lane (:lane card)
        _ (require-lane lane)
        lines (remove-card (vec (str/split-lines board)) id)
        heading (str "## " lane)
        idx (first (keep-indexed #(when (= %2 heading) %1) lines))]
    (when-not idx
      (die (str "Board lane not found: " lane)))
    (let [insert-idx (if (and (< (inc idx) (count lines)) (str/blank? (get lines (inc idx))))
                       (+ idx 2)
                       (inc idx))
          out (vec (concat (subvec lines 0 insert-idx)
                           [(card-line card)]
                           (subvec lines insert-idx)))]
      (str (str/join "\n" out) "\n"))))

(defn apply-ticket-update [ticket updates]
  (let [status (:status updates)
        fm0 (:frontmatter-lines ticket)
        fm1 (reduce (fn [fm [k v]]
                      (fm-set fm k v))
                    fm0
                    (remove (fn [[_ v]] (nil? v))
                            {"board_rev" (:rev updates)
                             "status" status
                             "priority" (:priority updates)
                             "assignee" (:assignee updates)
                             "repo" (:repo updates)
                             "closed" (:closed updates)}))
        body0 (:body-lines ticket)
        body1 (if-let [title (:title updates)]
                (replace-heading body0 (:id ticket) title)
                body0)
        body2 (reduce (fn [body [k section]]
                        (let [value ((keyword k) updates)]
                          (if (some? value)
                            (replace-section body section value)
                            body)))
                      body1
                      section-names)
        body3 (if-let [note (:append-note updates)]
                (append-note-lines body2 (:note-source updates) note)
                body2)]
    (render-ticket fm1 body3)))

(defn ticket-number [id]
  (some-> id (str/replace "BOXP-" "") parse-long))

(defn next-ticket-id [vault board]
  (let [file-ids (for [p (fs/glob (tickets-dir vault) "BOXP-*.md")
                       :let [id (ticket-id-from-path p)
                             n (some-> id ticket-number)]
                       :when n]
                   n)
        board-ids (for [card (board-cards board)
                        :let [n (some-> (:id card) ticket-number)]
                        :when n]
                    n)
        ids (concat file-ids board-ids)]
    (str "BOXP-" (inc (apply max 0 ids)))))

(defn create-ticket-content [{:keys [id title summary acceptance context plan notes priority assignee repo lane closed-date rev]}]
  (let [status (lanes lane)]
    (str "---\n"
         "id: " id "\n"
         "type: task\n"
         (str/join "\n" (fm-set [] "board_rev" rev)) "\n"
         "status: " status "\n"
         "priority: " (or priority "medium") "\n"
         "assignee: " (or assignee "boxp") "\n"
         "reporter: boxp\n"
         "project: BOXP\n"
         "epic:\n"
         "sprint:\n"
         "repo: " (or repo "") "\n"
         "estimate:\n"
         "created: " (now-date) "\n"
         "due:\n"
         "closed:" (when (seq closed-date) (str " " closed-date)) "\n"
         "tags:\n"
         "  - ticket\n"
         "---\n\n"
         "# " id ": " title "\n\n"
         "## Summary\n\n"
         (or summary "") "\n\n"
         "## Acceptance Criteria\n\n"
         (or acceptance "- [ ] ") "\n\n"
         "## Context\n\n"
         (or context "- 背景:\n- 関連リンク:\n- 関連ノート:") "\n\n"
         "## Plan\n\n"
         (or plan "- [ ] 調査\n- [ ] 実装または作業\n- [ ] 確認") "\n\n"
         "## Notes\n\n"
         (or notes "作業ログや判断メモを書く。") "\n")))

(defn cmd-list [opts]
  (let [vault (vault-path opts)
        board (read-text (board-path vault))
        lane (:lane opts)
        _ (when lane (require-lane lane))
        cards (cond->> (board-cards board)
                lane (filter #(= lane (:lane %))))]
    (print-result opts {:tickets (vec cards)})))

(defn cmd-show [opts id]
  (let [vault (vault-path opts)
        board (read-text (board-path vault))
        ticket (ticket-data vault id)
        cards (vec (filter #(= id (:id %)) (board-cards board)))
        card (first cards)]
    (print-result opts {:ticket (select-keys ticket [:id :path :title :status :priority :assignee :repo :rev])
                        :card card
                        :consistency {:ticket-rev (:rev ticket) :card-rev (:rev card)
                                      :rev-match (= (:rev ticket) (:rev card))
                                      :assignee-match (= (:assignee ticket) (:assignee card))
                                      :duplicate-cards (count cards) :card-lanes (mapv :lane cards)}})))

(defn cmd-verify-dispatch [opts id]
  (let [expected (or (:expected-rev opts) (die "verify-dispatch requires --expected-rev"))
        epoch (try (Long/parseLong (first (str/split expected #"-")) 36)
                   (catch Exception _ (die "invalid --expected-rev")))
        vault (vault-path opts)
        ticket (ticket-data vault id)
        cards (vec (filter #(= id (:id %)) (board-cards (read-text (board-path vault)))))
        card (first cards)
        notes (when-let [[start end] (find-section-range (:body-lines ticket) "Notes")]
                (subvec (:body-lines ticket) start end))
        started (when (#{"In Progress" "Review" "Blocked" "Done"} (:lane card))
                  (some (fn [[_ run timestamp agent]]
                          (try
                            (let [fmt (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
                                  instant (.toInstant (.atOffset (java.time.LocalDateTime/parse timestamp fmt) java.time.ZoneOffset/UTC))]
                              (when (and (>= (.getEpochSecond instant) (quot epoch 1000))
                                         (or (nil? (:assignee opts)) (= agent (:assignee opts))))
                                run))
                            (catch Exception _ nil)))
                        (re-seq #"Codex task-board run ((\d{8}T\d{6}Z)[^\s]*) started from .* using ([^\s]+?)\.?(?:\s|$)" (str/join "\n" notes))))
        tr (:rev ticket) cr (:rev card) assignee (:assignee opts)
        state (cond
                (> (count cards) 1) "duplicate-cards"
                started "started"
                (and (= tr cr) (not= tr expected)) "reverted"
                (not= tr cr) "pending-sync"
                (and (= tr cr expected) (or (nil? assignee) (= assignee (:assignee ticket)))) "awaiting-pickup"
                :else "unknown")]
    (print-result opts {:action "verify-dispatch" :id id :state state :ticket-rev tr :card-rev cr
                        :ticket-assignee (:assignee ticket) :card-assignee (:assignee card)
                        :lane (:lane card) :started-run started :duplicate-cards (count cards)})
    (when-let [code ({"duplicate-cards" 3 "reverted" 4 "pending-sync" 5 "unknown" 6} state)]
      (System/exit code))))

(defn cmd-create [opts]
  (let [vault (vault-path opts)
        title (or (:title opts) (die "create requires --title"))
        lane (require-lane (or (:lane opts) "Backlog"))
        bpath (board-path vault)
        result-atom (atom nil)]
    (with-board-lock bpath
      (fn []
        (let [board (read-text bpath)
              id (next-ticket-id vault board)
              path (ticket-path vault id)
              done-date (when (= lane "Done") (now-date))
              rev (new-rev)
              ticket-content (create-ticket-content (assoc opts :id id :title title :lane lane :closed-date done-date :rev rev))
              card {:id id :title title :lane lane :priority (:priority opts) :assignee (or (:assignee opts) "boxp") :repo (:repo opts) :done-date done-date :rev rev}
              new-board (insert-card board id card)
              result {:action "create" :rev rev :id id :ticket-path (str path) :lane lane :dry-run (boolean (:dry-run opts))}]
          (when-not (:dry-run opts)
            (write-text! path ticket-content)
            (write-text! bpath new-board))
          (reset! result-atom result))))
    (print-result opts @result-atom)))

(defn cmd-update [opts id]
  (let [vault (vault-path opts)
        path (ticket-path vault id)
        bpath (board-path vault)
        result-atom (atom nil)]
    (with-board-lock bpath
      (fn []
        (with-ticket-lock opts path
          (fn []
            (let [ticket (ticket-data vault id)
                  _ (when (and (:plan opts) (not (:force-plan opts)) (= "v1" (fm-get (:frontmatter-lines ticket) "todo_contract")))
                      (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_board_todos.bb")))
                      (let [parse (resolve 'task-board-todos/parse-items) hash-item (resolve 'task-board-todos/item-hash)
                            old (mapv (juxt :id hash-item) (parse (slurp (str path))))
                            new (into {} (map (juxt :id hash-item) (parse (str "## Plan\n" (:plan opts)))))]
                        (when (some (fn [[id hash]] (not= hash (get new id))) old)
                          (die "update --plan changes existing TD items; use --force-plan to override"))))
                  board (read-text bpath)
                  old-card (card-for board id)
                  lane (or (:lane opts) (:lane old-card) (status->lane (:status ticket)) "Backlog")
                  status (lanes (require-lane lane))
                  title (or (:title opts) (:title ticket))
                  done-date (or (present (:done-date old-card))
                                (present (fm-get (:frontmatter-lines ticket) "closed"))
                                (when (= lane "Done") (now-date)))
                  ;; A new revision marks a new assignment (lane or assignee);
                  ;; the runner treats it as superseding an in-flight run. Text
                  ;; edits and notes keep the current one.
                  reassigned? (or (not= lane (:lane old-card))
                                  (not= status (:status ticket))
                                  (and (:assignee opts) (not= (:assignee opts) (:assignee ticket))))
                  rev (if reassigned? (new-rev) (or (:rev ticket) (:rev old-card)))
                  updates {:rev rev :append-note (:note opts) :note-source (or (:source opts) "hermes-agent")
                           :title (:title opts)
                           :summary (:summary opts)
                           :acceptance (:acceptance opts)
                           :context (:context opts)
                           :plan (:plan opts)
                           :notes (:notes opts)
                           :status status
                           :priority (:priority opts)
                           :assignee (:assignee opts)
                           :repo (:repo opts)
                           :closed (if (= lane "Done") done-date "")}
                  new-ticket (apply-ticket-update ticket updates)
                  card {:id id
                        :title title
                        :lane lane
                        :priority (or (:priority opts) (:priority ticket) (:priority old-card))
                        :assignee (or (:assignee opts) (:assignee ticket) (:assignee old-card))
                        :repo (or (:repo opts) (:repo old-card) (:repo ticket))
                        :done-date done-date :rev rev}
                  new-board (insert-card board id card)
                  result {:action "update" :rev rev :id id :lane lane :status status :dry-run (boolean (:dry-run opts))}]
              (when-not (:dry-run opts)
                (write-text! path new-ticket)
                (write-text! bpath new-board))
              (reset! result-atom result))))))
    (print-result opts @result-atom)))

(defn cmd-append-note [opts id]
  (let [vault (vault-path opts)
        note (or (:note opts) (die "append-note requires --note or --note-file"))
        path (ticket-path vault id)
        result {:action "append-note" :id id :source (or (:source opts) "hermes-agent") :dry-run (boolean (:dry-run opts))}]
    (if (:dry-run opts)
      (print-result opts result)
      (do
        (with-ticket-lock opts path
          (fn []
            (let [ticket (ticket-data vault id)
                  new-ticket (apply-ticket-update ticket {:append-note note :note-source (:source opts)})]
              (write-text! path new-ticket))))
        (print-result opts result)))))

(defn cmd-request-codex [opts id]
  (let [vault (vault-path opts)
        lane (require-lane (or (:lane opts) (die "request-codex requires --lane")))
        note (or (:note opts) (die "request-codex requires --note or --note-file"))
        path (ticket-path vault id)
        bpath (board-path vault)
        result-atom (atom nil)]
    (when-not (contains? codex-request-lanes lane)
      (die "request-codex lane must be one of Backlog, Ready, or Blocked"))
    (with-board-lock bpath
      (fn []
        (with-ticket-lock opts path
          (fn []
            (let [ticket (ticket-data vault id)
                  board (read-text bpath)
                  old-card (card-for board id)
                  status (lanes lane)
                  rev (new-rev)
                  new-ticket (apply-ticket-update ticket {:rev rev :status status
                                                          :assignee "codex"
                                                          :closed ""
                                                          :append-note note
                                                          :note-source (or (:source opts) "codex request")})
                  card {:id id
                        :title (:title ticket)
                        :lane lane
                        :priority (or (:priority ticket) (:priority old-card) "medium")
                        :assignee "codex"
                        :repo (or (:repo ticket) (:repo old-card)) :rev rev}
                  new-board (insert-card board id card)
                  result {:action "request-codex" :rev rev :id id :lane lane :status status :assignee "codex" :dry-run (boolean (:dry-run opts))}]
              (when-not (:dry-run opts)
                (write-text! path new-ticket)
                (write-text! bpath new-board))
              (reset! result-atom result))))))
    (print-result opts @result-atom)))

(defn cmd-delete [opts id]
  (when-not (or (:dry-run opts) (:confirm opts))
    (die "delete requires --dry-run or --confirm"))
  (when (and (:dry-run opts) (:confirm opts))
    (die "delete cannot combine --dry-run and --confirm"))
  (let [vault (vault-path opts)
        path (ticket-path vault id)
        bpath (board-path vault)
        result-atom (atom nil)]
    (with-board-lock bpath
      (fn []
        (with-ticket-lock opts path
          (fn []
            (let [board (read-text bpath)
                  card (card-for board id)
                  new-board (str (str/join "\n" (remove-card (vec (str/split-lines board)) id)) "\n")
                  result {:action "delete" :id id :ticket-path (str path) :card card :dry-run (boolean (:dry-run opts))}]
              (when (and (:confirm opts) (not (:dry-run opts)))
                (fs/delete-if-exists path)
                (write-text! bpath new-board))
              (reset! result-atom result))))))
    (print-result opts @result-atom)))

(defn frontmatter-projection [ticket]
  (into {} (keep (fn [k]
                   (when-let [value (present (fm-get (:frontmatter-lines ticket) k))]
                     [k value]))
                 ["autonomy_version" "execution_intent" "control_revision"])))

(def restrictive-intents #{"pause" "cancel" "wait-human"})

;; The previewed request must be one the control store accepts as-is: the op
;; name, the exact key set, and the single role allowed to send it. An owner
;; changes intent with :update-control; the runner identity can only tighten it
;; with :restrict-intent, bound to its writer generation.
(defn control-intent-request [opts]
  (let [intent (:intent opts)
        actor (or (:actor opts) "owner")
        generation (:writer-generation opts)]
    (when-not (contains? (conj restrictive-intents "run") intent)
      (die "control-intent requires --intent run, pause, cancel, or wait-human"))
    (case actor
      "owner" (do (when generation
                    (die "--writer-generation only applies to --actor runner"))
                  {:op :update-control :intent intent})
      "runner" (do (when-not (contains? restrictive-intents intent)
                     (die "--actor runner can only request --intent pause, cancel, or wait-human"))
                   (when-not (and generation (re-matches #"[1-9][0-9]{0,8}" generation))
                     (die "--actor runner requires --writer-generation <positive integer>"))
                   {:op :restrict-intent :intent intent
                    :writer-generation (parse-long generation)})
      (die "control-intent requires --actor owner or runner"))))

;; Dry-run only. The control original lives behind an authenticated API that is
;; not deployed yet; this helper never edits a file to express intent, because
;; a file edit is not an authorization. Decision answers and retry changes have
;; no control store operation yet, so there is nothing to preview for them.
(defn cmd-control-intent [opts id]
  (when-not (:dry-run opts)
    (die "control-intent only supports --dry-run: the authenticated control API is not deployed, and editing vault files never grants authorization"))
  (let [revision (:expected-revision opts)
        _ (when-not (and revision (re-matches #"[1-9][0-9]{0,8}" revision))
            (die "control-intent requires --expected-revision <positive integer>"))
        request (control-intent-request opts)
        vault (vault-path opts)
        ticket (ticket-data vault id)
        card (card-for (read-text (board-path vault)) id)]
    (print-result opts {:action "control-intent"
                        :id id
                        :dry-run true
                        :request (assoc request :ticket id :expected-revision (parse-long revision))
                        :requires-actor (or (:actor opts) "owner")
                        :lane (:lane card)
                        :projection (frontmatter-projection ticket)
                        :writes []})))

(defn repair-sha [s]
  (apply str (map #(format "%02x" (bit-and 0xff %))
                  (.digest (MessageDigest/getInstance "SHA-256") (.getBytes s "UTF-8")))))

(defn repair-require [condition message]
  (when-not condition (die (str "reconcile-done: " message))))

(defn repair-owned-path! [path]
  ;; Never follow a symlink into another vault/source or write a root-owned path.
  (let [path (fs/path path)
        uid (Long/parseLong (str/trim (:out (shell/sh "id" "-u"))))]
    (repair-require (and (fs/exists? path)
                         (= (str (fs/absolutize path)) (str (fs/canonicalize path)))
                         (= uid (java.nio.file.Files/getAttribute path "unix:uid"
                                   (make-array java.nio.file.LinkOption 0))))
                    (str "unsafe path or UID: " path))))

(defn repair-source [root id]
  (repair-owned-path! (fs/path root "locks"))
  (repair-require (not (or (fs/exists? (fs/path root "locks" (str id ".edn")))
                           (fs/sym-link? (fs/path root "locks" (str id ".edn")))))
                  "active or unresolved source claim")
  (let [runs (sort (map str (fs/list-dir (fs/path root "runs" id))))
        run (last runs)
        _ (repair-require (some? run) "missing source run")
        _ (doseq [path [(fs/path root "runs") (fs/path root "runs" id) (fs/path run)
                         (fs/path run "summary.edn")]] (repair-owned-path! path))
        raw (read-text (fs/path run "summary.edn"))
        summary (try
                  (with-open [reader (PushbackReader. (StringReader. raw))]
                    (let [value (edn/read {:eof ::end} reader)]
                      (when (= ::end (edn/read {:eof ::end} reader)) value)))
                  (catch Exception _ nil))]
    (repair-require (and (= id (:ticket summary))
                         (re-matches #"[0-9]{8}T[0-9]{6}Z-[a-f0-9-]{36}" (str (fs/file-name run)))
                         (= (str (fs/file-name run)) (:run-id summary))
                         (= :succeeded (:status summary)) (= "done" (:result summary))
                         (try (java.time.Instant/parse (:finished-at summary))
                              (catch Exception _ false)))
                    "latest source run is not proven succeeded/done")
    {:run-id (:run-id summary) :sha256 (repair-sha raw)}))

(defn repair-board [board ticket]
  (repair-require (not (str/includes? board "\r")) "CRLF board is unsupported")
  (let [id (:id ticket)
        ;; Preserve every byte outside the exact stale line, including terminal blanks.
        lines (str/split board #"\n" -1)
        _ (doseq [lane ["In Progress" "Done"]]
            (repair-require (= 1 (count (filter (fn [line] (= line (str "## " lane))) lines)))
                            "missing or duplicate lane heading"))
        candidates (loop [xs lines idx 0 lane nil cards []]
                     (if (empty? xs) cards
                       (let [line (first xs)
                             heading (second (re-find #"^##\s+(.+?)\s*$" line))
                             lane (if heading (when (contains? readable-lanes heading) heading) lane)
                             related? (str/includes? line (str "[[Tickets/" id))
                             card (when (and lane related?) (parse-card lane line))]
                         (when (and lane related?)
                           (repair-require (and card (= id (:id card))
                                                (= line (card-line (assoc card :repo (:repo card)))))
                                           "ambiguous, malformed or annotated target card"))
                         (recur (rest xs) (inc idx) lane
                                (cond-> cards card (conj (assoc card :index idx)))))))
        matches-ticket? (fn [card]
                          (and (= (:title ticket) (:title card))
                               (= (:rev ticket) (:rev card))
                               (= (:priority ticket) (:priority card))
                               (= (repo-values (:repo ticket)) (:repo card))))
        done (filter #(and (= "Done" (:lane %)) (= "done" (:status %))
                           (:done %) (= "boxp" (:assignee %))
                           (= (fm-get (:frontmatter-lines ticket) "closed") (:done-date %))
                           (matches-ticket? %)) candidates)
        stale (filter #(and (= "In Progress" (:lane %)) (= "in-progress" (:status %))
                            (not (:done %)) (nil? (:done-date %))
                            (= "claude-opus" (:assignee %)) (matches-ticket? %)) candidates)]
    (repair-require (and (= 1 (count done)) (<= (count stale) 1)
                         (= (count candidates) (+ 1 (count stale))))
                    "expected one canonical Done card and at most one matching stale card")
    (doseq [card stale]
      (let [next-line (get lines (inc (:index card)) "")]
        (repair-require (or (str/blank? next-line) (card-line? next-line)
                            (str/starts-with? next-line "## ")) "stale card has attached content")))
    {:candidates candidates :kept (first done) :removed (vec stale)
     :after (str/join "\n" (keep-indexed
                               (fn [idx line] (when-not (= idx (:index (first stale))) line)) lines))}))

(defn repair-audit! [vault record]
  (let [path (fs/path vault ".task-board-repair-audit.edn")]
    (when (fs/exists? path) (repair-owned-path! path))
    (spit (str path) (str (pr-str (assoc record :at (str (java.time.Instant/now)))) "\n") :append true)
    (with-open [raf (RandomAccessFile. (str path) "rw")] (.force (.getChannel raf) true))))

(defn repair-exchange! [a b]
  ;; renameat2(RENAME_EXCHANGE): both names keep a file, so the content this
  ;; replacement displaced is preserved and can be compared afterwards.
  (let [{:keys [exit err]} (shell/sh "mv" "--exchange" "--no-target-directory" "--" (str a) (str b))]
    (repair-require (zero? exit) (str "atomic exchange failed: " (str/trim (str err))))))

(defn repair-exchange-supported? [dir]
  (let [a (fs/path dir (str ".reconcile-433-probe-" (random-uuid) ".a"))
        b (fs/path dir (str ".reconcile-433-probe-" (random-uuid) ".b"))]
    (try
      (spit (str a) "a") (spit (str b) "b")
      (and (zero? (:exit (shell/sh "mv" "--exchange" "--no-target-directory" "--" (str a) (str b))))
           (= "b" (slurp (str a))) (= "a" (slurp (str b))))
      (catch Exception _ false)
      (finally (fs/delete-if-exists a) (fs/delete-if-exists b)))))

(defn repair-settle-ms []
  (try (Long/parseLong (or (System/getenv "CODEX_TASK_BOARD_RECONCILE_SETTLE_MS") "1000"))
       (catch Exception _ 1000)))

(defn repair-holder-wait-ms []
  (try (Long/parseLong (or (System/getenv "CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS") "30000"))
       (catch Exception _ 30000)))

(defn repair-file-key [p]
  (try (.fileKey (java.nio.file.Files/readAttributes (fs/path p) java.nio.file.attribute.BasicFileAttributes
                   (make-array java.nio.file.LinkOption 0)))
       (catch Exception _ nil)))

(defn repair-proc-uid [proc]
  (try (java.nio.file.Files/getAttribute (fs/path proc) "unix:uid"
                                         (make-array java.nio.file.LinkOption 0))
       (catch Exception _ nil)))

(defn repair-proc-label [proc]
  (str (fs/file-name proc) "("
       (or (try (str/trim (first (java.nio.file.Files/readAllLines (fs/path proc "comm"))))
                (catch Exception _ nil)) "?")
       ")"))

(defn repair-scan-holders
  "Scan /proc for the inode at `p`. Returns {:holders [...] :uninspected [...]}
  as pid(comm) labels. Processes of another UID are only considered when the
  inode is group/other writable: task-board writers run as this non-root UID
  (root is refused) and an owner-only-writable inode cannot be written by
  another non-root UID. A process whose fd table the kernel refuses to show to
  this same user (different saved ids/capabilities, non-dumpable, LSM) is
  reported as uninspected; the caller treats it as a possible holder unless
  the kernel write lease proves no writer remains. Vanished PIDs are ignored."
  [p]
  (let [k (repair-file-key p)
        uid (Long/parseLong (str/trim (:out (shell/sh "id" "-u"))))
        mode (try (java.nio.file.Files/getAttribute (fs/path p) "unix:mode"
                                                    (make-array java.nio.file.LinkOption 0))
                  (catch Exception _ nil))
        foreign-writable? (or (nil? mode) (not (zero? (bit-and mode 2r000010010))))]
    (repair-require k (str "cannot identify displaced board inode " p))
    (reduce (fn [acc proc]
              (let [owner (repair-proc-uid proc)]
                (if-not (or foreign-writable? (nil? owner) (= uid owner))
                  acc
                  (let [fds (try (vec (fs/list-dir (fs/path proc "fd")))
                                 (catch java.nio.file.NoSuchFileException _ [])
                                 (catch Exception _ (when (fs/exists? proc) ::unknown)))]
                    (cond
                      (= ::unknown fds) (update acc :uninspected conj (repair-proc-label proc))
                      (some #(= k (repair-file-key %)) fds) (update acc :holders conj (repair-proc-label proc))
                      :else acc)))))
            {:holders [] :uninspected []}
            (filter #(re-matches #"\d+" (str (fs/file-name %))) (fs/list-dir "/proc")))))

(def repair-lease-probe
  ;; F_SETLEASE is not reachable from the JVM. A read lease is granted only
  ;; while no process on this host -- any UID, dumpable or not -- has the inode
  ;; open for writing (or mapped writable), so it proves that no writer can
  ;; still write into the displaced inode. Exit 0 free, 3 open for write,
  ;; 4 unavailable (no python3, unsupported filesystem, leases disabled).
  "import errno, fcntl, os, sys
F_SETLEASE = getattr(fcntl, 'F_SETLEASE', 1024)
try:
    fd = os.open(sys.argv[1], os.O_RDONLY)
except OSError:
    sys.exit(4)
try:
    fcntl.fcntl(fd, F_SETLEASE, fcntl.F_RDLCK)
except OSError as e:
    sys.exit(3 if e.errno in (errno.EAGAIN, errno.EBUSY) else 4)
fcntl.fcntl(fd, F_SETLEASE, fcntl.F_UNLCK)
")

(defn repair-write-lease
  "Kernel check whether any process still has the inode at `p` open for
  writing: :free, :busy or :unavailable."
  [p]
  (if (= "true" (System/getenv "CODEX_TASK_BOARD_TEST_RECONCILE_NO_LEASE"))
    :unavailable
    (let [r (try (shell/sh "python3" "-I" "-c" repair-lease-probe (str p))
                 (catch Exception _ {:exit 4}))]
      (case (:exit r) 0 :free 3 :busy :unavailable))))

(defn repair-wait-holders!
  "Wait until no process can still write into the displaced inode. After that
  no write can reach it any more (its old name now resolves to the new Board),
  so comparing its content afterwards is final for this host. The proof is a
  kernel read lease (repair-write-lease), which also covers same-UID writers
  whose fd table /proc hides (non-dumpable etc.). Only when leases are
  unavailable does the /proc scan decide, and then a process whose fd table
  cannot be inspected counts as a holder (fail closed). Returns the remaining
  holders (empty on success)."
  [p]
  (let [deadline (+ (System/currentTimeMillis) (repair-holder-wait-ms))]
    (loop []
      (let [lease (repair-write-lease p)
            holders (if (= :free lease)
                      []
                      (let [{:keys [holders uninspected]} (repair-scan-holders p)
                            hs (into holders (map #(str % "[fd table not inspectable]") uninspected))]
                        (if (and (= :busy lease) (empty? hs))
                          ["(open for write by a process hidden from /proc)"]
                          hs)))]
        (if (or (empty? holders) (> (System/currentTimeMillis) deadline))
          holders
          (do (Thread/sleep 100) (recur)))))))

(defn repair-retained-dir [vault]
  ;; Inside the vault so displaced Board inodes stay on the same filesystem and
  ;; can be renamed (not copied): a writer still holding the old inode open
  ;; keeps writing into the retained file instead of a deleted one.
  (let [dir (fs/path vault ".task-board-repair-retained")]
    (when (fs/exists? dir) (repair-owned-path! dir))
    (fs/create-dirs dir)
    (repair-owned-path! dir)
    dir))

(defn repair-retain! [tmp retain-dir label]
  ;; Never delete an inode that has been the live Board. Rename it (same inode)
  ;; into the retained dir; if that is impossible keep it where it is.
  (let [dst (fs/path retain-dir (str "BOXP-433-" (random-uuid) "-" label ".md"))]
    (try
      (java.nio.file.Files/move tmp dst
        (into-array java.nio.file.CopyOption [java.nio.file.StandardCopyOption/ATOMIC_MOVE]))
      (str dst)
      (catch Exception _ (str tmp)))))

(defn repair-check-retained!
  "Late-write detection: a writer that opened the Board before the exchange
  and wrote after the settle delay changed a retained displaced inode. Every
  retained inode must still hold exactly the content recorded at apply time."
  [vault]
  (let [path (fs/path vault ".task-board-repair-audit.edn")]
    (if-not (fs/exists? path)
      0
      (do
        (repair-owned-path! path)
        (let [records (keep (fn [line]
                              (when-not (str/blank? line)
                                (let [record (try (edn/read-string line) (catch Exception _ ::bad))]
                                  (repair-require (map? record) "unreadable repair audit record")
                                  (when (:retained-path record) record))))
                            (str/split-lines (read-text path)))]
          (doseq [{:keys [retained-path retained-sha256]} records]
            (repair-require (fs/exists? retained-path)
                            (str "retained displaced board missing: " retained-path))
            (repair-owned-path! retained-path)
            (repair-require (= retained-sha256 (repair-sha (read-text retained-path)))
                            (str "late concurrent write detected in retained displaced board " retained-path
                                 "; merge it into the Board manually before any further repair")))
          (count records))))))

(defn repair-atomic-board!
  "Replace the board with `after` only if the replaced content was exactly
  `before`. With an atomic exchange the displaced file is kept and compared
  after a settle delay (covering an in-place write already in flight), so a
  runner/Sync write that landed after the last check is detected and put
  back instead of being silently overwritten. Displaced inodes are never
  deleted: they are renamed into `retain-dir` so a writer that still holds
  one open writes into a retained file that later runs check
  (repair-check-retained!). Without exchange support only a shared writer
  lock may fall back to a plain atomic move. Returns {:conflict nil
  :retained [...]} or {:conflict reason :preserved [paths] :retained [...]}."
  [path before after {:keys [exchange? preserve-dir retain-dir]}]
  (let [tmp (fs/path (fs/parent path) (str ".reconcile-433-" (random-uuid) ".tmp"))
        exchanged? (atom false)
        preserve! (fn [label src]
                    (let [dst (fs/path preserve-dir (str "BOXP-433-" (random-uuid) "-" label ".md"))]
                      (spit (str dst) (read-text src))
                      (str dst)))
        retain! (fn [label]
                  (let [content (read-text tmp)]
                    [{:retained-path (repair-retain! tmp retain-dir label)
                      :retained-sha256 (repair-sha content)}]))]
    (try
      (spit (str tmp) after)
      (with-open [raf (RandomAccessFile. (str tmp) "rw")] (.force (.getChannel raf) true))
      (java.nio.file.Files/setPosixFilePermissions tmp
        (java.nio.file.Files/getPosixFilePermissions (fs/path path)
          (make-array java.nio.file.LinkOption 0)))
      (repair-require (= before (read-text path)) "board changed before atomic replacement")
      (when (= "true" (System/getenv "CODEX_TASK_BOARD_TEST_RECONCILE_CONCURRENT_WRITE"))
        ;; Deterministic hook: another writer replaces the board after the check.
        (let [other (fs/path (fs/parent path) (str ".reconcile-433-other-" (random-uuid) ".tmp"))]
          (spit (str other) (str before "concurrent writer\n"))
          (java.nio.file.Files/move other (fs/path path)
            (into-array java.nio.file.CopyOption [java.nio.file.StandardCopyOption/ATOMIC_MOVE
                                                 java.nio.file.StandardCopyOption/REPLACE_EXISTING]))))
      (if exchange?
        (do
          (repair-exchange! tmp path)
          (reset! exchanged? true)
          (Thread/sleep (repair-settle-ms))
          (let [displaced (read-text tmp)]
            (if (= displaced before)
              (let [rpath (if (= "true" (System/getenv "CODEX_TASK_BOARD_TEST_RECONCILE_LATE_WRITE"))
                            ;; Deterministic hook: a writer opened the old inode before the
                            ;; exchange and writes through that descriptor after the settle delay.
                            (with-open [out (java.io.FileOutputStream. (str tmp) true)]
                              (let [r (repair-retain! tmp retain-dir "displaced")]
                                (.write out (.getBytes "late writer\n" "UTF-8"))
                                r))
                            (repair-retain! tmp retain-dir "displaced"))
                    ;; The command must not report success while a writer can
                    ;; still write into the displaced inode: wait for every
                    ;; descriptor on it to close, then compare once more.
                    holders (repair-wait-holders! rpath)
                    final (read-text rpath)]
                (if (and (empty? holders) (= final before))
                  {:conflict nil :retained [{:retained-path rpath :retained-sha256 (repair-sha final)}]}
                  ;; Late write or a still-open descriptor: put the displaced
                  ;; inode back as the live Board so the writer's update (now or
                  ;; later) lands in the real Board. Every version is preserved.
                  (let [reason (if (seq holders)
                                 (str "displaced board still open by pid " (str/join "," holders)
                                      "; original board restored")
                                 "late write to displaced board; writer content restored")
                        displaced-copy (preserve! "late-displaced" rpath)]
                    (if (= after (read-text path))
                      (do (repair-exchange! rpath path)
                          (let [now (read-text rpath)]
                            {:conflict reason :preserved [displaced-copy]
                             :retained [{:retained-path rpath :retained-sha256 (repair-sha now)}]}))
                      {:conflict (str reason " failed: board replaced again; merge " displaced-copy " manually")
                       :preserved [displaced-copy]
                       :retained [{:retained-path rpath :retained-sha256 (repair-sha (read-text rpath))}]}))))
              ;; Someone else wrote between the check and the exchange: put
              ;; their content back. If the board changed again meanwhile,
              ;; restore that newest content too; every version is preserved.
              (let [displaced-copy (preserve! "displaced" tmp)]
                (repair-exchange! tmp path)
                (let [returned (read-text tmp)]
                  (if (= returned after)
                    {:conflict "board changed concurrently; concurrent content restored"
                     :preserved [displaced-copy] :retained (retain! "replaced")}
                    (let [returned-copy (preserve! "newer" tmp)]
                      (repair-exchange! tmp path)
                      {:conflict "board changed repeatedly during repair; newest content restored"
                       :preserved [displaced-copy returned-copy] :retained (retain! "replaced")})))))))
        (do
          (java.nio.file.Files/move tmp (fs/path path)
            (into-array java.nio.file.CopyOption [java.nio.file.StandardCopyOption/ATOMIC_MOVE
                                                 java.nio.file.StandardCopyOption/REPLACE_EXISTING]))
          {:conflict nil}))
      ;; Only a temp file that never became the live Board may be deleted.
      (finally (when-not @exchanged? (fs/delete-if-exists tmp))))))

(defn cmd-reconcile-done [opts id]
  ;; Deliberately no general force/dedupe operation. This is the approved 433 repair.
  (repair-require (= "BOXP-433" id) "only BOXP-433 is sanctioned")
  (repair-require (= [id] (:positionals opts)) "unexpected arguments")
  (repair-require (every? #{:positionals :vault :source-root :dry-run :json :confirm :expected-rev
                            :expected-ticket-sha256 :expected-board-sha256 :expected-after-board-sha256
                            :expected-source-sha256 :expected-helper-sha256} (keys opts))
                  "unsupported option for sanctioned repair")
  (let [repair-result-backup (atom nil)
        vault (fs/absolutize (vault-path opts))
        root (some-> (:source-root opts) fs/absolutize)
        writer (present (System/getenv "TASK_BOARD_VAULT_WRITER_LOCK_DIR"))
        _ (repair-require root "--source-root required")
        _ (repair-require (not (.startsWith (.normalize root) (.normalize vault))) "source-root must be outside vault")
        guard (fs/path root "lock-guards" (str id ".lock"))
        bpath (board-path vault)
        tpath (ticket-path vault id)]
    (doseq [path (concat [vault root guard bpath tpath] (when writer [(fs/path writer) (fs/path writer "vault-writer.lock")]))] (repair-owned-path! path))
    ;; Same source guard as runner acquire/release. Never edit claims or stale locks.
    (with-open [raf (RandomAccessFile. (str guard) "rw") channel (.getChannel raf)]
      (let [_source-lock (.lock channel)]
        ;; The outer CLI wrapper must NOT take writer lock first: runner acquires
        ;; source guard before committing vault changes as well.
        ((fn [f]
           ;; Require an existing shared domain; never silently invent a new one.
           (if writer
             (with-open [file (RandomAccessFile. (str (fs/path writer "vault-writer.lock")) "rw")
                         writer-channel (.getChannel file)]
               (let [_writer-lock (.lock writer-channel)] (f)))
             (f)))
          #(with-board-lock bpath
             (fn []
               (with-ticket-lock opts tpath
                 (fn []
                   (let [retained-checked (repair-check-retained! vault)
                         board (read-text bpath) ticket (ticket-data vault id)
                         source (repair-source root id)
                         helper-sha (repair-sha (read-text *file*))
                         ticket-sha (repair-sha (read-text tpath))
                         _ (repair-require (and (= id (fm-get (:frontmatter-lines ticket) "id"))
                                                (= "done" (:status ticket)) (= "boxp" (:assignee ticket))
                                                (every? (fn [k] (= 1 (count (filter (fn [line] (str/starts-with? line (str k ":")))
                                                                                   (:frontmatter-lines ticket)))))
                                                        ["id" "status" "assignee" "board_rev" "priority" "repo" "closed"])
                                                (seq (:rev ticket))
                                                (re-matches #"[0-9]{4}-[0-9]{2}-[0-9]{2}"
                                                  (or (fm-get (:frontmatter-lines ticket) "closed") "")))
                                           "ticket is not done/boxp with revision and closed date")
                         {:keys [after] :as change} (repair-board board ticket)
                         hashes {:ticket-sha256 ticket-sha :board-sha256 (repair-sha board)
                                 :after-board-sha256 (repair-sha after)
                                 :source-sha256 (:sha256 source) :helper-sha256 helper-sha}
                         result (merge (dissoc change :after) hashes
                                  {:action "reconcile-done" :id id :rev (:rev ticket)
                                   :status "done" :assignee "boxp" :source-run (:run-id source)
                                   :writer-lock (if writer "shared" "none")
                                   :retained-checked retained-checked
                                   :dry-run (boolean (:dry-run opts)) :noop (= board after)})]
                     (when-not (:dry-run opts)
                       (repair-require (:confirm opts) "apply requires --confirm")
                       (doseq [[k value] (assoc (dissoc hashes :board-sha256) :rev (:rev ticket))]
                         (repair-require (= value (get opts (keyword (str "expected-" (name k)))))
                                         (str "expectation mismatch: " (name k))))
                       (repair-require (and (re-matches #"[a-f0-9]{64}" (or (:expected-board-sha256 opts) ""))
                                            (or (= (:board-sha256 hashes) (:expected-board-sha256 opts))
                                                (and (= board after)
                                                     (= (:board-sha256 hashes) (:expected-after-board-sha256 opts)))))
                                       "board expectation mismatch")
                       (repair-require (= source (repair-source root id)) "source changed")
                       (repair-require (= ticket-sha (repair-sha (read-text tpath))) "ticket changed")
                       (when-not (= board after)
                         (let [dir (fs/path root "repair-backups")
                               _ (when (fs/exists? dir) (repair-owned-path! dir))
                               _ (fs/create-dirs dir)
                               _ (repair-owned-path! dir)
                               exchange? (repair-exchange-supported? dir)
                               _ (repair-require (or exchange? writer)
                                                 "atomic exchange (mv --exchange) unavailable and no shared writer lock; refusing unsafe replacement")
                               stamp (.format (java.time.ZonedDateTime/now java.time.ZoneOffset/UTC)
                                              (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmssSSS'Z'"))
                               backup (fs/path dir (str id "-" stamp "-board.md"))]
                           (java.nio.file.Files/createFile backup
                             (into-array java.nio.file.attribute.FileAttribute
                               [(java.nio.file.attribute.PosixFilePermissions/asFileAttribute
                                  (java.nio.file.attribute.PosixFilePermissions/fromString "rw-------"))]))
                           (with-open [out (java.io.FileOutputStream. (.toFile backup))]
                             (.write out (.getBytes board "UTF-8"))
                             (.force (.getChannel out) true))
                           (repair-require (= (:board-sha256 hashes) (repair-sha (read-text backup))) "backup hash mismatch")
                           (repair-audit! vault (assoc hashes :phase :prepared :id id :rev (:rev ticket)
                                                     :backup-path (str backup) :source-run (:run-id source)))
                           (let [{:keys [conflict preserved retained]} (repair-atomic-board! bpath board after
                                                                {:exchange? exchange? :preserve-dir dir
                                                                 :retain-dir (when exchange? (repair-retained-dir vault))})]
                             ;; One audit line per retained inode so later runs can detect late writes.
                             (doseq [r retained]
                               (repair-audit! vault (assoc r :phase :retained :id id :backup-path (str backup))))
                             (when conflict
                               (repair-audit! vault (assoc hashes :phase :conflict :id id :reason conflict
                                                         :preserved preserved :backup-path (str backup)))
                               (die (str "reconcile-done: " conflict "; nothing applied; backup at " backup
                                         "; preserved " (str/join ", " preserved)))))
                           (when (= "true" (System/getenv "CODEX_TASK_BOARD_TEST_RECONCILE_READBACK_MISMATCH"))
                             (spit (str bpath) "test readback mismatch"))
                           (let [observed (read-text bpath)]
                             (if (= observed after)
                               (repair-audit! vault (assoc hashes :phase :applied :id id :rev (:rev ticket)))
                               (do (repair-audit! vault (assoc hashes :phase :conflict :id id :observed-sha256 (repair-sha observed)))
                                   (die (str "reconcile-done: post-apply readback mismatch; backup at " backup)))))
                           (reset! repair-result-backup (str backup)))))
                     (print-result opts (cond-> result @repair-result-backup (assoc :backup-path @repair-result-backup)))))))))))))

(defn usage []
  (die "Usage: task-board.bb <list|show|create|update|append-note|request-codex|verify-dispatch|delete|control-intent|reconcile-done> [args]\nverify-dispatch ID --expected-rev R [--assignee A] [--json]: started/awaiting-pickup (0), duplicate-cards (3), reverted (4), pending-sync (5), unknown (6)"))

(defn root-user? []
  (let [uid (try
              (let [{:keys [exit out]} (shell/sh "id" "-u")
                    value (str/trim out)]
                (when (and (zero? exit) (re-matches #"[0-9]+" value)) value))
              (catch Exception _ nil))]
    (if uid
      (boolean (re-matches #"0+" uid))
      (= "root" (System/getProperty "user.name")))))

(defn guard-root-write! [cmd]
  (when (and (#{"create" "update" "append-note" "request-codex" "delete" "reconcile-done"} cmd)
             (root-user?))
    (die (str "Root cannot run Task Board write commands (including --dry-run). Use:\n"
              "kubectl -n hermes-agent exec deploy/hermes-agent -c hermes-agent -- /command/s6-setuidgid hermes bb /opt/data/skills/note-taking/obsidian-task-board/bin/task-board.bb <command> ..."))))

(defn -main [& args]
  (guard-root-write! (first args))
  (let [cmd (first args)
        opts (parse-args (rest args))
        id (first (:positionals opts))]
    (case cmd
      "reconcile-done" (cmd-reconcile-done opts (or id (die "reconcile-done requires ticket id")))
      "list" (cmd-list opts)
      "verify-dispatch" (cmd-verify-dispatch opts (or id (die "verify-dispatch requires ticket id")))
      "show" (cmd-show opts (or id (die "show requires ticket id")))
      "create" (with-vault-writer-lock opts #(cmd-create opts))
      "update" (let [id (or id (die "update requires ticket id"))]
                 (with-vault-writer-lock opts #(cmd-update opts id)))
      "append-note" (let [id (or id (die "append-note requires ticket id"))]
                      (with-vault-writer-lock opts #(cmd-append-note opts id)))
      "request-codex" (let [id (or id (die "request-codex requires ticket id"))]
                        (with-vault-writer-lock opts #(cmd-request-codex opts id)))
      "delete" (let [id (or id (die "delete requires ticket id"))]
                 (with-vault-writer-lock opts #(cmd-delete opts id)))
      "control-intent" (cmd-control-intent opts (or id (die "control-intent requires ticket id")))
      (usage))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
