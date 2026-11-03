#!/usr/bin/env bb
;; BOXP-385: AI Ops SLO 案の「いま測れる値」を既存 metadata から read-only で出す (定義版 slo-draft/v2)。
;; v2: BOXP-395 の Review 廃止に合わせ、continue の停止を既承認の停滞として数え、移行で Done になった票を受入と分ける。
;;
;; Usage: bb slo_snapshot.bb <task-board-root> <vault> [--since YYYY-MM-DD] [--ids]
;;
;; 読むもの: runs/*/*/summary.edn の固定 field (ai_ops_insight の検証を通したもの)、
;;   Boards/Task Board.md のカード行の ticket ID・レーン・assignee、Tickets/*.md の frontmatter status/assignee、
;;   Notes 見出しの時刻と source (allowlist)、移行 ledger の ticket ID と新レーン。本文・タイトル・prompt・events.jsonl は読まず、出力もしない。
;; 出力: 件数だけの JSON。ticket ID は --ids を付けたときの ready_queue.mismatch_ids だけ。
;; どこにも書き込まず、外部へ送らない。本ツールの出力は提案の根拠で、正式な SLO 判定ではない。
(require '[babashka.fs :as fs] '[cheshire.core :as json] '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/parent (fs/parent (fs/absolutize *file*))))
                         "docker/codex-workspace/task-board/ai_ops_insight.bb")))

(def definition-version "slo-draft/v2")
(def owner-contact-kinds #{"owner-relay" "owner-direct"})
(def migration-ledger-path ["Projects" "task-board-review-retirement" "migration-ledger.md"])
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

(defn run-start [r] (or (ai-ops-insight/parse-inst (:started-at r)) (ai-ops-insight/run-id->instant (:run-id r))))

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

(defn parse-migrated-done
  "BOXP-395 の移行で Done になった ticket ID。移行の判定で閉じた票で、Owner の受入ではない。ID と新レーン以外は捨てる。"
  [lines]
  (set (keep #(second (re-find #"^\| \[\[Tickets/([A-Z]+-\d+)\|[^\]]*\]\] \| [^|]* \| Done \|" %)) lines)))

(defn ticket-assignee [vault t]
  (let [f (fs/path vault "Tickets" (str t ".md"))]
    (when (fs/readable? f)
      (with-open [r (clojure.java.io/reader (str f))]
        (->> (line-seq r) (take 40)
             (some #(second (re-matches #"assignee:\s*([A-Za-z0-9_-]+)\s*" %))))))))

(defn stops
  "review / continue / owner-acceptance で正常終了した run ごとの停止 (:kind で区別)。gate で止まった run は status が別なので入らない。
  再開は次 run の開始、契機は区間内の Notes 見出し (時刻と種別のみ)。
  読めない run があっても読める run の停止は残す (読めない run は次 run の開始時刻としてだけ使い、件数は :coverage へ出す)。
  ticket が読めない、または再開時刻が不明な停止は :contacts-known? false とし、接触なしと区別する。"
  [runs-by-ticket triggers board now]
  (for [[t runs] runs-by-ticket
        [prev cur] (map vector runs (concat (rest runs) [nil]))
        :when (and (= "succeeded" (:status prev)) (#{"review" "continue" "owner-acceptance"} (:result prev)) (:finished-at prev))
        :let [from (java.time.Instant/parse (:finished-at prev))
              to (when cur (run-start cur))
              resume-unknown? (and (some? cur) (nil? to))
              ts (let [v (get triggers t)] (when (sequential? v) v))
              contacts-known? (and (some? ts) (not resume-unknown?))
              in (when contacts-known?
                   (sort-by :at (filter #(and (pos? (compare (:at %) from)) (or (nil? to) (neg? (compare (:at %) to)))) ts)))
              lane (get-in board [t :lane])]]
    {:ticket t :from from :to to :kind (:result prev)
     :followed? (some? cur)
     :lane lane
     :contacts-known? contacts-known?
     :state (cond resume-unknown? :unknown-resume (some? cur) :followed (nil? lane) :unknown-lane (= "Done" lane) :closed :else :open)
     :hours (when-not resume-unknown? (hours-between from (or to now)))
     :contact-kinds (map :kind in)
     :first-owner-contact-at (:at (first (filter #(owner-contact-kinds (:kind %)) in)))
     :last-kind (:kind (last in))
     :first-contact-wait-h (when (first in) (hours-between (:at (first in)) (or to now)))}))

(defn first-run-to-first-outcome
  "秒精度で測れる区間: 最初の run 開始 -> 最初に review / continue / owner-acceptance / done で正常終了した時刻。Owner の受入待ちを含まない。
  旧 Review 到達と continue はどちらも gate 通過の時点。done は gate を通らないが、数えないと即完了の task が打切りに見える。
  未到達の task は打切りとして別掲し、分位に入れない。
  最初の読める結果より前 (未到達ならいずれか) に読めない run がある task は、最初の結果を特定できないので :unevaluated へ出す。"
  [runs-by-ticket since]
  (let [outcome? #(and (= "succeeded" (:status %)) (#{"review" "continue" "owner-acceptance" "done"} (:result %)) (:finished-at %))
        xs (for [[_ runs] runs-by-ticket
                 :let [start (some run-start runs)]
                 :when (or (nil? start) (nil? since) (not (neg? (compare start since))))
                 :let [stop (some-> (some #(when (outcome? %) %) runs) :finished-at java.time.Instant/parse)
                       unknown? (or (nil? start)
                                    (some #(= "unreadable" (:status %)) (take-while (complement outcome?) runs))
                                    (and stop (neg? (compare stop start))))]]
             (cond unknown? :unevaluated
                   stop (hours-between start stop)
                   :else :censored))
        done (filter number? xs)]
    {:reached (count done) :censored (count (filter #{:censored} xs)) :unevaluated (count (filter #{:unevaluated} xs))
     :p50_h (ai-ops-insight/quantile done 0.5) :p90_h (ai-ops-insight/quantile done 0.9)}))

(defn over [h] (fn [s] (> (or (:hours s) 0) h)))

(defn continue-rescue
  "continue の停止は result が既承認の残作業を示すので、停止理由は agent-continue と決まる。:unknown は接触の有無が不明な停止。
  run の前後関係は停止の区間そのものなので run-active? は常に偽。カードと ticket の担当不一致は現在のボードしか分からないのでここでは見ない。"
  [{:keys [contacts-known? from to first-owner-contact-at state]}]
  (if (or (not contacts-known?) (= :unknown-resume state))
    :unknown
    (rescue-class {:contact? (some? first-owner-contact-at)
                   :wait-reason "agent-continue"
                   :seconds-since-stop (when first-owner-contact-at
                                         (.toSeconds (java.time.Duration/between from first-owner-contact-at)))
                   :resumed? (some? to)})))

(defn blocked-stops
  "窓の中で Blocked へ止まった run の blocker category。Owner 判断待ちか外部 hold か既承認の修復待ちかは未分類で、救援にも停滞にも数えない。
  category は runner の固定語彙だが、語彙外の値をそのまま出さないよう形式を検査する。"
  [runs-by-ticket since]
  (for [[_ runs] runs-by-ticket, r runs
        :let [at (ai-ops-insight/parse-inst (:finished-at r))]
        :when (and (= "blocked" (:status r)) at (or (nil? since) (not (neg? (compare at since)))))]
    (let [c (:blocker r)]
      (cond (nil? c) "none-recorded"
            (re-matches #"[a-z][a-z-]{0,40}" (str c)) (str c)
            :else "other"))))

(defn coverage
  "窓の中で欠けた入力の件数。読めない run は Review 停止だったか不明なので、停止の件数には入らない。
  読めない run は終了時刻が分からないので、開始時刻では窓を判定しない。同じ task の run は順に走るので、次の run が窓より前に
  始まっているときだけ窓の外と確定できる。次の run が無い、または次の run の開始時刻が分からない run は、since があっても数える。"
  [runs-by-ticket ss since]
  (let [maybe-in-window? (fn [next-run] (let [next-start (some-> next-run run-start)]
                                          (or (nil? since) (nil? next-start) (not (neg? (compare next-start since))))))
        by-task (for [[_ runs] runs-by-ticket]
                  (for [[r next-run] (map vector runs (concat (rest runs) [nil]))
                        :when (and (= "unreadable" (:status r)) (maybe-in-window? next-run))]
                    r))
        unreadable (count (mapcat identity by-task))
        unknown-contacts (count (remove :contacts-known? ss))
        unknown-resume (count (filter #(= :unknown-resume (:state %)) ss))]
    {:complete (and (zero? unreadable) (zero? unknown-contacts))
     :unreadable_runs unreadable
     :tasks_with_unreadable_runs (count (filter seq by-task))
     :stops_with_unknown_contacts unknown-contacts
     :stops_with_unknown_resume unknown-resume}))

(defn snapshot [runs-by-ticket triggers board assignee-of now {:keys [since ids? migrated-done ledger-read?]}]
  (let [all (stops runs-by-ticket triggers board now)
        windowed (if since (filter #(not (neg? (compare (:from %) since))) all) all)
        by-kind (group-by :kind windowed)
        ss (get by-kind "review")
        st (group-by :state ss)
        followed (:followed st) open (:open st)
        over24f (count (filter (over 24) followed))
        over24o (filter (over 24) open)
        ;; 継続の代理指標は review と continue の両方を見る。owner-acceptance は Owner の確認を待つ停止なので除く。
        working (concat ss (get by-kind "continue"))
        wst (group-by :state working)
        waited (filter :first-contact-wait-h working)
        cs (get by-kind "continue")
        cst (group-by :state cs)
        cfollowed (:followed cst) copen (:open cst)
        c-over24f (count (filter (over 24) cfollowed))
        c-over24o (count (filter (over 24) copen))
        c-denominator (+ (count cfollowed) (count copen))
        blocked-categories (blocked-stops runs-by-ticket since)
        unclassified-blocked (count blocked-categories)
        rescue (frequencies (map continue-rescue cs))
        closed (:closed st)
        closed-migrated (count (filter #(contains? migrated-done (:ticket %)) closed))
        ready (filter (fn [[_ c]] (= "Ready" (:lane c))) board)
        mismatch (for [[t c] ready
                       :let [a (assignee-of t)]
                       :when (and (:assignee c) (not= (:assignee c) a) (not= "boxp" (:assignee c)))]
                   t)]
    (cond->
     {:definition_version definition-version
      :generated_at (str now)
      :since (some-> since str)
      :coverage (coverage runs-by-ticket windowed since)
      :review_stops {:total (count ss)
                     :closed_by_acceptance (- (count closed) closed-migrated)
                     ;; BOXP-395 の移行で Done になった票。Owner の受入ではない
                     :closed_by_migration closed-migrated
                     :followed (count followed)
                     :followed_over_24h over24f
                     :open (count open)
                     :open_over_24h (count over24o)
                     :open_over_24h_by_lane (frequencies (map :lane over24o))
                     :unknown_lane (count (:unknown-lane st))
                     :unknown_resume (count (:unknown-resume st))}
      ;; continue は「既承認の残作業があり gate を通った」停止で、次 run がすぐ始まるのが正常。
      :continue_stops {:total (count cs)
                       :closed (count (:closed cst))
                       :followed (count cfollowed)
                       :followed_over_15m (count (filter (over 0.25) cfollowed))
                       :followed_over_24h c-over24f
                       :open (count copen)
                       :open_over_15m (count (filter (over 0.25) copen))
                       :open_over_24h c-over24o
                       :unknown_lane (count (:unknown-lane cst))
                       :unknown_resume (count (:unknown-resume cst))}
      :owner_acceptance_stops {:total (count (get by-kind "owner-acceptance"))}
      :blocked_stops {:total unclassified-blocked :reason_classified false :by_category (frequencies blocked-categories)}
      :migration {:ledger_read ledger-read? :tickets_moved_to_done (count migrated-done)}
      ;; 旧 SLI は分母が再開済みの停止だけで、開いたままの停止を落としていた。
      ;; 下の参考率は開いた停止をすべて停滞と置いた値。正当な待ちを含むので真の率でも下限でもない。
      :stall_reference {:followed_only {:numerator over24f :denominator (count followed)}
                        :with_open_as_stalled {:numerator (+ over24f (count over24o))
                                               :denominator (+ (count followed) (count open))}}
      ;; 既承認の停滞は continue の停止だけ測れる。Blocked に止まった既承認作業は分類できないので分母に入らない。
      :approved_work_stall {:status (if (zero? c-denominator) "no_observations" "measuring")
                            :numerator (+ c-over24f c-over24o)
                            :denominator c-denominator
                            :excluded_unclassified_blocked unclassified-blocked}
      :instructed_not_started {:followed_over_1h (count (filter #(and (:followed? %) (> (:first-contact-wait-h %) 1)) waited))
                               :followed_over_24h (count (filter #(and (:followed? %) (> (:first-contact-wait-h %) 24)) waited))
                               :open_over_1h (count (filter #(and (= :open (:state %)) (> (:first-contact-wait-h %) 1)) waited))
                               :open_over_24h (count (filter #(and (= :open (:state %)) (> (:first-contact-wait-h %) 24)) waited))
                               ;; ticket が読めず接触の有無が不明な停止。上の件数には入らないので過少でありうる
                               :unevaluated_stops (count (remove :contacts-known? (concat (:followed wst) (:open wst))))}
      ;; 再開の直前にあった note の source。承認継続・差戻し・新 scope を区別していないので救援率ではない。
      :resume_last_contact (let [f (frequencies (map #(cond (not (:contacts-known? %)) "unknown-unreadable"
                                                               :else (or (:last-kind %) "none-observed")) (:followed wst)))]
                             (into {} (map (fn [k] [k (get f k 0)]) ["owner-relay" "owner-direct" "supervisor" "none-observed" "unknown-unreadable"])))
      :first_run_to_first_outcome (first-run-to-first-outcome runs-by-ticket since)
      :ready_queue {:cards (count ready) :card_ticket_assignee_mismatch (count mismatch)}
      ;; task 単位の救援なし完了率ではなく、continue の停止で起きた救援の件数。Blocked は分類できないので unknown のまま
      :owner_rescue {:status (if (seq cs) "continue_stops_only" "no_observations")
                     :rescue (get rescue :rescue 0)
                     :not_rescue (get rescue :not-rescue 0)
                     :unknown (get rescue :unknown 0)
                     :excluded_unclassified_blocked unclassified-blocked}}
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
          board (parse-board (fs/read-all-lines board-file))
          ledger (apply fs/path vault migration-ledger-path)
          ledger-read? (fs/readable? ledger)
          migrated-done (if ledger-read? (parse-migrated-done (fs/read-all-lines ledger)) #{})]
      (println (json/generate-string
                (snapshot runs (ai-ops-insight/load-triggers vault (keys runs)) board
                          #(ticket-assignee vault %) (java.time.Instant/now) {:since since :ids? ids? :migrated-done migrated-done :ledger-read? ledger-read?}))))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
