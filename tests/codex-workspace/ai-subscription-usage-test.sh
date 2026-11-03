#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
module="${repo}/docker/codex-workspace/task-board/ai_subscription_usage.bb"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
export TEST_ROOT="${tmp}/root" TEST_CODEX="${tmp}/codex" TEST_MODULE="${module}"
mkdir -p "${TEST_CODEX}/sessions/2026/01"
bb -e '
(load-file (System/getenv "TEST_MODULE"))
(let [clean (ai-subscription-usage/clean-claude-rate-limit-info
             {:status "BAD VALUE" :rateLimitType "five_hour" :resetsAt 123 :isUsingOverage false
              :secretToken "SECRET_TOP"
              :unifiedWindows {"five_hour" {:utilization 0.2 :resetsAt 456 :status "allowed" :note "SECRET_WIN"}
                               "Bad Key" {:utilization 0.5}}})]
  (assert (= {:status "other" :rateLimitType "five_hour" :resetsAt 123 :isUsingOverage false
              :unifiedWindows {"five_hour" {:utilization 0.2 :resetsAt 456 :status "allowed"}}} clean)))
(let [root (System/getenv "TEST_ROOT") home (System/getenv "TEST_CODEX") now (quot (System/currentTimeMillis) 1000)
      event {:type "rate_limit_event" :uuid "SECRET_UUID" :session_id "SECRET_SESSION"
             :rate_limit_info {:status "BAD VALUE" :overageStatus "rejected" :isUsingOverage false
                               :unifiedWindows {:five_hour {:utilization 0.2 :resetsAt (+ now 100) :status "allowed"}
                                                :seven_day {:utilization 0.73 :resetsAt (- now 1) :status "allowed"}}}}]
  (ai-subscription-usage/record-claude-rate-limit! root event (* now 1000))
  (let [raw (slurp (str root "/ai-ops/subscription/claude.json"))]
    (assert (not (clojure.string/includes? raw "SECRET")))
    (assert (clojure.string/includes? raw "other")))
  (let [path (str root "/ai-ops/subscription/claude.json")]
    (ai-subscription-usage/record-claude-rate-limit! root {:rate_limit_info {:status "rejected"}} (- (* now 1000) 1))
    (assert (= "other" (get-in (ai-subscription-usage/snapshot path) [:data :rate_limit_info :status])))
    (ai-subscription-usage/record-claude-rate-limit! root {:rate_limit_info {:status "allowed"}} (+ (* now 1000) 1))
    (assert (= "allowed" (get-in (ai-subscription-usage/snapshot path) [:data :rate_limit_info :status])))
    (ai-subscription-usage/record-claude-rate-limit! root event (+ (* now 1000) 2)))
  ;; Same-second observations, equal timestamps, and legacy snapshots.
  (let [path (str root "/ai-ops/subscription/claude.json") base (* now 1000)
        record (fn [ms status] (ai-subscription-usage/record-claude-rate-limit! root {:rate_limit_info {:status status}} ms))]
    (record (+ base 900) "newest")
    (record (+ base 100) "older")
    (assert (= "newest" (get-in (ai-subscription-usage/snapshot path) [:data :rate_limit_info :status])))
    (record (+ base 900) "equal")
    (assert (= "equal" (get-in (ai-subscription-usage/snapshot path) [:data :rate_limit_info :status])))
    (spit path (cheshire.core/generate-string {:observed_at now :rate_limit_info {:status "legacy"}}))
    (assert (= "ok" (:state (ai-subscription-usage/snapshot path))))
    (record (dec base) "older")
    (assert (= "legacy" (get-in (ai-subscription-usage/snapshot path) [:data :rate_limit_info :status])))
    (record (inc base) "newer")
    (assert (= "newer" (get-in (ai-subscription-usage/snapshot path) [:data :rate_limit_info :status])))
    (let [jobs (doall (for [i (shuffle (range 40))] (future (record (+ base 2000 i) (str "event_" i)))))]
      (doseq [job jobs] @job)
      (let [data (:data (ai-subscription-usage/snapshot path))]
        (assert (= (+ base 2039) (:observed_at_ms data)))
        (assert (= (+ now 2) (:observed_at data)))
        (assert (= "event_39" (get-in data [:rate_limit_info :status])))))
    (ai-subscription-usage/record-claude-rate-limit! root event (+ base 3000)))
  (let [file (str home "/sessions/2026/01/rollout-test.jsonl")]
    (spit file (str "{\"secret\":\"SECRET_BODY\"}\n"
                    (cheshire.core/generate-string {:type "event_msg" :timestamp (str (java.time.Instant/ofEpochSecond now))
                     :payload {:type "token_count" :rate_limits {:primary {:used_percent 31.0 :window_minutes 10080 :resets_at (+ now 100)}
                      :credits {:has_credits false :unlimited false :balance "0"} :plan_type "prolite"}}}) "\n")))
  (let [out (ai-subscription-usage/prom-text root home now)]
    (doseq [part ["ai_subscription_source_up{provider=\"claude\"} 1" "ai_subscription_source_up{provider=\"codex\"} 1"
                  "limit=\"five_hour\",name=\"shared_5h\",window=\"5h\"} 20.0" "limit=\"seven_day\",name=\"shared_7d\",window=\"7d\"} 1"
                  "limit=\"primary\",name=\"primary\",window=\"7d\"} 31.0"]]
      (assert (clojure.string/includes? out part) part))
    (assert (clojure.string/includes? out "ai_subscription_window_present{provider=\"claude\",limit=\"seven_day_overage_included\",name=\"fable_7d\"} 0"))
    (assert (not (re-find #"ai_subscription_window_used_percent\{[^\n]*seven_day_overage_included" out)))
    (assert (not (clojure.string/includes? out "SECRET_BODY")))
    (assert (not (re-find #"ai_subscription_window_used_percent\{[^\n]*seven_day" out))))
  (ai-subscription-usage/record-claude-rate-limit! root
    {:rate_limit_info {:rateLimitType "seven_day_overage_included"
                       :unifiedWindows {:seven_day_overage_included {:utilization 0.4 :resetsAt (+ now 100) :status "allowed"}}}} (+ (* now 1000) 4000))
  (let [out (ai-subscription-usage/prom-text root home now)]
    (doseq [part ["limit=\"seven_day_overage_included\",name=\"fable_7d\",window=\"7d\"} 40.0"
                  (str "ai_subscription_window_observed_timestamp_seconds{provider=\"claude\",limit=\"seven_day_overage_included\",name=\"fable_7d\",window=\"7d\"} " (+ now 4))
                  "ai_subscription_window_present{provider=\"claude\",limit=\"seven_day_overage_included\",name=\"fable_7d\"} 1"
                  "ai_subscription_limiting_window{provider=\"claude\",limit=\"seven_day_overage_included\"} 1"
                  "# HELP ai_subscription_window_present AI subscription window_present."
                  "# HELP ai_subscription_limiting_window AI subscription limiting_window."]]
      (assert (clojure.string/includes? out part) part)))
  ;; Window-level retention: an event listing only some windows must not erase the others.
  (let [wroot (str root "-windows")
        path (str wroot "/ai-ops/subscription/claude.json")
        base (* now 1000)
        fable-labels "provider=\"claude\",limit=\"seven_day_overage_included\",name=\"fable_7d\",window=\"7d\""
        shared-labels "provider=\"claude\",limit=\"seven_day\",name=\"shared_7d\",window=\"7d\""
        rec (fn [windows ms scope] (ai-subscription-usage/record-claude-rate-limit! wroot {:rate_limit_info {:status "allowed" :unifiedWindows windows}} ms scope))
        win (fn [u reset] {:utilization u :resetsAt reset :status "allowed"})
        prom #(ai-subscription-usage/prom-text wroot (str home "-empty") %)
        has (fn [out part] (assert (clojure.string/includes? out part) part))
        lacks (fn [out re] (assert (not (re-find re out)) (str re)))]
    ;; Fable+shared, then shared only (Opus run): Fable keeps its own value and time.
    (rec {:seven_day (win 0.4 (+ now 500)) :seven_day_overage_included (win 0.85 (+ now 500))} (- base 60000) "acct-a")
    (rec {:seven_day (win 0.43 (+ now 500))} base "acct-a")
    (let [out (prom now)]
      (has out (str "ai_subscription_window_used_percent{" fable-labels "} 85.0"))
      (has out (str "ai_subscription_window_observed_timestamp_seconds{" fable-labels "} " (- now 60)))
      (has out (str "ai_subscription_window_used_percent{" shared-labels "} 43.0"))
      (has out (str "ai_subscription_window_observed_timestamp_seconds{" shared-labels "} " now))
      (has out "ai_subscription_window_present{provider=\"claude\",limit=\"seven_day_overage_included\",name=\"fable_7d\"} 1")
      (has out (str "ai_subscription_observed_timestamp_seconds{provider=\"claude\"} " now)))
    ;; A never-observed window stays absent, not 0.
    (let [out (prom now)]
      (has out "ai_subscription_window_present{provider=\"claude\",limit=\"five_hour\",name=\"shared_5h\"} 0")
      (lacks out #"ai_subscription_window_used_percent\{[^\n]*five_hour"))
    ;; Out of order: older event cannot overwrite a newer window or the top level,
    ;; but may fill a window not seen since.
    (rec {:seven_day (win 0.1 (+ now 500)) :five_hour (win 0.2 (+ now 100))} (- base 30000) "acct-a")
    (let [data (:data (ai-subscription-usage/snapshot path)) out (prom now)]
      (assert (= base (:observed_at_ms data)))
      (has out (str "ai_subscription_window_used_percent{" shared-labels "} 43.0"))
      (has out "ai_subscription_window_used_percent{provider=\"claude\",limit=\"five_hour\",name=\"shared_5h\",window=\"5h\"} 20.0")
      (has out (str "ai_subscription_window_observed_timestamp_seconds{provider=\"claude\",limit=\"five_hour\",name=\"shared_5h\",window=\"5h\"} " (- now 30))))
    ;; After reset: old used is withheld while last observation and expiry remain visible.
    (let [out (prom (+ now 600))]
      (lacks out #"ai_subscription_window_used_percent\{[^\n]*seven_day_overage_included")
      (lacks out #"ai_subscription_window_status\{[^\n]*seven_day_overage_included")
      (has out (str "ai_subscription_window_expired{" fable-labels "} 1"))
      (has out (str "ai_subscription_window_observed_timestamp_seconds{" fable-labels "} " (- now 60))))
    ;; A later cycle replaces the window.
    (rec {:seven_day_overage_included (win 0.02 (+ now 9000))} (+ base 1000) "acct-a")
    (has (prom (+ now 600)) (str "ai_subscription_window_used_percent{" fable-labels "} 2.0"))
    ;; Unknown scope cannot prove a boundary, so it retains.
    (rec {:seven_day (win 0.44 (+ now 500))} (+ base 2000) nil)
    (has (prom now) (str "ai_subscription_window_used_percent{" fable-labels "} 2.0"))
    ;; Older event of another account is ignored; a newer one drops only windows of that account.
    (rec {:seven_day (win 0.9 (+ now 500))} (- base 90000) "acct-b")
    (has (prom now) (str "ai_subscription_window_used_percent{" fable-labels "} 2.0"))
    (rec {:seven_day (win 0.05 (+ now 500))} (+ base 3000) "acct-b")
    (let [out (prom now)]
      (lacks out #"ai_subscription_window_used_percent\{[^\n]*seven_day_overage_included")
      (has out "ai_subscription_window_present{provider=\"claude\",limit=\"seven_day_overage_included\",name=\"fable_7d\"} 0")
      (has out (str "ai_subscription_window_used_percent{" shared-labels "} 5.0")))
    ;; The scope never reaches the exposition.
    (assert (not (clojure.string/includes? (prom now) "acct-")))
    ;; An unknown-scope event keeps the last known boundary, both on a refreshed
    ;; window and on a window it adds, so a later account switch still drops them.
    (rec {:seven_day (win 0.06 (+ now 500))} (+ base 4000) nil)
    (rec {:five_hour (win 0.07 (+ now 100))} (+ base 5000) nil)
    (let [out (prom now)]
      (has out (str "ai_subscription_window_used_percent{" shared-labels "} 6.0"))
      (has out "ai_subscription_window_used_percent{provider=\"claude\",limit=\"five_hour\",name=\"shared_5h\",window=\"5h\"} 7.0"))
    (rec {:seven_day_sonnet (win 0.08 (+ now 500))} (+ base 6000) "acct-c")
    (let [out (prom now)]
      (lacks out #"ai_subscription_window_used_percent\{[^\n]*limit=\"seven_day\"")
      (lacks out #"ai_subscription_window_used_percent\{[^\n]*limit=\"five_hour\"")
      (has out "ai_subscription_window_used_percent{provider=\"claude\",limit=\"seven_day_sonnet\",name=\"sonnet_7d\",window=\"7d\"} 8.0"))
    ;; Legacy snapshot without per-window time inherits the file time, then merges.
    (spit path (cheshire.core/generate-string {:observed_at (- now 10) :rate_limit_info {:status "allowed" :unifiedWindows {:seven_day_overage_included (win 0.7 (+ now 500))}}}))
    (rec {:seven_day (win 0.3 (+ now 500))} base "acct-a")
    (let [out (prom now)]
      (has out (str "ai_subscription_window_used_percent{" fable-labels "} 70.0"))
      (has out (str "ai_subscription_window_observed_timestamp_seconds{" fable-labels "} " (- now 10)))))
  ;; Concurrent writers in one process keep every distinct window.
  (let [wroot (str root "-concurrent") base (* now 1000)
        jobs (doall (for [i (shuffle (range 12))]
                      (future (ai-subscription-usage/record-claude-rate-limit! wroot {:rate_limit_info {:unifiedWindows {(keyword (str "w_" i)) {:utilization 0.1}}}} (+ base i) "a"))))]
    (doseq [job jobs] @job)
    (assert (= 12 (count (get-in (ai-subscription-usage/snapshot (str wroot "/ai-ops/subscription/claude.json")) [:data :rate_limit_info :unifiedWindows])))))
  (let [out (ai-subscription-usage/prom-text (str root "-empty") (str home "-empty") now)]
    (assert (clojure.string/includes? out "state=\"no_snapshot\""))
    (assert (not (clojure.string/includes? out "ai_subscription_window_used_percent"))))
  (spit (str home "/sessions/2026/01/rollout-test.jsonl")
        (str (cheshire.core/generate-string {:type "event_msg" :timestamp (str (java.time.Instant/ofEpochSecond now))
              :payload {:type "token_count" :rate_limits {:limit_id "codex_other" :primary {:used_percent 5.0 :window_minutes 300 :resets_at (+ now 100)}}}}) "\n"))
  (let [out (ai-subscription-usage/prom-text root home now)]
    (assert (clojure.string/includes? out "limit=\"codex_other_primary\",name=\"codex_other_primary\",window=\"5h\"} 5.0"))
    (assert (not (clojure.string/includes? out "limit=\"primary\""))))
  (let [older (str home "/sessions/2026/01/rollout-older.jsonl")
        newer (str home "/sessions/2026/01/rollout-test.jsonl")
        event (fn [timestamp limits]
                (str (cheshire.core/generate-string {:type "event_msg" :timestamp (str (java.time.Instant/ofEpochSecond timestamp))
                      :payload {:type "token_count" :rate_limits limits}}) "\n"))
        window (fn [used] {:used_percent used :window_minutes 300 :resets_at (+ now 100)})]
    (spit older (event (- now 20) {:limit_id "codex" :primary (window 10.0)}))
    (spit newer (event (- now 10) {:limit_id "codex" :primary (window 20.0)}))
    (babashka.fs/set-last-modified-time older (java.nio.file.attribute.FileTime/fromMillis (* 1000 now)))
    (babashka.fs/set-last-modified-time newer (java.nio.file.attribute.FileTime/fromMillis (* 1000 (- now 30))))
    (let [out (ai-subscription-usage/prom-text root home now)]
      (assert (clojure.string/includes? out "limit=\"primary\",name=\"primary\",window=\"5h\"} 20.0")))
    (babashka.fs/delete older)
    (spit newer (str (event (- now 259200) {:limit_id "codex" :primary (window 30.0) :plan_type "pro"})
                     (event now {:limit_id "other_bucket" :primary (window 40.0) :plan_type "other"})))
    (let [out (ai-subscription-usage/prom-text root home now)]
      (doseq [part ["limit=\"primary\",name=\"primary\",window=\"5h\"} 30.0"
                    "limit=\"other_bucket_primary\",name=\"other_bucket_primary\",window=\"5h\"} 40.0"
                    "ai_subscription_plan_info{provider=\"codex\",plan=\"pro\"} 1"
                    (str "ai_subscription_window_observed_timestamp_seconds{provider=\"codex\",limit=\"primary\",name=\"primary\",window=\"5h\"} " (- now 259200))
                    (str "ai_subscription_window_observed_timestamp_seconds{provider=\"codex\",limit=\"other_bucket_primary\",name=\"other_bucket_primary\",window=\"5h\"} " now)
                    (str "ai_subscription_observed_timestamp_seconds{provider=\"codex\"} " now)]]
        (assert (clojure.string/includes? out part) part))))
  (let [dir (str home "/sessions/many")
        event (fn [t n] (str (cheshire.core/generate-string {:type "event_msg" :timestamp (str (java.time.Instant/ofEpochSecond t))
                         :payload {:type "token_count" :rate_limits {:limit_id "many" :primary {:used_percent n}}}}) "\n"))]
    (babashka.fs/create-dirs dir)
    (doseq [i (range 250)]
      (let [path (str dir "/rollout-" i ".jsonl")]
        (spit path (event (if (zero? i) now (- now 100)) (if (zero? i) 99 1)))
        (babashka.fs/set-last-modified-time path (java.nio.file.attribute.FileTime/fromMillis (* 1000 (- now (if (zero? i) 300 0)))))))
    (assert (= 99 (get-in (ai-subscription-usage/codex-latest-rate-limits home now) [:buckets "many" :rate_limits :primary :used_percent])))
    (spit (str dir "/rollout-1.jsonl") (event (+ now 1) 77) :append true)
    (assert (= 77 (get-in (ai-subscription-usage/codex-latest-rate-limits home now) [:buckets "many" :rate_limits :primary :used_percent])))
    (babashka.fs/delete-tree dir))
  (spit (str home "/sessions/2026/01/rollout-test.jsonl") "{\"token_count\": malformed}\n")
  (assert (clojure.string/includes? (ai-subscription-usage/prom-text root home now) "provider=\"codex\",state=\"parse_error\""))
  (assert (clojure.string/includes? (ai-subscription-usage/prom-text root home now) "provider=\"codex\",state=\"parse_error\""))
  (spit (str root "/ai-ops/subscription/claude.json") "not json")
  (assert (clojure.string/includes? (ai-subscription-usage/prom-text root home now) "state=\"parse_error\""))
  (ai-subscription-usage/record-claude-rate-limit! root event (* now 1000))
  (assert (= "ok" (:state (ai-subscription-usage/snapshot (str root "/ai-ops/subscription/claude.json"))))))
'
# Separate runner processes must not lose each other's windows.
for i in 0 1 2 3 4 5; do
  TEST_I="${i}" bb -e '
  (load-file (System/getenv "TEST_MODULE"))
  (let [i (System/getenv "TEST_I")]
    (ai-subscription-usage/record-claude-rate-limit! (str (System/getenv "TEST_ROOT") "-procs")
      {:rate_limit_info {:unifiedWindows {(keyword (str "w_" i)) {:utilization 0.1}}}}
      (+ 1800000000000 (Long/parseLong i)) "a"))' >/dev/null &
done
wait
bb -e '
(load-file (System/getenv "TEST_MODULE"))
(assert (= 6 (count (get-in (ai-subscription-usage/snapshot (str (System/getenv "TEST_ROOT") "-procs/ai-ops/subscription/claude.json")) [:data :rate_limit_info :unifiedWindows]))))
;; The account digest comes from the local config, is opaque, and is nil when absent.
(let [dir (str (System/getenv "TEST_ROOT") "-home")]
  (babashka.fs/create-dirs dir)
  (spit (str dir "/.claude.json") (cheshire.core/generate-string {:oauthAccount {:accountUuid "SECRET_ACCOUNT" :emailAddress "SECRET_MAIL"}}))
  (System/setProperty "user.home" dir)
  (let [scope (ai-subscription-usage/claude-account-scope)]
    (assert (re-matches #"[0-9a-f]{16}" scope)))
  (babashka.fs/delete (str dir "/.claude.json"))
  (assert (nil? (ai-subscription-usage/claude-account-scope))))' >/dev/null
mkdir -p "${tmp}/vault/Boards" "${tmp}/vault/Tickets" "${tmp}/bin"
cat >"${tmp}/vault/Boards/Task Board.md" <<'BOARD'
# Task Board

## Backlog

## Ready

## In Progress
- [ ] [[Tickets/BOXP-149|BOXP-149: stream]] #ticket status::in-progress

## Blocked

## Review

## Done
BOARD
cat >"${tmp}/vault/Tickets/BOXP-149.md" <<'TICKET'
---
id: BOXP-149
type: task
status: in-progress
priority: medium
assignee: fable
repo:
closed:
---

# BOXP-149: stream

## Summary

Test.

## Acceptance Criteria

- [ ] Done

## Context

Test.

## Plan

- [ ] Run

## Notes
TICKET
cat >"${tmp}/bin/claude" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
prompt="$(cat)"
if [[ "${prompt}" == *'Delegation contract:'* ]]; then
  python3 "${TASK_BOARD_DELEGATION_HELPER}" exempt small-task >&2
fi
printf '%s\n' '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"SECRET_SESSION"}' '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}' '{"type":"result","result":"TASK_BOARD_RESULT: done"}'
FAKE
chmod +x "${tmp}/bin/claude"
PATH="${tmp}/bin:${PATH}" TASK_BOARD_DELEGATION_HELPER="${repo}/docker/codex-workspace/task-board/delegate.py" CODEX_TASK_BOARD_CLAUDE_BIN="${tmp}/bin/claude" CODEX_TASK_BOARD_VAULT="${tmp}/vault" CODEX_TASK_BOARD_ROOT="${tmp}/runner-state" \
  bb "${repo}/docker/codex-workspace/task-board/task_board_runner.bb" tick >/dev/null
message="$(find "${tmp}/runner-state/runs/BOXP-149" -name last-message.md -print -quit)"
[[ "$(cat "${message}")" == 'TASK_BOARD_RESULT: done' ]]
[[ -f "${tmp}/runner-state/ai-ops/subscription/claude.json" ]]
grep -q '^status: done$' "${tmp}/vault/Tickets/BOXP-149.md"
echo 'ai-subscription-usage tests passed' 
