#!/usr/bin/env bb
;; BOXP-360: 是正・再作業の集中先分析と correction-rules/v1 (分析専用, metadata-only)
;;
;; Usage:
;;   bb ai_ops_insight.bb report <task-board-root> [until-run-id] [vault]   EDN report (stdout)
;;   (until-run-id を使わず vault だけ渡す場合は until-run-id に "" を渡す)
;;
;; 読むのは runs/<ticket>/<run-id>/summary.edn の次の field だけ:
;;   :status :action :result :blocker-category :started-at :finished-at :agent
;;   :review-gate の :gate / :diagnostic :category
;; prompt / last-message / events.jsonl は読まない。
;; vault を与えた場合だけ、Tickets/BOXP-<n>.md の `## Notes` 節 (次の `## ` 見出しまで、code block 内を除く) の各行を正規表現
;;   ^- YYYY-MM-DD HH:MM:SS UTC [<source>]:
;; と照合し、一致した行の「時刻」と「source (下の allowlist の語彙)」だけを残す。本文・タイトル・その他の行は保持も出力もしない。
;; ticket file が無い/読めない ticket は trigger=unknown-unreadable として別掲し、観測なし (none-observed) にしない。
;; vault/Tickets が読めなければ exit 2。
;; 公開中の SLI (ai_ops_sli.bb, correction-rules/v0) は変更しない。v1 は版を分けて並べて比較する。
;; until-run-id を与えると、その run-id 以下の run だけを使う (固定 snapshot で再現するため)。
(ns ai-ops-insight
  (:require [babashka.fs :as fs]
            [clojure.java.io]
            [clojure.edn :as edn]
            [clojure.string :as str]))

(def rules-version "correction-rules/v1")

(defn kw [v] (cond (keyword? v) (name v) (string? v) v :else nil))

;; Notes 見出しの source -> Review 停止からの再開契機の種別 (allowlist。これ以外の source は無視)
;; kohako-event は通知済み marker で再開契機ではないため含めない。agent 自身の作業ログも含めない。
(def trigger-sources
  {"kohako-supervisor" "supervisor" "kohako" "supervisor"
   "hermes-agent" "owner-relay" "boxp" "owner-direct"})

