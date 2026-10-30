#!/usr/bin/env bb
;; BOXP-360: 是正・再作業の集中先分析と correction-rules/v1 (分析専用, metadata-only)
;;
;; Usage:
;;   bb ai_ops_insight.bb report <task-board-root> [until-run-id]   EDN report (stdout)
;;
;; 読むのは runs/<ticket>/<run-id>/summary.edn の次の field だけ:
;;   :status :action :result :blocker-category :started-at :finished-at :agent
;;   :review-gate の :gate / :diagnostic :category
;; prompt / last-message / events.jsonl / ticket 本文は読まない。
;; 公開中の SLI (ai_ops_sli.bb, correction-rules/v0) は変更しない。v1 は版を分けて並べて比較する。
;; until-run-id を与えると、その run-id 以下の run だけを使う (固定 snapshot で再現するため)。
(ns ai-ops-insight
  (:require [babashka.fs :as fs]
            [clojure.edn :as edn]
            [clojure.string :as str]))

(def rules-version "correction-rules/v1")

(defn kw [v] (cond (keyword? v) (name v) (string? v) v :else nil))

(defn read-summary [f]
  (try
    (let [s (edn/read-string {:default (fn [_ v] v)} (slurp (str f)))]
      (when (map? s)
        {:run-id (str (fs/file-name (fs/parent f)))
         :status (kw (:status s)) :action (kw (:action s)) :result (kw (:result s))
         :blocker (kw (:blocker-category s)) :agent (kw (:agent s))
         :started-at (:started-at s) :finished-at (:finished-at s)
         :gate (kw (get-in s [:review-gate :gate]))
         :gate-category (kw (get-in s [:review-gate :diagnostic :category]))}))
    (catch Exception _ nil)))

