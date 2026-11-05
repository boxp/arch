#!/usr/bin/env bb

;; BOXP-405 AIOPS-QUOTA: provider usage limits as a decision input, definition
;; quota/v1-draft. This is not the outcome SLO burn rate: it answers "would a run
;; on this route start at all", from the numbers and enums the CLI already reports
;; in rate_limit_event. Unknown is never reported as available, and only a limit
;; that was seen rejected and has not reset holds a route back.

(ns ai-provider-quota
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(def definition-version "quota/v1-draft")

;; Observations older than this are shown as stale. A rejected window keeps its
;; hold until its reset instead, because the reset time is what ends a rejection.
(def stale-seconds (* 24 3600))
(def near-limit-utilization 0.9)

(def shared-windows [:five_hour :seven_day])

;; Limits that bind one model only. A route also depends on all shared windows.
(def route-model-windows
  {"claude-fable" [:seven_day_overage_included]
   "fable" [:seven_day_overage_included]
   "claude-opus" [:seven_day_opus]
   "claude-sonnet" [:seven_day_sonnet]})

(def alternative-routes ["claude-opus" "claude-sonnet"])

(defn window-state
  "State of one window from the merged snapshot, at now-s. scope is the logged-in
  account; a window recorded for another account says nothing about this one."
  [window now-s scope]
  (let [{:keys [status resetsAt utilization observed_at_ms account_scope]} window
        observed-s (when (number? observed_at_ms) (quot observed_at_ms 1000))
        reset-passed? (and (number? resetsAt) (<= resetsAt now-s))
        stale? (or (nil? observed-s) (> (- now-s observed-s) stale-seconds))]
    (cond
      (or (nil? window) (and scope account_scope (not= scope account_scope))) :unobserved
      reset-passed? :expired_unobserved
      (and (= "rejected" status) (or (number? resetsAt) (not stale?))) :exhausted
      stale? :stale
      (= "allowed_warning" status) :near_limit
      (and (number? utilization) (>= utilization near-limit-utilization)) :near_limit
      (= "allowed" status) :ok
      (number? utilization) :ok
      :else :unobserved)))

(defn- window-view [windows k now-s scope]
  (let [window (get windows k)]
    (cond-> {:limit (name k) :state (window-state window now-s scope)}
      (number? (:resetsAt window)) (assoc :resets-at (:resetsAt window))
      (number? (:observed_at_ms window)) (assoc :observed-at (quot (:observed_at_ms window) 1000))
      (number? (:utilization window)) (assoc :utilization (:utilization window)))))

(defn- effective-windows
  "The snapshot's windows with the event-level rejection applied. A rejection can
  be reported only at the top of the event, naming the limit in rateLimitType,
  while that limit's window has no status or is missing. The window's own
  observation replaces it only when strictly newer. The top level has its own
  account mark; an older snapshot without one uses the mark on its windows."
  [data]
  (let [info (:rate_limit_info data)
        windows (or (:unifiedWindows info) {})
        limit (:rateLimitType info)
        observed-ms (or (:observed_at_ms data)
                        (when (number? (:observed_at data)) (* 1000 (:observed_at data))))]
    (if (and (= "rejected" (:status info)) (string? limit))
      (let [k (keyword limit)
            window (get windows k)
            newer-window? (and (number? (:observed_at_ms window)) (number? observed-ms)
                               (> (:observed_at_ms window) observed-ms))
            account (or (:account_scope data) (some :account_scope (vals windows)))
            reset (or (:resetsAt info) (:resetsAt window))]
        (if newer-window?
          windows
          (assoc windows k (cond-> (assoc (or window {}) :status "rejected")
                             (number? observed-ms) (assoc :observed_at_ms observed-ms)
                             reset (assoc :resetsAt reset)
                             account (assoc :account_scope account)))))
      windows)))

(defn route-status
  "Decision for one Claude route. :decision is :hold (a limit it needs is rejected
  and has not reset), :clear (every limit it needs was observed fresh) or :unknown
  (nothing rejected, but not everything is known). :unknown does not hold a route:
  only a run can produce the next observation, so holding on it would never end."
  [data route now-s scope]
  (let [windows (effective-windows data)
        shared (mapv #(window-view windows % now-s scope) shared-windows)
        model (mapv #(window-view windows % now-s scope) (get route-model-windows route []))
        exhausted (fn [views] (filter #(= :exhausted (:state %)) views))
        known? (fn [{:keys [state]}] (contains? #{:ok :near_limit} state))
        ex-shared (exhausted shared)
        ex-model (exhausted model)
        blockers (concat ex-shared ex-model)
        resets (keep :resets-at blockers)]
    (cond-> {:route route
             :definition-version definition-version
             :decision (cond (seq blockers) :hold
                             (every? known? (concat shared model)) :clear
                             :else :unknown)
             :windows (into shared model)}
      (seq ex-shared) (assoc :scope :shared)
      (and (empty? ex-shared) (seq ex-model)) (assoc :scope :model)
      (seq blockers) (assoc :limits (mapv :limit blockers))
      ;; The route reopens only when its last rejected window has reset. A window
      ;; rejected without a reset time leaves this unset rather than guessed.
      (and (seq blockers) (= (count resets) (count blockers))) (assoc :resets-at (apply max resets)))))

(defn alternatives
  "Claude routes that are not rejected, for a route held by its own model limit.
  A shared rejection has none: every Claude model draws on the shared windows.
  These are candidates for an Owner or the normal helper, not an automatic switch."
  [data {:keys [route scope decision]} now-s scope-id]
  (if (and (= :hold decision) (= :model scope))
    (->> alternative-routes
         (remove #{route})
         (map #(route-status data % now-s scope-id))
         (remove #(= :hold (:decision %)))
         (mapv #(select-keys % [:route :decision])))
    []))

(defn- utc [epoch-s]
  (str (java.time.Instant/ofEpochSecond (long epoch-s))))

(defn- windows-line [windows]
  (str/join ", " (map (fn [{:keys [limit state resets-at]}]
                        (str limit "=" (name state) (when resets-at (str " (reset " (utc resets-at) ")"))))
                      windows)))

(defn hold-reason
  "One line for logs and Notes: fixed words, enum values and times only."
  [{:keys [route scope limits resets-at]}]
  (str "provider usage limit: route=" route
       " scope=" (name scope)
       " limits=" (str/join "," limits)
       " reset=" (if resets-at (utc resets-at) "unknown")))

(defn prompt-section
  "Decision support for the agent. nil when the snapshot was never written, which
  is reported by the caller as unknown."
  [data route now-s scope]
  (let [{:keys [decision windows] :as status} (route-status data route now-s scope)
        alts (alternatives data status now-s scope)]
    (str "Provider usage limits (利用枠, " definition-version ", last observed values, not the outcome SLO):\n"
         "- This route " route ": " (name decision)
         (when-let [s (:scope status)] (str " (" (name s) " limit)"))
         ". " (windows-line windows) ".\n"
         "- unknown, stale, unobserved and expired_unobserved mean not known; do not read them as available.\n"
         (cond
           (= :shared (:scope status))
           "- The shared limit binds every Claude model: switching to Opus or Sonnet would not avoid it. Wait for the reset.\n"
           (seq alts)
           (str "- Candidates if the Owner or the normal task-board helper reassigns this work: "
                (str/join ", " (map (fn [{r :route d :decision}] (str r " (" (name d) ")")) alts)) ".\n")
           :else nil)
         "- Do not retry a rejected route before its reset, and do not use new billing, another account or any way around the limit.\n")))

(defn run-rate-limit
  "The limit that stopped a run, from its events: the last rate_limit_event, only
  if it is a rejection. A warning or an earlier rejection that later cleared is not
  a stop reason. Unparseable lines are skipped."
  [event-lines]
  (let [info (->> event-lines
                  (filter #(str/includes? % "rate_limit_event"))
                  (keep (fn [line]
                          (try (let [e (json/parse-string line true)]
                                 (when (= "rate_limit_event" (:type e)) (:rate_limit_info e)))
                               (catch Exception _ nil))))
                  last)
        limit (:rateLimitType info)]
    (when (= "rejected" (:status info))
      (cond-> {:limit (if (and (string? limit) (re-matches #"[a-z0-9_]{1,40}" limit)) limit "unknown")
               :scope (cond (contains? (set (map name shared-windows)) limit) :shared
                            (string? limit) :model
                            :else :unknown)}
        (number? (:resetsAt info)) (assoc :resets-at (:resetsAt info))))))

(defn run-rate-limit-reason [{:keys [limit scope resets-at]}]
  (str "Agent stopped at a provider usage limit (scope=" (name scope)
       " limit=" limit
       " reset=" (if resets-at (utc resets-at) "unknown")
       "); do not retry this route before the reset; inspect the referenced run artifacts."))
