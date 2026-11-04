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
(ns ai-ops-slo)
(require '[babashka.fs :as fs] '[cheshire.core :as json] '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/absolutize *file*)) "ai_ops_insight.bb")))

(def definition-version "slo-draft/v2")
(def owner-contact-kinds #{"owner-relay" "owner-direct"})
(def migration-ledger-path ["Projects" "task-board-review-retirement" "migration-ledger.md"])
;; 移行で Done になった票のうち、Owner の受入が Notes にある票。ledger は 1 回限りの移行の記録で今後は増えない。
;; 根拠は自由文なので実行時には読まず、ledger の根拠と票の Notes を人が照合した ID をここに固定する。
;; BOXP-387: 2026-11-03 Owner が実機の接続・音声対話の成功を報告。BOXP-215: 2026-10-07 Owner が preflight の成果を採用。
(def migrated-owner-accepted #{"BOXP-387" "BOXP-215"})
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
  "BOXP-395 の移行で Done になった ticket ID。Owner の受入があった票も含む (migrated-owner-accepted で分ける)。ID と新レーン以外は捨てる。
  票の行を 1 件も認識できないときは nil (移行 0 件と区別する)。"
  [lines]
  (let [rows (keep #(next (re-find #"^\| \[\[Tickets/([A-Z]+-\d+)\|[^\]]*\]\] \| [^|]* \| ([^|]*?) \|" %)) lines)]
    (when (seq rows)
      (set (keep (fn [[t lane]] (when (= "Done" lane) t)) rows)))))

(defn read-migrated-done
  "ledger を読めないときは nil。"
  [ledger]
  (try
    (when (fs/regular-file? ledger) (parse-migrated-done (fs/read-all-lines ledger)))
    (catch java.io.IOException _ nil)))

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
     :last-owner-contact-at (:at (last (filter #(owner-contact-kinds (:kind %)) in)))
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
  run の前後関係は停止の区間そのものなので run-active? は常に偽。カードと ticket の担当不一致は現在のボードしか分からないのでここでは見ない。
  猶予の判定は再開前の最後の Owner 接触で行う。猶予内の接触のあとに猶予を過ぎて再度接触して再開した停止も救援にするため。"
  [{:keys [contacts-known? from to last-owner-contact-at state]}]
  (if (or (not contacts-known?) (= :unknown-resume state))
    :unknown
    (rescue-class {:contact? (some? last-owner-contact-at)
                   :wait-reason "agent-continue"
                   :seconds-since-stop (when last-owner-contact-at
                                         (.toSeconds (java.time.Duration/between from last-owner-contact-at)))
                   :resumed? (some? to)})))

(defn blocked-stops
  "窓の中で Blocked へ止まった run の blocker category。Owner 判断待ちか外部 hold か既承認の修復待ちかは未分類で、救援にも停滞にも数えない。
  status が blocked の run に加え、result が blocked の run も数える。:result は effective-result なので、exit≠0 の failed を含み、Ready へ進む groom を含まない。
  category は runner の固定語彙だが、語彙外の値をそのまま出さないよう形式を検査する。"
  [runs-by-ticket since]
  (for [[_ runs] runs-by-ticket, r runs
        :let [at (ai-ops-insight/parse-inst (:finished-at r))]
        :when (and (or (= "blocked" (:status r)) (= "blocked" (:result r))) at (or (nil? since) (not (neg? (compare at since)))))]
    (let [c (:blocker r)]
      {:category (cond (nil? c) "none-recorded"
                       (#{"external" "agent-reported-blocked" "agent-process-error" "pr-gate-pr-url" "pr-gate-budget" "runner-internal-error" "continuation-limit" "gate-failure-budget-exhausted" "pr-gate-retry-limit" "codex-review-invalid-output" "reason-unavailable"} c) c
                       :else "other")
       :wait-reason (or (:wait-reason r) "unrecorded")})))

(defn coverage
  "窓の中で欠けた入力の件数。読めない run は Review 停止だったか不明なので、停止の件数には入らない。
  読めない run は終了時刻が分からないので、開始時刻では窓を判定しない。同じ task の run は順に走るので、次の run が窓より前に
  始まっているときだけ窓の外と確定できる。次の run が無い、または次の run の開始時刻が分からない run は、since があっても数える。"
  [runs-by-ticket ss since ledger-read?]
  (let [maybe-in-window? (fn [next-run] (let [next-start (some-> next-run run-start)]
                                          (or (nil? since) (nil? next-start) (not (neg? (compare next-start since))))))
        by-task (for [[_ runs] runs-by-ticket]
                  (for [[r next-run] (map vector runs (concat (rest runs) [nil]))
                        :when (and (= "unreadable" (:status r)) (maybe-in-window? next-run))]
                    r))
        unreadable (count (mapcat identity by-task))
        unknown-contacts (count (remove :contacts-known? ss))
        unknown-resume (count (filter #(= :unknown-resume (:state %)) ss))]
    {:complete (and (zero? unreadable) (zero? unknown-contacts) ledger-read?)
     :unreadable_runs unreadable
     :tasks_with_unreadable_runs (count (filter seq by-task))
     :stops_with_unknown_contacts unknown-contacts
     :stops_with_unknown_resume unknown-resume
     :migration_ledger_read ledger-read?}))

(def board-states ["running" "ready_not_started" "ready_assignee_mismatch" "waiting_owner" "waiting_owner_acceptance" "blocked_owner_decision" "blocked_external_hold" "blocked_new_scope" "blocked_agent_recoverable" "blocked_unrecorded" "backlog" "done" "other"])
(def wait-reasons ["owner-decision" "external-hold" "new-scope" "agent-recoverable" "unrecorded"])
(defn board-tasks [board runs assignee-of]
  (let [counts (frequencies
                (for [[t {:keys [lane assignee]}] board
                      :let [readable (remove #(= "unreadable" (:status %)) (get runs t))
                            latest (last readable)
                            blocked (last (filter #(or (= "blocked" (:status %)) (= "blocked" (:result %))) readable))]]
                  (case lane
                    "In Progress" "running"
                    "Ready" (if (= "boxp" assignee)
                              (if (= "owner-acceptance" (:result latest)) "waiting_owner_acceptance" "waiting_owner")
                              (if (= assignee (assignee-of t)) "ready_not_started" "ready_assignee_mismatch"))
                    "Blocked" (str "blocked_" (str/replace (or (:wait-reason blocked) "unrecorded") "-" "_"))
                    "Backlog" "backlog" "Done" "done" "other")))]
    (into {} (map (fn [state] [state (get counts state 0)]) board-states))))

(defn snapshot [runs-by-ticket triggers board assignee-of now {:keys [since ids? migrated-done]}]
  (let [ledger-read? (some? migrated-done)
        all (stops runs-by-ticket triggers board now)
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
        unclassified-blocked (count (filter #(= "unrecorded" (:wait-reason %)) blocked-categories))
        acceptable-blocked (count (filter #(acceptable-wait-reasons (:wait-reason %)) blocked-categories))
        rescue (frequencies (map continue-rescue cs))
        closed (:closed st)
        ;; ledger が読めないと移行か受入か分からないので、どちらにも数えず closed_unclassified へ出す
        closed-migrated (when ledger-read? (count (filter #(and (contains? migrated-done (:ticket %)) (not (contains? migrated-owner-accepted (:ticket %)))) closed)))
        ready (filter (fn [[_ c]] (= "Ready" (:lane c))) board)
        mismatch (for [[t c] ready
                       :let [a (assignee-of t)]
                       :when (and (:assignee c) (not= (:assignee c) a) (not= "boxp" (:assignee c)))]
                   t)]
    (cond->
     {:definition_version definition-version
      :generated_at (str now)
      :since (some-> since str)
      :coverage (coverage runs-by-ticket windowed since ledger-read?)
      :review_stops {:total (count ss)
                     :closed_by_acceptance (when ledger-read? (- (count closed) closed-migrated))
                     ;; BOXP-395 の移行で Done になった票のうち、Owner の受入が無い票
                     :closed_by_migration closed-migrated
                     :closed_unclassified (if ledger-read? 0 (count closed))
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
      :blocked_stops {:total (count blocked-categories) :reason_classified (boolean (some #(not= "unrecorded" (:wait-reason %)) blocked-categories)) :by_category (frequencies (map :category blocked-categories)) :by_wait_reason (frequencies (map :wait-reason blocked-categories))}
      :migration {:ledger_read ledger-read? :tickets_moved_to_done (when ledger-read? (count migrated-done))
                  :tickets_with_owner_acceptance (when ledger-read? (count (filter migrated-owner-accepted migrated-done)))}
      ;; 旧 SLI は分母が再開済みの停止だけで、開いたままの停止を落としていた。
      ;; 下の参考率は開いた停止をすべて停滞と置いた値。正当な待ちを含むので真の率でも下限でもない。
      :stall_reference {:followed_only {:numerator over24f :denominator (count followed)}
                        :with_open_as_stalled {:numerator (+ over24f (count over24o))
                                               :denominator (+ (count followed) (count open))}}
      ;; 既承認の停滞は continue の停止だけ測れる。Blocked に止まった既承認作業は分類できないので分母に入らない。
      :approved_work_stall {:status (if (zero? (+ c-denominator acceptable-blocked)) "no_observations" "measuring")
                            :numerator (+ c-over24f c-over24o)
                            :denominator (+ c-denominator acceptable-blocked)
                            :excluded_unclassified_blocked unclassified-blocked
                            :blocked_agent_recoverable (count (filter #(= "agent-recoverable" (:wait-reason %)) blocked-categories))}
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
      :board_tasks (board-tasks board runs-by-ticket assignee-of)
      :ready_queue {:cards (count ready) :card_ticket_assignee_mismatch (count mismatch)}
      ;; task 単位の救援なし完了率ではなく、continue の停止で起きた救援の件数。Blocked は分類できないので unknown のまま
      :owner_rescue {:status (if (seq cs) "continue_stops_only" "no_observations")
                     :rescue (get rescue :rescue 0)
                     :not_rescue (+ (get rescue :not-rescue 0) acceptable-blocked)
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
          migrated-done (read-migrated-done (apply fs/path vault migration-ledger-path))]
      (println (json/generate-string
                (snapshot runs (ai-ops-insight/load-triggers vault (keys runs)) board
                          #(ticket-assignee vault %) (java.time.Instant/now) {:since since :ids? ids? :migrated-done migrated-done}))))))

(defn prom [root vault]
  (when-not (and root vault (fs/readable? (fs/path root "runs")) (fs/directory? (fs/path root "runs"))
                 (fs/readable? (fs/path vault "Tickets")) (fs/directory? (fs/path vault "Tickets"))
                 (fs/readable? (fs/path vault "Boards" "Task Board.md")))
    (throw (ex-info "unreadable root or vault" {})))
  (let [s (json/parse-string (with-out-str (-main root vault)) true)
        lines (atom [])
        emit (fn [name rows]
               (swap! lines conj (str "# HELP " name " AI operations SLO measurement.\n# TYPE " name " gauge\n"
                                      (str/join "" (for [[labels value] rows :when (some? value)]
                                                      (str name (when (seq labels) (str "{" (str/join "," (map (fn [[k v]] (str (clojure.core/name k) "=\"" v "\"")) labels)) "}")) " " value "\n"))))))
        parts (fn [metric key ks] (emit metric (for [k ks] [{:part (name k)} (get-in s [key k])])))
        labels (fn [metric key label values] (emit metric (for [v values] [{label v} (get-in s [key (keyword v)] 0)])))]
    (emit "ai_ops_v2_info" [[{:definition_version definition-version :review_retired_at "2026-11-03T21:12:00Z"} 1]])
    (emit "ai_ops_v2_generated_timestamp_seconds" [[{} (.getEpochSecond (java.time.Instant/parse (:generated_at s)))]])
    (parts "ai_ops_v2_continue_stops" :continue_stops [:total :closed :followed :followed_over_15m :followed_over_24h :open :open_over_15m :open_over_24h :unknown_lane :unknown_resume])
    (parts "ai_ops_v2_owner_rescue" :owner_rescue [:rescue :not_rescue :unknown :excluded_unclassified_blocked])
    (emit "ai_ops_v2_owner_rescue_status" [[{:status (get-in s [:owner_rescue :status])} 1]])
    (parts "ai_ops_v2_approved_work_stall" :approved_work_stall [:numerator :denominator :excluded_unclassified_blocked :blocked_agent_recoverable])
    (emit "ai_ops_v2_blocked_stops" (for [v wait-reasons] [{:wait_reason v} (get-in s [:blocked_stops :by_wait_reason (keyword v)] 0)]))
    (emit "ai_ops_v2_blocked_stops_by_category" (for [v ["external" "agent-reported-blocked" "agent-process-error" "pr-gate-pr-url" "pr-gate-budget" "runner-internal-error" "continuation-limit" "gate-failure-budget-exhausted" "pr-gate-retry-limit" "codex-review-invalid-output" "reason-unavailable" "none-recorded" "other"]] [{:category v} (get-in s [:blocked_stops :by_category (keyword v)] 0)]))
    (emit "ai_ops_v2_owner_acceptance_stops" [[{} (get-in s [:owner_acceptance_stops :total])]])
    (parts "ai_ops_v2_review_stops" :review_stops [:total :closed_by_acceptance :closed_by_migration :closed_unclassified :followed :followed_over_24h :open :open_over_24h :unknown_lane :unknown_resume])
    (parts "ai_ops_v2_instructed_not_started" :instructed_not_started [:followed_over_1h :followed_over_24h :open_over_1h :open_over_24h :unevaluated_stops])
    (labels "ai_ops_v2_resume_last_contact" :resume_last_contact :kind ["owner-relay" "owner-direct" "supervisor" "none-observed" "unknown-unreadable"])
    (parts "ai_ops_v2_first_run_to_first_outcome" :first_run_to_first_outcome [:reached :censored :unevaluated])
    (emit "ai_ops_v2_first_run_to_first_outcome_hours" (for [[q k] [["0.5" :p50_h] ["0.9" :p90_h]]] [{:quantile q} (get-in s [:first_run_to_first_outcome k])]))
    (parts "ai_ops_v2_ready_queue" :ready_queue [:cards :card_ticket_assignee_mismatch])
    (labels "ai_ops_v2_board_tasks" :board_tasks :state board-states)
    (parts "ai_ops_v2_coverage" :coverage [:unreadable_runs :tasks_with_unreadable_runs :stops_with_unknown_contacts :stops_with_unknown_resume])
    (emit "ai_ops_v2_coverage_complete" [[{} (if (get-in s [:coverage :complete]) 1 0)]])
    (emit "ai_ops_v2_migration_ledger_read" [[{} (if (get-in s [:migration :ledger_read]) 1 0)]])
    (parts "ai_ops_v2_migration" :migration [:tickets_moved_to_done :tickets_with_owner_acceptance])
    (apply str @lines)))

(when (= *file* (System/getProperty "babashka.file"))
  (try (let [[command root vault] *command-line-args*]
         (when-not (= command "prom") (throw (ex-info "usage: ai_ops_slo.bb prom <root> <vault>" {})))
         (print (prom root vault)))
       (catch Exception e (binding [*out* *err*] (println (.getMessage e))) (System/exit 2))))