(defn load-runs [root until]
  (let [dir (fs/path root "runs")]
    (into {}
          (for [t (fs/list-dir dir)
                :let [ticket (str (fs/file-name t))]
                :when (re-matches #"[A-Z]+-\d+" ticket)
                :let [runs (->> (fs/list-dir t)
                                (keep #(let [f (fs/path % "summary.edn")]
                                         (if (fs/exists? f)
                                           (or (read-summary f) {:run-id (str (fs/file-name %)) :status "unreadable"})
                                           {:run-id (str (fs/file-name %)) :status "unreadable"})))
                                (remove #(and until (pos? (compare (:run-id %) until))))
                                (sort-by :run-id))]
                :when (seq runs)]
            [ticket runs]))))

;; ---------------------------------------------------------------------------
;; v0 / v1 の遷移分類
;;
;; v0 (ai_ops_sli.bb derive-corrections と同じ規則):
;;   cur.action=review-fix                          -> correction gate_defect (agent-system)
;;   prev succeeded & result review/done & cur implement/docs-edit -> reopen (unknown)
;; v1: 前 run の終わり方で「なぜ次の run が始まったか」を分ける。
;;   gate_rework          : 前 run が review gate 失敗で retrying (Owner に届く前の内部再作業, agent-system)。
;;                          件数・task 率は失敗 run 自体で数える (後続 run 未開始の最新失敗も含む)
;;   review_fix           : cur.action=review-fix (v0 と同じ, agent-system)
;;   groom_to_implement   : 前 run が groom/docs-groom で正常終了 (段階の継続, 是正ではない)
;;   resume_interrupted   : 前 run が interrupted / agent-process-error / failed (基盤要因, 是正ではない)
;;   resume_after_block   : 前 run が blocked (判断待ち解除。block 自体の妥当性は未評価)
;;   reopen_after_review  : 前 run が review/done で正常終了した後の implement (Owner 起点の差戻し・承認継続・新 scope を
;;                          metadata だけでは区別できないため unknown のまま。本文は読まない)
;;   retry_unknown        : retrying だが gate 情報なし
(def correction-kinds
  {"gate_rework" {:origin "agent-system" :owner-visible false}
   "review_fix" {:origin "agent-system" :owner-visible true}
   "reopen_after_review" {:origin "unknown" :owner-visible true}
   "retry_unknown" {:origin "unknown" :owner-visible false}})

(defn classify-v0 [prev cur]
  (cond
    (= "review-fix" (:action cur)) "correction"
    (and prev (= "succeeded" (:status prev)) (#{"review" "done"} (:result prev))
         (#{"implement" "docs-edit"} (:action cur))) "reopen"
    :else nil))

(defn classify-v1 [prev cur]
  (cond
    (= "review-fix" (:action cur)) "review_fix"
    (nil? prev) nil
    (= "retrying" (:status prev)) (if (:gate prev) "gate_rework" "retry_unknown")
    (or (#{"interrupted" "failed" "unreadable" "running"} (:status prev))
        (= "agent-process-error" (:blocker prev))) "resume_interrupted"
    (= "blocked" (:status prev)) "resume_after_block"
    (and (= "succeeded" (:status prev)) (#{"groom" "docs-groom"} (:action prev))) "groom_to_implement"
    (and (= "succeeded" (:status prev)) (= "blocked" (:result prev))) "resume_after_block"
    (and (= "succeeded" (:status prev)) (#{"review" "done"} (:result prev))
         (#{"implement" "docs-edit" "blocked-retry"} (:action cur))) "reopen_after_review"
    :else "other"))

(defn transitions [runs]
  (map (fn [prev cur] {:prev prev :cur cur :v0 (classify-v0 prev cur) :v1 (classify-v1 prev cur)})
       (cons nil runs) runs))

;; ---------------------------------------------------------------------------
;; 集計

(defn pct [n d] (when (pos? d) (/ (Math/round (* 1000.0 (/ n d))) 10.0)))

(defn instant [v]
  (try (cond (inst? v) (.toInstant ^java.util.Date v)
             (string? v) (java.time.Instant/parse v)
             :else nil)
       (catch Exception _ nil)))

(defn run-id->instant [run-id]
  (when-let [[_ d] (re-matches #"(\d{8}T\d{6}Z).*" (str run-id))]
    (try (.toInstant (.parse (doto (java.text.SimpleDateFormat. "yyyyMMdd'T'HHmmss'Z'")
                                   (.setTimeZone (java.util.TimeZone/getTimeZone "UTC"))) d))
         (catch Exception _ nil))))

(defn hours [a b] (when (and a b) (/ (.toMinutes (java.time.Duration/between a b)) 60.0)))

(defn quantile [xs q]
  (when (seq xs)
    (let [v (vec (sort xs))] (nth v (min (dec (count v)) (int (Math/floor (* q (count v)))))))))

(defn top [n m] (->> m (sort-by (comp - val)) (take n) vec))

(defn pareto
  "上位 k task が全体件数に占める割合。"
  [per-task k]
  (let [total (reduce + (vals per-task))
        topk (reduce + (map val (take k (sort-by (comp - val) per-task))))]
    {:top k :count topk :total total :share-pct (pct topk total)}))

(def loop-threshold 10)

(defn gate-fail? [r] (and (= "retrying" (:status r)) (some? (:gate r))))

(defn review-loops
  "gate 失敗 (gate 情報のある retrying) の連続が threshold 回に達した系列 (レビュー反復ループの検出器)。
   gate 情報のない retrying (retry_unknown) や他の run は系列を区切る。
   :hit-run-id は threshold 回目の失敗 run、:ongoing は最新 run がまだ gate 失敗か。"
  [runs-by-ticket threshold]
  (vec (for [[t runs] runs-by-ticket
             streak (partition-by gate-fail? runs)
             :when (and (gate-fail? (first streak)) (>= (count streak) threshold))]
         {:ticket t :length (count streak)
          :hit-run-id (:run-id (nth streak (dec threshold)))
          :first-run-id (:run-id (first streak))
          :ongoing (= (last streak) (last runs))})))

(defn report [runs-by-ticket]
  (let [trs (for [[t runs] runs-by-ticket, tr (transitions runs)] (assoc tr :ticket t))
        ;; Review 到達 = review で正常終了 (succeeded) した run がある task。gate 失敗 (retrying) の run も :result "review" を持つが Owner には届いていない。
        reached-review (set (for [[t runs] runs-by-ticket :when (some #(and (= "succeeded" (:status %)) (= "review" (:result %))) runs)] t))
        tasks-with (fn [pred] (set (keep #(when (pred %) (:ticket %)) trs)))
        v0-tasks (tasks-with :v0)
        ;; gate 失敗は失敗 run 自体を 1 件と数える (後続 run が未開始の最新失敗も含める)。
        gate-fails (for [[t runs] runs-by-ticket
                         [r nxt] (map vector runs (concat (rest runs) [nil]))
                         :when (gate-fail? r)]
                     {:ticket t :run r :followed? (some? nxt)})
        v1-agent (into (tasks-with #(= "agent-system" (get-in correction-kinds [(:v1 %) :origin])))
                       (map :ticket gate-fails))
        v1-owner-visible (tasks-with #(get-in correction-kinds [(:v1 %) :owner-visible]))
        v1-agent-owner-visible (tasks-with #(= "review_fix" (:v1 %)))
        count-by (fn [k pred] (frequencies (keep #(when (pred %) (k %)) trs)))
        gate-rework-by-task (frequencies (map :ticket gate-fails))
        gf-count-by (fn [f] (frequencies (map f gate-fails)))
        reopen-by-task (count-by :ticket #(= "reopen_after_review" (:v1 %)))
        ;; Review 停滞: review で正常終了した run の終了から次 run 開始までの時間 (次 run が無いものは別掲)
        review-waits (for [[t runs] runs-by-ticket
                           [prev cur] (map vector runs (concat (rest runs) [nil]))
                           :when (and (= "succeeded" (:status prev)) (= "review" (:result prev)))]
                       {:ticket t :followed? (some? cur) :next (when cur (classify-v1 prev cur))
                        :hours (when cur (hours (instant (:finished-at prev)) (or (instant (:started-at cur)) (run-id->instant (:run-id cur)))))})
        waited (filter :hours review-waits)
        all-runs (mapcat val runs-by-ticket)
        month (fn [r] (subs (:run-id r) 0 6))]
    {:rules-version rules-version
     :snapshot {:tickets (count runs-by-ticket) :runs (count all-runs)
                :last-run-id (last (sort (map :run-id all-runs)))
                :unreadable-runs (count (filter #(= "unreadable" (:status %)) all-runs))}
     :transitions {:v0 (frequencies (keep :v0 trs)) :v1 (frequencies (keep :v1 trs))
                   :v0->v1 (frequencies (for [tr trs :when (or (:v0 tr) (correction-kinds (:v1 tr)))] [(:v0 tr) (:v1 tr)]))}
     :task-rates {:denominator-reached-review (count reached-review)
                  :v0-correction-tasks {:n (count (filter reached-review v0-tasks)) :pct (pct (count (filter reached-review v0-tasks)) (count reached-review))}
                  :v1-agent-system-tasks {:n (count (filter reached-review v1-agent)) :pct (pct (count (filter reached-review v1-agent)) (count reached-review))}
                  :v1-owner-visible-tasks {:n (count (filter reached-review v1-owner-visible)) :pct (pct (count (filter reached-review v1-owner-visible)) (count reached-review))}
                  :v1-owner-visible-agent-system-tasks {:n (count (filter reached-review v1-agent-owner-visible))}}
     :gate-rework {:definition "gate 失敗 run (retrying かつ gate 情報あり) の件数。後続 run 未開始の最新失敗も含み :pending で別掲"
                   :total (reduce + (vals gate-rework-by-task))
                   :pending (count (remove :followed? gate-fails))
                   :by-gate (gf-count-by #(get-in % [:run :gate]))
                   :by-category (gf-count-by #(or (get-in % [:run :gate-category]) "none"))
                   :tasks (count gate-rework-by-task)
                   :pareto-top1 (pareto gate-rework-by-task 1) :pareto-top5 (pareto gate-rework-by-task 5)
                   :top-tasks (top 10 gate-rework-by-task)
                   :by-month (gf-count-by #(month (:run %)))
                   :by-agent (gf-count-by #(or (get-in % [:run :agent]) "unknown"))
                   :longest-streak (top 5 (into {} (for [[t runs] runs-by-ticket]
                                                     [t (reduce max 0 (map count (filter #(gate-fail? (first %)) (partition-by gate-fail? runs))))])))}
     :review-loops {:threshold loop-threshold
                    :detected (->> (review-loops runs-by-ticket loop-threshold) (sort-by (comp - :length)) vec)}
     :reopen-after-review {:total (reduce + (vals reopen-by-task)) :tasks (count reopen-by-task)
                           :pareto-top5 (pareto reopen-by-task 5) :top-tasks (top 10 reopen-by-task)}
     :non-correction {:by-kind (count-by :v1 #(#{"groom_to_implement" "resume_interrupted" "resume_after_block" "other"} (:v1 %)))}
     :review-wait {:review-finishes (count review-waits) :followed (count waited)
                   :not-followed (count (remove :followed? review-waits))
                   :followed-without-time (count (filter #(and (:followed? %) (nil? (:hours %))) review-waits))
                   :p50-h (quantile (map :hours waited) 0.5) :p90-h (quantile (map :hours waited) 0.9)
                   :next-kind (frequencies (map :next waited))
                   :over-24h (count (filter #(> (:hours %) 24) waited))
                   :by-next (into {} (for [[k xs] (group-by :next waited)]
                                       [k {:n (count xs) :p50-h (quantile (map :hours xs) 0.5) :p90-h (quantile (map :hours xs) 0.9)}]))}
     :runs-by-status (frequencies (map :status all-runs))}))

(defn -main [cmd & args]
  (case cmd
    "report" (let [[root until] args
                   runs (load-runs root until)]
               (when (empty? runs)
                 (binding [*out* *err*] (println "no runs found under" root))
                 (System/exit 2))
               (prn (report runs)))
    (do (binding [*out* *err*] (println "usage: bb ai_ops_insight.bb report <task-board-root> [until-run-id]"))
        (System/exit 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
