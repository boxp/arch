#!/usr/bin/env bb
(ns task-board-conflict
  (:require [babashka.fs :as fs] [babashka.process :as process]
            [cheshire.core :as json] [clojure.string :as str]
            [clojure.set :as set])
  (:import [java.time Instant]))

(def default-root "/home/boxp/.codex-task-board")
(defn enabled? [] (not (contains? #{"off" "false" "0"} (str/lower-case (or (System/getenv "CODEX_TASK_BOARD_CONFLICT_OBSERVE") "")))))
(defn valid-key? [k] (boolean (and (string? k) (re-matches #"(?:code:[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)?|(?:spec|deploy|res):[A-Za-z0-9._/-]+)" k))))
(def deploy-rules [[#"^arch/apps/kohako-studio/" "kohako-studio"]
                   [#"^arch/docker/codex-workspace/" "codex-workspace"]
                   [#"^arch/docker/hermes-agent/" "hermes-agent"]
                   [#"^arch/docker/([^/]+)/" 1] [#"^arch/apps/([^/]+)/" 1]
                   [#"^lolice/argoproj/([^/]+)/" 1]])
(def hot-regions [[#"(?i)kohako-home|コハコの家|家画面|apps/kohako-studio" ["code:arch:apps/kohako-studio/web/src/home" "code:arch:apps/kohako-studio/verify/home" "deploy:kohako-studio"]]
                  [#"(?i)task[-_ ]?board[-_ ]?runner|task_board_runner|codex-workspace" ["code:arch:docker/codex-workspace/task-board" "deploy:codex-workspace"]]
                  [#"(?i)hermes-agent" ["code:arch:docker/hermes-agent" "deploy:hermes-agent"]]])
(defn sorted-keys [xs] (vec (sort (distinct (filter valid-key? xs)))))
(defn file-keys [repo path]
  (let [parts (str/split path #"/") parent (take 5 (butlast parts))
        code (str "code:" repo (when (seq parent) (str ":" (str/join "/" parent))))
        full (str repo "/" path)
        deploy (some (fn [[re target]] (when-let [m (re-find re full)] (str "deploy:" (if (number? target) (nth m target) target)))) deploy-rules)]
    (sorted-keys [code deploy])))
;; Notes are a work log (agent names, run lines), not the ticket goal: matching
;; them would mark almost every ticket as touching the runner or Hermes.
(defn hot-region-text [text]
  (first (str/split (or text "") #"(?m)^## Notes\s*$" 2)))
(defn pre-keys [{:keys [repos text]}]
  (sorted-keys (concat (map #(str "code:" (last (str/split % #"/"))) repos)
                       (mapcat #(str/split (second %) #"[,\s]+") (re-seq #"(?im)^\s*(?:conflict_keys|衝突領域)\s*[:：]+\s*(.+)$" (or text "")))
                       (mapcat (fn [[re ks]] (when (re-find re (hot-region-text text)) ks)) hot-regions))))
(defn keys-overlap? [a b]
  (if (and (str/starts-with? a "code:") (str/starts-with? b "code:"))
    (let [[_ ar ap] (str/split a #":" 3) [_ br bp] (str/split b #":" 3)
          x (if ap (str/split ap #"/") []) y (if bp (str/split bp #"/") [])]
      (and (= ar br) (= (take (min (count x) (count y)) x) (take (min (count x) (count y)) y))))
    (= a b)))
(defn key-sets-overlap [as bs] (set (for [a as b bs :when (keys-overlap? a b)] [a b])))
(defn repo-name-from-pr-url [url] (second (re-find #"https?://[^/]+/[^/]+/([^/]+)/pull/\d+" (or url ""))))
(defn event-path [root] (str (fs/path root "conflict-observe" "events.jsonl")))
(defn append-event! [root event]
  (let [path (event-path root)] (fs/create-dirs (fs/parent path))
    (java.nio.file.Files/write (fs/path path) (.getBytes (str (json/generate-string (assoc event :schema "conflict-observe/v1" :at (str (Instant/now)))) "\n") "UTF-8") (into-array java.nio.file.OpenOption [java.nio.file.StandardOpenOption/CREATE java.nio.file.StandardOpenOption/APPEND]))))
(def ^:dynamic *warning-handler* nil)
(defmacro safely [& body] `(try ~@body nil (catch Throwable e# (let [message# (str "conflict observation: " (.getMessage e#))] (binding [*out* *err*] (println message#)) (when *warning-handler* (try (*warning-handler* message#) (catch Throwable _# nil)))) nil)))
(defn record-pre! [root {:keys [ticket run agent action repos text]}]
  (safely (append-event! root {:ticket ticket :run run :stage "pre" :source "runner" :keys (pre-keys {:repos repos :text text}) :agent agent :action action :repos repos})))
(defn record-declared! [root {:keys [ticket run source keys]}]
  (safely (append-event! root {:ticket ticket :run run :stage "declared" :source source :keys (sorted-keys keys)})))
;; Every changed file is stored: a cut list would hide an overlap that only exists
;; past the cut. files_complete says whether the list covers the PR's changed files.
(defn record-pr! [root {:keys [ticket run pr head state created-at merged-at closed-at files files-total gate-ok gate]}]
  (safely (append-event! root {:ticket ticket :run run :stage "pr" :source "runner" :pr pr :head head :pr_state state :pr_created_at created-at :pr_merged_at merged-at :pr_closed_at closed-at :files (vec files) :files_count (count files) :files_complete (or (nil? files-total) (= files-total (count files))) :keys (sorted-keys (mapcat #(file-keys (repo-name-from-pr-url pr) %) files)) :gate_ok (boolean gate-ok) :gate gate})))
(defn gh-out [args timeout-ms]
  (try (let [p (process/process (into ["gh"] args) {:out :string :err :string})
             result (deref (future @p) timeout-ms ::timeout)]
         (if (= ::timeout result) (do (process/destroy-tree p) nil) (when (zero? (:exit result)) (:out result))))
       (catch Throwable _ nil)))
;; `gh pr view --json files` can stop at the first page, so the full list is read
;; through the paginated REST endpoint; the view's list is only the fallback.
(defn fetch-pr-files [url]
  (when-let [[_ owner repo n] (re-find #"https?://[^/]+/([^/]+)/([^/]+)/pull/(\d+)" (or url ""))]
    (when-let [out (gh-out ["api" "--paginate" (str "repos/" owner "/" repo "/pulls/" n "/files?per_page=100") "--jq" ".[].filename"] 90000)]
      (vec (remove str/blank? (str/split-lines out))))))
(defn fetch-pr [url]
  (try (when-let [out (gh-out ["pr" "view" url "--json" "url,state,createdAt,mergedAt,closedAt,headRefOid,changedFiles,files"] 30000)]
         (let [v (json/parse-string out true) all (fetch-pr-files url) listed (mapv :path (:files v))]
           {:state (:state v) :created-at (:createdAt v) :merged-at (:mergedAt v) :closed-at (:closedAt v) :head (:headRefOid v)
            :files (if (>= (count all) (count listed)) all listed) :files-total (:changedFiles v)}))
       (catch Throwable _ nil)))
(defn read-events [root]
  (let [path (event-path root)]
    (if (fs/exists? path)
      (reduce (fn [acc line] (try (let [v (json/parse-string line true)] (if (map? v) (update acc :events conj v) (update acc :malformed inc))) (catch Throwable _ (update acc :malformed inc)))) {:events [] :malformed 0} (str/split-lines (slurp path)))
      {:events [] :malformed 0})))
(defn instant [s] (try (when s (Instant/parse s)) (catch Throwable _ nil)))
(defn time-min [xs] (first (sort (keep instant xs))))
(defn time-max [xs] (last (sort (keep instant xs))))
(defn files-complete? [e] (if (contains? e :files_complete) (boolean (:files_complete e)) (= (:files_count e) (count (:files e)))))
;; `now` closes the active period of a ticket whose PR is still open: its work is
;; not over at its last recorded event, so later tickets still overlap with it.
(defn analyze [events malformed refresh? now]
  (let [refresh (if refresh? (into {} (map (fn [url] [url (fetch-pr url)]) (distinct (keep :pr events)))) {})
        groups (group-by :ticket (filter :ticket events))
        tickets (into {} (for [[id es] groups]
          (let [prs (filter #(= "pr" (:stage %)) es)
                start (time-min (concat (map :at es) (map :pr_created_at prs)))
                latest (map last (vals (group-by :pr prs)))
                pr-end (fn [e] (if-let [r (get refresh (:pr e))] (time-max [(:merged-at r) (:closed-at r)]) (time-max [(:pr_merged_at e) (:pr_closed_at e)])))
                open (remove pr-end latest)
                closed (time-max (map str (concat (keep instant (map :at es)) (keep pr-end latest))))
                end (if (seq open) (time-max (map str (remove nil? [closed now]))) closed)]
            [id {:events es :prs prs :start start :end end :open_prs (count open)
                 :files_complete (every? (fn [e] (if-let [r (get refresh (:pr e))] (or (nil? (:files-total r)) (= (:files-total r) (count (:files r)))) (files-complete? e))) latest)
                 ;; A bare repo key at the pre stage only says "same repo": it would predict
                 ;; an overlap for every pair, so it is recorded but not used to predict.
                 :keys (into {} (for [s ["pre" "declared" "pr"]] [s (set (cond->> (mapcat :keys (filter #(= s (:stage %)) es)) (= s "pre") (remove #(re-matches #"code:[^:]+" %))))]))
                 :files (set (mapcat (fn [e] (map #(str (repo-name-from-pr-url (:pr e)) "/" %) (concat (:files e) (:files (get refresh (:pr e)))))) prs))}])))
        ids (sort (keys tickets))
        pairs (vec (for [i (range (count ids)) j (range (inc i) (count ids))
                         :let [a (tickets (nth ids i)) b (tickets (nth ids j))]
                         :when (and (:start a) (:start b) (:end a) (:end b) (not (.isAfter (:start a) (:end b))) (not (.isAfter (:start b) (:end a))))]
                     {:a (nth ids i) :b (nth ids j) :actual_overlap (boolean (seq (set/intersection (:files a) (:files b))))
                      :overlaps (into {} (for [s ["pre" "declared" "pr"]] [s (key-sets-overlap (get-in a [:keys s]) (get-in b [:keys s]))]))}))
        stages (into {} (for [s ["pre" "declared" "pr"]]
          (let [pred (filter #(seq (get-in % [:overlaps s])) pairs)
                ;; "No overlap" is only known when both file lists are complete.
                known (filter #(and (seq (:prs (tickets (:a %)))) (seq (:prs (tickets (:b %)))) (or (:actual_overlap %) (and (:files_complete (tickets (:a %))) (:files_complete (tickets (:b %)))))) pred)
                waits (for [p pred :let [a (tickets (:a p)) b (tickets (:b p)) [early late] (if (.isAfter (:start a) (:start b)) [b a] [a b]) h (max 0.0 (/ (double (- (.toEpochMilli (:end early)) (.toEpochMilli (:start late)))) 3600000.0))]] [p h])]
            [s {:predicted_pairs (count pred) :needless (count (remove :actual_overlap known)) :known_pairs (count known) :needless_fraction (when (seq known) (/ (double (count (remove :actual_overlap known))) (count known))) :unconfirmed (- (count pred) (count known))
                :wait_hours (reduce + 0.0 (map second waits))
                :wait_by_key (reduce (fn [m [p h]] (reduce #(update %1 %2 (fnil + 0.0) h) m (set (mapcat identity (get-in p [:overlaps s]))))) {} waits)}])))
        conflicts (for [[id t] tickets e (:prs t) :when (= "conflict" (:gate e))]
                    (let [partners (filter #(and (:actual_overlap %) (or (= id (:a %)) (= id (:b %)))) pairs)]
                      {:ticket id :explained (boolean (seq partners)) :predicted (into {} (for [s ["pre" "declared" "pr"]] [s (boolean (some #(seq (get-in % [:overlaps s])) partners))]))}))
        accuracy (into {} (for [[id t] tickets :let [decl (filter #(str/starts-with? % "code:") (get-in t [:keys "declared"])) files (:files t)] :when (and (seq (get-in t [:keys "declared"])) (seq files))]
                            (let [covered (fn [f k] (let [[repo path] (str/split f #"/" 2)] (keys-overlap? k (str "code:" repo ":" path))))]
                              [id {:covered_files (count (filter #(some (partial covered %) decl) files)) :files (count files) :coverage_fraction (/ (double (count (filter #(some (partial covered %) decl) files))) (count files)) :untouched_keys (vec (sort (remove #(some (fn [f] (covered f %)) files) decl)))}])))]
    {:events_per_stage (frequencies (map :stage events)) :tickets (count tickets) :pairs (count pairs) :open_pr_tickets (count (filter #(pos? (:open_prs %)) (vals tickets))) :incomplete_file_tickets (count (remove :files_complete (vals tickets))) :evaluated_until (some-> now str) :pair_details (mapv (fn [p] {:tickets [(:a p) (:b p)] :actual_overlap (:actual_overlap p) :predicted_pre (boolean (seq (get-in p [:overlaps "pre"]))) :predicted_declared (when (and (seq (get-in tickets [(:a p) :keys "declared"])) (seq (get-in tickets [(:b p) :keys "declared"]))) (boolean (seq (get-in p [:overlaps "declared"])))) :predicted_pr (boolean (seq (get-in p [:overlaps "pr"])))}) pairs) :malformed malformed :first_at (some-> (time-min (map :at events)) str) :last_at (some-> (time-max (map :at events)) str) :stages stages :conflicts (vec conflicts) :conflict_summary {:total (count conflicts) :explained (count (filter :explained conflicts)) :unexplained (count (remove :explained conflicts)) :predicted (into {} (for [s ["pre" "declared" "pr"]] [s (count (filter #(get-in % [:predicted s]) conflicts))])) :miss (into {} (for [s ["pre" "declared" "pr"]] [s (count (filter #(and (:explained %) (not (get-in % [:predicted s]))) conflicts))]))} :declaration_accuracy accuracy}))
(defn parse-args [args allowed]
  (loop [xs args out {} positional []]
    (if-let [x (first xs)]
      (if (str/starts-with? x "--")
        (let [k (keyword (subs x 2)) kind (get allowed k)]
          (cond (= kind :flag) (recur (rest xs) (assoc out k true) positional)
                (and (= kind :value) (second xs) (not (str/starts-with? (second xs) "--"))) (recur (nnext xs) (assoc out k (second xs)) positional)
                :else (throw (ex-info (str "invalid option: " x) {}))))
        (recur (rest xs) out (conj positional x)))
      (assoc out :positional positional))))
(defn main [args]
  (try
    (let [[cmd & rest] args opts (parse-args rest (case cmd "declare" {:keys :value :run :value :source :value :root :value} "report" {:root :value :since :value :until :value :json :flag :refresh-prs :flag} "status" {:root :value :json :flag} (throw (ex-info "unknown command" {}))))
          root (or (:root opts) (System/getenv "CODEX_TASK_BOARD_ROOT") default-root)]
      (case cmd
        "declare" (let [ticket (first (:positional opts)) ks (some-> (:keys opts) (str/split #",")) bad (some #(when-not (valid-key? %) %) ks)]
                    (when (or (not= 1 (count (:positional opts))) (empty? ks) bad) (throw (ex-info (str "invalid key: " (or bad "missing")) {})))
                    (record-declared! root {:ticket ticket :run (or (:run opts) (System/getenv "CODEX_TASK_BOARD_RUN_ID")) :source (or (:source opts) "cli") :keys ks})
                    (println "記録のみ：開始やマージには影響しません。"))
        (do (when (seq (:positional opts)) (throw (ex-info "unexpected arguments" {})))
            (let [{:keys [events malformed]} (read-events root)
                  _ (doseq [s [(:since opts) (:until opts)]] (when (and s (nil? (instant s))) (throw (ex-info (str "invalid instant: " s) {}))))
                  events (filterv (fn [e] (let [at (instant (:at e))] (and at (or (nil? (:since opts)) (not (.isBefore at (instant (:since opts))))) (or (nil? (:until opts)) (not (.isAfter at (instant (:until opts)))))))) events)
                  data (if (= cmd "status") {:path (event-path root) :enabled (enabled?) :events_per_stage (frequencies (map :stage events)) :first_at (some-> (time-min (map :at events)) str) :last_at (some-> (time-max (map :at events)) str)} (analyze events malformed (:refresh-prs opts) (or (instant (:until opts)) (Instant/now))))]
              (if (:json opts) (println (json/generate-string data))
                (if (= cmd "status") (do (println (str "保存先: " (:path data) "、有効: " (:enabled data))) (println (str "段階別: " (pr-str (:events_per_stage data)) "、期間: " (:first_at data) "〜" (:last_at data)))) (if (empty? events) (println "まだ記録がありません。")
                  (do (println (if (= cmd "status") "# 衝突観測の状態" "# 衝突観測レポート")) (println (str "記録: " (count events) " 件、期間: " (:first_at data) "〜" (:last_at data)))
                      (when (= cmd "report") (println (str "チケット: " (:tickets data) "、組: " (:pairs data) "、不正行: " malformed)) (println (str "PRが開いたままの票: " (:open_pr_tickets data) "（評価時点 " (:evaluated_until data) " まで稼働中として扱う。マージ済みの反映は --refresh-prs）、変更ファイル一覧が不完全な票: " (:incomplete_file_tickets data))) (doseq [[s v] (:stages data)] (println (str "- " s ": 無駄な直列化 " (:needless v) "/" (:known_pairs v) "、未確定 " (:unconfirmed v) "、仮の待ち " (:wait_hours v) " 時間"))) (println (str "衝突イベント: " (count (:conflicts data)) " 件、説明可能: " (get-in data [:conflict_summary :explained]) "、原因不明: " (get-in data [:conflict_summary :unexplained]))) (doseq [s ["pre" "declared" "pr"]] (println (str "  " s " 予測: " (get-in data [:conflict_summary :predicted s]) "、見逃し: " (get-in data [:conflict_summary :miss s]) "、キー別の仮の待ち: " (pr-str (get-in data [:stages s :wait_by_key]))))) (doseq [[ticket accuracy] (:declaration_accuracy data)] (println (str "- 宣言 " ticket ": 対象ファイル " (:covered_files accuracy) "/" (:files accuracy) "、未使用キー " (pr-str (:untouched_keys accuracy))))))))))))))
    0
    (catch Throwable e (binding [*out* *err*] (println (.getMessage e))) 2)))
(when (= *file* (System/getProperty "babashka.file")) (System/exit (main *command-line-args*)))
