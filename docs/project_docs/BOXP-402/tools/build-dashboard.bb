#!/usr/bin/env bb
;; BOXP-402: 既存 ai-ops-quality.json から新構成の dashboard JSON を生成する (再現用)。
;; Usage: bb build-dashboard.bb <old.json> <out.json>
(require '[cheshire.core :as json] '[clojure.string :as str])

(def old-path (first *command-line-args*))
(def out-path (second *command-line-args*))
(def old (json/parse-string (slurp old-path) true))
(def by-id (into {} (map (juxt :id identity) (:panels old))))
(def job "job=\"codex-workspace-ai-ops-metrics\"")
(def hjob "job=\"hermes-agent-ai-ops-metrics\"")
(def ds {:type "prometheus" :uid "${datasource}"})
(def v2-novalue "未計測：集計(v2)が未配備（arch の反映待ち）")
(def retired "2026-11-03 21:12 UTC")
(def next-id (atom 200))
(defn nid [] (swap! next-id inc))

(defn target [expr legend & [{:keys [format]}]]
  (cond-> {:datasource ds :expr expr :legendFormat legend :refId (str (char (+ 65 (rand-int 26))) (nid)) :instant true :range false}
    format (assoc :format format)))
(defn targets [qs] (map-indexed (fn [i [expr legend]] (assoc (target expr legend) :refId (str "Q" i))) qs))

(defn stat [title desc qs & [{:keys [unit no-value decimals mappings thresholds color-mode] :or {unit "short" no-value v2-novalue color-mode "none"}}]]
  {:id (nid) :type "stat" :title title :description desc :datasource ds
   :targets (targets qs)
   :fieldConfig {:defaults (cond-> {:unit unit :noValue no-value :mappings (or mappings [])
                                    :thresholds (or thresholds {:mode "absolute" :steps [{:color "text" :value nil}]})}
                             decimals (assoc :decimals decimals))
                 :overrides []}
   :options {:colorMode color-mode :graphMode "none" :justifyMode "center" :orientation "auto" :textMode "value_and_name"
             :reduceOptions {:calcs ["lastNotNull"] :fields "" :values false} :wideLayout true}})

(def table-exclude {:prometheus true :pod true :instance true :endpoint true :service true :namespace true :__name__ true :Time true :container true :job true})
(defn table [title desc expr & [{:keys [no-value mappings rename] :or {no-value v2-novalue}}]]
  {:id (nid) :type "table" :title title :description desc :datasource ds
   :targets [(assoc (target expr "" {:format "table"}) :refId "A")]
   :transformations [{:id "merge" :options {}} {:id "organize" :options {:excludeByName table-exclude :renameByName (or rename {})}}]
   :fieldConfig {:defaults {:noValue no-value :mappings (or mappings [])} :overrides []}
   :options {:showHeader true :cellHeight "sm"}})

(defn text [title content] {:id (nid) :type "text" :title title :options {:mode "markdown" :content content}})

