#!/usr/bin/env bb
;; BOXP-708: 保留中の利用枠の再観測。期待値は現行仕様
;; Projects/task-board-provider-quota/spec.md の「決まり（再観測）」と例の表から取る。
;; 回帰例 (BOXP-707): Fable 7d 枠が reset 前に戻ったのに、保留中は観測が来ず止まり続けた。
(require '[clojure.test :refer [deftest is testing run-tests]]
         '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])
(def task-board-dir (str (fs/path (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))
                                  "docker/codex-workspace/task-board")))
(load-file (str task-board-dir "/ai_subscription_usage.bb"))
(load-file (str task-board-dir "/ai_provider_quota.bb"))
(load-file (str task-board-dir "/ai_quota_reprobe.bb"))
(alias 'r 'ai-quota-reprobe)
(alias 'q 'ai-provider-quota)
(alias 'u 'ai-subscription-usage)

(def min60 60)
(def hour 3600)
;; 07:25 UTC に rejected を観測、reset は 3 日後 (BOXP-707 と同じ形)。
(def t0 1795591500)
(def reset (+ t0 (* 3 24 hour)))
(def config {:enabled? true :base-s 1800 :cap-s 21600 :max-attempts 40 :margin-s 900 :force-gap-s 60})

(defn- held-data [observed-s]
  {:observed_at observed-s :observed_at_ms (* 1000 observed-s)
   :rate_limit_info {:status "rejected" :rateLimitType "seven_day_overage_included" :resetsAt reset
                     :unifiedWindows {:five_hour {:status "allowed" :utilization 0.1 :observed_at_ms (* 1000 observed-s)}
                                      :seven_day {:status "allowed" :utilization 0.5 :observed_at_ms (* 1000 observed-s)}
                                      :seven_day_overage_included {:status "rejected" :resetsAt reset :observed_at_ms (* 1000 observed-s)}}}})

(defn- status-at [now] (q/route-status (held-data t0) "claude-fable" now nil))

(defn- decide [now entry & {:keys [force? cfg status] :or {cfg config}}]
  (:decision (r/decide {:status (or status (status-at now)) :entry entry :now-s now :config cfg :force? force?})))

(deftest hold-key-and-observed
  (let [s (status-at (+ t0 60))]
    (is (= :hold (:decision s)))
    (is (= (str "claude-fable/seven_day_overage_included/" reset) (r/hold-key s)))
    (is (= t0 (r/hold-observed-at s)))))

(deftest example-table
  (testing "仕様の例: 30 分・1h・2h と間隔が伸びる"
    (let [k (r/hold-key (status-at t0))]
      (is (= :wait (decide (+ t0 (* 15 min60)) nil)) "07:40 はまだ 30 分たっていない")
      (is (= :probe (decide (+ t0 (* 30 min60)) nil)) "07:55 に 1 回目")
      (let [e1 {:hold_key k :attempts 1 :last_attempt_at (+ t0 (* 30 min60))}]
        (is (= :wait (decide (+ t0 (* 65 min60)) e1)) "08:30 は待つ")
        (is (= :probe (decide (+ t0 (* 90 min60)) e1)) "08:55 に 2 回目"))
      (let [e2 {:hold_key k :attempts 2 :last_attempt_at (+ t0 (* 90 min60))}]
        (is (= :wait (decide (+ t0 (* 209 min60)) e2)))
        (is (= :probe (decide (+ t0 (* 210 min60)) e2)) "10:55 に 3 回目"))
      (testing "cap 6 時間で頭打ち"
        (let [e {:hold_key k :attempts 10 :last_attempt_at (+ t0 hour)}]
          (is (= :wait (decide (+ t0 hour (dec 21600)) e)))
          (is (= :probe (decide (+ t0 hour 21600) e))))))))

