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
  ;; A run stays bound to the account it started with. After a login switch its
  ;; later events cannot be attributed, so they must not enter the snapshot under
  ;; either account; the windows of the account now logged in stay intact.
  (let [login (fn [account] (spit (str dir "/.claude.json") (cheshire.core/generate-string {:oauthAccount {:accountUuid account}})) (ai-subscription-usage/claude-account-scope))
        rroot (str (System/getenv "TEST_ROOT") "-run-scope")
        file (str rroot "/ai-ops/subscription/claude.json")
        used (fn [] (get-in (ai-subscription-usage/snapshot file) [:data :rate_limit_info :unifiedWindows :seven_day :utilization]))
        scope-of (fn [] (get-in (ai-subscription-usage/snapshot file) [:data :rate_limit_info :unifiedWindows :seven_day :account_scope]))
        rec (fn [u ms run-scope] (ai-subscription-usage/record-claude-run-rate-limit! rroot {:rate_limit_info {:unifiedWindows {:seven_day {:utilization u}}}} ms run-scope))
        base 1800000000000
        a (login "account-a")]
    (rec 0.1 base a)
    (assert (= [0.1 a] [(used) (scope-of)]))
    (let [b (login "account-b")]
      ;; Run A, login now B: dropped although it is the newest event.
      (rec 0.9 (+ base 1000) a)
      (assert (= [0.1 a] [(used) (scope-of)]))
      ;; A run started under B replaces the old account.
      (rec 0.2 (+ base 2000) b)
      (assert (= [0.2 b] [(used) (scope-of)]))
      ;; A late event of run A cannot take the snapshot back from B.
      (rec 0.8 (+ base 3000) a)
      (assert (= [0.2 b] [(used) (scope-of)]))
      ;; Unknown at start but known now: the boundary is unverified, so drop.
      (rec 0.7 (+ base 4000) nil)
      (assert (= [0.2 b] [(used) (scope-of)]))
      ;; Config temporarily unreadable: the start scope still identifies the run.
      (babashka.fs/delete (str dir "/.claude.json"))
      (rec 0.3 (+ base 5000) b)
      (assert (= [0.3 b] [(used) (scope-of)]))))
  (babashka.fs/delete-if-exists (str dir "/.claude.json"))
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
# BOXP-637: Antigravity /usage collection (official CLI, fake binary here).
cat >"${tmp}/bin/agy" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >"${AGY_FAKE_LOG}.args"
env >"${AGY_FAKE_LOG}.env"
[[ -t 0 ]] && exit 9
case "$(cat "${AGY_FAKE_LOG}.mode" 2>/dev/null || echo ok)" in
  ok) cat <<'JSON'
{"command":{"name":"usage","data":{"description":"SECRET_DESC","groups":[
 {"name":"Gemini Models","description":"SECRET_MODELS","buckets":[
  {"id":"gemini-weekly","name":"Weekly","description":"SECRET_SENTENCE","window":"weekly","remaining_fraction":0.75,"reset_time":"2099-01-01T00:00:00Z"},
  {"id":"gemini-5h","name":"5h","window":"5h","remaining_fraction":0,"reset_time":"2099-01-01T05:00:00Z"}]},
 {"name":"Claude and GPT models","buckets":[
  {"id":"3p-weekly","window":"weekly","remaining_fraction":1,"reset_time":"2000-01-01T00:00:00Z"},
  {"id":"3p-5h","window":"5h","remaining_fraction":"bad","reset_time":"not a time"},
  {"id":"Bad Id!!","window":"daily","remaining_fraction":1.5}]}]}},
 "conversation_id":"","num_turns":0,"status":"SUCCESS","response":"x","usage":{"total_tokens":0}}
JSON
  ;;
  auth) echo '{"status":"ERROR","error":"authentication failed or timed out","response":""}'; exit 1 ;;
  apikey) echo 'not available with a Gemini API key'; exit 2 ;;
  garbage) echo 'not json' ;;