(defn old-panel
  "既存 panel を再利用する。title/description/noValue を上書きし、job label の除外などは触らない。"
  [id {:keys [title description no-value desc-prefix]}]
  (let [p (or (by-id id) (throw (ex-info (str "missing panel " id) {})))]
    (cond-> p
      title (assoc :title title)
      description (assoc :description description)
      desc-prefix (update :description #(str desc-prefix (when (seq %) (str " ／ 元の説明: " %))))
      no-value (assoc-in [:fieldConfig :defaults :noValue] no-value))))

(defn place
  "[[panel w h] ...] を 24 幅に順に敷き詰める (幅が足りなければ次の行)。y0 から開始し [panels next-y] を返す。"
  [items y0]
  (loop [items items x 0 y y0 row-h 0 acc []]
    (if-let [[p w h] (first items)]
      (let [[x y row-h] (if (> (+ x w) 24) [0 (+ y row-h) 0] [x y row-h])]
        (recur (rest items) (+ x w) y (max row-h h) (conj acc (assoc p :gridPos {:x x :y y :w w :h h}))))
      [acc (+ y row-h)])))

(defn row [title y collapsed? children]
  (cond-> {:id (nid) :type "row" :title title :collapsed collapsed? :gridPos {:x 0 :y y :w 24 :h 1} :panels []}
    collapsed? (assoc :panels children)))

(defn section
  "行見出し + 中身。collapsed なら中身は row の :panels に入れる。[panels next-y] を返す。"
  [title y collapsed? items]
  (let [[children next-y] (place items (inc y))
        r (row title y collapsed? children)]
    (if collapsed? [[r] (inc y)] [(into [r] children) next-y])))

;; ---------------------------------------------------------------------------
(def intro
  (str "**まず上からこの順に見る**（更新 1 分、数値は本文なしの metadata だけで作る）\n\n"
       "1. **いま止まっている作業・自分の判断が必要な作業** … Blocked の理由と、起動できない Ready がないか。\n"
       "2. **任せた作業が催促なしで進んでいるか** … `continue`（既承認の残作業あり）で止まったまま再開していない作業、再開までの遅れ、催促・手助けが必要だった作業。\n"
       "3. **成果の品質と数字の信頼性** … 最初の提出から手直しなく受入された割合と、その数字を信じてよいか（収集の欠落・鮮度・移行で Done になった票）。\n\n"
       "折りたたみ: **詳細**（原因調査・自動チェック・未計測の理由）／ **利用枠**（Claude Code / Codex）／ **旧 Review 時代の履歴**（" retired " 以前。現行の数値と比較しない）。\n\n"
       "**表示の意味**: 「未計測：…」= 入力や集計が無い（0 ではない）／「対象なし」= 分母 0・該当なし／「計測障害」= export 失敗・鮮度切れ／ 実測 0 は `0` と出す。"
       "率は必ず件数と分母を併読する。英語の系列名・enum は各 panel の説明（i アイコン）に残す。"))

(def outcome-mappings [{:type "value" :options {"accepted" {:text "受入済み（Done）"} "in-flight" {:text "進行中（Ready / In Progress）"} "blocked" {:text "Blocked"} "backlog" {:text "未着手（Backlog）"}}}])
(def v2 "ai_ops_v2_")
(defn q [metric sel] (str v2 metric "{" job (when sel (str "," sel)) "}"))

(def row1-items
  [[(stat "いまの作業の状態（票の件数）"
          (str "Task Board のレーンと票の担当、最新 run から数える現在値。『カード登録』と『担当の受領・実行開始』は同じにしない: Ready にあっても担当が agent で起動可能なら『実行可能だが未着手』、カードの担当と票の担当が食い違って runner が起動できないものは『起動できない Ready』。"
               "『本人が持っている』は Ready で担当 boxp。『本人の受入待ち』は最新 run が owner-acceptance で終わった票。系列: " v2 "board_tasks{state}。")
          [[(q "board_tasks" "state=\"running\"") "実行中"]
           [(q "board_tasks" "state=\"ready_not_started\"") "実行可能だが未着手"]
           [(q "board_tasks" "state=\"ready_assignee_mismatch\"") "起動できない Ready（担当不一致）"]
           [(q "board_tasks" "state=\"waiting_owner_acceptance\"") "本人の受入待ち"]
           [(q "board_tasks" "state=\"waiting_owner\"") "本人が持っている（Ready / boxp）"]
           [(str "sum(" (q "board_tasks" "state=~\"blocked_.*\"") ")") "Blocked（合計。理由は右）"]]) 12 6]
   [(stat "Blocked の停止理由（判断が必要なのは『本人の判断待ち』）"
          (str "Blocked で終わった run を、agent が最終出力に添えた理由 (TASK_BOARD_WAIT_REASON) で分ける。理由がない run は『理由未記録』として残し、0 や正常待ちに混ぜない。"
               "英語 enum: owner-decision / external-hold / new-scope / agent-recoverable / unrecorded。系列: " v2 "blocked_stops{wait_reason}。記録開始（BOXP-402 配備）より前の Blocked はすべて『理由未記録』。")
          [[(q "blocked_stops" "wait_reason=\"owner-decision\"") "本人の判断待ち"]
           [(q "blocked_stops" "wait_reason=\"external-hold\"") "外部待ち"]
           [(q "blocked_stops" "wait_reason=\"new-scope\"") "新しい scope（承認外）"]
           [(q "blocked_stops" "wait_reason=\"agent-recoverable\"") "agent 側で回復できる"]
           [(q "blocked_stops" "wait_reason=\"unrecorded\"") "理由未記録"]]) 12 6]
   [(table "票の状態（累積の snapshot）"
           (str "全履歴の票を現在の状態で数えた値。系列: ai_ops_tasks{outcome}（accepted / in-flight / blocked / backlog）。No data は SLI export の未配備・停止。")
           (str "ai_ops_tasks{" job "}") {:no-value "未計測：SLI export が未配備・停止" :mappings outcome-mappings :rename {:outcome "状態" :Value "件数"}}) 8 5]
   [(stat "起動できない Ready カード（担当不一致）"
          (str "Ready レーンのカード数と、カードの担当が boxp 以外で票の担当と一致しないカード数。runner は票の担当を読むので後者は起動しない（登録しただけで受領されていない状態）。古いカードも含むので候補として扱う。系列: " v2 "ready_queue{part}。")
          [[(q "ready_queue" "part=\"cards\"") "Ready カード数"]
           [(q "ready_queue" "part=\"card_ticket_assignee_mismatch\"") "担当不一致（起動しない）"]]) 8 5]
   [(stat "本人の受入待ちで止まった run（累積）"
          (str "owner-acceptance で正常終了した run の数。本人（Owner）の実機確認を待つ正当な停止で、停滞にも救援にも数えない。系列: " v2 "owner_acceptance_stops。")
          [[(q "owner_acceptance_stops" nil) "受入待ちの停止"]]) 8 5]])

(def row2-items
  [[(stat "継続待ちで止まったままの作業（再開していない continue 停止）"
          (str "`continue`（gate を通り、既承認の残作業がある）で止まり、次の run がまだ始まっていない停止。15 分以内の再開が正常。15 分超は催促の猶予切れ、24 時間超は停滞の基準（SLO 案 slo-draft/v2）。レーンが Done になった停止は含まない。系列: " v2 "continue_stops{part=open|open_over_15m|open_over_24h}。")
          [[(q "continue_stops" "part=\"open\"") "止まったまま"]
           [(q "continue_stops" "part=\"open_over_15m\"") "うち 15 分超"]
           [(q "continue_stops" "part=\"open_over_24h\"") "うち 24 時間超"]]) 8 5]
   [(stat "再開までの遅れ（再開済みの continue 停止）"
          (str "次の run が始まった continue 停止の総数と、再開まで 15 分 / 24 時間を超えた件数。系列: " v2 "continue_stops{part=followed|followed_over_15m|followed_over_24h}。")
          [[(q "continue_stops" "part=\"followed\"") "再開済み（分母）"]
           [(q "continue_stops" "part=\"followed_over_15m\"") "15 分超で再開"]
           [(q "continue_stops" "part=\"followed_over_24h\"") "24 時間超で再開"]]) 8 5]
   [(stat "催促・手助けが必要だった作業（救援）"
          (str "continue で止まってから 15 分を超えて Owner の接触（Notes の boxp / hermes-agent 見出し）があり、その後に再開した停止を 1 件と数える。本文は読まない。『判定不能』は票が読めない・再開時刻が不明な停止。Blocked で理由未記録の停止は分母に入れず別掲。"
               "観測が無いときは 0 件ではなく『観測なし』。英語: owner_rescue / rescue, not_rescue, unknown。系列: " v2 "owner_rescue{part}, " v2 "owner_rescue_status{status}。")
          [[(q "owner_rescue" "part=\"rescue\"") "救援あり"]
           [(q "owner_rescue" "part=\"not_rescue\"") "救援なしで再開"]
           [(q "owner_rescue" "part=\"unknown\"") "判定不能"]
           [(q "owner_rescue" "part=\"excluded_unclassified_blocked\"") "別掲: Blocked 理由未記録"]
           [(str "(" (q "owner_rescue_status" "status=\"no_observations\"") " == 1) * 0") "観測なし（continue 停止が 0 件）"]]) 8 5]
   [(stat "既承認作業の停滞（24 時間超 / continue 停止）"
          (str "SLO 案『既承認の停滞 5% 以下』の分子・分母。分子 = 再開まで 24 時間超 + 止まったまま 24 時間超、分母 = 再開済み + 止まったまま。分母 0 のとき率は出さない。Blocked で理由未記録の停止は分母外。系列: " v2 "approved_work_stall{part}。")
          [[(q "approved_work_stall" "part=\"numerator\"") "24 時間超（分子）"]
           [(q "approved_work_stall" "part=\"denominator\"") "continue 停止（分母）"]
           [(str "100 * " (q "approved_work_stall" "part=\"numerator\"") " / ignoring(part) (" (q "approved_work_stall" "part=\"denominator\"") " > 0)") "停滞率（%。分母 0 なら対象なし）"]]
          {:no-value "未計測：集計(v2)が未配備（arch の反映待ち）／分母 0 は対象なし"}) 8 4]
   [(stat "指示（Owner 経由 / 監督の note）の後に始まらなかった停止"
          (str "停止中に Owner 経由または監督の note が付いてから、次の run 開始（または現在）まで 1 時間 / 24 時間を超えた停止。note の内容は見ないので、指示か状況確認かは区別しない。旧 Review 停止と continue 停止の両方を含む。系列: " v2 "instructed_not_started{part}。")
          [[(q "instructed_not_started" "part=\"open_over_1h\"") "止まったまま 1 時間超"]
           [(q "instructed_not_started" "part=\"open_over_24h\"") "止まったまま 24 時間超"]
           [(q "instructed_not_started" "part=\"followed_over_24h\"") "24 時間超で再開"]
           [(q "instructed_not_started" "part=\"unevaluated_stops\"") "判定不能（票が読めない）"]]) 8 4]
   [(stat "最初の run 開始 → 最初の結果までの時間（時間）"
          (str "最初の run の開始から、最初に continue / owner-acceptance / done（過去分は review）で正常終了するまで。秒精度、全層まとめ。未到達は打切りとして別掲し分位に入れない。系列: " v2 "first_run_to_first_outcome_hours{quantile}, " v2 "first_run_to_first_outcome{part}。")
          [[(str v2 "first_run_to_first_outcome_hours{" job ",quantile=\"0.5\"}") "p50（時間）"]
           [(str v2 "first_run_to_first_outcome_hours{" job ",quantile=\"0.9\"}") "p90（時間）"]
           [(q "first_run_to_first_outcome" "part=\"reached\"") "到達（分母）"]
           [(q "first_run_to_first_outcome" "part=\"censored\"") "未到達（打切り）"]] {:decimals 1}) 8 4]])

(def row3-items
  [[(old-panel 16 {:title "最初の提出から手直しなく受入された成果の割合"
                   :description (str "式: 最初の受入までに agent 起因・原因不明の是正が無い task ÷ 受入時刻を確認できる受入 task（全履歴の累積）。『未評価を不合格扱い』は読めない run を持つ task を不合格として分母に入れた保守値。"
                                     "注意: BOXP-395 の移行で Done になった票（右の『移行で Done』）が受入に混ざる。28 日窓で除いた値は Obsidian slo-owner-decision.md。英語: first_acceptance_conformance（sli/v1）。")
                   :no-value "判定不能／未計測（分母 0 または収集欠落）"}) 6 4]
   [(old-panel 17 {:title "同: 合格 / 分母 / 分母から除いた件数" :description "合格数・分母と、分母から除いた件数（未評価・受入日が前後不明・受入時刻なし・入力欠落）。率は必ずこの件数と併読する。" :no-value "判定不能／未計測"}) 6 4]
   [(old-panel 51 {:title "未評価の作業（読めない run を含む task 数）" :desc-prefix "summary.edn が欠落・破損した run を持つ task。1 件以上なら v1 系列の値は下限で確定値ではない。" :no-value "未計測：v1 集計が未出力"}) 6 4]
   [(stat "移行で Done になった票（受入に混入しうる件数）"
          (str "BOXP-395 の Review 廃止で移行により Done になった票の数と、そのうち Notes に Owner の受入がある票（BOXP-387, 215）。差分は『受入でない終了』で、累積の受入率に混ざる。系列: " v2 "migration{part}。ledger が読めないときは系列が出ない（" v2 "migration_ledger_read=0）。")
          [[(q "migration" "part=\"tickets_moved_to_done\"") "移行で Done"]
           [(q "migration" "part=\"tickets_with_owner_acceptance\"") "うち Owner 受入あり"]
           [(q "migration_ledger_read" nil) "移行 ledger 読取 (1=可)"]]) 6 4]
   [(old-panel 3 {:title "収集: runner 側の scrape" :description "codex-workspace の ai-ops-metrics sidecar の up。Down なら以下の数値は更新されていない。" :no-value "計測障害：scrape 対象なし"}) 4 3]
   [(old-panel 4 {:title "収集: Hermes 側の scrape" :description "hermes-agent の ai-ops-metrics sidecar の up。" :no-value "計測障害：scrape 対象なし"}) 4 3]
   [(old-panel 6 {:title "集計の鮮度（最後の SLI 集計からの経過）" :description "最後に SLI snapshot を生成してからの時間。既定 15 分間隔。大きく超えていれば集計が止まっている（計測障害）。" :no-value "計測障害：SLI export が未配備・停止"}) 4 3]
   [(stat "集計 export の状態（v1 是正分析 / v2 停止・救援）"
          "1 = 直近の集計で export 成功、0 = 失敗・未出力（該当系列は古いか無い）。v2 が 0 のときは 1・2 段目の数値を使わない。英語: ai_ops_v1_export_ok / ai_ops_v2_export_ok。"
          [[(str "ai_ops_v1_export_ok{" job "}") "v1（是正・自動チェック）"]
           [(str "ai_ops_v2_export_ok{" job "}") "v2（停止・救援・Blocked 理由）"]]
          {:no-value "未計測：export 未配備" :mappings [{:type "value" :options {"0" {:text "失敗 / 未出力" :color "orange"} "1" {:text "成功" :color "green"}}}] :color-mode "value"}) 6 3]
   [(old-panel 8 {:title "収集欠落（期間内に失った event）" :description "生成元で失った event の増分。0 でなければ是正・救援の系列は確定値にならない。" :no-value "未計測"}) 6 3]
   [(stat "数字の信頼性（v2 集計が読めなかった入力）"
          (str "読めない run（summary 欠落・実行中）、接触の有無が不明な停止、再開時刻が不明な停止の件数。いずれか 1 件以上なら『完全』は 0 で、2 段目の値は下限。系列: " v2 "coverage{part}, " v2 "coverage_complete。")
          [[(q "coverage" "part=\"unreadable_runs\"") "読めない run"]
           [(q "coverage" "part=\"tasks_with_unreadable_runs\"") "読めない run を持つ task"]
           [(q "coverage" "part=\"stops_with_unknown_contacts\"") "接触不明の停止"]
           [(q "coverage" "part=\"stops_with_unknown_resume\"") "再開時刻不明の停止"]
           [(q "coverage_complete" nil) "完全（1=欠けなし）"]]) 12 4]
   [(old-panel 9 {:title "集計入力の欠落・拒否（累積）" :description "SLI 集計時点の全履歴での欠落・privacy 拒否・未紐付け・形式不正の件数。" :no-value "未計測：SLI export が未配備・停止"}) 6 4]
   [(old-panel 5 {:title "metrics file の経過秒（sidecar）" :description "exposition file の最終更新からの秒数（-1 = file なし）。runner は 60 秒毎に更新。" :no-value "未計測"}) 6 4]])

(def determinable-mappings [{:type "value" :options {"0" {:text "判定不能（未計測）" :color "orange"} "1" {:text "確定" :color "green"}}}])
(def sli-name-mappings [{:type "value" :options {"owner_rescue" {:text "催促・手助け（v0 判定）"} "duplicate_approval" {:text "同 scope の重複承認"} "first_acceptance_conformance" {:text "最初の提出で受入"}
                                                  "agent_system_correction_task_ratio" {:text "agent 起因の是正（旧 Review 分母）"} "reopen_after_accept" {:text "受入後の再開"} "ready_ack_latency" {:text "Ready→着手の遅延"}
                                                  "tokens_cost" {:text "token / 費用"} "hermes_conversation" {:text "Hermes 会話"} "critical_safety_events" {:text "重大な安全事象"} "duplicate_effects" {:text "二重 effect"} "private_leak" {:text "本文漏えい"}}}])

(def detail-items
  [[(text "詳細の読み方" (str "原因を調べるときに開く。**自動チェック** = CI / コードレビュー gate。『やり直し』は gate に落ちて同じ run が再試行した回数で、Owner に届く前の内部作業。**未計測の指標**は source 未接続・対象外のもので、0 ではない。英語の系列名は各 panel の説明に残す。")) 24 3]
   [(old-panel 42 {:title "自動チェック（CI / コードレビュー）でやり直した run" :desc-prefix "gate 失敗後の再作業 run 数・task 数・保留中。Owner に届く前の内部再作業で、受入率には含まない。英語: gate rework（v1）。" :no-value "未計測：v1 集計が未出力"}) 6 4]
   [(old-panel 43 {:title "やり直しの内訳（チェック別）" :no-value "未計測：v1 集計が未出力"}) 6 6]
   [(old-panel 44 {:title "自動チェックに 10 回以上連続で落ちた作業" :desc-prefix "gate 情報のある retrying が 10 連続以上続いた系列・task・最長。英語: review loops（v1）。" :no-value "未計測：v1 集計が未出力"}) 6 4]
   [(old-panel 27 {:title "run の中断・再試行（累積）" :description "全 run・中断・idle timeout・retrying の件数。英語: ai_ops_runs{status}。" :no-value "未計測：SLI export が未配備・停止"}) 6 4]
   [(old-panel 19 {:title "自動チェックの結果（1 時間ごとの増分）" :description "gate=all の pass / fail / skip と CI・codex-review の内訳。exporter は許可済み label 組をすべて 0 から出すため初回 event も増分に数える。" :no-value "未計測"}) 12 6]
   [(old-panel 18 {:title "業務の種類別の件数（stratum）" :description "infra / dev / assistant-or-research / creative の層別件数。小母数（28 日で 30 件未満）の層は率を読まない。" :no-value "未計測：SLI export が未配備・停止"}) 12 6]
   [(old-panel 26 {:title "依頼 → 受入の所要時間（日精度）" :description "request.received → 受入（frontmatter の日付）。日精度なので 10% 程度の変化は読めない。英語: ai_ops_lead_time_hours。" :no-value "未計測：SLI export が未配備・停止"}) 6 4]
   [(table "再開の直前にあった接触の種別（旧 Review + continue の再開済み停止）"
           (str "再開の直前の Notes 見出し source。owner-relay = Hermes 経由の Owner、owner-direct = Owner 本人、supervisor = 監督、none-observed = 接触なし、unknown-unreadable = 票が読めない。承認継続・差戻し・新 scope は区別しないので救援率ではない。系列: " v2 "resume_last_contact{kind}。")
           (q "resume_last_contact" nil) {:rename {:kind "接触の種別" :Value "件数"}}) 6 4]
   [(old-panel 28 {:title "runner の run 終了（1 時間ごとの増分、status 別）" :no-value "未計測"}) 12 4]
   [(old-panel 29 {:title "Hermes の会話 turn 終了（1 時間ごとの増分、status 別）" :no-value "未計測"}) 12 4]
   [(old-panel 10 {:title "Hermes observer の queue / process" :no-value "未計測"}) 6 3]
   [(old-panel 23 {:title "Hermes の承認 event（期間内）" :no-value "未計測"}) 6 3]
   [(old-panel 48 {:title "v1 集計の鮮度" :no-value "未計測：v1 集計が未出力"}) 6 3]
   [(old-panel 7 {:title "SLI export の失敗回数（期間内）" :no-value "計測障害：SLI export が未配備・停止"}) 6 3]
   [(assoc-in (old-panel 11 {:title "指標ごとの入力の接続状況（0 = 未接続 → 未計測）" :no-value "未計測：SLI export が未配備・停止"}) [:fieldConfig :defaults :mappings]
              (into (get-in (by-id 11) [:fieldConfig :defaults :mappings] []) sli-name-mappings)) 12 6]
   [(-> (old-panel 12 {:title "指標ごとの判定可否（判定不能 = 未計測で、0 ではない）" :no-value "未計測：SLI export が未配備・停止"})
        (assoc-in [:fieldConfig :defaults :mappings] (into determinable-mappings sli-name-mappings))) 12 6]
   [(old-panel 49 {:title "未計測の理由（指標別の分類）" :description "未接続 = source が無い／履歴欠損 = 入力の欠落・拒否・読めない run／分類不能 = metadata だけでは判別できない／対象外 = 取得しない方針。" :no-value "未計測：v1/v0 集計が未出力"}) 12 6]
   [(old-panel 50 {:title "未計測の件数（詳細）" :no-value "未計測：集計が未出力"}) 12 6]
   [(old-panel 21 {:title "催促・手助け（旧 v0 判定の接続状況。現行値は 2 段目）" :description "v0（sli/v1）の owner_rescue は救援 event の source が未接続のため判定不能のまま。現行の件数は 2 段目『催促・手助けが必要だった作業』（v2）を見る。" :no-value "未計測：未接続"}) 6 4]
   [(old-panel 22 {:title "同 scope の重複承認（未接続）" :no-value "未計測：未接続"}) 6 4]
   [(old-panel 30 {:title "Ready → 着手の遅延（未接続）" :no-value "未計測：未接続"}) 6 4]
   [(old-panel 31 {:title "token / 費用（対象外）" :no-value "未計測：対象外（subscription CLI は token/費用を返さない）"}) 6 4]])

(def usage-ids [101 102 103 104 105 106 107 108 109 110])
(def usage-items (map (fn [id] (let [p (by-id id) g (:gridPos p)] [p (:w g) (:h g)])) usage-ids))

(def legacy-items
  [[(text "旧 Review 時代の履歴について"
          (str "Task Board の Review レーンは **" retired "**（BOXP-395）に廃止された。ここの系列は『Review 到達』（result=review の成功 run）を分母にしており、廃止後は owner-acceptance と過去分の review だけが増える。"
               "現行の『継続待ち・救援・Blocked 理由』（1・2 段目）とは定義も母集団も違うので比較しない。過去の値は保存のため残し、定義は変えない（correction-rules/v0・v1、sli/v1）。")) 24 3]
   [(old-panel 46 {:title "Review 停滞（旧: review 終了 → 次 run 開始。廃止後は増えない）" :no-value "対象なし：Review レーン廃止後は新規に発生しない"}) 6 4]
   [(stat "旧 Review 停止の件数（v2 集計、切替前の系列）"
          (str "切替前に review で止まった停止の総数・再開済み・24 時間超・開いたまま・終了の種別（受入 / 移行 / 不明）。今後は増えない。系列: " v2 "review_stops{part}。")
          [[(q "review_stops" "part=\"total\"") "総数"]
           [(q "review_stops" "part=\"followed\"") "再開済み"]
           [(q "review_stops" "part=\"followed_over_24h\"") "24 時間超で再開"]
           [(q "review_stops" "part=\"open\"") "開いたまま"]
           [(q "review_stops" "part=\"open_over_24h\"") "開いたまま 24 時間超"]
           [(q "review_stops" "part=\"closed_by_acceptance\"") "終了: 受入"]
           [(q "review_stops" "part=\"closed_by_migration\"") "終了: 移行（受入なし）"]
           [(q "review_stops" "part=\"closed_unclassified\"") "終了: 不明"]]) 18 4]
   [(old-panel 40 {:title "Owner 差戻し後に再開した作業の割合（v1、旧 Review 分母）" :no-value "未計測：v1 集計が未出力"}) 6 4]
   [(old-panel 41 {:title "同 内訳（v1、task 数）" :no-value "未計測：v1 集計が未出力"}) 6 4]
   [(old-panel 14 {:title "agent 起因の是正を含む作業の割合（v0、旧 Review 分母）" :no-value "判定不能／未計測"}) 6 4]
   [(old-panel 15 {:title "同 件数 / 分母（v0）" :no-value "判定不能／未計測"}) 6 4]
   [(old-panel 45 {:title "分類できない再開（v0、Review 後に run が再開した task）" :no-value "未計測"}) 6 4]])

;; ---------------------------------------------------------------------------
(let [[intro-panels y] (place [[(text "このダッシュボードの読み方（まず上からこの順に）" intro) 24 7]] 0)
      [r1 y] (section "1. いま止まっている作業・自分の判断が必要な作業" y false row1-items)
      [r2 y] (section "2. 任せた作業が催促なしで進んでいるか（continue の停止・救援）" y false row2-items)
      [r3 y] (section "3. 成果の品質と数字の信頼性" y false row3-items)
      [r4 y] (section "詳細：原因を調べる・自動チェック・未計測の理由（折りたたみ）" y true detail-items)
      [r5 y] (section "利用枠（Claude Code / Codex、BOXP-372。折りたたみ）" y true usage-items)
      [r6 _] (section (str "旧 Review 時代の履歴（" retired " 以前。現行と比較不可。折りたたみ）") y true legacy-items)
      panels (vec (concat intro-panels r1 r2 r3 r4 r5 r6))
      ids (mapcat (fn [p] (cons (:id p) (map :id (:panels p)))) panels)
      _ (when (not= (count ids) (count (set ids))) (throw (ex-info "duplicate panel ids" {:dups (for [[k v] (frequencies ids) :when (> v 1)] k)})))
      dash (-> old
               (assoc :title "AI Ops 運用品質：Task Board / Hermes（BOXP-360 / 402）"
                      :panels panels
                      :tags ["ai-ops" "boxp-360" "boxp-402"]
                      :description (str "見る順序: 1 止まっている作業 → 2 催促なしで進んでいるか → 3 品質と数字の信頼性。旧 Review 時代の系列は最下段の折りたたみ。定義: ai-ops-event/v0, sli/v1, correction-rules/v0・v1, slo-draft/v2。")))]
  (spit out-path (json/generate-string dash {:pretty true}))
  (println "panels:" (count panels) "ids:" (count ids) "out:" out-path))