(deftest stop-conditions
  (let [k (r/hold-key (status-at t0))
        late (+ t0 (* 2 24 hour))]
    (testing "上限回数で止まる"
      (is (= :skip (decide late {:hold_key k :attempts 40 :last_attempt_at t0})))
      (is (= :budget-spent (:reason (r/decide {:status (status-at late) :entry {:hold_key k :attempts 40 :last_attempt_at t0}
                                               :now-s late :config config})))))
    (testing "reset まで 15 分を切ったら打たない"
      (is (= :skip (decide (- reset (* 14 min60)) nil)))
      (is (= :probe (decide (- reset (* 16 min60)) nil))))
    (testing "hold でない route には打たない (自動も本人入口も)"
      (let [clear (q/route-status (held-data t0) "claude-opus" late nil)]
        (is (not= :hold (:decision clear)))
        (is (= :skip (decide late nil :status clear)))
        (is (= :skip (decide late nil :status clear :force? true)))))
    (testing "off なら打たない"
      (is (= :skip (decide late nil :cfg (assoc config :enabled? false)))))
    (testing "保留キーが変わると回数は数え直し"
      (is (= :probe (decide late {:hold_key "claude-fable/seven_day_overage_included/1" :attempts 40 :last_attempt_at (- late 10)}))))))

(deftest owner-force
  (let [k (r/hold-key (status-at t0)) now (+ t0 (* 5 min60))]
    (is (= :probe (decide now nil :force? true)) "間隔を無視")
    (is (= :probe (decide now {:hold_key k :attempts 40 :last_attempt_at (- now 61)} :force? true)) "回数上限も無視")
    (is (= :probe (decide (- reset 60) nil :force? true)) "reset 直前でも打てる")
    (is (= :skip (decide now {:hold_key k :attempts 1 :last_attempt_at (- now 30)} :force? true)) "60 秒以内は二重押し")
    (is (= :skip (decide now {:hold_key k :attempts 1 :last_attempt_at (- now 30) :last_result "running"} :force? true)))))

(deftest config-from-env
  (let [c (r/config-from-env {})]
    (is (= [true 1800 21600 40 900 60] ((juxt :enabled? :base-s :cap-s :max-attempts :margin-s :force-gap-s) c))))
  (is (false? (:enabled? (r/config-from-env {"CODEX_TASK_BOARD_QUOTA_REPROBE" "off"}))))
  (is (= 600 (:base-s (r/config-from-env {"CODEX_TASK_BOARD_QUOTA_REPROBE_BASE_SECONDS" "60"}))) "600 秒未満にはできない")
  (is (= 1800 (:base-s (r/config-from-env {"CODEX_TASK_BOARD_QUOTA_REPROBE_BASE_SECONDS" "x"})))))

