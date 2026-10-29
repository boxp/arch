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
    :severity :effect_key :approval_key :redelivery :synthetic :coverage_target})

(def forbidden-value-patterns
  [#"(?i)bearer\s+[a-z0-9._-]+" #"(?i)(api[_-]?key|token|secret|password)=" #"https?://[^\s]*\?"
   #"(?i)-----BEGIN" #"(?i)\bat\s+[\w.$]+\([\w.]+:\d+\)"])

(defn safe-value? [v]
  (cond
    (nil? v) true
    (string? v) (and (<= (count v) 128)
                     (boolean (re-matches #"[A-Za-z0-9_./:+-]+" v))
                     (not (re-find #"(?i)(?:^|[^a-z0-9])sk-[a-z0-9_-]+" v))
                     (not (some #(re-find % v) forbidden-value-patterns)))
    (sequential? v) (every? safe-value? v)
    :else (or (number? v) (boolean? v))))

(defn privacy-gate
  "許可 key の値も短い識別子に限定し、不正な値を redact する。"
  [e]
  (let [dropped (remove allowed-keys (keys e))
        selected (select-keys e allowed-keys)
        invalid (filter (fn [[k v]] (or (not (safe-value? v))
                                      (and (#{:result :status :blocker_category :correction_class :correction_origin :severity} k)
                                           (string? v) (> (count v) 48)))) selected)]
    {:event (reduce (fn [m [k _]] (assoc m k "redacted")) selected invalid)
     :dropped-keys (count dropped) :redacted-values (count invalid) :rejected? false}))

(defn emit-gated [stats e]
  (let [{:keys [event dropped-keys redacted-values rejected?]} (privacy-gate e)]
    (swap! stats #(-> % (update :privacy-dropped-keys + dropped-keys)
                      (update :privacy-redacted-values + redacted-values)
                      (cond-> rejected? (update :privacy-rejected inc))))
    (when event (println (json/generate-string event)))))

;; ---------------------------------------------------------------------------
;; extract: 既存 metadata -> 共通 schema

(defn read-edn [f]
  (try (edn/read-string {:default (fn [_ v] v)} (slurp (str f))) (catch Exception _ nil)))

(defn run-id->instant [run-id]
  (when-let [[_ y mo d h mi s] (re-find #"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z" (str run-id))]
    (str y "-" mo "-" d "T" h ":" mi ":" s "Z")))

(defn frontmatter [f]
  (let [lines (str/split-lines (slurp (str f)))]
    (when (= "---" (first lines))
      (->> (rest lines)
           (take-while #(not= "---" %))
           (keep #(when-let [[_ k v] (re-matches #"^([a-z_]+):\s*(.*)$" %)] [(keyword k) (str/trim v)]))
           (into {})))))

(def infra-repos #{"boxp/arch" "boxp/lolice" "boxp/is01-linux" "boxp/dotfiles" "boxp/palserver"})

(defn stratum [{:keys [repo]} actions]
  (let [repos (set (map #(str/replace % #"^https://github.com/" "") (re-seq #"[\w./:-]+/[\w.-]+" (or repo ""))))]
    (cond
      (some #{:docs-edit :docs-groom} actions) "creative"
      (seq (filter infra-repos repos)) "infra"
      (seq repos) "dev"
      :else "assistant-or-research")))

(defn summary->events [ticket s]
  (let [run-id (:run-id s)
        started (or (:started-at s) (run-id->instant run-id))
        base {:schema_version schema-version :task_id ticket :request_id (str "req:" ticket)
              :run_id run-id :source "task-board-runner" :agent (:agent s)
              :runtime (let [a (str (:agent s))]
                         (cond (str/starts-with? a "codex") "codex-cli"
                               (str/starts-with? a "localllm") "localllm"
                               (str/blank? a) "unknown"
                               :else "claude-cli"))
              :action (some-> (:action s) name) :cost_source "unknown"
              :delegation_kind (:delegation-kind s)}]
    (cond-> [(assoc base :event_id (str ticket "/" run-id ":started") :event_type "run.started"
                    :occurred_at started :occurred_precision "second")]
      (:finished-at s)
      (conj (assoc base :event_id (str ticket "/" run-id ":finished") :event_type "run.finished"
                   :occurred_at (:finished-at s) :occurred_precision "ns"
                   :status (some-> (:status s) name) :result (some-> (:result s) str)
                   :exit_code (:exit-code s) :idle_timeout (boolean (:idle-timeout? s))
                   :blocker_category (some-> (:blocker-category s) str)))
      (and (not (:finished-at s)) (#{:interrupted :running} (:status s)))
      (conj (assoc base :event_id (str ticket "/" run-id ":" (name (:status s))) :event_type "run.interrupted"
                   :occurred_at (or (:updated-at s) started) :status (name (:status s)))))))

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
                (and prev (= :succeeded (:status prev)) (#{"review" "done"} (str (:result prev)))
                     (#{:implement :docs-edit} (:action cur)))
                [(assoc base :event_id (str ticket "/" (:run-id cur) ":reopen") :event_type "task.reopened"
                        :correction_class "unknown" :correction_origin "unknown" :confidence "low")]
                :else [])))))))

(defn outbox->events [e]
  (when (and (:event-id e) (:event-type e))
    (let [lane? (= "task-board.lane-changed" (:event-type e))]
      [{:schema_version schema-version :event_id (:event-id e) :task_id (:ticket-id e)
        :request_id (str "req:" (:ticket-id e)) :run_id (:run-id e) :source (str "outbox:" (:source e))
        :event_type (if lane? "lane.changed" "notify.run-finished")
        :occurred_at (:created-at e) :observed_at (:accepted-at e) :occurred_precision "ns"
        :lane_from (:from-status e) :lane_to (:to-status e)
        :result (some-> (:result e) str) :redelivery (or (:redeliveries e) 0)
        :status (str (:hermes-status e))}])))

(defn extract [root vault]
  (let [stats (atom {:privacy-dropped-keys 0 :privacy-redacted-values 0 :privacy-rejected 0})
        tickets (->> (fs/glob (fs/path vault "Tickets") "BOXP-*.md")
                     (keep (fn [f] (when-let [fm (frontmatter f)] [(str (fs/strip-ext (fs/file-name f))) fm])))
                     (into {}))
        runs (->> (fs/glob (fs/path root "runs") "*/*/summary.edn")
                  (keep (fn [f] (when-let [s (read-edn f)]
                                  (let [d (fs/path (fs/parent f) "delegation.json")]
                                    (cond-> s (fs/exists? d)
                                      (assoc :delegation-kind (try (:kind (json/parse-string (slurp (str d)) true)) (catch Exception _ "unparsable"))))))))
                  (group-by :ticket))]
    (doseq [[ticket fm] (sort-by key tickets)
            :let [rs (get runs ticket)
                  st (stratum fm (set (keep :action rs)))
                  ;; 期間外の古い ticket は created しか持たない
                  evs (concat
                       [{:schema_version schema-version :event_id (str ticket ":requested") :task_id ticket
                         :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "request.received"
                         :occurred_at (str (:created fm) "T00:00:00Z") :occurred_precision "day"}]
                       (mapcat #(summary->events ticket %) rs)
                       (derive-corrections ticket rs)
                       (when (and (= "done" (:status fm)) (not (str/blank? (:closed fm))))
                         [{:schema_version schema-version :event_id (str ticket ":accepted") :task_id ticket
                           :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "task.accepted"
                           :occurred_at (str (:closed fm) "T23:59:59Z") :occurred_precision "day"}])
                       (when (#{"ready" "review" "blocked" "backlog" "in-progress"} (:status fm))
                         [{:schema_version schema-version :event_id (str ticket ":state") :task_id ticket
                           :request_id (str "req:" ticket) :source "ticket-frontmatter" :event_type "task.state"
                           :status (:status fm) :occurred_at nil}]))]
            e evs]
      (emit-gated stats (assoc e :stratum st)))
    (doseq [f (fs/glob (fs/path root "outbox") "**.edn")
            :when (not= "board-lanes.edn" (str (fs/file-name f)))
            :let [e (read-edn f)]
            ev (outbox->events e)]
      (emit-gated stats ev))
    (binding [*out* *err*] (prn @stats))))

;; ---------------------------------------------------------------------------
;; emit-sim: 生成元 bounded buffer。collector 停止中も業務は止めず、溢れた分は drop を数える

(defn emit-sim [file buffer-cap down-from down-to]
  (let [raw (->> (str/split-lines (slurp file)) (remove str/blank?) (map #(json/parse-string % true)))
        st (reduce
            (fn [{:keys [buf] :as st} [i e]]
              (let [{ev :event :keys [dropped-keys redacted-values rejected?]} (privacy-gate e)
                    st (-> st (update :emitted inc) (update :privacy-dropped-keys + dropped-keys) (update :privacy-redacted-values + redacted-values)
                           (cond-> rejected? (update :privacy-rejected inc)))
                    down? (<= down-from i down-to)]
                (cond
                  (nil? ev) st
                  down? (if (< (count buf) buffer-cap)
                          (update st :buf conj ev)
                          (-> st (update :buffer-dropped inc)))
                  :else (-> st
                            (update :delivered into (conj buf ev))
                            (assoc :buf [])
                            (update :max-depth max (count buf))))))
            {:emitted 0 :delivered [] :buf [] :buffer-dropped 0 :privacy-dropped-keys 0
             :privacy-rejected 0 :privacy-redacted-values 0 :max-depth 0}
            (map-indexed vector raw))
        st (-> st (update :delivered into (:buf st)) (assoc :buf []))]
    (doseq [e (:delivered st)] (println (json/generate-string e)))
    (binding [*out* *err*]
      (prn {:emitted (:emitted st) :delivered (count (:delivered st)) :buffer-cap buffer-cap
            :buffer-dropped (:buffer-dropped st) :buffer-max-depth (max (:max-depth st) buffer-cap)
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
  (->> (str/split-lines (slurp file)) (remove str/blank?)
       (keep #(try (json/parse-string % true) (catch Exception _ nil)))))

(defn task-outcome [evs]
  (let [types (set (map :event_type evs))
        state (some #(when (= "task.state" (:event_type %)) (:status %)) evs)
        cancelled? (some #(= "task.cancelled" (:event_type %)) evs)]
    (cond
      cancelled? "cancelled"
      (contains? types "task.accepted") "accepted"
      (= state "blocked") "blocked"
      (= state "review") "awaiting-review"
      (#{"ready" "in-progress"} state) "in-flight"
      (= state "backlog") "backlog"
      (some #(= "hold" (:status %)) evs) "on-hold"
      :else "unobserved")))

(defn aggregate* [events]
  (let [n-in (count events)
        uniq (vals (reduce (fn [m e] (if (contains? m (:event_id e)) m (assoc m (:event_id e) e))) {} events))
        dup (- n-in (count uniq))
        ;; 観測順と occurred_at 順の逆転、observed_at より未来の occurred_at (時刻ずれ)
        inversions (->> events (group-by :task_id) vals
                        (map (fn [es] (->> es (keep (comp parse-inst :occurred_at)) (partition 2 1) (filter (fn [[a b]] (.isAfter a b))) count)))
                        (reduce + 0))
        skew (->> uniq (filter #(let [o (parse-inst (:occurred_at %)) w (parse-inst (:observed_at %))]
                                   (and o w (.isAfter o (.plusSeconds w 300))))) count)
        by-task (group-by :task_id (filter :task_id uniq))
        tasks (for [[tid evs] by-task
                    :let [evs (sort-by #(or (:occurred_at %) "9999") evs)
                          corr (filter #(#{"correction" "task.reopened"} (:event_type %)) evs)
                          ;; 人の訂正 (classifier=human) は同じ evidence の rule 判定を上書きする
                          human (into {} (keep #(when (= "human" (:classifier %)) [(first (:evidence_event_ids %)) %]) corr))
                          corr (keep #(if (= "human" (:classifier %)) %
                                          (when-not (contains? human (first (:evidence_event_ids %))) %)) corr)
                          agent-corr (filter #(= "agent-system" (:correction_origin %)) corr)
                          unknown-corr (filter #(= "unknown" (:correction_origin %)) corr)
                          accepted (some #(when (= "task.accepted" (:event_type %)) (parse-inst (:occurred_at %))) evs)
                          first-review (some #(when (or (= "review" (:result %)) (= "review" (:lane_to %)))
                                                (parse-inst (:occurred_at %))) evs)
                          post-accept-corr (when accepted (filter #(some-> (parse-inst (:occurred_at %)) (.isAfter accepted)) corr))
                          requested (some #(when (= "request.received" (:event_type %)) (parse-inst (:occurred_at %))) evs)
                          runs (filter #(= "run.started" (:event_type %)) evs)
                          finished (filter #(= "run.finished" (:event_type %)) evs)]
                    :when (or (seq runs) (some :synthetic evs))]
                {:task tid :stratum (some :stratum evs) :outcome (task-outcome evs)
                 :runs (count runs) :finished (count finished)
                 :interrupted (count (filter #(= "run.interrupted" (:event_type %)) evs))
                 :idle-timeouts (count (filter :idle_timeout finished))
                 :retrying (count (filter #(= "retrying" (:status %)) finished))
                 :agent-corr (count agent-corr) :unknown-corr (count unknown-corr)
                 :post-accept-corr (count post-accept-corr)
                 :reached-review? (boolean (or first-review accepted))
                 :first-pass? (and accepted (not-any? #(let [t (parse-inst (:occurred_at %))]
                                                        (or (nil? t) (.isBefore t accepted))) corr))
                 :lead-h (hours requested accepted)
                 :rescue (count (filter #(= "owner.rescue" (:event_type %)) evs))
                 :approvals (frequencies (keep :approval_key (filter #(= "approval.requested" (:event_type %)) evs)))
                 :effects (frequencies (keep :effect_key (filter #(= "effect.applied" (:event_type %)) evs)))
                 :severe (count (filter #(= "critical" (:severity %)) evs))
                 :agents (set (keep :agent runs))
                 :delegation (frequencies (keep :delegation_kind runs))})
        n (count tasks)
        reached (filter :reached-review? tasks)
        accepted (filter #(= "accepted" (:outcome %)) tasks)
        sources (frequencies (map :source uniq))]
    {:schema schema-version :classifier classifier-version
     :input {:events n-in :unique (count uniq) :duplicates dup :order-inversions inversions
             :clock-skew-gt-5m skew :sources sources}
     :tasks {:total n :outcomes (frequencies (map :outcome tasks))
             :by-stratum (frequencies (map :stratum tasks))}
     :sli
     {:agent-system-correction-task-ratio
      (assoc (ratio (count (filter #(pos? (:agent-corr %)) reached)) (count reached))
             :unknown-cause-tasks (count (filter #(and (zero? (:agent-corr %)) (pos? (:unknown-corr %))) reached))
             :note "分母=review 到達 task。unknown 原因は分子に入れず別掲 (成功扱いもしない)")
      :corrections-per-task {:agent-system (quantiles (map :agent-corr reached))
                             :unknown (quantiles (map :unknown-corr reached))
                             :total-agent-system (reduce + (map :agent-corr reached))
                             :total-unknown (reduce + (map :unknown-corr reached))}
      :first-acceptance-conformance
      (assoc (ratio (count (filter :first-pass? accepted)) (count accepted))
             :incl-unevaluated-as-not-pass (ratio (count (filter :first-pass? accepted)) (count reached))
             :not-yet-evaluated (count (remove #(= "accepted" (:outcome %)) reached))
             :note "分母=受入済 task。未評価 (awaiting-review 等) は別掲し合格に数えない")
      :reopen-after-accept (ratio (count (filter #(pos? (:post-accept-corr %)) accepted)) (count accepted))
      :owner-rescue (if (some #(= "owner.rescue" (:event_type %)) uniq)
                      (ratio (count (filter #(pos? (:rescue %)) tasks)) n)
                      {:status "unknown" :reason "rescue event の source 未接続"})
      :duplicate-approval (let [ap (mapcat (comp vals :approvals) tasks)]
                            (if (seq ap) (ratio (count (filter #(> % 1) ap)) (count ap))
                                {:status "unknown" :reason "approval event 未接続"}))
      :lead-time-hours (assoc (quantiles (keep :lead-h accepted))
                              :note "request.received/accepted は日粒度 (frontmatter)。queue/active/approval/wait/blocked 分解は lane timestamp 不足で unknown")
      :run-reliability {:runs (reduce + (map :runs tasks))
                        :interrupted (reduce + (map :interrupted tasks))
                        :idle-timeouts (reduce + (map :idle-timeouts tasks))
                        :retrying (reduce + (map :retrying tasks))}
      :delegation (apply merge-with + (map :delegation tasks))}
     :zero-tolerance {:duplicate-effects (if (some #(or (= "effect.applied" (:event_type %))
                                                            (and (= "coverage.connected" (:event_type %)) (= "duplicate-effects" (:coverage_target %)))) uniq)
                                          (count (mapcat #(filter (fn [[_ c]] (> c 1)) (:effects %)) tasks))
                                          {:status "unknown" :reason "effect source 未接続"})
                      :critical-safety-events (if (some #(or (some? (:severity %))
                                                               (and (= "coverage.connected" (:event_type %)) (= "critical-safety-events" (:coverage_target %)))) uniq)
                                                (reduce + (map :severe tasks))
                                                {:status "unknown" :reason "safety source 未接続"})
                      :private-leak {:status "unknown" :reason "leak detector 未接続。0件観測≠0件"}}
     :guardrails {:pending-over-7d "要 lane timestamp (unknown)"
                  :tasks-per-request (ratio n (count (set (keep :request_id uniq))))
                  :awaiting-review (count (filter #(= "awaiting-review" (:outcome %)) tasks))
                  :unobserved (count (filter #(= "unobserved" (:outcome %)) tasks))}
     :coverage {:ready-ack-latency {:status "unknown" :reason "Ready 遷移時刻 event なし (board-diff は Ready→ を出さない)"}
                :tokens-cost {:status "unknown" :reason "subscription CLI は provider token/cost を返さない。API 単価換算はしない"}
                :hermes-conversation {:status (if (some #(str/starts-with? (str %) "hermes") (keys sources)) "connected" "not-connected")}}
     :by-stratum
     (into (sorted-map)
           (for [[s ts] (group-by :stratum tasks)
                 :let [r (filter :reached-review? ts)]]
             [s {:tasks (count ts) :reached-review (count r)
                 :agent-system-corr-tasks (count (filter #(pos? (:agent-corr %)) r))
                 :unknown-corr-tasks (count (filter #(pos? (:unknown-corr %)) r))
                 :first-pass (count (filter :first-pass? r))}]))}))

(defn aggregate [file] (aggregate* (read-events file)))

;; ---------------------------------------------------------------------------
;; prom: 低 cardinality のみ。task/run/request ID は trace 側 opaque correlation に残す

(defn prom [file]
  (let [evs (read-events file)
        r (aggregate* evs)
        line (fn [m labels v] (println (str m (when (seq labels) (str "{" (str/join "," (map (fn [[k v]] (str (name k) "=\"" v "\"")) labels)) "}")) " " v)))]
    (println "# TYPE ai_ops_events_total counter")
    (doseq [[[src t] c] (frequencies (map (juxt #(first (str/split (str (:source %)) #":")) :event_type) evs))]
      (line "ai_ops_events_total" {:source src :event_type t} c))
    (println "# TYPE ai_ops_tasks gauge")
    (doseq [[o c] (get-in r [:tasks :outcomes])] (line "ai_ops_tasks" {:outcome o} c))
    (line "ai_ops_event_duplicates_total" {} (get-in r [:input :duplicates]))
    (line "ai_ops_event_order_inversions_total" {} (get-in r [:input :order-inversions]))
    (let [c (get-in r [:sli :agent-system-correction-task-ratio])]
      (line "ai_ops_correction_tasks" {:origin "agent-system"} (:count c))
      (line "ai_ops_correction_tasks" {:origin "unknown"} (:unknown-cause-tasks c))
      (line "ai_ops_reached_review_tasks" {} (:denominator c)))))

;; ---------------------------------------------------------------------------

(defn -main [& [cmd & args]]
  (case cmd
    "extract" (extract (first args) (second args))
    "emit-sim" (let [[f cap from to] args] (emit-sim f (parse-long (or cap "8")) (parse-long (or from "-1")) (parse-long (or to "-2"))))
    "aggregate" (prn (aggregate (first args)))
    "prom" (prom (first args))
    (binding [*out* *err*] (println "usage: ai_ops_sli.bb extract|emit-sim|aggregate|prom ...") (System/exit 2))))

(when (= *file* (System/getProperty "babashka.file")) (apply -main *command-line-args*))
