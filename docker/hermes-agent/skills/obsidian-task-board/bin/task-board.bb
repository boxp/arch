#!/usr/bin/env bb

(ns task-board
  (:require [babashka.fs :as fs]
            [clojure.string :as str])
  (:import [java.io RandomAccessFile]
           [java.security MessageDigest]))

(def lanes
  {"Backlog" "backlog"
   "Ready" "ready"
   "In Progress" "in-progress"
   "Review" "review"
   "Blocked" "blocked"
   "Done" "done"})

(def status->lane (into {} (map (fn [[lane status]] [status lane]) lanes)))

(def codex-request-lanes #{"Backlog" "Ready" "Review" "Blocked"})

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
          "--expected-revision" (recur (nnext xs) (assoc opts :expected-revision (first more)))
          "--actor" (recur (nnext xs) (assoc opts :actor (first more)))
          "--writer-generation" (recur (nnext xs) (assoc opts :writer-generation (first more)))
          "--priority" (recur (nnext xs) (assoc opts :priority (first more)))
          "--assignee" (recur (nnext xs) (assoc opts :assignee (first more)))
          "--repo" (recur (nnext xs) (assoc opts :repo (first more)))
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

(defn with-ticket-lock [ticket-path f] (with-file-lock ticket-path f))
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
     :repo (fm-get frontmatter-lines "repo")}))

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
            lane (if (contains? lanes heading) heading lane)
            card (and lane (parse-card lane line))]
        (recur (rest lines) lane (cond-> cards card (conj card)))))))

(defn card-for [board id]
  (let [cards (filter #(= id (:id %)) (board-cards board))]
    (when (> (count cards) 1)
      (die (str "Multiple board cards found for " id)))
    (first cards)))

(defn remove-card [lines id]
  (vec (remove #(str/includes? % (str "[[Tickets/" id "|")) lines)))

(defn repo-values [repo]
  (cond
    (nil? repo) []
    (sequential? repo) (vec (remove str/blank? repo))
    :else (vec (remove str/blank? (map str/trim (str/split (str repo) #","))))))

(defn card-line [{:keys [id title lane priority assignee repo done done-date]}]
  (let [status (lanes (require-lane lane))
        checkbox (if (or done (= lane "Done")) "x" " ")
        done-date (or done-date (when (= lane "Done") (now-date)))
        meta (cond-> [(str "status::" status)
                      (str "priority::" (or priority "medium"))]
               (seq assignee) (conj (str "assignee::" assignee))
               (seq (repo-values repo)) (into (map #(str "repo::" %) (repo-values repo))))]
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
                            {"status" status
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

(defn create-ticket-content [{:keys [id title summary acceptance context plan notes priority assignee repo lane closed-date]}]
  (let [status (lanes lane)]
    (str "---\n"
         "id: " id "\n"
         "type: task\n"
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
        card (card-for board id)]
    (print-result opts {:ticket (select-keys ticket [:id :path :title :status :priority :assignee :repo])
                        :card card})))

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
              ticket-content (create-ticket-content (assoc opts :id id :title title :lane lane :closed-date done-date))
              card {:id id :title title :lane lane :priority (:priority opts) :assignee (:assignee opts) :repo (:repo opts) :done-date done-date}
              new-board (insert-card board id card)
              result {:action "create" :id id :ticket-path (str path) :lane lane :dry-run (boolean (:dry-run opts))}]
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
        (with-ticket-lock path
          (fn []
            (let [ticket (ticket-data vault id)
                  board (read-text bpath)
                  old-card (card-for board id)
                  lane (or (:lane opts) (:lane old-card) (status->lane (:status ticket)) "Backlog")
                  status (lanes (require-lane lane))
                  title (or (:title opts) (:title ticket))
                  done-date (or (present (:done-date old-card))
                                (present (fm-get (:frontmatter-lines ticket) "closed"))
                                (when (= lane "Done") (now-date)))
                  updates {:title (:title opts)
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
                        :done-date done-date}
                  new-board (insert-card board id card)
                  result {:action "update" :id id :lane lane :status status :dry-run (boolean (:dry-run opts))}]
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
        (with-ticket-lock path
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
      (die "request-codex lane must be one of Backlog, Ready, Review, or Blocked"))
    (with-board-lock bpath
      (fn []
        (with-ticket-lock path
          (fn []
            (let [ticket (ticket-data vault id)
                  board (read-text bpath)
                  old-card (card-for board id)
                  status (lanes lane)
                  new-ticket (apply-ticket-update ticket {:status status
                                                          :assignee "codex"
                                                          :closed ""
                                                          :append-note note
                                                          :note-source (or (:source opts) "codex request")})
                  card {:id id
                        :title (:title ticket)
                        :lane lane
                        :priority (or (:priority ticket) (:priority old-card) "medium")
                        :assignee "codex"
                        :repo (or (:repo ticket) (:repo old-card))}
                  new-board (insert-card board id card)
                  result {:action "request-codex" :id id :lane lane :status status :assignee "codex" :dry-run (boolean (:dry-run opts))}]
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
        (with-ticket-lock path
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

(defn usage []
  (die "Usage: task-board.bb <list|show|create|update|append-note|request-codex|delete|control-intent> [args]"))

(defn -main [& args]
  (let [cmd (first args)
        opts (parse-args (rest args))
        id (first (:positionals opts))]
    (case cmd
      "list" (cmd-list opts)
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

(apply -main *command-line-args*)