esac
FAKE
chmod +x "${tmp}/bin/agy"
export AGY_FAKE_LOG="${tmp}/agy" TEST_AGY="${tmp}/bin/agy" TEST_AGY_ROOT="${tmp}/agy-root"
GEMINI_API_KEY=SECRET_KEY GOOGLE_APPLICATION_CREDENTIALS=/SECRET AGY_ADC_AUTH=true bb -e '
(load-file (System/getenv "TEST_MODULE"))
(require (quote [clojure.string :as str]))
(let [root (System/getenv "TEST_AGY_ROOT") bin (System/getenv "TEST_AGY") now 1900000000
      call #(ai-subscription-usage/call-antigravity-usage bin 30000)
      prom #(ai-subscription-usage/prom-text root "/nonexistent" %)
      has? (fn [out part] (assert (str/includes? out part) part))
      lacks? (fn [out part] (assert (not (str/includes? out part)) part))]
  ;; Not opted in: no call at all.
  (assert (nil? (ai-subscription-usage/maybe-refresh-antigravity! root true)))
  (assert (not (babashka.fs/exists? (str (System/getenv "AGY_FAKE_LOG") ".args"))))
  ;; No snapshot yet: unknown, never 0% or unlimited.
  (let [out (prom now)]
    (has? out "ai_subscription_source_up{provider=\"antigravity\"} 0")
    (has? out "ai_subscription_source_state{provider=\"antigravity\",state=\"no_snapshot\"} 1")
    (lacks? out "provider=\"antigravity\",limit="))
  (let [data (ai-subscription-usage/refresh-antigravity! root now call)
        args (slurp (str (System/getenv "AGY_FAKE_LOG") ".args"))
        env (slurp (str (System/getenv "AGY_FAKE_LOG") ".env"))
        raw (slurp (str root "/ai-ops/subscription/antigravity.json"))
        out (prom now)]
    (assert (= "ok" (:last_state data)))
    (assert (= "-p /usage --output-format json --settings {\"useG1Credits\":false}" (str/trim args)) args)
    (doseq [k ["GEMINI_API_KEY" "GOOGLE_APPLICATION_CREDENTIALS" "AGY_ADC_AUTH"]] (assert (not (str/includes? env k)) k))
    (assert (not (str/includes? raw "SECRET")) raw)
    (lacks? out "SECRET")
    (has? out "ai_subscription_source_up{provider=\"antigravity\"} 1")
    (has? out "ai_subscription_window_used_percent{provider=\"antigravity\",limit=\"gemini_weekly\",name=\"gemini_7d\",window=\"7d\"} 25")
    (has? out "ai_subscription_window_used_percent{provider=\"antigravity\",limit=\"gemini_5h\",name=\"gemini_5h\",window=\"5h\"} 100")
    (has? out "ai_subscription_window_status{provider=\"antigravity\",limit=\"gemini_5h\",name=\"gemini_5h\",window=\"5h\",status=\"rejected\"} 1")
    (lacks? out "limit=\"gemini_weekly\",name=\"gemini_7d\",window=\"7d\",status=")
    (has? out "ai_subscription_window_duration_seconds{provider=\"antigravity\",limit=\"gemini_weekly\",name=\"gemini_7d\",window=\"7d\"} 604800")
    ;; A reset in the past is expired: no used% from before the reset.
    (has? out "ai_subscription_window_expired{provider=\"antigravity\",limit=\"3p_weekly\",name=\"claude_gpt_7d\",window=\"7d\"} 1")
    (lacks? out "ai_subscription_window_used_percent{provider=\"antigravity\",limit=\"3p_weekly\"")
    ;; Unparseable fraction/time stays unknown, not 0.
    (has? out "ai_subscription_window_present{provider=\"antigravity\",limit=\"3p_5h\",name=\"claude_gpt_5h\"} 1")
    (lacks? out "ai_subscription_window_used_percent{provider=\"antigravity\",limit=\"3p_5h\"")
    (lacks? out "ai_subscription_window_resets_at_seconds{provider=\"antigravity\",limit=\"3p_5h\"")
    ;; A known bucket the CLI did not report is "not provided".
    (has? out "ai_subscription_window_present{provider=\"antigravity\",limit=\"gemini_argon_wtu_weekly\",name=\"argon_7d\"} 0")
    ;; Odd ids are normalized, odd windows are unknown, out-of-range fraction dropped.
    (has? out "ai_subscription_window_present{provider=\"antigravity\",limit=\"bad_id\",name=\"bad_id\"} 1")
    (lacks? out "ai_subscription_window_used_percent{provider=\"antigravity\",limit=\"bad_id\""))
  ;; Throttled: a second call inside the interval does nothing.
  (assert (nil? (ai-subscription-usage/refresh-antigravity! root (+ now 60) (fn [] (throw (ex-info "called" {}))))))
  ;; Failures keep the last buckets with their old observation time and say why.
  (doseq [[i mode state] [[1 "auth" "auth_required"] [2 "apikey" "unsupported_auth"] [3 "garbage" "invalid_output"]]]
    (let [t (+ now (* i 700))
          _ (spit (str (System/getenv "AGY_FAKE_LOG") ".mode") mode)
          data (ai-subscription-usage/refresh-antigravity! root t (fn [] (ai-subscription-usage/call-antigravity-usage bin 30000)))]
      (assert (= state (:last_state data)) [mode data])
      (assert (= now (:observed_at data)))
      (let [out (prom t)]
        (has? out "ai_subscription_source_up{provider=\"antigravity\"} 0")
        (has? out (str "ai_subscription_source_state{provider=\"antigravity\",state=\"" state "\"} 1"))
        (has? out (str "ai_subscription_observed_timestamp_seconds{provider=\"antigravity\"} " now))
        (has? out (str "ai_subscription_attempt_timestamp_seconds{provider=\"antigravity\"} " t)))))
  (assert (= {:state "not_installed"} (ai-subscription-usage/antigravity-classify (ai-subscription-usage/call-antigravity-usage "/nonexistent/agy" 1000))))
  (assert (= {:state "timeout"} (ai-subscription-usage/antigravity-classify {:timeout true})))
  (assert (= "command_failed" (:last_state (ai-subscription-usage/refresh-antigravity! root (+ now 5000) (fn [] (throw (ex-info "boom" {})))))))
  ;; A broken snapshot is a parse_error, not ok.
  (spit (str root "/ai-ops/subscription/antigravity.json") "{")
  (has? (prom now) "ai_subscription_source_state{provider=\"antigravity\",state=\"parse_error\"} 1")
  (spit (str (System/getenv "AGY_FAKE_LOG") ".mode") "ok"))
