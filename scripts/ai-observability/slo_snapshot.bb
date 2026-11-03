#!/usr/bin/env bb
;; BOXP-385: AI Ops SLO 案の「いま測れる値」を既存 metadata から read-only で出す (定義版 slo-draft/v1)。
;;
;; Usage: bb slo_snapshot.bb <task-board-root> <vault> [--since YYYY-MM-DD] [--ids]
;;
;; 読むもの: runs/*/*/summary.edn の固定 field (ai_ops_insight の検証を通したもの)、
;;   Boards/Task Board.md のカード行の ticket ID・レーン・assignee、Tickets/*.md の frontmatter status/assignee、
;;   Notes 見出しの時刻と source (allowlist)。本文・タイトル・prompt・events.jsonl は読まず、出力もしない。
;; 出力: 件数だけの JSON。ticket ID は --ids を付けたときの ready_queue.mismatch_ids だけ。
;; どこにも書き込まず、外部へ送らない。本ツールの出力は提案の根拠で、正式な SLO 判定ではない。
(require '[babashka.fs :as fs] '[cheshire.core :as json] '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/parent (fs/parent (fs/absolutize *file*))))
                         "docker/codex-workspace/task-board/ai_ops_insight.bb")))

(def definition-version "slo-draft/v1")
(def rescue-grace-seconds (* 15 60))
(def acceptable-wait-reasons #{"owner-decision" "owner-acceptance" "external-hold" "new-scope"})

(defn rescue-class
  "救援の定義案 (本文を読まず状態だけで決める)。戻り値は :rescue / :not-rescue / :unknown。
  - Owner の接触がなければ救援ではない。実行中の run があるときの接触は通常の状況確認。
  - Ready カードと ticket の assignee 不一致 (runner が起動できない) に接触で気づいたら救援。
  - 停止理由が agent-continue (既承認の残作業がある) で、猶予を過ぎてから接触し、その後に再開したら救援。
  - 停止理由が Owner 判断待ち/受入待ち/外部 hold/新 scope なら救援ではない。
  - 停止理由が未記録なら unknown (0 にも救援なしにも数えない)。"
  [{:keys [contact? run-active? queue-mismatch? wait-reason seconds-since-stop resumed?]}]
  (cond
    (not contact?) :not-rescue
    run-active? :not-rescue
    queue-mismatch? :rescue
    (nil? wait-reason) :unknown
    (acceptable-wait-reasons wait-reason) :not-rescue
    (not= "agent-continue" wait-reason) :unknown
    (nil? seconds-since-stop) :unknown
    (and resumed? (> seconds-since-stop rescue-grace-seconds)) :rescue
    :else :not-rescue))

(defn hours-between [a b] (/ (.toSeconds (java.time.Duration/between a b)) 3600.0))

(defn parse-board
  "ticket -> {:lane :assignee}。カード行の ID・レーン・assignee 以外は捨てる。"
  [lines]
  (first
   (reduce (fn [[m lane] line]
             (if (str/starts-with? line "## ")
               [m (subs line 3)]
               (if-let [[_ t] (re-find #"^- \[.\] \[\[Tickets/([A-Z]+-\d+)\|" line)]
                 [(assoc m t {:lane lane :assignee (second (re-find #"assignee::([A-Za-z0-9_-]+)" line))}) lane]
                 [m lane])))
           [{} nil] lines)))

(defn ticket-assignee [vault t]
  (let [f (fs/path vault "Tickets" (str t ".md"))]
    (when (fs/readable? f)
      (with-open [r (clojure.java.io/reader (str f))]
        (->> (line-seq r) (take 40)
             (some #(second (re-matches #"assignee:\s*([A-Za-z0-9_-]+)\s*" %))))))))

(defn stops
  "review で正常終了した run ごとの停止。再開は次 run の開始、契機は区間内の Notes 見出し (時刻と種別のみ)。
  読めない run があっても読める run の停止は残す (読めない run は次 run の開始時刻としてだけ使い、件数は :coverage へ出す)。
  ticket が読めない、または再開時刻が不明な停止は :contacts-known? false とし、接触なしと区別する。"
  [runs-by-ticket triggers board now]
  (for [[t runs] runs-by-ticket
        [prev cur] (map vector runs (concat (rest runs) [nil]))
        :when (and (= "succeeded" (:status prev)) (= "review" (:result prev)) (:finished-at prev))
        :let [from (java.time.Instant/parse (:finished-at prev))
              to (when cur (or (ai-ops-insight/parse-inst (:started-at cur)) (ai-ops-insight/run-id->instant (:run-id cur))))
              resume-unknown? (and (some? cur) (nil? to))
              ts (let [v (get triggers t)] (when (sequential? v) v))
              contacts-known? (and (some? ts) (not resume-unknown?))
              in (when contacts-known?
                   (sort-by :at (filter #(and (pos? (compare (:at %) from)) (or (nil? to) (neg? (compare (:at %) to)))) ts)))
              lane (get-in board [t :lane])]]
    {:ticket t :from from :to to
     :followed? (some? cur)
     :lane lane
     :contacts-known? contacts-known?
     :state (cond resume-unknown? :unknown-resume (some? cur) :followed (nil? lane) :unknown-lane (= "Done" lane) :closed :else :open)
     :hours (when-not resume-unknown? (hours-between from (or to now)))
     :contact-kinds (map :kind in)
     :last-kind (:kind (last in))
     :first-contact-wait-h (when (first in) (hours-between (:at (first in)) (or to now)))}))

(defn first-run-to-review
  "秒精度で測れる区間: 最初の run 開始 -> 最初の Review 到達。Owner の受入待ちを含まない。
  未到達の task は打切りとして別掲し、分位に入れない。
  最初の読める Review より前 (未到達ならいずれか) に読めない run がある task は、最初の Review を特定できないので :unevaluated へ出す。"
  [runs-by-ticket since]
  (let [review? #(and (= "succeeded" (:status %)) (= "review" (:result %)) (:finished-at %))
        xs (for [[_ runs] runs-by-ticket
                 :let [start (some #(or (ai-ops-insight/parse-inst (:started-at %)) (ai-ops-insight/run-id->instant (:run-id %))) runs)]
                 :when (or (nil? start) (nil? since) (not (neg? (compare start since))))
                 :let [stop (some-> (some #(when (review? %) %) runs) :finished-at java.time.Instant/parse)
                       unknown? (or (nil? start)
                                    (some #(= "unreadable" (:status %)) (take-while (complement review?) runs))
                                    (and stop (neg? (compare stop start))))]]
             (cond unknown? :unevaluated
                   stop (hours-between start stop)
                   :else :censored))
        done (filter number? xs)]
    {:reached (count done) :censored (count (filter #{:censored} xs)) :unevaluated (count (filter #{:unevaluated} xs))
     :p50_h (ai-ops-insight/quantile done 0.5) :p90_h (ai-ops-insight/quantile done 0.9)}))

(defn over [h] (fn [s] (> (or (:hours s) 0) h)))

(defn coverage
  "窓の中で欠けた入力の件数。読めない run は Review 停止だったか不明なので、停止の件数には入らない。
  時刻を出せない run は窓を判定できないので、since があっても数える。"
  [runs-by-ticket ss since]
  (let [in-window? (fn [r] (let [at (ai-ops-insight/run-id->instant (:run-id r))]
                             (or (nil? since) (nil? at) (not (neg? (compare at since))))))
        by-task (for [[_ runs] runs-by-ticket] (filter #(and (= "unreadable" (:status %)) (in-window? %)) runs))
        unreadable (count (mapcat identity by-task))
        unknown-contacts (count (remove :contacts-known? ss))
        unknown-resume (count (filter #(= :unknown-resume (:state %)) ss))]
    {:complete (and (zero? unreadable) (zero? unknown-contacts))
     :unreadable_runs unreadable
     :tasks_with_unreadable_runs (count (filter seq by-task))
     :stops_with_unknown_contacts unknown-contacts
     :stops_with_unknown_resume unknown-resume}))

(defn snapshot [runs-by-ticket triggers board assignee-of now {:keys [since ids?]}]
  (let [all (stops runs-by-ticket triggers board now)
        ss (if since (filter #(not (neg? (compare (:from %) since))) all) all)
        st (group-by :state ss)
        followed (:followed st) open (:open st)
        over24f (count (filter (over 24) followed))
        over24o (filter (over 24) open)
        waited (filter :first-contact-wait-h ss)
        ready (filter (fn [[_ c]] (= "Ready" (:lane c))) board)
        mismatch (for [[t c] ready
                       :let [a (assignee-of t)]
                       :when (and (:assignee c) (not= (:assignee c) a) (not= "boxp" (:assignee c)))]
                   t)]
    (cond->
     {:definition_version definition-version
      :generated_at (str now)
      :since (some-> since str)
      :coverage (coverage runs-by-ticket ss since)
      :review_stops {:total (count ss)
                     :closed_by_acceptance (count (:closed st))
                     :followed (count followed)
                     :followed_over_24h over24f
                     :open (count open)
                     :open_over_24h (count over24o)
                     :open_over_24h_by_lane (frequencies (map :lane over24o))
                     :unknown_lane (count (:unknown-lane st))
                     :unknown_resume (count (:unknown-resume st))}
      ;; 旧 SLI は分母が再開済みの停止だけで、開いたままの停止を落としていた。
      ;; 下の参考率は開いた停止をすべて停滞と置いた値。正当な待ちを含むので真の率でも下限でもない。
      :stall_reference {:followed_only {:numerator over24f :denominator (count followed)}
                        :with_open_as_stalled {:numerator (+ over24f (count over24o))
                                               :denominator (+ (count followed) (count open))}
                        :approved_work_stall "unknown: wait_reason 未記録"}
      :instructed_not_started {:followed_over_1h (count (filter #(and (:followed? %) (> (:first-contact-wait-h %) 1)) waited))
                               :followed_over_24h (count (filter #(and (:followed? %) (> (:first-contact-wait-h %) 24)) waited))
                               :open_over_1h (count (filter #(and (= :open (:state %)) (> (:first-contact-wait-h %) 1)) waited))
                               :open_over_24h (count (filter #(and (= :open (:state %)) (> (:first-contact-wait-h %) 24)) waited))
                               ;; ticket が読めず接触の有無が不明な停止。上の件数には入らないので過少でありうる
                               :unevaluated_stops (count (remove :contacts-known? (concat followed open)))}
      ;; 再開の直前にあった note の source。承認継続・差戻し・新 scope を区別していないので救援率ではない。
      :resume_last_contact (let [f (frequencies (map #(cond (not (:contacts-known? %)) "unknown-unreadable"
                                                               :else (or (:last-kind %) "none-observed")) followed))]
                             (into {} (map (fn [k] [k (get f k 0)]) ["owner-relay" "owner-direct" "supervisor" "none-observed" "unknown-unreadable"])))
      :first_run_to_review (first-run-to-review runs-by-ticket since)
      :ready_queue {:cards (count ready) :card_ticket_assignee_mismatch (count mismatch)}
      :owner_rescue {:status "unknown" :reason "wait_reason 未記録"}}
      ids? (assoc-in [:ready_queue :mismatch_ids] (vec (sort mismatch))))))

(defn -main [& args]
  (let [[root vault & opts] args
        opts (vec opts)
        since (when-let [i (some #(when (= "--since" (opts %)) %) (range (count opts)))]
                (java.time.Instant/parse (str (opts (inc i)) "T00:00:00Z")))
        ids? (some #{"--ids"} opts)]
    (when-not (and root vault (fs/directory? (fs/path root "runs")) (fs/directory? (fs/path vault "Tickets")))
      (binding [*out* *err*] (println "usage: bb slo_snapshot.bb <task-board-root> <vault> [--since YYYY-MM-DD] [--ids]"))
      (System/exit 2))
    (let [runs (ai-ops-insight/load-runs root nil)
          board-file (fs/path vault "Boards" "Task Board.md")
          board (parse-board (fs/read-all-lines board-file))]
      (println (json/generate-string
                (snapshot runs (ai-ops-insight/load-triggers vault (keys runs)) board
                          #(ticket-assignee vault %) (java.time.Instant/now) {:since since :ids? ids?}))))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
