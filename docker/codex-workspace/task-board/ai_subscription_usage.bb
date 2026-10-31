#!/usr/bin/env bb

(ns ai-subscription-usage
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(defn enum-value [x fallback]
  (if (and (string? x) (re-matches #"[a-z0-9_]{1,40}" x)) x fallback))

(defn atomic-write! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/create-temp-file {:dir (fs/parent path) :prefix ".subscription-"})]
    (try (spit (str tmp) content)
         (fs/move tmp path {:replace-existing true :atomic-move true})
         (finally (fs/delete-if-exists tmp)))))

(defn record-claude-rate-limit! [root event observed-epoch-s]
  (let [info (:rate_limit_info event)
        enums [:status :rateLimitType :overageStatus :overageDisabledReason]
        clean (reduce (fn [m k] (if (some? (get info k)) (assoc m k (enum-value (get info k) "other")) m)) {} enums)
        clean (cond-> clean
                (number? (:resetsAt info)) (assoc :resetsAt (:resetsAt info))
                (boolean? (:isUsingOverage info)) (assoc :isUsingOverage (:isUsingOverage info)))
        windows (->> (:unifiedWindows info)
                     (filter (fn [[k v]] (and (re-matches #"[a-z0-9_]{1,40}" (name k)) (map? v))))
                     (sort-by (comp name key)) (take 10)
                     (map (fn [[k v]] [k (cond-> {}
                                            (and (number? (:utilization v)) (<= 0 (:utilization v) 1)) (assoc :utilization (:utilization v))
                                            (number? (:resetsAt v)) (assoc :resetsAt (:resetsAt v))
                                            (some? (:status v)) (assoc :status (enum-value (:status v) "other")))]))
                     (into {}))]
    (atomic-write! (fs/path root "ai-ops/subscription/claude.json")
                   (json/generate-string {:observed_at observed-epoch-s :rate_limit_info (assoc clean :unifiedWindows windows)}))))

(def ^:dynamic *codex-read-error* nil)

(defn codex-latest-rate-limits [codex-home now-s]
  (let [dir (fs/path codex-home "sessions")
        files (if (fs/exists? dir)
                (->> (fs/glob dir "**/rollout-*.jsonl")
                     (filter #(>= (quot (.toMillis (fs/last-modified-time %)) 1000) (- now-s (* 8 86400))))
                     (sort-by #(.toMillis (fs/last-modified-time %)) >) (take 200)) [])]
    (some (fn [file]
            (try
              (with-open [reader (io/reader (str file))]
                (reduce (fn [last-hit line]
                          (if (str/includes? line "\"token_count\"")
                            (let [entry (try (json/parse-string line true) (catch Exception _ (when *codex-read-error* (reset! *codex-read-error* true)) nil))
                                  payload (:payload entry)]
                              (if (and (= "event_msg" (:type entry)) (= "token_count" (:type payload)) (map? (:rate_limits payload)))
                                {:rate_limits (:rate_limits payload)
                                 :observed_at (try (.getEpochSecond (java.time.Instant/parse (:timestamp entry)))
                                                   (catch Exception _ (quot (.toMillis (fs/last-modified-time file)) 1000)))}
                                last-hit)) last-hit)) nil (line-seq reader)))
              (catch Exception _ (when *codex-read-error* (reset! *codex-read-error* true)) nil))) files)))

(defn snapshot [path]
  (if-not (fs/exists? path) {:state "no_snapshot"}
    (try (let [v (json/parse-string (slurp (str path)) true)]
           (if (and (map? v) (map? (:rate_limit_info v)) (number? (:observed_at v)))
             {:state "ok" :data v} {:state "parse_error"}))
         (catch Exception _ {:state "parse_error"}))))

(defn window-name [provider limit]
  (if (= provider "claude")
    (get {"five_hour" "shared_5h" "seven_day" "shared_7d"
          "seven_day_overage_included" "fable_7d" "seven_day_opus" "opus_7d"
          "seven_day_sonnet" "sonnet_7d"} limit limit)
    limit))

(defn prom-text [root codex-home now-s]
  (let [claude (snapshot (fs/path root "ai-ops/subscription/claude.json"))
        codex (try (let [error? (atom false)
                         v (binding [*codex-read-error* error?] (codex-latest-rate-limits codex-home now-s))]
                     (if v {:state "ok" :data v} {:state (if @error? "parse_error" "no_snapshot")}))
                   (catch Exception _ {:state "parse_error"}))
        lines (atom [])
        emit (fn [metric labels value]
               (when (some? value)
                 (swap! lines conj (str metric (when (seq labels) (str "{" (str/join "," (map (fn [[k v]] (str (name k) "=\"" v "\"")) labels)) "}")) " " value))))
        bool-num (fn [x] (when (boolean? x) (if x 1 0)))
        window! (fn [provider limit window used reset duration status]
                  (let [labels [[:provider provider] [:limit limit] [:name (window-name provider limit)] [:window window]]
                        expired (and (number? reset) (<= reset now-s))]
                    (when (number? reset) (emit "ai_subscription_window_expired" labels (if expired 1 0)))
                    (when (and (number? used) (not expired)) (emit "ai_subscription_window_used_percent" labels used))
                    (when (number? reset) (emit "ai_subscription_window_resets_at_seconds" labels reset))
                    (when (number? duration) (emit "ai_subscription_window_duration_seconds" labels duration))
                    (when (some? status) (emit "ai_subscription_window_status" (conj labels [:status (enum-value status "other")]) 1))))]
    (doseq [[provider source] [["claude" claude] ["codex" codex]]]
      (emit "ai_subscription_source_up" [[:provider provider]] (if (= "ok" (:state source)) 1 0))
      (emit "ai_subscription_source_state" [[:provider provider] [:state (:state source)]] 1)
      (when (= "ok" (:state source)) (emit "ai_subscription_observed_timestamp_seconds" [[:provider provider]] (get-in source [:data :observed_at]))))
    (emit "ai_subscription_generated_timestamp_seconds" [] now-s)
    (when-let [info (get-in claude [:data :rate_limit_info])]
      (doseq [k [:five_hour :seven_day :seven_day_overage_included]]
        (let [limit (name k)]
          (emit "ai_subscription_window_present" [[:provider "claude"] [:limit limit] [:name (window-name "claude" limit)]]
                (if (contains? (:unifiedWindows info) k) 1 0))))
      (when (some? (:rateLimitType info))
        (emit "ai_subscription_limiting_window" [[:provider "claude"] [:limit (enum-value (:rateLimitType info) "other")]] 1))
      (doseq [[k v] (:unifiedWindows info) :when (and (map? v) (re-matches #"[a-z0-9_]{1,40}" (name k)))]
        (let [limit (name k) window (cond (= limit "five_hour") "5h" (str/starts-with? limit "seven_day") "7d" :else "unknown")
              u (:utilization v)]
          (window! "claude" limit window (when (and (number? u) (<= 0 u 1)) (* 100 u)) (:resetsAt v) ({"5h" 18000 "7d" 604800} window) (:status v))))
      (emit "ai_subscription_extra_usage_status" [[:provider "claude"] [:status (enum-value (:overageStatus info) "unknown")] [:reason (enum-value (:overageDisabledReason info) "none")]] 1)
      (emit "ai_subscription_extra_usage_in_use" [[:provider "claude"]] (bool-num (:isUsingOverage info))))
    (when-let [limits (get-in codex [:data :rate_limits])]
      ;; Codex reports one bucket per event (limit_id, "codex" for the plan-wide limit).
      ;; Other buckets get their own limit label so they never overwrite the plan window.
      (doseq [slot [:primary :secondary] :let [v (slot limits)] :when (map? v)]
        (let [minutes (:window_minutes v)
              limit-id (:limit_id limits)
              limit (if (or (nil? limit-id) (= "codex" limit-id))
                      (name slot)
                      (enum-value (str limit-id "_" (name slot)) "other"))]
          (window! "codex" limit (cond (= 300 minutes) "5h"
                                       (= 10080 minutes) "7d"
                                       (and (integer? minutes) (pos? minutes) (< minutes 1000000000)) (str minutes "m")
                                       :else "unknown")
                   (:used_percent v) (:resets_at v) (when (and (number? minutes) (pos? minutes)) (* minutes 60)) nil)))
      (let [credits (:credits limits) labels [[:provider "codex"]]]
        (emit "ai_subscription_credits_available" labels (bool-num (:has_credits credits)))
        (emit "ai_subscription_credits_unlimited" labels (bool-num (:unlimited credits)))
        (emit "ai_subscription_credits_balance" labels (try (when (string? (:balance credits)) (let [n (Double/parseDouble (:balance credits))] (when (Double/isFinite n) n))) (catch Exception _ nil)))
        (emit "ai_subscription_spend_control_reached" labels (bool-num (:spend_control_reached limits)))
        (when (some? (:rate_limit_reached_type limits)) (emit "ai_subscription_limit_reached" (conj labels [:type (enum-value (:rate_limit_reached_type limits) "other")]) 1))
        (when (some? (:plan_type limits)) (emit "ai_subscription_plan_info" (conj labels [:plan (enum-value (:plan_type limits) "other")]) 1))))
    (let [metrics (distinct (map #(first (str/split % #"[ {]")) @lines))]
      (str (str/join "\n" (mapcat (fn [m] (concat [(str "# HELP " m " AI subscription " (subs m 16) ".") (str "# TYPE " m " gauge")] (filter #(str/starts-with? % (str m (if (str/includes? % "{") "{" " "))) @lines))) metrics)) "\n"))))

(defn write-metrics! [root]
  (try (atomic-write! (fs/path root "ai-ops/subscription-usage.prom")
                      (prom-text root (or (System/getenv "CODEX_HOME") (str (fs/path (System/getProperty "user.home") ".codex"))) (quot (System/currentTimeMillis) 1000)))
       true (catch Exception _ nil)))

(when (= (str (fs/canonicalize *file*)) (some-> (System/getProperty "babashka.file") fs/canonicalize str))
  (when (= "prom" (first *command-line-args*))
    (print (prom-text (second *command-line-args*) (or (System/getenv "CODEX_HOME") (str (fs/path (System/getProperty "user.home") ".codex"))) (quot (System/currentTimeMillis) 1000)))))