'
CODEX_TASK_BOARD_ANTIGRAVITY_BIN="${tmp}/bin/agy" CODEX_TASK_BOARD_ANTIGRAVITY_USAGE=true bb -e '
(load-file (System/getenv "TEST_MODULE"))
(let [root (str (System/getenv "TEST_AGY_ROOT") "-sync")]
  (assert (= "ok" (:last_state (ai-subscription-usage/maybe-refresh-antigravity! root true))))
  (assert (nil? (ai-subscription-usage/maybe-refresh-antigravity! root true))))'
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
CODEX_TASK_BOARD_ANTIGRAVITY_USAGE=true CODEX_TASK_BOARD_ANTIGRAVITY_BIN="${tmp}/bin/agy" PATH="${tmp}/bin:${PATH}" TASK_BOARD_DELEGATION_HELPER="${repo}/docker/codex-workspace/task-board/delegate.py" CODEX_TASK_BOARD_CLAUDE_BIN="${tmp}/bin/claude" CODEX_TASK_BOARD_VAULT="${tmp}/vault" CODEX_TASK_BOARD_ROOT="${tmp}/runner-state" \
  bb "${repo}/docker/codex-workspace/task-board/task_board_runner.bb" tick >/dev/null
message="$(find "${tmp}/runner-state/runs/BOXP-149" -name last-message.md -print -quit)"
[[ "$(cat "${message}")" == 'TASK_BOARD_RESULT: done' ]]
[[ -f "${tmp}/runner-state/ai-ops/subscription/claude.json" ]]
grep -q '"last_state":"ok"' "${tmp}/runner-state/ai-ops/subscription/antigravity.json"
grep -q '^ai_subscription_source_up{provider="antigravity"} 1$' "${tmp}/runner-state/ai-ops/subscription-usage.prom"
grep -q '^status: done$' "${tmp}/vault/Tickets/BOXP-149.md"
echo 'ai-subscription-usage tests passed'
