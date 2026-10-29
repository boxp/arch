#!/usr/bin/env bb
;; BOXP-360: AI運用品質 SLI pilot (metadata-only)
;;
;; Subcommands:
;;   extract   <task-board-root> <vault>   既存 runner/outbox/ticket frontmatter を共通 event schema v0 へ変換 (stdout JSONL)
;;   emit-sim  <events.jsonl>              bounded buffer + privacy gate + collector 停止を模擬して collector 側 JSONL と stats を出す
;;   aggregate <events.jsonl>              SLI / guardrail / coverage を集計 (EDN report)
;;   prom      <events.jsonl>              低 cardinality Prometheus exposition を出す (ID/title/path は label にしない)
;;
;; 読むのは summary.edn / outbox *.edn / ticket frontmatter だけ。prompt.md / events.jsonl /
;; last-message.md / ticket 本文は読まない。
(ns ai-ops-sli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.string :as str]))

(def schema-version "ai-ops-event/v0")
(def classifier-version "correction-rules/v0")

;; ---------------------------------------------------------------------------
;; privacy gate (生成元で適用。collector / server masking には依存しない)

(def allowed-keys
  #{:schema_version :event_id :request_id :task_id :run_id :attempt :parent_event_id
    :source :runtime :agent :event_type :occurred_at :observed_at :occurred_precision
    :lane_from :lane_to :status :result :action :exit_code :idle_timeout :blocker_category
    :correction_class :correction_origin :classifier :classifier_version :confidence
    :evidence_event_ids :stratum :delegation_kind :tokens_in :tokens_out :cost_source
    :severity :effect_key :approval_key :redelivery :synthetic :coverage_target :snapshot})