(deftest probe-args-are-minimal
  (let [args (r/probe-args "claude" "claude-fable-5-2")]
    (is (= "claude" (first args)))
    (doseq [flag ["--print" "--output-format" "stream-json" "--verbose" "--model" "claude-fable-5-2"
                  "--tools" "--strict-mcp-config" "--disable-slash-commands" "--no-session-persistence"]]
      (is (some #{flag} args) flag))
    (is (= "" (second (drop-while #(not= "--tools" %) args))) "ツールなし")
    (is (not-any? #{"--dangerously-skip-permissions" "--bare"} args))))

(deftest probe-env-stays-on-subscription
  (let [e (r/probe-env {"PATH" "/usr/bin" "HOME" "/h" "ANTHROPIC_API_KEY" "k" "ANTHROPIC_AUTH_TOKEN" "t" "ANTHROPIC_BASE_URL" "u"
                        "ANTHROPIC_CUSTOM_HEADERS" "h" "CLAUDE_CODE_USE_BEDROCK" "1" "CLAUDE_CODE_USE_VERTEX" "1" "CLAUDE_CODE_USE_FOUNDRY" "1"})]
    (is (= {"PATH" "/usr/bin" "HOME" "/h"} e) "API キー・別 provider への切替変数を外す")))

(defn- event-line
  ([status limit] (event-line status limit reset))
  ([status limit reset-s]
   (json/generate-string {:type "rate_limit_event"
                          :rate_limit_info {:status status :rateLimitType limit :resetsAt reset-s
                                            :unifiedWindows {(keyword limit) {:status status :utilization (if (= "allowed" status) 0.0 1.0) :resetsAt reset-s}}}})))

(deftest classify-results
  (is (= "allowed" (r/classify {:exit 0 :out (str "{\"type\":\"system\"}\n" (event-line "allowed" "seven_day_overage_included") "\n")})))
  (is (= "rejected" (r/classify {:exit 1 :out (str (event-line "allowed" "five_hour") "\n" (event-line "rejected" "seven_day_overage_included"))})) "最後の event で判断")
  (is (= "no_event" (r/classify {:exit 0 :out "{\"type\":\"result\"}\nnot json\n"})))
  (is (= "timeout" (r/classify {:timeout true})))
  (is (= "missing" (r/classify {:missing true})))
  (is (= "failed" (r/classify {:exit 2 :out ""}))))

(deftest end-to-end-with-fake-cli
  (let [root (str (fs/create-temp-dir {:prefix "reprobe-test"}))
        snap (str root "/ai-ops/subscription/claude.json")
        calls (atom 0)
        now (quot (System/currentTimeMillis) 1000)
        ;; reset は実時刻基準にする (固定値 reset だと 2026-11-28 07:25 UTC 以降に過去の reset になり失敗した)
        cli (fn [status] (fn [_args] (swap! calls inc) {:exit 0 :out (str (event-line status "seven_day_overage_included" (+ now (* 3 24 hour))) "\n")}))
        observed (- now (* 2 hour))
        data (assoc-in (held-data observed) [:rate_limit_info :resetsAt] (+ now (* 3 24 hour)))
        data (assoc-in data [:rate_limit_info :unifiedWindows :seven_day_overage_included :resetsAt] (+ now (* 3 24 hour)))
        status-now (fn [] (q/route-status (:data (u/snapshot snap)) "claude-fable" (quot (System/currentTimeMillis) 1000) nil))
        run! (fn [status & {:keys [force?]}]
               (r/reprobe! {:root root :route "claude-fable" :model "claude-fable-5-2" :status (status-now)
                            :now-s (quot (System/currentTimeMillis) 1000) :config config :force? force?
                            :scope (u/claude-account-scope) :call (cli status)}))]
    (fs/create-dirs (fs/parent snap))
    (spit snap (json/generate-string data))
    (is (= :hold (:decision (status-now))))
    (testing "まだ上限: rejected を記録し、判定は hold のまま、回数は 1"
      (let [out (run! "rejected")]
        (is (= "rejected" (:result out)))
        (is (= :hold (:decision (status-now))))
        (is (= 1 (get-in (r/read-state root) [:routes :claude-fable :attempts])))))
    (testing "直後の自動は待つ (CLI を呼ばない)"
      (let [n @calls out (run! "allowed")]
        (is (= :wait (:decision out)))
        (is (= n @calls))))
    (testing "本人入口でも 60 秒以内は打たない"
      (is (= :skip (:decision (run! "allowed" :force? true)))))
    (testing "早期解放: allowed を記録すると hold が解ける (snapshot は記録関数だけが書く)"
      (r/write-state! root (assoc-in (r/read-state root) [:routes :claude-fable :last_attempt_at] (- now 120)))
      (let [out (run! "allowed" :force? true)]
        (is (= "allowed" (:result out)))
        (is (not= :hold (:decision (status-now))))
        (is (= :probe (:decision out)))))
    (testing "状態ファイルに秘密や本文が入らない"
      (let [raw (slurp (str root "/ai-ops/subscription/claude-reprobe.json"))]
        (is (not (str/includes? raw "OK")))
        (is (str/includes? raw "allowed"))))
    (fs/delete-tree root)))

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