(def note-header #"^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC \[([a-z][a-z0-9-]{0,40})\]:.*")

(defn notes-lines
  "`## Notes` 見出しから次の `## ` 見出しまでの各行に extract を適用し、nil 以外の結果だけを返す
  (fenced code block 内の行は除く)。行そのものは蓄積しない (本文をメモリに保持しない)。
  節の開始・終端とも fence の外にある見出しだけを見る (code block 内の `## Notes` / `## ` 行は無視)。
  開いた fence の文字種と長さを覚え、同じ文字種で同じ長さ以上の fence 行 (info string なし) だけで閉じる
  (`~~~` block 内の ``` は閉じとみなさない)。"
  [extract lines]
  (loop [[line & more :as ls] lines
         started? false fence nil acc []]
    (if (empty? ls)
      acc
      (let [[_ marker info] (re-find #"^\s{0,3}(`{3,}|~{3,})(.*)$" line)]
        (cond fence (recur more started?
                           (when-not (and marker (= (first marker) (:ch fence)) (>= (count marker) (:len fence))
                                          (re-matches #"\s*" info))
                             fence)
                           acc)
              marker (recur more started? {:ch (first marker) :len (count marker)} acc)
              (not started?) (recur more (boolean (re-matches #"^## Notes\s*$" line)) nil acc)
              (re-matches #"^## .*" line) acc
              :else (recur more true nil (if-some [v (extract line)] (conj acc v) acc)))))))

(defn read-note-triggers
  "ticket file の Notes 節から再開契機の候補 (時刻と種別だけ) を返す。行の残りは捨てる。
  読めない場合は :unreadable を返す (観測なしと区別する)。"
  [f]
  (try
    (with-open [r (clojure.java.io/reader (str f))]
      (notes-lines
       (fn [line]
         (let [[_ d t src] (re-matches note-header line)
               kind (get trigger-sources src)
               at (when kind (try (java.time.Instant/parse (str d "T" t "Z")) (catch Exception _ nil)))]
           (when at {:at at :kind kind})))
       (line-seq r)))
    (catch Exception _ :unreadable)))

(defn load-triggers
  "ticket -> 契機 vector。ticket file が無い/読めない ticket は :unreadable (unknown として別掲)。"
  [vault tickets]
  (into {} (for [t tickets
                 :let [f (fs/path vault "Tickets" (str t ".md"))]]
             [t (if (fs/readable? f) (read-note-triggers f) :unreadable)])))

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
                                ;; 上限は run ID の先頭を上限の長さで比較する (時刻だけの上限 20261030T065040Z では同じ秒の run も含める)
                                (remove #(and until (pos? (compare (subs (:run-id %) 0 (min (count (:run-id %)) (count until))) until))))
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
;;                          前 run が gate 失敗なら cur が review-fix でも gate_rework を優先する。
;;                          不変条件: transitions.v1.gate_rework = gate-rework.total - gate-rework.pending
;;   review_fix           : cur.action=review-fix で前 run が gate 失敗でないもの (agent-system)
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
    ;; 前 run が gate 失敗なら、続く run が review-fix でも gate_rework (gate-rework の件数と遷移集計を一致させる)
    (and prev (= "retrying" (:status prev)) (:gate prev)) "gate_rework"
    (= "review-fix" (:action cur)) "review_fix"
    (nil? prev) nil
    (= "retrying" (:status prev)) "retry_unknown"
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

(declare review-resume)

(defn report [runs-by-ticket & [triggers until-at]]
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
        ;; Owner 可視の集計は v1 遷移分類と独立に、run 自身が review-fix かどうかで数える。
        ;; gate 失敗直後の review-fix は遷移分類では gate_rework だが、review-fix run があること自体は Owner 可視の是正として残す。
        ;; gate 失敗 (retrying) 等で Owner に届いていない review-fix は数えない (run 自身が succeeded のものだけ)。
        review-fix? #(and (= "review-fix" (get-in % [:cur :action])) (= "succeeded" (get-in % [:cur :status])))
        ;; review_fix 遷移も同じ条件 (review-fix?) で判定し、gate 失敗した review-fix を遷移分類経由で数えない。
        v1-owner-visible (tasks-with #(or (and (not= "review_fix" (:v1 %)) (get-in correction-kinds [(:v1 %) :owner-visible])) (review-fix? %)))
        v1-agent-owner-visible (tasks-with review-fix?)
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
                   :followed (count (filter :followed? gate-fails))
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
     :review-resume (if triggers
                      (review-resume runs-by-ticket triggers until-at)
                      {:status "unknown" :reason "vault 未指定 (Notes 見出しの時刻/source を読んでいない)"})
     :runs-by-status (frequencies (map :status all-runs))}))

;; ---------------------------------------------------------------------------
;; Review 停止からの再開契機 (Review停止催促 / Owner 経由指示 / 観測なし) と Ready→着手遅延の代理指標
;;
;; review で正常終了した run (prev) ごとに、prev 終了から次 run 開始まで (次 run が無ければ snapshot 上限まで) の
;; 再開契機 note を見る。
;;   trigger        : 区間内の最後の契機 note の種別。無ければ none-observed (Owner が直接 card を動かした等。原因は unknown)
;;   ack-min        : 最後の契機 note -> 次 run 開始 (分)。Ready 遷移時刻の代理 (note 後に Ready へ戻す運用のため)
;;   nudges         : 区間内の supervisor note 数。2 以上は同じ停止に対する催促の繰返し
;; 業務上の差戻しか承認継続か新 scope かは本文を読まないため区別しない (correction-rules/v1 の reopen_after_review と同じく unknown)。
(defn review-resume [runs-by-ticket triggers until-at]
  (let [unreadable? (fn [t] (= :unreadable (get triggers t)))
        stalls (for [[t runs] runs-by-ticket
                     [prev cur] (map vector runs (concat (rest runs) [nil]))
                     :when (and (= "succeeded" (:status prev)) (= "review" (:result prev)))
                     :let [from (instant (:finished-at prev))
                           to (when cur (or (instant (:started-at cur)) (run-id->instant (:run-id cur))))
                           end (or to until-at)
                           ;; note 時刻は秒単位。prev 終了と同じ秒の note は前後を判定できないため、確実に後の note とは分ける
                           from-sec (when from (.truncatedTo from java.time.temporal.ChronoUnit/SECONDS))
                           ;; 次 run 開始側も同様。開始と同じ秒の note は開始前か後か判定できないため確定区間に入れない
                           ;; 次 run が無い停止は snapshot 上限 (until-at) を終端とし、上限と同じ秒の note も前後不明として確定区間に入れない
                           to-sec (when end (.truncatedTo end java.time.temporal.ChronoUnit/SECONDS))
                           within-end? #(or (nil? to-sec) (neg? (compare (:at %) to-sec)))
                           ts (when-not (unreadable? t) (get triggers t))
                           in (when from (filter #(and (pos? (compare (:at %) from-sec)) (within-end? %)) ts))
                           same-sec (when from (filter #(and (= (:at %) from-sec) (or (nil? to-sec) (not (pos? (compare (:at %) to-sec))))) ts))
                           end-same-sec (when (and from to-sec (pos? (compare to-sec from-sec)))
                                          (filter #(= (:at %) to-sec) ts))
                           last-trigger (last (sort-by :at in))
                           ;; note 時刻は秒単位。最後の秒に種別の異なる note が複数あると、どれが最後か判定できない
                           last-conflict? (and last-trigger
                                               (> (count (set (map :kind (filter #(= (:at %) (:at last-trigger)) in)))) 1))
                           ;; 開始同秒の note が最後の契機だった可能性があり、種別が違えば分類を確定しない
                           end-ambiguous? (boolean (seq end-same-sec))
                           end-conflict? (and end-ambiguous? (or (nil? last-trigger)
                                                                 (some #(not= (:kind %) (:kind last-trigger)) end-same-sec)))]]
                 {:ticket t :followed? (some? cur) :time-known? (some? from)
                  :next (when cur (classify-v1 prev cur))
                  :same-second? (boolean (or (seq same-sec) end-ambiguous? last-conflict?))
                  :trigger (cond (unreadable? t) "unknown-unreadable" (nil? from) "unknown-time"
                                 (or end-conflict? last-conflict?) "ambiguous-same-second"
                                 last-trigger (:kind last-trigger)
                                 (seq same-sec) "ambiguous-same-second" :else "none-observed")
                  ;; ticket が読めない/Review 終了時刻が無い停止は催促の有無を判定できないため nil (0 にしない)
                  :nudges (when (and from (not (unreadable? t))) (count (filter #(= "supervisor" (:kind %)) in)))
                  ;; 開始同秒の supervisor note は催促回数に確定計上せず別掲
                  :nudges-ambiguous (count (filter #(= "supervisor" (:kind %)) (concat same-sec end-same-sec)))
                  ;; 開始同秒の note があると最後の契機が不明なため ack 遅延は unknown (nil)
                  :ack-min (when (and to last-trigger (not end-ambiguous?))
                             (/ (.toSeconds (java.time.Duration/between (:at last-trigger) to)) 60.0))})
        followed (filter :followed? stalls)
        nudged? #(pos? (or (:nudges %) 0))
        acks (fn [xs] (keep :ack-min xs))
        by-trigger (into {} (for [[k xs] (group-by :trigger followed)]
                              [k {:n (count xs) :tasks (count (set (map :ticket xs)))
                                  :ack-p50-min (quantile (acks xs) 0.5) :ack-p90-min (quantile (acks xs) 0.9)}]))]
    {:definition "review で正常終了した run の後、次 run 開始までの最後の契機 note (Notes 見出しの source のみ) で再開契機を分類"
     :unreadable-tickets (count (filter unreadable? (keys runs-by-ticket)))
     ;; 同秒の契機 note だけがある停止は ambiguous-same-second (none-observed にも契機ありにも入れない)。
     ;; 後に確実な契機 note もある停止は そちらで分類し、ここで件数だけ示す
     :same-second-boundary (count (filter :same-second? stalls))
     :review-finishes (count stalls) :followed (count followed)
     :by-trigger by-trigger
     :by-trigger-next (frequencies (map (juxt :trigger :next) followed))
     :supervisor-nudged {:stalls (count (filter nudged? stalls))
                         :tasks (count (set (map :ticket (filter nudged? stalls))))
                         :repeated-nudge-stalls (count (filter #(> (or (:nudges %) 0) 1) stalls))
                         ;; 催促の有無を判定できない停止 (ticket 読めない/時刻なし)。上の件数には含めない
                         :unknown-nudge-stalls (count (filter #(nil? (:nudges %)) stalls))
                         ;; 同秒境界の supervisor note を持つ停止。上の件数は確定分のみで、これは下限との差の上限
                         :ambiguous-nudge-stalls (count (filter #(pos? (:nudges-ambiguous %)) stalls))}
     :open-stalls {:n (count (remove :followed? stalls))
                   :with-supervisor-nudge (count (filter #(and (not (:followed? %)) (nudged? %)) stalls))
                   :nudge-unknown (count (filter #(and (not (:followed? %)) (nil? (:nudges %))) stalls))}
     :ack-negative (count (filter #(neg? %) (acks followed)))}))

;; ---------------------------------------------------------------------------
;; Prometheus 出力 (公開 SLI の correction-rules/v1 系列)
;;
;; runner の SLI export (ai_ops_ledger.bb refresh-sli!) が `prom <root>` を呼び、sli.prom に連結する。
;; 全履歴 snapshot の gauge なので rate()/increase() は使わない。ticket ID 等の高 cardinality 値は label に出さない
;; (top-tasks / review-loops の ticket は件数だけに畳む)。Notes (vault) は読まない。
(def v1-transition-kinds ["gate_rework" "review_fix" "reopen_after_review" "retry_unknown"
                          "resume_interrupted" "resume_after_block" "groom_to_implement" "other"])

(defn prom-lines
  "report の結果 r を Prometheus text format で標準出力に書く。"
  [r]
  (let [seen (atom #{})
        esc (fn [v] (-> (str v) (str/replace "\\" "\\\\") (str/replace "\"" "\\\"")))
        line (fn [m labels v]
               (when-not (@seen m)
                 (swap! seen conj m)
                 (println (str "# HELP " m " Full-history snapshot (" rules-version "); do not use rate() or increase()."))
                 (println (str "# TYPE " m " gauge")))
               (println (str m (when (seq labels)
                                 (str "{" (str/join "," (map (fn [[k v]] (str (name k) "=\"" (esc v) "\"")) labels)) "}"))
                             " " v)))
        ;; gate 名は runner の固定語彙だが、未知の値が混ざっても label を汚さない
        safe (fn [v] (if (and (string? v) (re-matches #"[a-z0-9_.-]{1,40}" v)) v "other"))
        rates (:task-rates r) gr (:gate-rework r) rw (:review-wait r) loops (:detected (:review-loops r))]
    (line "ai_ops_v1_info" {:rules_version rules-version :loop_threshold loop-threshold} 1)
    (line "ai_ops_v1_generated_timestamp_seconds" {} (quot (System/currentTimeMillis) 1000))
    (doseq [[p k] [["tickets" :tickets] ["runs" :runs] ["unreadable_runs" :unreadable-runs]]]
      (line "ai_ops_v1_snapshot" {:part p} (get-in r [:snapshot k] 0)))
    (line "ai_ops_v1_reached_review_tasks" {} (:denominator-reached-review rates 0))
    (doseq [[k key] [["v0_candidate" :v0-correction-tasks] ["agent_system" :v1-agent-system-tasks]
                     ["owner_visible" :v1-owner-visible-tasks] ["owner_visible_agent_system" :v1-owner-visible-agent-system-tasks]]]
      (line "ai_ops_v1_correction_tasks" {:kind k} (get-in rates [key :n] 0)))
    (doseq [k v1-transition-kinds]
      (line "ai_ops_v1_transitions" {:kind k} (get-in r [:transitions :v1 k] 0)))
    (doseq [[p k] [["total" :total] ["pending" :pending] ["followed" :followed]]]
      (line "ai_ops_v1_gate_rework_runs" {:part p} (get gr k 0)))
    (doseq [[g n] (sort-by key (reduce-kv (fn [m g n] (update m (safe (or g "none")) (fnil + 0) n)) {} (or (:by-gate gr) {})))]
      (line "ai_ops_v1_gate_rework_runs_by_gate" {:gate g} n))
    (line "ai_ops_v1_gate_rework_tasks" {} (:tasks gr 0))
    (line "ai_ops_v1_review_loops" {:part "series"} (count loops))
    (line "ai_ops_v1_review_loops" {:part "tasks"} (count (distinct (map :ticket loops))))
    (line "ai_ops_v1_review_loops" {:part "max_length"} (reduce max 0 (map :length loops)))
    (doseq [[p k] [["total" :total] ["tasks" :tasks]]]
      (line "ai_ops_v1_reopen_after_review" {:part p} (get-in r [:reopen-after-review k] 0)))
    (doseq [[q k] [["0.5" :p50-h] ["0.9" :p90-h]] :let [v (get rw k)] :when (number? v)]
      (line "ai_ops_v1_review_wait_hours" {:quantile q} v))
    (doseq [[p k] [["followed" :followed] ["not_followed" :not-followed] ["over_24h" :over-24h] ["followed_without_time" :followed-without-time]]]
      (line "ai_ops_v1_review_wait" {:part p} (get rw k 0)))))

(defn -main [cmd & args]
  (case cmd
    "prom" (let [[root until] args
                 until (when-not (str/blank? until) until)
                 runs (load-runs root until)]
             (when (empty? runs)
               (binding [*out* *err*] (println "no runs found under" root))
               (System/exit 2))
             (prom-lines (report runs nil (when until (run-id->instant until)))))
    "report" (let [[root until vault] args
                   until (when-not (str/blank? until) until)
                   runs (load-runs root until)]
               (when (empty? runs)
                 (binding [*out* *err*] (println "no runs found under" root))
                 (System/exit 2))
               (when (and vault (let [d (fs/path vault "Tickets")]
                                   (not (and (fs/directory? d) (fs/readable? d) (fs/executable? d)
                                             (try (fs/list-dir d) true (catch Exception _ false))))))
                 (binding [*out* *err*] (println "vault Tickets dir not readable:" vault))
                 (System/exit 2))
               (prn (report runs
                            (when vault (load-triggers vault (keys runs)))
                            (when until (run-id->instant until)))))
    (do (binding [*out* *err*] (println "usage: bb ai_ops_insight.bb report <task-board-root> [until-run-id] [vault] | prom <task-board-root> [until-run-id]"))
        (System/exit 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