(def enum-values
  {:snapshot #{"current"} :schema_version #{"ai-ops-event/v0"} :classifier_version #{"correction-rules/v0"}
   :event_type #{"request.received" "run.started" "run.finished" "run.interrupted" "task.accepted" "task.reopened" "task.state" "task.cancelled" "run.unreadable" "lane.changed" "notify.run-finished" "correction" "owner.rescue" "approval.requested" "approval.resolved" "effect.applied" "coverage.connected"}
   :source #{"task-board-runner" "ticket-frontmatter" "derived" "outbox:task-board-runner" "outbox:board-diff" "synthetic:calibration" "synthetic:feedback" "synthetic:hermes" "synthetic:task-board"}
   :runtime #{"codex-cli" "claude-cli" "localllm" "hermes" "unknown"}
   :agent #{"codex" "codex-sol" "codex-sol-xhigh" "codex-astra" "claude-opus" "claude-fable" "fable" "localllm"}
   :action #{"implement" "groom" "review-fix" "blocked-retry" "docs-edit" "docs-groom"}
   :status #{"done" "closed" "succeeded" "retrying" "accepted" "blocked" "interrupted" "review" "ready" "backlog" "failed" "in-progress" "running" "duplicate" "hold" "cancelled"}
   :result #{"review" "blocked" "done" "ready"}
   :lane_from #{"ready" "review" "blocked" "backlog" "in-progress" "done"}
   :lane_to #{"ready" "review" "blocked" "backlog" "in-progress" "done"}
   :correction_class #{"gate_defect" "unknown" "done_claim_without_execution" "instruction_violation" "source_mismatch" "assignee_regression" "preference_adjustment" "scope_addition" "unavoidable_safety_decision" "external_failure"}
   :correction_origin #{"agent-system" "non-agent" "unknown"} :classifier #{"rule" "human" "model"}
   :confidence #{"high" "medium" "low"} :severity #{"critical" "high" "medium" "low"}
   :cost_source #{"unknown"} :occurred_precision #{"day" "second" "ns"}
   :delegation_kind #{"delegated" "exempt" "failed" "unparsable"}
   :stratum #{"assistant-or-research" "assistant" "research" "creative" "dev" "infra"}
   :blocker_category #{"external" "agent-reported-blocked" "agent-process-error" "pr-gate-pr-url"}
   :coverage_target #{"duplicate-effects" "critical-safety-events" "acceptance-history" "hermes-conversation"}})

(def token-pattern #"(?i)(?:^|[^a-z0-9])(ghp_|gho_|github_pat_|xox[bp]-|AKIA|sk-|glpat-)[a-z0-9_-]+|[a-z0-9]{32,}")
(defn token-safe? [s] (not (re-find token-pattern s)))
(defn event-id? [s synthetic?]
  (and (<= (count s) 128) (boolean (re-matches (if synthetic? #"[A-Za-z0-9:_/-]{1,128}"
                         #"(?:[A-Z]+-\d+(?:[/:-][A-Za-z0-9:_/-]+)?|cov-[a-z0-9-]+-[0-9a-f]{8}|(?:req|conv)-[a-z0-9-]{8,64}(?:/[A-Za-z0-9:_-]+)?)") s))))
(def ^:dynamic *synthetic-mode* false)

(defn valid-value? [k v]
  (let [synthetic? *synthetic-mode*]
  (cond
    (nil? v) true
    (and (string? v) (not (token-safe? v))) false
    (contains? enum-values k) (and (string? v) (contains? (enum-values k) v))
    (#{:attempt :exit_code :redelivery :tokens_in :tokens_out} k) (number? v)
    (#{:idle_timeout :synthetic} k) (boolean? v)
    (#{:occurred_at :observed_at} k) (and (string? v) (try (java.time.Instant/parse v) true (catch Exception _ false)))
    (#{:event_id :parent_event_id} k) (and (string? v) (event-id? v synthetic?))
    (= k :evidence_event_ids) (and (sequential? v) (every? #(and (string? %) (token-safe? %) (event-id? % synthetic?)) v))
    (= k :task_id) (and (string? v) (boolean (re-matches (if synthetic? #"(?:[A-Z]+[0-9]+|req:conv-[a-z0-9-]+)" #"(?:[A-Z]+-\d+|(?:req|conv)-[a-z0-9-]{8,64})") v)))
    (= k :request_id) (and (string? v) (boolean (re-matches (if synthetic? #"req:(?:[A-Z]+[0-9]+|conv-[a-z0-9-]+)" #"(?:req:[A-Z]+-\d+|(?:req|conv)-[a-z0-9-]{8,64})") v)))
    (= k :run_id) (and (string? v) (boolean (re-matches (if synthetic? #"r[0-9]+" #"\d{8}T\d{6}Z(?:-[0-9a-f-]+)?(?:-[a-z]+)?") v)))
    (#{:effect_key :approval_key} k) (and (string? v) (boolean (re-matches #"[a-z0-9:_-]{1,64}" v)))
    :else false)))

(defn privacy-gate [e]
  (let [dropped (remove allowed-keys (keys e))
        selected (select-keys e allowed-keys)
        invalid (filter (fn [[k v]] (not (valid-value? k v))) selected)
        invalid-correlation? (boolean (some #(and (some? (get e %)) (not (valid-value? % (get e %)))) [:task_id :request_id :run_id]))
        rejected? (or (nil? (:event_id e)) (not (valid-value? :event_id (:event_id e))) invalid-correlation?)]
    {:event (when-not rejected? (reduce (fn [m [k _]] (assoc m k "redacted")) selected invalid))
     :dropped-keys (count dropped) :redacted-values (count (remove #(= :event_id (first %)) invalid))
     :rejected? rejected? :invalid-correlation? invalid-correlation?}))

(def rejected-marker {:privacy_rejected "upstream"})
;; 是正 SLI (是正率/first acceptance) に影響し得ない event 種別。これ以外 (種別不明を含む) の欠落は是正だった可能性を否定できない
(def correction-neutral-types #{"notify.run-finished" "owner.rescue" "approval.requested" "approval.resolved" "effect.applied" "coverage.connected"})
(defn may-affect-corrections? [event-type] (not (contains? correction-neutral-types event-type)))
;; 拒否 marker には本文・ID を出さず、許可 enum の event_type だけを残す (是正 SLI への影響判定用)
(defn rejected-marker-for [e]
  (cond-> rejected-marker (contains? (:event_type enum-values) (:event_type e)) (assoc :event_type (:event_type e))))
(defn rejected-marker? [e]
  (and (map? e) (= "upstream" (:privacy_rejected e)) (every? #{:privacy_rejected :event_type} (keys e))))
;; collector 停止で bounded buffer から溢れた/未配信の event の marker (本文・ID なし)
;; input_unreadable: extract で読めなかった summary.edn / outbox (task を特定できない欠落入力)
(def lost-markers {{:collection_lost "buffer_dropped"} :buffer-dropped {:collection_lost "undelivered"} :undelivered
                   {:collection_lost "input_unreadable"} :input-unreadable})
(defn marker? [e] (or (rejected-marker? e) (contains? lost-markers e)))

(defn emit-gated [stats e]
  (let [{:keys [event dropped-keys redacted-values rejected?]} (privacy-gate e)]
    (swap! stats #(-> % (update :privacy-dropped-keys + dropped-keys)
                      (update :privacy-redacted-values + redacted-values)
                      (cond-> rejected? (update :privacy-rejected inc))))
    ;; 拒否した event は本文を出さず、ID を持たない marker 行だけを出して aggregate へ拒否件数を引き継ぐ
    (println (json/generate-string (or event (rejected-marker-for e))))))

;; ---------------------------------------------------------------------------
;; extract: 既存 metadata -> 共通 schema

(defn read-edn [f]
  (try (edn/read-string {:default (fn [_ v] v)} (slurp (str f))) (catch Exception _ nil)))

(defn run-id->instant [run-id]
  (when-let [[_ y mo d h mi s] (re-find #"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z" (str run-id))]
    (str y "-" mo "-" d "T" h ":" mi ":" s "Z")))

(def ticket-statuses #{"ready" "review" "blocked" "backlog" "in-progress" "done" "cancelled"})

(defn frontmatter
  "開始/終了の `---` が揃い、必須field (status / created) を持つ frontmatter だけを map で返す。
  終了区切りが無い (本文の status: 等まで取り込み得る) / 必須field欠落 / 未知の status (例 donee) / 読み取り例外 (権限不足等) は nil (呼び出し側で破損扱い)。"
  [f]
  (let [lines (try (str/split-lines (slurp (str f))) (catch Exception _ nil))
        body (rest lines)
        fm-lines (take-while #(not= "---" %) body)]
    (when (and (= "---" (first lines)) (< (count fm-lines) (count body)))
      (let [m (->> fm-lines
                   (keep #(when-let [[_ k v] (re-matches #"^([a-z_]+):\s*(.*)$" %)] [(keyword k) (str/trim v)]))
                   (into {}))]
        (when (and (contains? ticket-statuses (:status m)) (re-matches #"\d{4}-\d{2}-\d{2}" (str (:created m))))
          m)))))

(def infra-repos #{"boxp/arch" "boxp/lolice" "boxp/is01-linux" "boxp/dotfiles" "boxp/palserver"})

(defn stratum [{:keys [repo]} actions]
  (let [repos (set (map #(str/replace % #"^https://github.com/" "") (re-seq #"[\w./:-]+/[\w.-]+" (or repo ""))))]
    (cond
      (some #{:docs-edit :docs-groom} actions) "creative"
      (seq (filter infra-repos repos)) "infra"
      (seq repos) "dev"
      :else "assistant-or-research")))

(defn kw-or-str
  "keyword/文字列の両形式を同じ文字列に正規化する (:review と \"review\" を区別しない)。"
  [v] (when (some? v) (if (keyword? v) (name v) (str v))))

(defn summary->events [ticket s]
  (let [run-id (:run-id s)
        started (or (:started-at s) (run-id->instant run-id))
        base {:schema_version schema-version :task_id ticket :request_id (str "req:" ticket)
              :run_id run-id :source "task-board-runner" :agent (kw-or-str (:agent s))
              :runtime (let [a (or (kw-or-str (:agent s)) "")]
                         (cond (str/starts-with? a "codex") "codex-cli"
                               (str/starts-with? a "localllm") "localllm"
                               (str/blank? a) "unknown"
                               :else "claude-cli"))
              :action (some-> (:action s) name) :cost_source "unknown"
              :delegation_kind (:delegation-kind s)}]
    (cond-> [(assoc base :event_id (str ticket "/" run-id ":started") :event_type "run.started"
                    :occurred_at started :occurred_precision "second")]
      (and (:finished-at s) (not= :interrupted (:status s)))
      (conj (assoc base :event_id (str ticket "/" run-id ":finished") :event_type "run.finished"
                   :occurred_at (:finished-at s) :occurred_precision "ns"
                   :status (some-> (:status s) name) :result (kw-or-str (:result s))
                   :exit_code (:exit-code s) :idle_timeout (boolean (:idle-timeout? s))
                   :blocker_category (kw-or-str (:blocker-category s))))
      (= :interrupted (:status s))
      (conj (assoc base :event_id (str ticket "/" run-id ":" (name (:status s))) :event_type "run.interrupted"
                   :occurred_at (or (:finished-at s) (:updated-at s) started) :status (name (:status s)))))))

(defn derive-corrections
  "run 系列から是正 event を規則で暫定分類する (classifier=rule, 人の訂正で上書き可能)。"
  [ticket runs]
  (let [runs (sort-by :run-id runs)]
    (->> (map vector (cons nil runs) runs)
         (mapcat
          (fn [[prev cur]]
            (let [ts (or (:started-at cur) (run-id->instant (:run-id cur)))
                  base {:schema_version schema-version :task_id ticket :request_id (str "req:" ticket)
                        :run_id (:run-id cur) :source "derived" :classifier "rule"
                        :classifier_version classifier-version :occurred_at ts
                        :evidence_event_ids (cond-> [(str ticket "/" (:run-id cur) ":started")]
                                              prev (conj (str ticket "/" (:run-id prev) ":finished")))}]
              (cond
                ;; CI / codex review gate が欠陥を見つけて差し戻した: agent-system 起因 (中確度)
                (= :review-fix (:action cur))
                [(assoc base :event_id (str ticket "/" (:run-id cur) ":corr") :event_type "correction"
                        :correction_class "gate_defect" :correction_origin "agent-system" :confidence "medium")]
                ;; review/done 後に再び implement: Owner 差戻し or scope 追加。原因は metadata だけでは判別不能
                (and prev (= :succeeded (:status prev)) (#{"review" "done"} (kw-or-str (:result prev)))
                     (#{:implement :docs-edit} (:action cur)))
                [(assoc base :event_id (str ticket "/" (:run-id cur) ":reopen") :event_type "task.reopened"
                        :correction_class "unknown" :correction_origin "unknown" :confidence "low")]
                :else [])))))))

(defn outbox->events [e]
  ;; 既知の outbox 種別のみ変換し、空/未知の event-type は nil (呼び出し側で欠落入力として計数) にする
  (when-let [et (and (:event-id e) ({"task-board.lane-changed" "lane.changed" "task-board.run-finished" "notify.run-finished"} (:event-type e)))]
    (let [lane? (= "lane.changed" et)]
      [{:schema_version schema-version :event_id (:event-id e) :task_id (:ticket-id e)
        :request_id (str "req:" (:ticket-id e)) :run_id (:run-id e) :source (str "outbox:" (:source e))
        :event_type et
        :occurred_at (:created-at e) :observed_at (:accepted-at e) :occurred_precision "ns"
        :lane_from (:from-status e) :lane_to (:to-status e)
        ;; :hermes-status は通知配送の状態で task 状態ではないため :status へ写さない
        ;; (欠落時の空文字が redact され task が入力欠落扱いになるのを防ぐ)
        :result (kw-or-str (:result e)) :redelivery (or (:redeliveries e) 0)}])))

(defn extract [root vault]
  ;; 入力ディレクトリの指定ミス/未マウント/権限不足を空データとして集計しない (SLI を確定値と誤報しないようエラー終了する)
  (doseq [d [(fs/path vault "Tickets") (fs/path root "runs") (fs/path root "outbox")]]
    (when-not (and (fs/directory? d) (fs/readable? d))
      (binding [*out* *err*] (println (str "extract: required input directory is missing or unreadable: " d)))
      (System/exit 2)))
  ;; 未マウントの空マウントポイント等で正本 ticket (BOXP-<数字>.md) が 1 件も無い場合も空データとして扱わない (添付ノートのみは空扱い)
  (when (empty? (filter #(re-matches #"BOXP-\d+\.md" (str (fs/file-name %))) (fs/glob (fs/path vault "Tickets") "BOXP-*.md")))
    (binding [*out* *err*] (println (str "extract: no ticket files found under " (fs/path vault "Tickets"))))
    (System/exit 2))
  (let [stats (atom {:privacy-dropped-keys 0 :privacy-redacted-values 0 :privacy-rejected 0})
        tickets (->> (fs/glob (fs/path vault "Tickets") "BOXP-*.md")
                     ;; ticket 正本は BOXP-<数字>.md のみ (BOXP-144-*.md 等の添付ノートは ticket ではない)
                     (filter #(re-matches #"BOXP-\d+\.md" (str (fs/file-name %))))
                     ;; frontmatter を読めない ticket も黙って除外せず ::broken として残し、run 抽出と未評価扱いを保つ
                     (map (fn [f] [(str (fs/strip-ext (fs/file-name f))) (or (frontmatter f) ::broken)]))
                     (into {}))
        ;; summary.edn ではなく run ディレクトリを列挙し、summary.edn 自体が無い run も欠落として検出する
        summaries (->> (fs/glob (fs/path root "runs") "*/*")
                       (filter fs/directory?)
                       (map #(fs/path % "summary.edn")))
        ;; 読めない/必須field (ticket・run-id がディレクトリと一致、status) を欠く summary.edn は黙って捨てず
        ;; run.unreadable として ディレクトリの ticket に紐付け、その task の SLI を未評価にする
        valid-summary? (fn [f] (let [s (read-edn f) d (fs/parent f)]
                                 ;; summary->events/derive-corrections が name/str を呼ぶ field の型も検証する (不正型は欠落扱い)
                                 (and (map? s) (some? (:status s))
                                      (every? #(let [v (get s %)] (or (keyword? v) (string? v))) [:status])
                                      (every? #(let [v (get s %)] (or (nil? v) (keyword? v) (string? v))) [:action :agent :result :blocker-category])
                                      (every? #(let [v (get s %)] (or (nil? v) (string? v))) [:started-at :finished-at :updated-at])
                                      ;; 時刻は解釈可能であること (不正時刻は privacy gate で redact され是正の前後を誤判定するため欠落入力として扱う)
                                      (every? #(let [v (get s %)] (or (nil? v) (try (java.time.Instant/parse v) true (catch Exception _ false))))
                                              [:started-at :finished-at :updated-at])
                                      ;; 集計に使う値が未知 (例: :action "review_fix") なら是正導出から漏れるため欠落入力として扱う
                                      (every? (fn [[k ek]] (let [v (get s k)] (or (nil? v) (contains? (ek enum-values) (kw-or-str v)))))
                                              [[:status :status] [:action :action] [:result :result]])
                                      (let [v (:exit-code s)] (or (nil? v) (integer? v)))
                                      ;; 実行中/中断以外 (succeeded/retrying/blocked/failed 等の終了状態) は :finished-at 必須。
                                      ;; 欠けると run.finished が出ず Review 到達/retry が黙って消えるため欠落入力として扱う
                                      (or (contains? #{"running" "in-progress" "interrupted"} (kw-or-str (:status s)))
                                          (not (str/blank? (:finished-at s))))
                                      (= (:ticket s) (str (fs/file-name (fs/parent d))))
                                      (= (:run-id s) (str (fs/file-name d))))))
        unreadable (->> summaries (remove valid-summary?)
                        (map (fn [f] (let [d (fs/parent f)] {:ticket (str (fs/file-name (fs/parent d))) :run-id (str (fs/file-name d))})))
                        (group-by :ticket))
        runs (->> summaries
                  (keep (fn [f] (when-let [s (and (valid-summary? f) (read-edn f))]
                                  ;; :status/:action は文字列形式も許可するため keyword に正規化してから比較する
                                  (let [s (cond-> (update s :status keyword) (:action s) (update :action keyword))
                                        d (fs/path (fs/parent f) "delegation.json")]
                                    (cond-> s (fs/exists? d)
                                      (assoc :delegation-kind (try (:kind (json/parse-string (slurp (str d)) true)) (catch Exception _ "unparsable"))))))))
                  (group-by :ticket))
        ;; vault に ticket が無い run (削除/移動) も黙って除外せず、run を計上したうえで ticket 欠落として未評価にする
        all-tickets (merge (zipmap (concat (keys runs) (keys unreadable)) (repeat ::missing)) tickets)]
    (doseq [[ticket fm] (sort-by key all-tickets)
            :let [missing? (= ::missing fm)
                  broken? (or missing? (= ::broken fm))
                  fm (if broken? {} fm)
                  _ (when broken? (swap! stats update :input-unreadable (fnil inc 0))
                      (println (json/generate-string {:collection_lost "input_unreadable"})))
                  rs (get runs ticket)
                  st (stratum fm (set (keep :action rs)))
                  ;; 期間外の古い ticket は created しか持たない
                  evs (concat
                       (if broken?
                         ;; frontmatter 破損: 該当 task を unreadable として未評価にする (分母から黙って消さない)
                         [{:schema_version schema-version :event_id (str ticket (if missing? ":ticket-missing" ":frontmatter-unreadable")) :task_id ticket
                           :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "run.unreadable"
                           :occurred_at nil}]
                         [{:schema_version schema-version :event_id (str ticket ":requested") :task_id ticket
                           :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "request.received"
                           :occurred_at (str (:created fm) "T00:00:00Z") :occurred_precision "day"}])
                       (mapcat #(summary->events ticket %) rs)
                       (for [{:keys [run-id]} (get unreadable ticket)]
                         {:schema_version schema-version :event_id (str ticket ":" run-id ":unreadable") :task_id ticket
                          :request_id (str "req:" ticket) :run_id run-id :source "task-board-runner" :event_type "run.unreadable"
                          :occurred_at (run-id->instant run-id) :occurred_precision "second"})
                       (derive-corrections ticket rs)
                       ;; 取消済み ticket の closed は受入ではないため task.accepted/reopened を出さない
                       (when (and (not= "cancelled" (:status fm)) (not (str/blank? (:closed fm))))
                         [{:schema_version schema-version :event_id (str ticket ":accepted") :task_id ticket
                           :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "task.accepted"
                           :occurred_at (str (:closed fm) "T23:59:59Z") :occurred_precision "day"}])
                       (when (and (not (#{"done" "cancelled"} (:status fm))) (not (str/blank? (:closed fm))))
                         [{:schema_version schema-version :event_id (str ticket ":reopened") :task_id ticket
                           :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "task.reopened"
                           :occurred_at (str (:closed fm) "T23:59:59Z") :occurred_precision "day"
                           :correction_origin "unknown" :correction_class "unknown"}])
                       (when (contains? ticket-statuses (:status fm))
                         [{:schema_version schema-version :event_id (str ticket ":state") :task_id ticket
                           :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "task.state"
                           :status (:status fm) :snapshot "current" :occurred_at nil}]))]
            e evs]
      (emit-gated stats (assoc e :stratum st)))
    (doseq [f (fs/glob (fs/path root "outbox") "**.edn")
            :when (not= "board-lanes.edn" (str (fs/file-name f)))
            :let [e (read-edn f)]
            ;; 必須field (event-id/event-type/ticket-id) を欠く map も黙って捨てず欠落として数える
            ev (or (when (map? e) (when (:ticket-id e) (outbox->events e))) [::unreadable])]
      (if (= ::unreadable ev)
        (do (swap! stats update :input-unreadable (fnil inc 0))
            (println (json/generate-string {:collection_lost "input_unreadable"})))
        (emit-gated stats ev)))
    (binding [*out* *err*] (prn @stats))))

;; ---------------------------------------------------------------------------
;; emit-sim: 生成元 bounded buffer。collector 停止中も業務は止めず、溢れた分は drop を数える

(defn emit-sim [file buffer-cap down-from down-to]
  (let [raw (->> (str/split-lines (slurp file)) (remove str/blank?) (map #(json/parse-string % true)))
        st (reduce
            (fn [{:keys [buf] :as st} [i e]]
              (let [{ev :event :keys [dropped-keys redacted-values rejected?]} (privacy-gate e)
                    ev (or ev (rejected-marker-for e))
                    st (-> st (update :emitted inc) (update :privacy-dropped-keys + dropped-keys) (update :privacy-redacted-values + redacted-values)
                           (cond-> rejected? (update :privacy-rejected inc)))
                    down? (<= down-from i down-to)]
                (cond
                  down? (if (< (count buf) buffer-cap)
                          (-> st (update :buf conj ev) (update :max-depth max (inc (count buf))))
                          (-> st (update :buffer-dropped inc)))
                  :else (-> st
                            (update :delivered into (conj buf ev))
                            (assoc :buf [])
                            (update :max-depth max (count buf))))))
            {:emitted 0 :delivered [] :buf [] :buffer-dropped 0 :privacy-dropped-keys 0
             :privacy-rejected 0 :privacy-redacted-values 0 :max-depth 0}
            (map-indexed vector raw))
        st (if (and (seq raw) (<= down-from (dec (count raw)) down-to))
             st
             (-> st (update :delivered into (:buf st)) (assoc :buf [])))]
    (doseq [e (:delivered st)] (println (json/generate-string e)))
    ;; drop/未配信は stderr だけでなく本文なし marker 行で aggregate へ引き継ぎ、影響する指標を unknown にする
    (dotimes [_ (:buffer-dropped st)] (println (json/generate-string {:collection_lost "buffer_dropped"})))
    (dotimes [_ (count (:buf st))] (println (json/generate-string {:collection_lost "undelivered"})))
    (binding [*out* *err*]
      (prn {:emitted (:emitted st) :delivered (count (:delivered st)) :buffer-cap buffer-cap
            :buffer-dropped (:buffer-dropped st) :undelivered-buffered (count (:buf st)) :buffer-max-depth (:max-depth st)
            :privacy-dropped-keys (:privacy-dropped-keys st) :privacy-redacted-values (:privacy-redacted-values st) :privacy-rejected (:privacy-rejected st)}))))

;; ---------------------------------------------------------------------------
;; aggregate

(defn parse-inst [s] (try (java.time.Instant/parse s) (catch Exception _ nil)))
(defn hours [a b] (when (and a b) (/ (.toMillis (java.time.Duration/between a b)) 3600000.0)))

(defn pct [n d] (when (pos? d) (Math/round (* 1000.0 (/ n d)))))
(defn ratio [n d] {:count n :denominator d :permille (pct n d)})

(defn quantiles [xs]
  (let [v (vec (sort xs)) n (count v)]
    (when (pos? n)
      {:n n :p50 (v (quot n 2)) :p90 (v (min (dec n) (int (* 0.9 n))))
       :note (when (< n 20) "n<20: 分位点は参考値")})))

(defn read-events [file]
  ;; 破損行は黙って捨てず ::malformed marker として残し、aggregate* で計数して影響 coverage を unknown にする
  (->> (str/split-lines (slurp file)) (remove str/blank?)
       (map #(let [e (try (json/parse-string % true) (catch Exception _ nil))]
               (if (map? e) e {::malformed true})))))

(def rule-classifier? #{"rule" "model"})

(defn unique-events [events]
  (second (reduce (fn [[seen out] e] (if (contains? seen (:event_id e)) [seen out] [(conj seen (:event_id e)) (conj out e)])) [#{} []] events)))

;; 同じ event_id で内容 (配送 metadata の observed_at/redelivery を除く) が異なる event: 再送ではなく ID 衝突。
;; unique-events は先着を残すため後着側が消える (順序依存)。消えた側の種別は信用できないので欠落として扱う
(defn event-id-collisions [events]
  (->> events (group-by :event_id) vals
       (map #(dec (count (distinct (map (fn [e] (dissoc e :observed_at :redelivery)) %)))))
       (reduce + 0)))

(defn event-time-key [e]
  (if-let [t (parse-inst (:occurred_at e))] [1 t] [0 java.time.Instant/MIN]))

(def correction-class-origin
  {"instruction_violation" "agent-system" "source_mismatch" "agent-system"
   "done_claim_without_execution" "agent-system" "assignee_regression" "agent-system"
   "gate_defect" "agent-system" "preference_adjustment" "non-agent"
   "scope_addition" "non-agent" "unavoidable_safety_decision" "non-agent"
   "external_failure" "non-agent"})

(defn correction-origin [e]
  (or (#{"agent-system" "non-agent" "unknown"} (:correction_origin e))
      (correction-class-origin (:correction_class e)) "unknown"))

(defn evidence-key
  "再分類の照合 key。evidence_event_ids の集合全体で対象を一意に特定する (先頭 ID だけで照合しない)"
  [e]
  (let [ids (:evidence_event_ids e)]
    (when (and (sequential? ids) (seq ids)) (vec (sort (distinct ids))))))

;; occurred_at 欠落の再open/取消/lane 遷移は他の遷移との前後を確定できない (時刻なしとして過去側に並び、受入後の再open を受入前と誤判定する)。
;; 現在状態 snapshot があればそれが優先されるので対象外。時刻なし task.state は snapshot 扱い、時刻なし task.accepted は受入時刻不明として別掲済み
(def order-sensitive-types #{"task.reopened" "task.cancelled" "lane.changed"})
(defn unordered-transition-events [evs]
  (let [transitions (filter #(#{"task.state" "task.accepted" "task.reopened" "task.cancelled" "lane.changed"} (:event_type %)) evs)]
    (if (or (some #(and (= "task.state" (:event_type %)) (= "current" (:snapshot %))) transitions)
            (< (count transitions) 2))
      []
      (filter #(and (contains? order-sensitive-types (:event_type %)) (nil? (:occurred_at %))) transitions))))
(defn task-outcome [evs]
  (let [evidence-of evidence-key
        reclassifiable? #(#{"correction" "task.reopened"} (:event_type %))
        ;; 人の再分類は、同じ evidence を持つ rule/model 判定がある場合だけ状態遷移から除外する
        ruled (set (keep #(when (and (reclassifiable? %) (rule-classifier? (:classifier %))) (evidence-of %)) evs))
        ;; aggregate の是正再分類と同じ照合条件 (evidence の一致のみ。evidence event 自体の有無は問わない)
        evs (remove #(let [evidence (evidence-of %)]
                       (and (= "human" (:classifier %)) (reclassifiable? %) evidence (contains? ruled evidence))) evs)
        latest (last (sort-by #(conj (if (and (= "task.state" (:event_type %)) (= "current" (:snapshot %))) [2 java.time.Instant/MIN] (event-time-key %)) (if (= "task.reopened" (:event_type %)) 1 0)) (filter #(or (#{"task.state" "task.accepted" "task.reopened" "task.cancelled"} (:event_type %)) (and (= "lane.changed" (:event_type %)) (#{"ready" "review" "blocked" "backlog" "in-progress"} (:lane_to %)))) evs)))
        state (if (= "lane.changed" (:event_type latest)) (:lane_to latest) (:status latest))]
    (cond
      ;; 時刻なし再open/取消/lane 遷移があり現在状態 snapshot も無い: 前後不明のため受入済みと確定しない (未完了側に数える)
      (seq (unordered-transition-events evs)) "indeterminate"
      (or (= "task.cancelled" (:event_type latest)) (= "cancelled" state)) "cancelled"
      (= "task.reopened" (:event_type latest)) "in-flight"
      (or (= "task.accepted" (:event_type latest)) (#{"done" "closed" "accepted"} state)) "accepted"
      (= state "blocked") "blocked"
      (= state "review") "awaiting-review"
      (#{"ready" "in-progress"} state) "in-flight"
      (= state "backlog") "backlog"
      (some #(= "hold" (:status %)) evs) "on-hold"
      :else "unobserved")))

(def state-fields [:status :result :action :lane_from :lane_to])
;; event 種別ごとに outcome/Review 到達の判定に必須の状態 field: 欠落も redact と同じく入力欠落として扱う
(def required-state-fields {"task.state" [:status] "lane.changed" [:lane_to]})
(def state-transition-types #{"task.state" "task.accepted" "task.reopened" "task.cancelled" "lane.changed"})
(defn unverifiable-state-event? [e]
  (or (some #(= "redacted" (get e %)) state-fields)
      ;; 状態遷移の occurred_at が不正 (redact 済み等) だと時刻なしとして過去側に並び、受入/再open の前後を誤判定するため入力欠落とする
      ;; (時刻なし current snapshot は occurred_at=nil なので対象外)
      (and (contains? state-transition-types (:event_type e)) (some? (:occurred_at e)) (nil? (parse-inst (:occurred_at e))))
      ;; occurred_precision が不正 (redact 済み) だと日粒度の受入を正確な時刻と誤認し同日の是正の前後を誤判定するため入力欠落とする
      (and (or (contains? state-transition-types (:event_type e)) (= "correction" (:event_type e))) (= "redacted" (:occurred_precision e)))
      (some #(let [v (get e %)] (or (nil? v) (and (string? v) (str/blank? v)))) (get required-state-fields (:event_type e)))))
(defn input-missing? [t] (or (pos? (:unreadable-runs t 0)) (pos? (:unverifiable-state t 0))))
;; 最初の受入履歴を持つ task (受入後に再オープン中でも first acceptance の対象から外さない; 現在状態は outcome で別に扱う)
(defn ever-accepted? [t] (or (:acceptance-history? t) (= "accepted" (:outcome t))))

(defn aggregate* [events]
  (let [malformed (count (filter ::malformed events))
        ;; 生成元 (extract/emit-sim) の privacy gate で拒否された event の marker
        upstream-markers (filter rejected-marker? events)
        upstream-rejected (count upstream-markers)
        collection-lost (frequencies (keep lost-markers events))
        buffer-dropped (get collection-lost :buffer-dropped 0)
        undelivered (get collection-lost :undelivered 0)
        input-unreadable (get collection-lost :input-unreadable 0)
        events (remove marker? events)
        raw-events (remove ::malformed events)
        gated (map privacy-gate raw-events)
        rejected (count (filter #(and (:rejected? %) (not (:invalid-correlation? %))) gated))
        rejected-correlation (count (filter :invalid-correlation? gated))
        ;; 破損行と privacy gate で拒否した event は中身を検証できないため、zero-tolerance 指標を 0 件と確定しない
        lost (+ malformed rejected rejected-correlation upstream-rejected buffer-dropped undelivered input-unreadable)
        ;; 是正 SLI 用の欠落: 種別が是正に無関係と分かる拒否 event (notify 等) は除く。破損行・drop・未配信・読めない入力は種別不明なので含める
        corr-lost (+ malformed buffer-dropped undelivered input-unreadable
                     (count (filter #(may-affect-corrections? (:event_type %)) upstream-markers))
                     (count (filter (fn [[e g]] (and (:rejected? g) (may-affect-corrections? (:event_type e)))) (map vector raw-events gated))))
        events (keep :event gated)
        n-in (count events)
        uniq (unique-events events)
        id-collisions (event-id-collisions events)
        ;; 読めない run summary / ticket (run.unreadable) は中身に effect/重大 event があった可能性を否定できない
        unreadable-run-events (count (filter #(= "run.unreadable" (:event_type %)) uniq))
        lost (+ lost unreadable-run-events id-collisions)
        unverifiable-severity (count (filter #(and (some? (:severity %)) (not (contains? (:severity enum-values) (:severity %)))) uniq))
        ;; event_type 欠落/不正 (redact 済み) の event は effect/重大 event の可能性を否定できない
        unverifiable-type (count (filter #(not (contains? (:event_type enum-values) (:event_type %))) uniq))
        ;; 種別不明の event は受入前の correction だった可能性を否定できないため、是正 SLI の欠落にも含める
        corr-lost (+ corr-lost unverifiable-type id-collisions)
        ;; 指定種別の event だった可能性を否定できない欠落件数 (種別不明の破損行・drop・未配信・読めない入力・run、
        ;; 種別不明または該当種別の privacy 拒否、event_type 不正、event_id 衝突)
        lost-of-type (fn [t] (let [maybe? #(or (= t %) (not (contains? (:event_type enum-values) %)))]
                               (+ malformed buffer-dropped undelivered input-unreadable unreadable-run-events id-collisions unverifiable-type
                                  (count (filter #(maybe? (:event_type %)) upstream-markers))
                                  (count (filter (fn [[e g]] (and (:rejected? g) (maybe? (:event_type e)))) (map vector raw-events gated))))))
        approval-lost (lost-of-type "approval.requested")
        rescue-lost (lost-of-type "owner.rescue")
        ;; task_id 欠落の救援は救援発生 task 数に数えられない
        rescue-unlinked (count (filter #(and (= "owner.rescue" (:event_type %)) (nil? (:task_id %))) uniq))
        dup (- n-in (count uniq))
        ;; 観測順と occurred_at 順の逆転、observed_at より未来の occurred_at (時刻ずれ)
        inversions (->> events (group-by :task_id) vals
                        (map (fn [es] (->> es (keep (comp parse-inst :occurred_at)) (partition 2 1) (filter (fn [[a b]] (.isAfter a b))) count)))
                        (reduce + 0))
        skew (->> uniq (filter #(let [o (parse-inst (:occurred_at %)) w (parse-inst (:observed_at %))]
                                   (and o w (.isAfter o (.plusSeconds w 300))))) count)
        by-task (group-by :task_id (filter :task_id uniq))
        ;; task に紐付くべき event で task_id が欠落したもの: 集計から黙って除外せず件数を別掲し、是正が欠落していれば SLI を確定しない
        task-scoped? #(or (#{"correction" "request.received" "lane.changed"} (:event_type %))
                          (some-> (:event_type %) (str/starts-with? "task."))
                          (some-> (:event_type %) (str/starts-with? "run.")))
        unlinked (filter #(and (nil? (:task_id %)) (task-scoped? %)) uniq)
        ;; correction/reopen だけでなく run.*/task.accepted/task.state 等も是正率・first acceptance の分母/分子を左右するため、
        ;; task_id 欠落の task 紐付け event が 1 件でもあれば是正 SLI を確定しない
        unlinked-corr (count unlinked)
        ;; 欠落 event (破損行・privacy 拒否・drop/未配信・読めない入力) は task に紐付けられず、受入前の是正だった可能性を否定できない
        unlinked-guard (fn [m] (cond
                                 (pos? unlinked-corr)
                                 {:status "unknown" :reason "task_id 欠落の task 紐付け event (是正・run・受入・状態) があり、どの task の分子/分母か確定できない (合格扱いしない)"
                                  :observed m :unlinked-corrections unlinked-corr :lost-events corr-lost}
                                 (pos? corr-lost)
                                 {:status "unknown" :reason "task に紐付けられない欠落 event (破損行・privacy 拒否・collector 欠落・読めない入力) があり、是正の有無を確定できない (観測値は observed)"
                                  :observed m :lost-events corr-lost}
                                 :else m))
        tasks (for [[tid evs] by-task
                    :let [evs (sort-by event-time-key evs)
                          corr (filter #(#{"correction" "task.reopened"} (:event_type %)) evs)
                          ;; 人の訂正 (classifier=human) は同じ evidence の rule 判定を上書きする
                          human (into {} (keep #(when-let [k (and (= "human" (:classifier %)) (evidence-key %))] [k %]) corr))
                          matched (set (keep #(when-let [k (and (rule-classifier? (:classifier %)) (evidence-key %))]
                                                (when (contains? human k) k)) corr))
                          corr (keep (fn [e]
                                       (let [evidence (evidence-key e) h (get human evidence)]
                                         (cond
                                           (and (= "human" (:classifier e)) (contains? matched evidence)) nil
                                           (and h (rule-classifier? (:classifier e)))
                                           (merge (apply dissoc e [:correction_class :correction_origin :classifier :classifier_version :confidence])
                                                  (select-keys h [:correction_class :correction_origin :classifier :classifier_version :confidence]))
                                           :else e))) corr)
                          agent-corr (filter #(= "agent-system" (correction-origin %)) corr)
                          unknown-corr (filter #(= "unknown" (correction-origin %)) corr)
                          acceptances (filter #(= "task.accepted" (:event_type %)) evs)
                          ;; 時刻不明の受入が 1 件でもあれば最初の受入を特定できない: 後の受入を first acceptance の基準にせず受入時刻不明として別掲
                          accepted-ev (when (every? #(parse-inst (:occurred_at %)) acceptances) (first acceptances))
                          accepted (some-> accepted-ev :occurred_at parse-inst)
                          ;; 日粒度の受入 (frontmatter closed) は当日内の前後関係を確定できない。最初の受入は
                          ;; [全受入の最早可能時刻の最小, 全受入の最遅可能時刻の最小] のどこかにあり、幅があればその区間を曖昧窓にする
                          ;; (日粒度受入と同日の時刻付き受入が混在する場合、時刻付き受入を最初の受入と確定しない)
                          bounds (when accepted-ev
                                   (for [a acceptances :let [t (parse-inst (:occurred_at a))]]
                                     (if (= "day" (:occurred_precision a))
                                       (let [start (.truncatedTo t java.time.temporal.ChronoUnit/DAYS)]
                                         [start (.plus start 1 java.time.temporal.ChronoUnit/DAYS) false])
                                       [t t true])))
                          lo (when bounds (first (sort (map first bounds))))
                          hi-b (when bounds (first (sort-by (juxt second #(if (nth % 2) 0 1)) bounds)))
                          hi (second hi-b)
                          ;; 窓の終端が時刻付き受入の場合は終端時刻も曖昧 (日粒度受入が先なら終端時刻の是正は受入後になり得る)
                          hi-inclusive? (boolean (nth hi-b 2 nil))
                          day-window (when (and lo hi (.isBefore lo hi)) [lo hi])
                          before-accept? (fn [t] (if day-window (.isBefore t (first day-window)) (not (.isAfter t accepted))))
                          same-day? (fn [t] (and day-window (not (.isBefore t (first day-window)))
                                                 (if hi-inclusive? (not (.isAfter t (second day-window))) (.isBefore t (second day-window)))))
                          relevant-corr (remove #(= "non-agent" (correction-origin %)) corr)
                          ;; 是正側も精度に応じた期間として比較する: 日粒度の是正は [当日 00:00, 翌日 00:00) のどこか。
                          ;; 期間の両端で受入との前後 (:before/:same/:after) が一致しなければ前後不明 (:ambiguous)
                          point-phase (fn [t] (cond (before-accept? t) :before (same-day? t) :same :else :after))
                          corr-interval (fn [e] (when-let [t (parse-inst (:occurred_at e))]
                                                  (if (= "day" (:occurred_precision e))
                                                    (let [lo (.truncatedTo t java.time.temporal.ChronoUnit/DAYS)]
                                                      [lo (.minusNanos (.plus lo 1 java.time.temporal.ChronoUnit/DAYS) 1)])
                                                    [t t])))
                          corr-phase (fn [e] (if-let [[lo hi] (corr-interval e)]
                                               (let [p1 (point-phase lo) p2 (point-phase hi)] (if (= p1 p2) p1 :ambiguous))
                                               :unknown))
                          first-pass (when accepted
                                       (let [phases (set (map corr-phase relevant-corr))]
                                         (cond
                                           (some phases [:unknown :before]) :fail
                                           (some phases [:same :ambiguous]) :ambiguous
                                           :else :pass)))
                          first-review (some #(when (or (= "review" (:result %)) (= "review" (:lane_to %))
                                                        (and (= "task.state" (:event_type %)) (= "review" (:status %))))
                                                (or (parse-inst (:occurred_at %)) true)) evs)
                          post-accept-corr (when accepted (filter #(when-let [t (first (corr-interval %))]
                                                                     ;; 日粒度の曖昧窓では同時刻の再オープン特例を適用しない (窓内の再オープンは前後不明)
                                                                     (if day-window
                                                                       (if hi-inclusive? (.isAfter t (second day-window)) (not (.isBefore t (second day-window))))
                                                                       (or (.isAfter t accepted) (and (= "task.reopened" (:event_type %)) (= t accepted))))) corr))
                          requested (some #(when (= "request.received" (:event_type %)) (parse-inst (:occurred_at %))) evs)
                          runs (filter #(= "run.started" (:event_type %)) evs)
                          finished (filter #(= "run.finished" (:event_type %)) evs)
                          ;; run.started を欠く終了/中断 event: run 履歴が不完全なため入力欠落として未評価にする
                          started-ids (set (keep :run_id runs))
                          orphan-runs (filter #(and (#{"run.finished" "run.interrupted"} (:event_type %))
                                                     (if (:run_id %) (not (started-ids (:run_id %))) (empty? runs))) evs)
                          ;; run 履歴の無い是正 event: 是正の根拠 run を確認できないため run 履歴不足として未評価にする
                          history-less-corr (when (and (empty? runs) (empty? orphan-runs) (not-any? :synthetic evs))
                                              (filter #(= "correction" (:event_type %)) evs))]
                    ;; 状態 event (state/cancelled/reopened)・読めない run・救援 event も task の存在を示す (救援単独 task を救援率から落とさない)
                    :when (or (some #(#{"request.received" "task.accepted" "task.state" "task.cancelled" "task.reopened" "run.unreadable" "owner.rescue" "correction"} (:event_type %)) evs) (seq runs) (seq orphan-runs) (some :synthetic evs) (some #(= "lane.changed" (:event_type %)) evs))]
                {:task tid :acceptance-history? (boolean (some #(= "task.accepted" (:event_type %)) evs)) :accepted-at accepted :stratum (some :stratum evs) :outcome (task-outcome evs)
                 :current-state (some #(when (= "task.state" (:event_type %)) (:status %)) evs)
                 :runs (count runs) :finished (count finished)
                 :unreadable-runs (+ (count (filter #(= "run.unreadable" (:event_type %)) evs)) (count orphan-runs) (if (seq history-less-corr) 1 0))
                 :orphan-runs (count orphan-runs)
                 ;; 状態/結果 field が不正値で redact された event: Review 到達・受入・取消を判定できないため入力欠落として扱う
                 :unverifiable-state (+ (count (filter unverifiable-state-event? evs)) (count (unordered-transition-events evs)))
                 :interrupted (count (filter #(= "run.interrupted" (:event_type %)) evs))
                 :idle-timeouts (count (filter :idle_timeout finished))
                 :retrying (count (filter #(= "retrying" (:status %)) finished))
                 :agent-corr (count agent-corr) :unknown-corr (count unknown-corr)
                 :post-accept-corr (count post-accept-corr)
                 ;; 受入時刻不明・是正時刻不明・日粒度受入と同日の是正: 受入後の是正 (再オープン) の有無を確定できない
                 :post-accept-indeterminate? (boolean (and (some #(= "task.accepted" (:event_type %)) evs) (empty? post-accept-corr)
                                                          (or (nil? accepted)
                                                              (some #(#{:unknown :same :ambiguous} (corr-phase %)) corr))))
                 :observed? (boolean (or (seq runs) (seq orphan-runs) (some :synthetic evs) (some #(= "run.unreadable" (:event_type %)) evs)))
                 :reached-review? (boolean (and (or (seq runs) (some :synthetic evs)) (or first-review accepted)))
                 ;; run 履歴の無い受入 task は受入時刻の有無・受入後の再オープンに関わらず未評価 (done snapshot のみ/再オープン中の task も保守的分母に残す)
                 :accepted-unobserved? (boolean (and (or (some #(= "task.accepted" (:event_type %)) evs) (= "accepted" (task-outcome evs)))
                                                     (empty? runs) (empty? orphan-runs) (not-any? :synthetic evs)))
                 :first-pass? (= :pass first-pass)
                 ;; 受入と同日の是正があり日粒度では前後不明: 合格にも不合格にもせず別掲
                 :first-pass-ambiguous? (= :ambiguous first-pass)
                 :lead-h (hours requested accepted)
                 :rescue (count (filter #(= "owner.rescue" (:event_type %)) evs))
                 :approvals (frequencies (keep :approval_key (filter #(= "approval.requested" (:event_type %)) evs)))
                 :effects (frequencies (keep :effect_key (filter #(= "effect.applied" (:event_type %)) evs)))
                 :agents (set (keep :agent runs))
                 :delegation (frequencies (keep :delegation_kind runs))})
        n (count tasks)
        ;; 読めない run を持つ task は是正/差戻しを見落とし得るため、是正率と first acceptance の分子・分母から除き別掲する
        input-missing (filter #(input-missing? %) tasks)
        ;; 入力欠落 task は Review 到達を確認できなくても未評価として別掲する (分母から黙って消さない)
        reached-all (filter #(or (:reached-review? %) (input-missing? %)) tasks)
        reached (remove #(input-missing? %) reached-all)
        observed-accepted (filter #(and (:observed? %) (ever-accepted? %)) tasks)
        accepted-all (filter :accepted-at observed-accepted)
        accepted-evaluable (remove #(input-missing? %) accepted-all)
        accepted (remove :first-pass-ambiguous? accepted-evaluable)
        acceptance-day-ambiguous (filter :first-pass-ambiguous? accepted-evaluable)
        accepted-without-acceptance-time (filter #(nil? (:accepted-at %)) observed-accepted)
        accepted-ever (filter :acceptance-history? tasks)
        sources (frequencies (map :source uniq))
        connected? (fn [target] (some #(and (= "coverage.connected" (:event_type %)) (= target (:coverage_target %))) uniq))
        duplicates (fn [type key] (let [groups (group-by key (filter #(and (= type (:event_type %)) (get % key) (not= "redacted" (get % key))) uniq))
                                         repeated (filter #(> (count %) 1) (vals groups))]
                                     {:count (reduce + (map #(dec (count %)) repeated))
                                      :unverifiable (count (filter #(and (= type (:event_type %)) (or (nil? (get % key)) (= "redacted" (get % key)))) uniq))
                                      :tasks-involved (count (set (keep :task_id (mapcat identity repeated))))
                                      :scopes (count groups) :total (reduce + (map count (vals groups)))}))
        effects (duplicates "effect.applied" :effect_key)
        approvals (duplicates "approval.requested" :approval_key)]
    {:schema schema-version :classifier classifier-version
     :input {:events n-in :malformed-lines malformed :unreadable-inputs input-unreadable
             :tasks-with-unreadable-runs (count input-missing) :unreadable-runs (reduce + (map :unreadable-runs tasks))
             :unverifiable-state-events (reduce + (map :unverifiable-state tasks)) :unique (count uniq) :duplicates dup :id-collisions id-collisions :order-inversions inversions
             :clock-skew-gt-5m skew :sources sources}
     :tasks {:total n :never-run (count (filter #(and (zero? (:runs %)) (zero? (:orphan-runs % 0))) tasks))
             :orphan-run-events (reduce + (map #(:orphan-runs % 0) tasks))
             :accepted-without-run-history (count (filter :accepted-unobserved? tasks)) :outcomes (frequencies (map :outcome tasks))
             :by-stratum (frequencies (map :stratum tasks))}
     :sli
     {:agent-system-correction-task-ratio
      (unlinked-guard (assoc (ratio (count (filter #(pos? (:agent-corr %)) reached)) (count reached))
             :unknown-cause-tasks (count (filter #(pos? (:unknown-corr %)) reached))
             :unevaluated-input-missing (count (filter #(input-missing? %) reached-all))
             :note "分母=review 到達 task。unknown 原因は分子に入れず別掲 (成功扱いもしない)"))
      :corrections-per-task (unlinked-guard {:agent-system (quantiles (map :agent-corr reached))
                             :unknown (quantiles (map :unknown-corr reached))
                             :total-agent-system (reduce + (map :agent-corr reached))
                             :total-unknown (reduce + (map :unknown-corr reached))})
      :first-acceptance-conformance
      (unlinked-guard (assoc (ratio (count (filter :first-pass? accepted)) (count accepted))
             :incl-unevaluated-as-not-pass (ratio (count (filter :first-pass? accepted))
                                                ;; 保守的分母: 未評価・受入時刻不明・run 履歴無し受入・入力欠落 task も不合格として含める
                                                (count (distinct (map :task (concat (filter #(or (ever-accepted? %) (nil? (:accepted-at %))) reached-all)
                                                                                    accepted-without-acceptance-time
                                                                                    (filter :accepted-unobserved? tasks))))))
             :accepted-without-acceptance-time (count accepted-without-acceptance-time)
             :acceptance-day-ambiguous (count acceptance-day-ambiguous)
             :unevaluated-input-missing (count (filter #(input-missing? %) accepted-all))
             :not-yet-evaluated (count (filter #(and (not= "accepted" (:outcome %)) (nil? (:accepted-at %))) reached))
             :note "分母=受入時刻を確認できる観測済み受入 task。受入時刻不明・日粒度受入と同日の是正 (前後不明)・未評価は別掲し合格に数えない"))
      :reopen-after-accept (cond
                             (not (connected? "acceptance-history")) {:status :unknown :reason "acceptance history source not connected"}
                             ;; 欠落・未紐付け event や入力欠落 task があれば、受入後の再オープンが欠落側にあった可能性を否定できない
                             (or (pos? unlinked-corr) (pos? corr-lost) (some input-missing? accepted-ever))
                             {:status :unknown :reason "欠落 event (破損行・privacy 拒否・collector 欠落・読めない入力)・task_id 欠落 event・受入履歴を持つ task の入力欠落があり受入後の再オープンを確定できない"
                              :observed (ratio (count (filter #(pos? (:post-accept-corr %)) accepted-ever)) (count accepted-ever))
                              :lost-events corr-lost :unlinked-events unlinked-corr
                              :unevaluated-input-missing (count (filter input-missing? accepted-ever))}
                             ;; 前後関係を確定できない task があれば率を確定しない (観測値は下限として別掲)
                             (some :post-accept-indeterminate? accepted-ever)
                             {:status :unknown :reason "受入時刻または是正時刻が不明で受入後の是正を確定できない task がある"
                              :observed (ratio (count (filter #(pos? (:post-accept-corr %)) accepted-ever)) (count accepted-ever))
                              :indeterminate (count (filter :post-accept-indeterminate? accepted-ever))}
                             :else (ratio (count (filter #(pos? (:post-accept-corr %)) accepted-ever)) (count accepted-ever)))
      :owner-rescue (cond
                      (not (some #(= "owner.rescue" (:event_type %)) uniq))
                      {:status "unknown" :reason "rescue event の source 未接続"}
                      ;; 救援 event が欠落/紐付け不能だと救援発生 task を過少計上するため確定しない (観測値は下限)
                      (or (pos? rescue-lost) (pos? rescue-unlinked))
                      {:status "unknown" :reason "救援 event だった可能性のある欠落 event または task_id 欠落の救援があり、救援発生 task 数を確定できない"
                       :observed-lower-bound (ratio (count (filter #(pos? (:rescue %)) tasks)) n)
                       :lost-events rescue-lost :unlinked-rescues rescue-unlinked}
                      ;; task 紐付け event の欠落/task_id 欠落は分母 (全 task 数) を過少にするため確定しない
                      (or (pos? corr-lost) (pos? unlinked-corr))
                      {:status "unknown" :reason "task の存在を示す event だった可能性のある欠落 event または task_id 欠落の task 紐付け event があり、救援率の分母を確定できない"
                       :observed (ratio (count (filter #(pos? (:rescue %)) tasks)) n)
                       :lost-events corr-lost :unlinked-task-events unlinked-corr}
                      :else (ratio (count (filter #(pos? (:rescue %)) tasks)) n))
      :duplicate-approval (cond
                            ;; 承認 event だった可能性のある欠落 (拒否・drop・破損等) があると重複を見落とし得る
                            (and (pos? approval-lost) (pos? (+ (:total approvals) (:unverifiable approvals))))
                            {:status "unknown" :reason "承認 event だった可能性のある欠落 event (privacy 拒否・collector 欠落・破損行・読めない入力) があり重複承認の有無を確定できない"
                             :observed-lower-bound (assoc (ratio (:count approvals) (:total approvals)) :tasks-involved (:tasks-involved approvals))
                             :lost-events approval-lost :unverifiable-approvals (:unverifiable approvals)}
                            ;; approval_key 欠落/不正の承認があると同 scope 重複の有無を確定できない (観測値は下限として別掲)
                            (pos? (:unverifiable approvals))
                            {:status "unknown" :reason "approval_key 欠落/不正の承認があり重複承認の有無を確定できない"
                             :observed-lower-bound (assoc (ratio (:count approvals) (:total approvals)) :tasks-involved (:tasks-involved approvals))
                             :unverifiable-approvals (:unverifiable approvals) :coverage "partial/unverifiable-keys"}
                            (pos? (:scopes approvals))
                            (assoc (ratio (:count approvals) (:total approvals)) :tasks-involved (:tasks-involved approvals))
                            :else {:status "unknown" :reason "approval event 未接続"})
      :lead-time-hours (assoc (quantiles (keep :lead-h accepted))
                              :note "request.received/accepted は日粒度 (frontmatter)。queue/active/approval/wait/blocked 分解は lane timestamp 不足で unknown")
      :run-reliability {:runs (reduce + (map :runs tasks))
                        :interrupted (reduce + (map :interrupted tasks))
                        :idle-timeouts (reduce + (map :idle-timeouts tasks))
                        :retrying (reduce + (map :retrying tasks))}
      :delegation (apply merge-with + (map :delegation tasks))}
     :zero-tolerance {:duplicate-effects (cond
                                           ;; 破損行・拒否 event に effect が含まれていた可能性があるため 0 件と確定しない
                                           (pos? lost)
                                           {:status "unknown" :reason "破損した入力行・拒否 event・collector 欠落 (drop/未配信)・読めない run・event_id 衝突があり重複の有無を確定できない"
                                            :observed-duplicates-lower-bound (:count effects) :malformed-lines malformed :rejected-events (+ rejected rejected-correlation upstream-rejected)
                                            :collection-lost-events (+ buffer-dropped undelivered) :unreadable-inputs input-unreadable :unreadable-runs unreadable-run-events :id-collisions id-collisions}
                                           (pos? unverifiable-type)
                                           {:status "unknown" :reason "event_type 欠落/不正の event があり重複の有無を確定できない"
                                            :observed-duplicates-lower-bound (:count effects) :unverifiable-event-types unverifiable-type}
                                           ;; effect_key 欠落/不正の effect があると重複の有無を確定できない (0 件と報告しない)
                                           (pos? (:unverifiable effects))
                                           {:status "unknown" :reason "effect_key 欠落/不正の effect があり重複の有無を確定できない"
                                            :observed-duplicates-lower-bound (:count effects) :tasks-involved (:tasks-involved effects)
                                            :unverifiable-effects (:unverifiable effects) :coverage "partial/unverifiable-keys"}
                                           (or (connected? "duplicate-effects") (some #(= "effect.applied" (:event_type %)) uniq))
                                           (assoc (select-keys effects [:count :tasks-involved])
                                                  :coverage (if (connected? "duplicate-effects") "connected" "partial/undeclared"))
                                           :else {:status "unknown" :reason "effect source 未接続"})
                      :critical-safety-events (cond
                                                (pos? lost)
                                                {:status "unknown" :reason "破損した入力行・拒否 event・collector 欠落 (drop/未配信)・読めない run・event_id 衝突があり重大 event の有無を確定できない"
                                                 :observed-lower-bound (count (filter #(= "critical" (:severity %)) uniq)) :malformed-lines malformed :rejected-events (+ rejected rejected-correlation upstream-rejected)
                                            :collection-lost-events (+ buffer-dropped undelivered) :unreadable-inputs input-unreadable :unreadable-runs unreadable-run-events :id-collisions id-collisions}
                                                (pos? unverifiable-type)
                                                {:status "unknown" :reason "event_type 欠落/不正の event があり重大 event の有無を確定できない"
                                                 :observed-lower-bound (count (filter #(= "critical" (:severity %)) uniq)) :unverifiable-event-types unverifiable-type}
                                                ;; severity が不正 (redact 済み) の event は重大度を検証できないため 0 件と確定しない
                                                (pos? unverifiable-severity)
                                                {:status "unknown" :reason "severity 不正の event があり重大 event の有無を確定できない"
                                                 :observed-lower-bound (count (filter #(= "critical" (:severity %)) uniq)) :unverifiable-severity unverifiable-severity}
                                                (connected? "critical-safety-events") {:count (count (filter #(= "critical" (:severity %)) uniq)) :coverage "connected"}
                                                (some #(contains? (:severity enum-values) (:severity %)) uniq) {:count (count (filter #(= "critical" (:severity %)) uniq)) :coverage "partial/undeclared"}
                                                :else {:status "unknown" :reason "safety source 未接続"})
                      :private-leak {:status "unknown" :reason "leak detector 未接続。0件観測≠0件"}}
     :guardrails {:pending-over-7d "要 lane timestamp (unknown)"
                  :tasks-per-request (ratio n (count (set (keep :request_id uniq))))
                  :unfinished (count (filter #(not (contains? #{"accepted" "cancelled"} (:outcome %))) tasks))
                  :awaiting-review (count (filter #(= "awaiting-review" (:outcome %)) tasks))
                  :unobserved (count (filter #(= "unobserved" (:outcome %)) tasks))}
     :coverage {:collection-lost {:buffer-dropped buffer-dropped :undelivered undelivered :input-unreadable input-unreadable} :privacy-rejected-invalid-id rejected :privacy-rejected-upstream upstream-rejected :privacy-rejected-invalid-correlation-id rejected-correlation :unlinked-task-events (count unlinked) :unlinked-corrections unlinked-corr :ready-ack-latency {:status "unknown" :reason "Ready 遷移時刻 event なし (board-diff は Ready→ を出さない)"}
                :tokens-cost {:status "unknown" :reason "subscription CLI は provider token/cost を返さない。API 単価換算はしない"}
                :hermes-conversation {:status (if (or (connected? "hermes-conversation")
                                                   (some #(or (= "hermes" (:runtime %))
                                                              (boolean (re-matches #"(?:[^:]+:)?hermes" (or (:source %) "")))) uniq))
                                             "connected" "not-connected")}}
     :by-stratum
     (into (sorted-map)
           (for [[s ts] (group-by :stratum tasks)
                 :let [ok (remove #(input-missing? %) ts)
                       r (filter :reached-review? ok)
                       observed-a (filter #(and (:observed? %) (ever-accepted? %)) ok)
                       a-all (filter :accepted-at observed-a)
                       a (remove :first-pass-ambiguous? a-all)]]
             [s {:tasks (count ts) :reached-review (count r)
                 :agent-system-corr-tasks (count (filter #(pos? (:agent-corr %)) r))
                 :unknown-corr-tasks (count (filter #(pos? (:unknown-corr %)) r))
                 :accepted (count a)
                 :accepted-without-acceptance-time (count (remove :accepted-at observed-a))
                 :first-pass (count (filter :first-pass? a))
                 :acceptance-day-ambiguous (count (filter :first-pass-ambiguous? a-all))
                 :unevaluated-input-missing (count (filter #(input-missing? %) ts))}]))}))

(defn aggregate [file] (aggregate* (read-events file)))

;; ---------------------------------------------------------------------------
;; prom: 低 cardinality のみ。task/run/request ID は trace 側 opaque correlation に残す

(defn prom [file]
  (let [evs (read-events file)
        r (aggregate* evs)
        line (fn [m labels v] (println (str m (when (seq labels) (str "{" (str/join "," (map (fn [[k v]] (str (name k) "=\"" v "\"")) labels)) "}")) " " v)))]
    (println "# TYPE ai_ops_events_total counter")
    (doseq [[[src t] c] (frequencies (map (fn [e] [(if (contains? (:source enum-values) (:source e)) (:source e) "other")
                                                    (if (contains? (:event_type enum-values) (:event_type e)) (:event_type e) "other")])
                                          (unique-events (keep (comp :event privacy-gate) (remove #(or (::malformed %) (marker? %)) evs)))))]
      (line "ai_ops_events_total" {:source src :event_type t} c))
    (println "# TYPE ai_ops_tasks gauge")
    (doseq [[o c] (get-in r [:tasks :outcomes])] (line "ai_ops_tasks" {:outcome o} c))
    (line "ai_ops_event_duplicates_total" {} (get-in r [:input :duplicates]))
    (line "ai_ops_event_id_collisions_total" {} (get-in r [:input :id-collisions]))
    (line "ai_ops_input_malformed_lines_total" {} (get-in r [:input :malformed-lines]))
    (line "ai_ops_privacy_rejected_events_total" {:stage "upstream"} (get-in r [:coverage :privacy-rejected-upstream]))
    (line "ai_ops_collection_lost_events_total" {:reason "buffer_dropped"} (get-in r [:coverage :collection-lost :buffer-dropped]))
    (line "ai_ops_collection_lost_events_total" {:reason "undelivered"} (get-in r [:coverage :collection-lost :undelivered]))
    (line "ai_ops_collection_lost_events_total" {:reason "input_unreadable"} (get-in r [:coverage :collection-lost :input-unreadable]))
    (line "ai_ops_event_order_inversions_total" {} (get-in r [:input :order-inversions]))
    (line "ai_ops_unlinked_task_events_total" {} (get-in r [:coverage :unlinked-task-events]))
    ;; unknown の SLI は観測値を確定値として公開しない。判定可否を別 gauge で出し、dashboard/alert が欠落込みの率を使わないようにする
    (println "# TYPE ai_ops_sli_determinable gauge")
    (doseq [[k m] [[:agent-system-correction-task-ratio "agent_system_correction_task_ratio"]
                   [:first-acceptance-conformance "first_acceptance_conformance"]]]
      (let [s (get-in r [:sli k])]
        ;; 分母 0 は率を計算できないので判定不能として扱う
        (line "ai_ops_sli_determinable" {:sli m} (if (or (= "unknown" (:status s)) (not (pos? (or (:denominator s) 0)))) 0 1))))
    (let [c (get-in r [:sli :agent-system-correction-task-ratio])]
      (when-not (= "unknown" (:status c))
        (line "ai_ops_correction_tasks" {:origin "agent-system"} (:count c))
        (line "ai_ops_correction_tasks" {:origin "unknown"} (:unknown-cause-tasks c))
        (line "ai_ops_reached_review_tasks" {} (:denominator c))))))

;; ---------------------------------------------------------------------------

(defn -main [& [cmd & args]]
  (let [synthetic? (and (contains? #{"emit-sim" "aggregate" "prom"} cmd) (= "--synthetic" (first args)))
        args (if synthetic? (rest args) args)]
    (binding [*synthetic-mode* (boolean synthetic?)]
      (case cmd
        "extract" (extract (first args) (second args))
        "emit-sim" (let [[f cap from to] args] (emit-sim f (parse-long (or cap "8")) (parse-long (or from "-1")) (parse-long (or to "-2"))))
        "aggregate" (prn (aggregate (first args)))
        "prom" (prom (first args))
        (binding [*out* *err*] (println "usage: ai_ops_sli.bb extract|emit-sim|aggregate|prom [--synthetic] ...") (System/exit 2))))))

(when (= *file* (System/getProperty "babashka.file")) (apply -main *command-line-args*))
