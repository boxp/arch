#!/usr/bin/env bb
;; BOXP-405 段階 1: 成果指標 outcome/v2-draft を既存 metadata から read-only で集計し、件数だけを出す。
;; 定義の正本は Obsidian Projects/ai-operations-observability/redesign.md 第 2 章、arch 側の範囲は docs/project_docs/BOXP-405/plan.md。
;;
;; Usage: bb ai_ops_outcome.bb snapshot|prom <task-board-root> <vault> [--now ISO]
;;
;; 読むもの: runs/*/*/summary.edn の固定 field (ai_ops_insight の検証を通したもの)、Boards/Task Board.md のカード行の
;;   ticket ID・レーン・assignee、Tickets/*.md frontmatter の closed。本文・タイトル・Notes・prompt は読まず、ticket ID も出力しない。
;; 使える成果 = result done / owner-acceptance の run 終了時刻 (秒精度)、無ければ frontmatter closed (日精度、分位には入れない)。
;; continue / review は gate 通過であって成果ではない。開始時刻が分からない作業は窓への所属を決められないので窓別集計に入らない。
;; 判定済みの区分は開始時刻ではなく、判定が確定した時刻で窓に入れる。成果の時刻か、予算が切れた時刻 (開始 + 予算) のうち早い方。
;; 開始時刻で入れると、予算 7 日に対して 7 日窓の失敗が常に 0 件になる (v1-draft の欠陥)。
;; pending / unevaluated / started は判定が確定していないので開始時刻で入れる。
;; 本ツールの出力は暫定 SLO の根拠で、正式な SLO 判定ではない。
(ns ai-ops-outcome
  (:require [babashka.fs :as fs] [cheshire.core :as json] [clojure.string :as str]))
(load-file (str (fs/path (fs/parent (fs/absolutize *file*)) "ai_ops_insight.bb")))
(load-file (str (fs/path (fs/parent (fs/absolutize *file*)) "ai_ops_slo.bb")))

(def definition-version "outcome/v2-draft")
(def budget-hours 168)
(def windows {"7d" 7 "28d" 28})
(def min-observations {"7d" 10 "28d" 20})
(def rework-maturity-days 14)
(def parts [:started :determined :reached_in_budget :reached_over_budget :not_reached :pending :excluded_legitimate_wait :unevaluated])

(defn closed-at [vault ticket]
  (let [f (fs/path vault "Tickets" (str ticket ".md"))]
    (try (when (fs/readable? f)
           (with-open [r (clojure.java.io/reader (str f))]
             (some #(when-let [[_ date] (re-matches #"closed:\s*(\d{4}-\d{2}-\d{2})\s*" %)]
                      (ai-ops-insight/parse-inst (str date "T00:00:00Z")))
                   (take-while #(not= "---" %) (rest (take 40 (line-seq r)))))))
         (catch Exception _ nil))))

(defn task [runs card closed now]
  (let [start (ai-ops-slo/run-start (first runs))
        outcome? #(and (= "succeeded" (:status %)) (#{"done" "owner-acceptance"} (:result %)) (ai-ops-insight/parse-inst (:finished-at %)))
        run-outcome (first (sort (keep #(when (outcome? %) (ai-ops-insight/parse-inst (:finished-at %))) runs)))
        ;; 最も早い成果時刻を使う。closed は日精度なので、run の成果より前の日なら closed を成果とし (分位には入れない)、
        ;; 同じ日以降なら run の成果 (秒精度) を使う。
        closed-first? (boolean (and closed (or (nil? run-outcome)
                                               (neg? (compare closed (.truncatedTo run-outcome java.time.temporal.ChronoUnit/DAYS))))))
        outcome (when-not closed-first? run-outcome)
        out (if closed-first? closed run-outcome)
        ;; closed だけの到達は日精度なので、同じ日に始まった run をやり直しと誤認しないよう翌日 0 時以降の run だけ数える
        rework-from (when out (if outcome out (.plusSeconds out 86400)))
        unreadable? #(= "unreadable" (:status %))
        ;; 選ばれた成果より前に始まった読めない run はそれより早く成果に達していたかもしれず、最初の成果時刻が分からない。
        ;; run の並び順 (run ID) に頼らず開始時刻で判定する (成果 run の開始後・終了前に始まった読めない run も含める)。
        ;; 成果時刻以降 (closed だけの到達は翌日 0 時以降) に始まった読めない run は到達の事実を変えないので
        ;; unevaluated にしない (やり直しには数える)。
        earliest-known (or outcome rework-from)
        uncertain? (boolean (or (unreadable? (first runs)) (nil? start)
                                (if earliest-known
                                  (some #(and (unreadable? %) (let [s (ai-ops-slo/run-start %)] (or (nil? s) (neg? (compare s earliest-known))))) runs)
                                  (some unreadable? runs))))
        hours (when (and start out) (let [h (ai-ops-slo/hours-between start out)] (if outcome h (max 0 h))))
        blocked (last (filter #(or (= "blocked" (:status %)) (= "blocked" (:result %))) runs))
        wait? (or (and (= "Blocked" (:lane card)) (#{"owner-decision" "external-hold" "new-scope"} (:wait-reason blocked)))
                  (and (= "Ready" (:lane card)) (= "boxp" (:assignee card))))
        class (cond uncertain? :unevaluated
                    out (if (<= hours budget-hours) :reached_in_budget :reached_over_budget)
                    (<= (ai-ops-slo/hours-between start now) budget-hours) :pending
                    wait? :excluded_legitimate_wait
                    :else :not_reached)
        budget-end (when start (.plusSeconds start (* 3600 budget-hours)))
        decided (case class
                  :reached_in_budget out
                  (:reached_over_budget :not_reached :excluded_legitimate_wait) budget-end
                  nil)]
    {:start start :decided decided :out out :run-outcome? (some? outcome) :hours hours :class class
     :rework? (and out (some #(when-let [s (ai-ops-slo/run-start %)] (if outcome (pos? (compare s out)) (not (neg? (compare s rework-from))))) runs))}))

(defn window-snapshot [tasks now window]
  (let [since (.minusSeconds now (* 86400 (windows window)))
        in-window? #(and % (not (neg? (compare % since))) (neg? (compare % now)))
        started (filter #(in-window? (:start %)) tasks)
        xs (filter #(if (:decided %) (in-window? (:decided %)) (in-window? (:start %))) tasks)
        counts (frequencies (map :class xs))
        n #(get counts % 0)
        determined (+ (n :reached_in_budget) (n :reached_over_budget) (n :not_reached))
        reached (filter #(#{:reached_in_budget :reached_over_budget} (:class %)) xs)
        durations (map :hours (filter :run-outcome? reached))
        cutoff (.minusSeconds now (* 86400 rework-maturity-days))
        matured (filter #(not (pos? (compare (:out %) cutoff))) reached)]
    (merge (zipmap (rest (drop 1 parts)) (map n (rest (drop 1 parts))))
           {:started (count started) :determined determined
            :status (cond (zero? determined) "no_observations" (< determined (min-observations window)) "insufficient" :else "measuring")
            :min_observations (min-observations window)
            :reach_rate (when (pos? determined) (/ (double (Math/round (* 1000.0 (/ (n :reached_in_budget) determined)))) 1000.0))
            :duration {:measured (count durations) :reached_without_run_outcome (count (remove :run-outcome? reached))
                       :p50_h (ai-ops-insight/quantile durations 0.5) :p90_h (ai-ops-insight/quantile durations 0.9)}
            :rework {:matured (count matured) :rework (count (filter :rework? matured)) :pending (- (count reached) (count matured))}})))

(defn snapshot
  ([root vault] (snapshot root vault (java.time.Instant/now)))
  ([root vault now]
   (when-not (and root vault (fs/directory? (fs/path root "runs")) (fs/readable? (fs/path root "runs"))
                  (fs/directory? (fs/path vault "Tickets")) (fs/readable? (fs/path vault "Tickets"))
                  (fs/readable? (fs/path vault "Boards" "Task Board.md")))
     (throw (ex-info "unreadable root or vault" {})))
   (let [board (ai-ops-slo/parse-board (fs/read-all-lines (fs/path vault "Boards" "Task Board.md")))
         tasks (for [[ticket runs] (ai-ops-insight/load-runs root nil)]
                 (task runs (get board ticket) (closed-at vault ticket) now))]
     {:definition_version definition-version :generated_at (str now) :budget_hours budget-hours
      :rework_maturity_days rework-maturity-days
      :windows (into {} (for [w ["7d" "28d"]] [w (window-snapshot tasks now w)]))})))

(defn prom
  ([root vault] (prom root vault (java.time.Instant/now)))
  ([root vault now]
   (let [s (snapshot root vault now) lines (atom [])
         emit (fn [metric rows]
                (when (seq rows)
                  (swap! lines conj (str "# HELP " metric " AI operations outcome measurement.\n# TYPE " metric " gauge\n"
                    (str/join "" (for [[labels value] rows]
                      (str metric (when (seq labels) (str "{" (str/join "," (map (fn [[k v]] (str (name k) "=\"" v "\"")) labels)) "}")) " " value "\n")))))))
         ws ["7d" "28d"]]
     (emit "ai_ops_outcome_info" [[(array-map :definition_version definition-version :budget_hours budget-hours :rework_maturity_days rework-maturity-days) 1]])
     (emit "ai_ops_outcome_generated_timestamp_seconds" [[{} (.getEpochSecond now)]])
     (emit "ai_ops_outcome_tasks" (for [w ws p parts] [(array-map :window w :part (name p)) (get-in s [:windows w p])]))
     (emit "ai_ops_outcome_reach_status" (for [w ws status ["no_observations" "insufficient" "measuring"]] [(array-map :window w :status status) (if (= status (get-in s [:windows w :status])) 1 0)]))
     (emit "ai_ops_outcome_min_observations" (for [w ws] [{:window w} (get-in s [:windows w :min_observations])]))
     (emit "ai_ops_outcome_hours" (for [w ws [q k] [["0.5" :p50_h] ["0.9" :p90_h]] :let [v (get-in s [:windows w :duration k])] :when (some? v)] [(array-map :window w :quantile q) v]))
     (emit "ai_ops_outcome_duration_tasks" (for [w ws p [:measured :reached_without_run_outcome]] [(array-map :window w :part (name p)) (get-in s [:windows w :duration p])]))
     (emit "ai_ops_outcome_rework" (for [w ws p [:matured :rework :pending]] [(array-map :window w :part (name p)) (get-in s [:windows w :rework p])]))
     (apply str @lines))))

(defn -main [& args]
  (let [[cmd root vault & opts] args
        valid? (and (#{"snapshot" "prom"} cmd) root vault (or (empty? opts) (and (= 2 (count opts)) (= "--now" (first opts)) (ai-ops-insight/parse-inst (second opts)))))]
    (if-not valid?
      (do (binding [*out* *err*] (println "usage: bb ai_ops_outcome.bb snapshot|prom <root> <vault> [--now ISO]")) (System/exit 2))
      (let [now (if (seq opts) (ai-ops-insight/parse-inst (second opts)) (java.time.Instant/now))]
        (print (if (= cmd "snapshot") (str (json/generate-string (snapshot root vault now)) "\n") (prom root vault now)))))))
(when (= *file* (System/getProperty "babashka.file")) (apply -main *command-line-args*))
