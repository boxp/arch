#!/usr/bin/env bb
;; BOXP-405 AIOPS-QUOTA: 実 run の event と同じ形 (数値・enum のみ) の合成 fixture。
;; 回帰例: Fable 専用枠の不足で run が即停止し、Owner が Opus を指名した件。
(require '[clojure.test :refer [deftest is testing run-tests]]
         '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))
                         "docker/codex-workspace/task-board/ai_provider_quota.bb")))
(alias 'q 'ai-provider-quota)

(def now 1793800000)
(def reset (+ now 3600))
(defn- win [status util & {:keys [resets age scope] :or {resets reset age 60}}]
  (cond-> {:status status :utilization util :observed_at_ms (* 1000 (- now age))}
    resets (assoc :resetsAt resets)
    scope (assoc :account_scope scope)))
(defn- data [m] {:rate_limit_info {:unifiedWindows m}})
(def all-ok {:five_hour (win "allowed" 0.1) :seven_day (win "allowed" 0.59)
             :seven_day_overage_included (win "allowed" 0.2) :seven_day_opus (win "allowed" 0.2)
             :seven_day_sonnet (win "allowed" 0.2)})
(defn- route [d r] (q/route-status d r now nil))

(deftest window-states
  (testing "unknown は available にしない"
    (is (= :unobserved (q/window-state nil now nil)))
    (is (= :expired_unobserved (q/window-state (win "rejected" 1.0 :resets (- now 1)) now nil)))
    (is (= :stale (q/window-state (win "allowed" 0.1 :age (* 2 q/stale-seconds)) now nil)))
    (is (= :unobserved (q/window-state (win "rejected" 1.0 :scope "other") now "mine"))))
  (is (= :exhausted (q/window-state (win "rejected" 1.0) now nil)))
  (testing "拒否は reset まで有効で、観測の古さでは解除しない"
    (is (= :exhausted (q/window-state (win "rejected" 1.0 :age (* 2 q/stale-seconds)) now nil))))
  (testing "reset のない古い拒否は断定しない"
    (is (= :stale (q/window-state (win "rejected" 1.0 :resets nil :age (* 2 q/stale-seconds)) now nil))))
  (is (= :near_limit (q/window-state (win "allowed_warning" 0.5) now nil)))
  (is (= :near_limit (q/window-state (win "allowed" 0.95) now nil)))
  (is (= :ok (q/window-state (win "allowed" 0.0) now nil))))

(deftest fable-only-vs-shared
  (testing "Fable 専用枠の不足: Fable だけ hold、Opus は候補"
    (let [d (data (assoc all-ok :seven_day_overage_included (win "rejected" 1.0)))
          s (route d "claude-fable")]
      (is (= :hold (:decision s)))
      (is (= :model (:scope s)))
      (is (= ["seven_day_overage_included"] (:limits s)))
      (is (= reset (:resets-at s)))
      (is (= :clear (:decision (route d "claude-opus"))))
      (is (= [{:route "claude-opus" :decision :clear} {:route "claude-sonnet" :decision :clear}]
             (q/alternatives d s now nil)))))
  (testing "共有枠の不足: どの Claude 経路も hold で候補なし"
    (let [d (data (assoc all-ok :seven_day (win "rejected" 1.0)))]
      (doseq [r ["claude-fable" "claude-opus" "claude-sonnet"]]
        (is (= :hold (:decision (route d r))))
        (is (= :shared (:scope (route d r)))))
      (is (= [] (q/alternatives d (route d "claude-fable") now nil)))
      (is (str/includes? (q/prompt-section d "claude-fable" now nil) "switching to Opus or Sonnet would not avoid it"))))
  (testing "両方不足なら共有を優先し、reset は遅い方"
    (let [later (+ reset 100)
          d (data (assoc all-ok :seven_day (win "rejected" 1.0)
                         :seven_day_overage_included (win "rejected" 1.0 :resets later)))
          s (route d "claude-fable")]
      (is (= :shared (:scope s)))
      (is (= later (:resets-at s)))))
  (testing "専用枠不足でも共有枠の一部が未観測なら候補は clear と言わない"
    (let [d (data (-> all-ok (dissoc :five_hour) (assoc :seven_day_overage_included (win "rejected" 1.0))))]
      (is (= [{:route "claude-opus" :decision :unknown} {:route "claude-sonnet" :decision :unknown}]
             (q/alternatives d (route d "claude-fable") now nil))))))

