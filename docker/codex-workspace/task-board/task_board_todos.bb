#!/usr/bin/env bb
(ns task-board-todos
  (:require [clojure.string :as str] [clojure.edn :as edn] [cheshire.core :as json] [babashka.fs :as fs] [clojure.java.shell :as shell])
  (:import [java.security MessageDigest] [java.io RandomAccessFile] [java.nio.file Files StandardCopyOption] [java.time Instant]))

(defn sha [s] (apply str (map #(format "%02x" (bit-and 255 %)) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8")))))
(defn norm [s] (str/trim (str/replace (or s "") #"\s+" " ")))
(defn section [text name]
  (or (second (re-find (re-pattern (str "(?ms)^## " (java.util.regex.Pattern/quote name) "[ \\t]*\\r?\\n(.*?)(?=^## |\\z)")) text)) ""))
(defn frontmatter [text]
  (into {} (keep (fn [line] (when-let [[_ k v] (re-matches #"([^:]+):\s*(.*?)\s*" line)] [k (str/replace v #"^[\"']|[\"']$" "")])) (str/split-lines (or (second (re-find #"(?s)^---\s*\n(.*?)\n---" text)) "")))))
(defn parse-items [text]
  (let [lines (str/split-lines (section text "Plan"))
        items (loop [ls lines fence nil out []]
                (if-let [line (first ls)]
                  (let [f (re-find #"^\s*(```+|~~~+)" line)]
                    (cond
                      f (recur (rest ls) (if fence nil (second f)) out)
                      fence (recur (rest ls) fence out)
                      (re-find #"^\s+[-*] \[[ xX]\]" line) (recur (rest ls) fence out)
                      (and (seq out) (re-find #"^\s+\S" line)) (recur (rest ls) fence (update-in out [(dec (count out)) :children] conj line))
                      (re-find #"^[-*] \[[ xX]\] TD-\d+" line)
                      (let [[_ mark id tag body] (re-matches #"^[-*] \[([ xX])\] (TD-\d+)【(必須|任意|取消)】(\S.*|)\s*" line)
                            id (or id (second (re-find #"(TD-\d+)" line)))]
                        (recur (rest ls) fence (conj out {:id id :tag (case tag "必須" :required "任意" :optional "取消" :cancelled :invalid) :text (or body line) :checked? (boolean (and mark (not= mark " "))) :line line :children []})))
                      (re-find #"^.*?TD-\d+" line) (if-let [[_ id] (re-find #"^(?![>\s])(.*?TD-\d+)" line)]
                                                         (recur (rest ls) fence (conj out {:id (second (re-find #"(TD-\d+)" id)) :tag :invalid :text line :line line :children []}))
                                                         (recur (rest ls) fence out))
                      :else (recur (rest ls) fence out))) out))
        counts (frequencies (map :id items))]
    (mapv #(if (> (counts (:id %)) 1) (assoc % :tag :invalid) %) items)))
(defn item-hash [item]
  (sha (str/join "|" [(:id item) (name (:tag item)) (norm (:text item))
                       (->> (:children item) (remove #(re-find #"^\s*[-*]\s*(証拠|見送り|取消理由|由来):" %)) (map norm) (str/join " "))])))
(defn body-hash [text mode]
  (sha (norm (str (section text "Summary") " " (section text "Acceptance Criteria")
                  (when (= mode :legacy) (str " " (str/replace (section text "Plan") #"\[[ xX]\]" "[ ]")))))))
(defn revision [hashes] (subs (sha (str/join "\n" (map (fn [[k v]] (str k "=" v)) (sort-by key hashes)))) 0 12))
(defn ticket-view [text]
  (let [fm (frontmatter text) mode (if (= "v1" (get fm "todo_contract")) :v1 :legacy)
        items (if (= mode :v1) (parse-items text) [])
        hashes (into {"_BODY" (body-hash text mode)} (map (juxt :id item-hash) items))
        ack (into {} (keep #(let [[k v] (str/split % #":" 2)] (when (and k v) [k v])) (str/split (get fm "todo_ack_items" "") #",")))
        same? (fn [id] (= (get ack id) (some-> (get hashes id) (subs 0 8))))
        items (mapv (fn [i] (assoc i :hash (get hashes (:id i)) :state (cond (= :cancelled (:tag i)) :deferred (and (= :optional (:tag i)) (some #(re-find #"^\s*[-*]\s*見送り:" %) (:children i))) :deferred (not (same? (:id i))) :unreceived (and (:checked? i) (some #(re-find #"^\s*[-*]\s*証拠:\s*\S" %) (:children i))) :verified :else :received))) items)
        added (vec (sort (remove #(contains? ack %) (keys hashes))))
        changed (vec (sort (filter #(and (contains? ack %) (not (same? %))) (keys hashes))))
        removed (vec (sort (remove #(contains? hashes %) (keys ack))))]
    {:mode mode :items items :hashes hashes :rev (revision hashes) :ack ack :ack-rev (get fm "todo_ack_rev") :diff {:added added :changed changed :removed removed}}))
(defn gate-decision [{:keys [view start-rev result]}]
  (let [{:keys [mode items rev ack-rev diff ack]} view
        ids (if (= mode :legacy)
              (if (and (not= rev start-rev) (not= rev ack-rev)) ["_BODY"] [])
              (vec (distinct (concat
                (when (not= (get ack "_BODY") (subs (get-in view [:hashes "_BODY"]) 0 8)) ["_BODY"])
                (:removed diff)
                (keep (fn [i] (when (or (and (= :cancelled (:tag i)) (contains? ack (:id i)) (not= (get ack (:id i)) (subs (:hash i) 0 8)))
                                             (and (#{:required :invalid} (:tag i)) (if (= result "blocked") (= :unreceived (:state i)) (not= :verified (:state i))))) (:id i))) items)))))
        hold? (and (#{"done" "blocked"} result) (seq ids))]
    {:hold? (boolean hold?) :reason (if hold? :unreceived-or-open :clear) :blocking-ids ids}))
(defn state-summary [view] (let [states (frequencies (map :state (:items view)))] (str "rev=" (:rev view) " unreceived=" (get states :unreceived 0) " open=" (get states :received 0) " done=" (get states :verified 0) " deferred=" (get states :deferred 0))))
(defn diff-text [view] (let [s (str "TODO rev " (:rev view) " changes: " (pr-str (:diff view)) "\n" (str/join "\n" (map :line (filter #(some (set (concat (get-in view [:diff :added]) (get-in view [:diff :changed]))) [(:id %)]) (:items view)))))] (if (> (count s) 1950) (str (subs s 0 1950) "\n... truncated; read the ticket for the rest.") s)))
(defn with-lock [path f]
  (let [dir (fs/path (System/getProperty "java.io.tmpdir") "task-board-locks")
        name (str (subs (sha (.getCanonicalPath (java.io.File. (str path)))) 0 16) "-" (str/replace (str (fs/file-name path)) #"[^a-zA-Z0-9._-]" "_") ".lock")]
    (fs/create-dirs dir)
    (with-open [r (RandomAccessFile. (str (fs/path dir name)) "rw") c (.getChannel r)] (let [_lock (.lock c)] (f)))))
(defn with-writer [path f]
  (if-let [dir (not-empty (System/getenv "TASK_BOARD_VAULT_WRITER_LOCK_DIR"))]
    (do (fs/create-dirs dir) (with-open [r (RandomAccessFile. (str (fs/path dir "vault-writer.lock")) "rw") c (.getChannel r)] (let [_lock (.lock c)] (with-lock path f))))
    (with-lock path f)))
(defn atomic-write [path text]
  (let [p (.toPath (java.io.File. (str path))) tmp (Files/createTempFile (.getParent p) ".todo-" ".tmp" (make-array java.nio.file.attribute.FileAttribute 0))]
    (try (spit (str tmp) text) (Files/move tmp p (into-array StandardCopyOption [StandardCopyOption/REPLACE_EXISTING StandardCopyOption/ATOMIC_MOVE])) (finally (Files/deleteIfExists tmp)))))
(defn set-fm [text k v]
  (let [[_ fm rest] (re-find #"(?s)^---\s*\n(.*?)\n---(.*)$" text)]
    (when-not fm (throw (ex-info "missing frontmatter" {})))
    (str "---\n" (if (re-find (re-pattern (str "(?m)^" k ":")) fm) (str/replace fm (re-pattern (str "(?m)^" k ":.*$")) (str k ": " v)) (str fm "\n" k ": " v)) "\n---" rest)))
(defn append-section [text name line]
  (let [pattern (re-pattern (str "(?ms)(^## " (java.util.regex.Pattern/quote name) "[^\\n]*\\n)(.*?)(?=^## |\\z)"))]
    (if (re-find pattern text) (str/replace-first text pattern (fn [[_ h body]] (str h (str/trimr body) "\n" line "\n\n"))) (str (str/trimr text) "\n\n## " name "\n\n" line "\n"))))
(defn replace-item [text item replacement]
  (let [old (str/join "\n" (cons (:line item) (:children item)))
        plan (section text "Plan") new-plan (str/replace-first plan (re-pattern (java.util.regex.Pattern/quote old)) (java.util.regex.Matcher/quoteReplacement replacement))]
    (str/replace-first text (re-pattern (str "(?ms)(^## Plan[^\\n]*\\n)" (java.util.regex.Pattern/quote plan))) (fn [[_ h]] (str h new-plan)))))
(defn opts [args] (loop [xs args m {:args []}] (if-let [x (first xs)] (if (str/starts-with? x "--") (let [k (keyword (subs x 2)) flag (#{:required :optional :json} k)] (recur (if flag (rest xs) (nnext xs)) (assoc m k (if flag true (second xs))))) (recur (rest xs) (update m :args conj x))) m)))
(defn die [s code] (binding [*out* *err*] (println s)) (System/exit code))
(defn require-value [v label] (or (not-empty v) (throw (ex-info (str "missing " label) {}))))
(defn hook [o]
  (try
    (let [input (json/parse-string (slurp *in*) true) path (fs/path (:vault o) "Tickets" (str (:ticket o) ".md")) view (ticket-view (slurp (str path))) dir (:run-dir o) delivery (fs/path dir "todo-delivery.edn") start (edn/read-string (slurp (str (fs/path dir "todo-start.edn")))) state (if (fs/exists? delivery) (edn/read-string (slurp (str delivery))) {}) rev (:rev view) gate (gate-decision {:view view :start-rev (:rev start) :result "blocked"}) msg (str (diff-text view) "\nRun status then ack --rev " rev ".") event (:event o)]
      (case event
        "post" (when (not= rev (or (:notified state) (:rev start))) (spit (str delivery) (pr-str (assoc state :notified rev))) (println (json/generate-string {:hookSpecificOutput {:hookEventName "PostToolUse" :additionalContext msg}})))
        "pre" (when (and (:hold? gate) (re-find #"(?i)(gh\s+pr\s+merge|kubectl\s+apply|terraform\s+apply|git\s+push\b[^\n]*(?:main|master))" (or (get-in input [:tool_input :command]) ""))) (println (json/generate-string {:hookSpecificOutput {:hookEventName "PreToolUse" :permissionDecision "deny" :permissionDecisionReason msg}})))
        "stop" (when (and (:hold? gate) (< (get-in state [:stops rev] 0) 2)) (spit (str delivery) (pr-str (update-in state [:stops rev] (fnil inc 0)))) (println (json/generate-string {:decision "block" :reason msg}))) nil))
    (catch Throwable _ nil)))
(defn -main [& args]
  (let [cmd (first args) o (opts (rest args)) [id item-id] (:args o) vault (if (= cmd "hook") (:vault o) (require-value (:vault o) "--vault")) path (when vault (fs/path vault "Tickets" (str id ".md")))]
    (if (= cmd "hook") (hook o)
      (if (= cmd "status") (let [v (ticket-view (slurp (str path)))] (println (if (:json o) (json/generate-string v) (str (state-summary v) "\n" (diff-text v)))))
        (do
          (when (let [result (try (shell/sh "id" "-u") (catch Throwable _ nil)) uid (some-> result :out str/trim)] (if (and (= 0 (:exit result)) (re-matches #"[0-9]+" (or uid ""))) (boolean (re-matches #"0+" uid)) (= "root" (System/getProperty "user.name")))) (die "Root cannot run Task Board write commands" 1))
          (with-writer path
            (fn []
              (let [text (slurp (str path)) view (ticket-view text) items (:items view) item (some #(when (= item-id (:id %)) %) items)
                    source (or (:source o) "task-board-todos")
                    _ (when (#{"add" "change" "cancel"} cmd) (require-value (:source o) "--source"))
                    _ (when (and (#{"change" "cancel" "done" "skip"} cmd) (nil? item)) (throw (ex-info "missing item" {})))
                    tag (cond (:required o) :required (:optional o) :optional :else (:tag item))
                    label {:required "必須" :optional "任意" :cancelled "取消"}
                    new-text
                    (case cmd
                      "add" (let [tag (or tag (throw (ex-info "choose --required or --optional" {}))) body (require-value (:text o) "--text") id (or (:id o) (format "TD-%02d" (inc (reduce max 0 (map #(parse-long (subs (:id %) 3)) (parse-items text))))))
                                  line (str "- [ ] " id "【" (label tag) "】" body) children (str (when (:ac o) (str "\n  - AC: " (:ac o))) (when (:priority o) (str "\n  - 優先度: " (:priority o)))) existing (some #(when (= id (:id %)) %) (parse-items text))]
                              (if existing (if (= (item-hash existing) (item-hash {:id id :tag tag :text body :children (str/split-lines children)})) text (throw (ex-info "ID already has different content" {}))) (-> text (set-fm "todo_contract" "v1") (append-section "Plan" (str line children "\n  - 由来: " source)))))
                      "change" (do (when (and (:expect-hash o) (not (str/starts-with? (:hash item) (:expect-hash o)))) (die "hash mismatch" 3)) (replace-item text item (str "- [" (if (:checked? item) "x" " ") "] " item-id "【" (label tag) "】" (or (:text o) (:text item)) (when (seq (:children item)) (str "\n" (str/join "\n" (:children item)))))))
                      "cancel" (replace-item text item (str "- [ ] " item-id "【取消】" (:text item) "\n" (str/join "\n" (:children item)) "\n  - 取消理由: " (require-value (:reason o) "--reason")))
                      "ack" (do (when (not= (:rev view) (:rev o)) (die (diff-text view) 3)) (if (= (:ack-rev view) (:rev view)) text (-> text (set-fm "todo_ack_rev" (:rev view)) (set-fm "todo_ack_items" (str/join "," (map (fn [[k v]] (str k ":" (subs v 0 8))) (sort-by key (:hashes view))))) (set-fm "todo_ack_run" (or (:run o) "")) (append-section "Notes" (str "- " (Instant/now) " UTC [" source "]: TODO ack " (str/join ", " (sort (keys (:hashes view)))))))))
                      "done" (do (when (not= (get (:ack view) item-id) (subs (:hash item) 0 8)) (die "item is not acknowledged" 3)) (replace-item text item (str "- [x] " item-id "【" (label (:tag item)) "】" (:text item) (when (seq (:children item)) (str "\n" (str/join "\n" (:children item)))) "\n  - 証拠: " (require-value (:evidence o) "--evidence"))))
                      "skip" (do (when (not= :optional (:tag item)) (die "required TODO: return blocked for an Owner decision" 4)) (replace-item text item (str (:line item) (when (seq (:children item)) (str "\n" (str/join "\n" (:children item)))) "\n  - 見送り: " (require-value (:reason o) "--reason"))))
                      (throw (ex-info "unknown command" {})))]
                (when (not= text new-text) (atomic-write path new-text))
                (println (state-summary (ticket-view new-text)))
                (when (and (= cmd "add") (#{"done" "blocked"} (get (frontmatter text) "status"))) (println "Move the card with update to resume."))))))))))
(when (= *file* (System/getProperty "babashka.file")) (try (apply -main *command-line-args*) (catch Throwable e (die (.getMessage e) 1))))