(defn- top-rejected [limit windows & {:keys [resets age scope] :or {resets reset age 60}}]
  (cond-> {:observed_at_ms (* 1000 (- now age))
           :rate_limit_info (cond-> {:status "rejected" :rateLimitType limit :unifiedWindows windows}
                              resets (assoc :resetsAt resets))}
    scope (assoc :account_scope scope)))

(deftest top-level-rejection
  (let [no-status (fn [w] (dissoc w :status))]
    (testing "該当窓に status がない最上位の拒否は hold する"
      (let [d (top-rejected "seven_day_overage_included"
                            (update all-ok :seven_day_overage_included no-status))
            s (route d "claude-fable")]
        (is (= :hold (:decision s)))
        (is (= :model (:scope s)))
        (is (= reset (:resets-at s)))
        (is (= :clear (:decision (route d "claude-opus"))))))
    (testing "該当窓がなくても hold し、共有枠なら全経路に効く"
      (let [d (top-rejected "seven_day" (dissoc all-ok :seven_day))]
        (doseq [r ["claude-fable" "claude-opus" "claude-sonnet"]]
          (is (= :hold (:decision (route d r))))
          (is (= :shared (:scope (route d r)))))))
    (testing "窓の resetsAt だけがあるときはそれを reset にする"
      (let [d (top-rejected "seven_day_opus" all-ok :resets nil)]
        (is (= reset (:resets-at (route d "claude-opus"))))))
    (testing "同時刻の窓が allowed でも最上位の拒否を優先し、より新しい窓の観測なら解除する"
      (is (= :hold (:decision (route (top-rejected "seven_day_opus" (assoc all-ok :seven_day_opus (win "allowed" 0.2))) "claude-opus"))))
      (is (not= :hold (:decision (route (top-rejected "seven_day_opus" all-ok :age 600) "claude-opus")))))
    (testing "reset 後は hold しない"
      (let [d (top-rejected "seven_day_opus" (update all-ok :seven_day_opus no-status) :resets (- now 1))]
        (is (= :unknown (:decision (route d "claude-opus"))))))
    (testing "reset 不明の古い拒否は断定しない"
      (let [d (top-rejected "seven_day_opus" {} :resets nil :age (* 2 q/stale-seconds))]
        (is (not= :hold (:decision (route d "claude-opus"))))))
    (testing "別 account の拒否では hold しない。窓が空でも最上位の印で分かる"
      (let [d (top-rejected "seven_day_opus" {} :scope "other")]
        (is (= :hold (:decision (route d "claude-opus"))))
        (is (not= :hold (:decision (q/route-status d "claude-opus" now "mine"))))
        (is (= :hold (:decision (q/route-status d "claude-opus" now "other")))))
      (let [legacy (top-rejected "seven_day_opus" {:seven_day (win "allowed" 0.1 :scope "other")})]
        (is (not= :hold (:decision (q/route-status legacy "claude-opus" now "mine"))))))
    (testing "拒否でない最上位や rateLimitType のない拒否は窓を変えない"
      (let [d (assoc-in (top-rejected "seven_day_opus" all-ok) [:rate_limit_info :status] "allowed_warning")]
        (is (= :clear (:decision (route d "claude-opus")))))
      (let [d (update (top-rejected "seven_day_opus" all-ok) :rate_limit_info dissoc :rateLimitType)]
        (is (= :clear (:decision (route d "claude-opus"))))))
    (testing "記録から判定まで: 窓に status のない event で hold し、次の event で解除される"
      (load-file (str (fs/path (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))
                               "docker/codex-workspace/task-board/ai_subscription_usage.bb")))
      (let [merge! (resolve 'ai-subscription-usage/merge-claude-snapshot)
            clean (resolve 'ai-subscription-usage/clean-claude-rate-limit-info)
            ms (* 1000 (- now 60))
            rejected (merge! nil (clean {:status "rejected" :rateLimitType "seven_day_opus" :resetsAt reset
                                         :unifiedWindows {:seven_day_opus {:utilization 1 :resetsAt reset}}})
                             ms "mine")
            allowed (merge! rejected (clean {:status "allowed" :rateLimitType "seven_day_opus" :resetsAt reset
                                             :unifiedWindows {:seven_day_opus {:status "allowed" :utilization 0.2 :resetsAt reset}}})
                            (+ ms 1000) "mine")]
        (is (= "mine" (:account_scope rejected)))
        (is (= :hold (:decision (q/route-status rejected "claude-opus" now "mine"))))
        (is (not= :hold (:decision (q/route-status rejected "claude-opus" now "other"))))
        (is (not= :hold (:decision (q/route-status allowed "claude-opus" now "mine"))))))))

(deftest unknown-does-not-hold
  (testing "観測なし・reset 後未観測・古い観測は hold しないが clear とも言わない"
    (doseq [d [(data {})
               (data (assoc all-ok :seven_day_overage_included (win "rejected" 1.0 :resets (- now 1))))
               (data (assoc all-ok :seven_day (win "allowed" 0.1 :age (* 2 q/stale-seconds))))]]
      (is (= :unknown (:decision (route d "claude-fable"))))))
  (testing "別 account の拒否では hold しない"
    (let [d (data (assoc all-ok :seven_day_overage_included (win "rejected" 1.0 :scope "other")))]
      (is (= :unknown (:decision (q/route-status d "claude-fable" now "mine"))))))
  (testing "全部新しく allowed なら clear"
    (is (= :clear (:decision (route (data all-ok) "claude-fable")))))
  (testing "プロンプトは未観測を区別する"
    (let [p (q/prompt-section (data (dissoc all-ok :five_hour)) "claude-opus" now nil)]
      (is (str/includes? p "claude-opus: unknown"))
      (is (str/includes? p "five_hour=unobserved"))
      (is (str/includes? p "do not read them as available")))))

(defn- ev [info] (json/generate-string {:type "rate_limit_event" :rate_limit_info info}))

(deftest run-classification
  (let [rejected {:status "rejected" :rateLimitType "seven_day_overage_included" :overageStatus "rejected" :resetsAt reset}]
    (testing "回帰例: Fable 専用枠の拒否で停止"
      (let [r (q/run-rate-limit [(ev {:status "allowed"}) "{\"type\":\"assistant\"}" (ev rejected)])]
        (is (= {:limit "seven_day_overage_included" :scope :model :resets-at reset} r))
        (is (str/includes? (q/run-rate-limit-reason r) "scope=model"))))
    (testing "共有枠の拒否"
      (is (= :shared (:scope (q/run-rate-limit [(ev {:status "rejected" :rateLimitType "five_hour"})])))))
    (testing "警告だけ・後で解消・event なしは停止理由にしない"
      (is (nil? (q/run-rate-limit [(ev {:status "allowed_warning" :rateLimitType "seven_day"})])))
      (is (nil? (q/run-rate-limit [(ev rejected) (ev {:status "allowed"})])))
      (is (nil? (q/run-rate-limit ["{\"type\":\"assistant\",\"x\":\"rate_limit_event\"}" "not json rate_limit_event"]))))
    (testing "形式外の limit 名はそのまま出さない"
      (is (= "unknown" (:limit (q/run-rate-limit [(ev {:status "rejected" :rateLimitType "bad value; rm -rf"})])))))))

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
