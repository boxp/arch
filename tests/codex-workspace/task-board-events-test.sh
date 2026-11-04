#!/usr/bin/env bash
# Black-box tests for the Task Board -> Hermes event outbox dispatcher
# (docker/codex-workspace/task-board/task_board_events.bb).
#
# A fake Hermes webhook receiver (bb + http-kit) validates the generic V2 HMAC
# signature exactly like gateway/platforms/webhook.py, answers 202 "accepted"
# for a new X-Request-ID and 200 "duplicate" for a repeated one, and can be
# switched to a 500 failure mode through a control file.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVENTS="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_events.bb"
SECRET="test-webhook-secret-$(date +%s)"
RECEIVER_PID=""

fail() {
  echo "error: $*" >&2
  exit 1
}

assert_file_contains() {
  grep -Eq "$2" "$1" || fail "expected $1 to match $2"
}

assert_file_not_contains() {
  if grep -Eq "$2" "$1"; then fail "expected $1 not to match $2"; fi
}

count_files() {
  find "$1" -maxdepth 1 -name '*.edn' 2>/dev/null | wc -l | tr -d ' '
}

write_fake_receiver() {
  cat >"$1" <<'CLJ'
(require '[org.httpkit.server :as srv]
         '[cheshire.core :as json]
         '[clojure.string :as str]
         '[babashka.fs :as fs])
(import '[javax.crypto Mac] '[javax.crypto.spec SecretKeySpec])

(def secret (System/getenv "FAKE_SECRET"))
(def port (Long/parseLong (System/getenv "FAKE_PORT")))
(def log-path (System/getenv "FAKE_LOG"))
(def mode-file (System/getenv "FAKE_MODE_FILE"))
(def seen (atom #{}))

(defn hmac-hex [s msg]
  (let [mac (Mac/getInstance "HmacSHA256")]
    (.init mac (SecretKeySpec. (.getBytes s "UTF-8") "HmacSHA256"))
    (apply str (map #(format "%02x" %) (.doFinal mac (.getBytes msg "UTF-8"))))))

(defn record! [entry]
  (spit log-path (str (json/generate-string entry) "\n") :append true))

(defn handler [req]
  (let [body (slurp (:body req))
        headers (:headers req)
        ts (get headers "x-webhook-timestamp" "")
        sig (get headers "x-webhook-signature-v2" "")
        id (get headers "x-request-id" "")
        mode (when (fs/exists? mode-file) (str/trim (slurp mode-file)))
        now (quot (System/currentTimeMillis) 1000)]
    (cond
      (= mode "500")
      (do (record! {:id id :outcome "server-error"})
          {:status 500 :headers {"content-type" "application/json"} :body "{\"error\":\"boom\"}"})

      (or (str/blank? ts) (str/blank? sig)
          (> (Math/abs (- now (Long/parseLong ts))) 300)
          (not= sig (hmac-hex secret (str ts "." body))))
      (do (record! {:id id :outcome "invalid-signature"})
          {:status 401 :headers {"content-type" "application/json"} :body "{\"error\":\"Invalid signature\"}"})

      :else
      (let [dup? (contains? @seen id)]
        (swap! seen conj id)
        (record! {:id id :outcome (if dup? "duplicate" "accepted") :payload (json/parse-string body)})
        (if dup?
          {:status 200 :headers {"content-type" "application/json"} :body (json/generate-string {:status "duplicate" :delivery_id id})}
          {:status 202 :headers {"content-type" "application/json"} :body (json/generate-string {:status "accepted" :delivery_id id})})))))

(srv/run-server handler {:port port})
(println (str "fake receiver listening on " port))
@(promise)
CLJ
}

start_receiver() {
  local dir="$1" port="$2"
  write_fake_receiver "${dir}/receiver.clj"
  : >"${dir}/receiver.log"
  FAKE_SECRET="${SECRET}" FAKE_PORT="${port}" FAKE_LOG="${dir}/receiver.log" FAKE_MODE_FILE="${dir}/mode" \
    bb "${dir}/receiver.clj" >"${dir}/receiver.out" 2>&1 &
  RECEIVER_PID=$!
  for _ in $(seq 1 50); do
    if grep -q "listening" "${dir}/receiver.out" 2>/dev/null; then return 0; fi
    sleep 0.2
  done
  fail "fake receiver did not start"
}

stop_receiver() {
  if [[ -n "${RECEIVER_PID}" ]]; then
    kill "${RECEIVER_PID}" 2>/dev/null || true
    wait "${RECEIVER_PID}" 2>/dev/null || true
    RECEIVER_PID=""
  fi
}
trap stop_receiver EXIT

free_port() {
  bb -e '(let [s (java.net.ServerSocket. 0)] (print (.getLocalPort s)) (.close s))'
}

write_vault() {
  local vault="$1" board_body="$2"
  mkdir -p "${vault}/Boards" "${vault}/Tickets"
  cat >"${vault}/Boards/Task Board.md" <<MD
# Task Board

## Backlog

## Ready

## In Progress
${board_body}

## Blocked

## Review

## Done
MD
}

write_ticket() {
  local vault="$1" ticket="$2" status="$3"
  cat >"${vault}/Tickets/${ticket}.md" <<MD
---
id: ${ticket}
status: ${status}
assignee: claude-fable
---

# ${ticket}: test

## Notes

- 2026-10-22: Codex task-board run r1 finished with result ${status}.
MD
}

move_card() {
  # Simulate a manual Board edit: move the ticket card under another lane heading.
  local vault="$1" ticket="$2" lane="$3" status="$4"
  local board="${vault}/Boards/Task Board.md"
  local line
  line="$(grep -F "[[Tickets/${ticket}|" "${board}")"
  grep -vF "[[Tickets/${ticket}|" "${board}" >"${board}.tmp"
  line="$(printf '%s' "${line}" | sed -E "s/status::[a-z-]+/status::${status}/")"
  awk -v lane="## ${lane}" -v card="${line}" '{print} $0 == lane {print card}' "${board}.tmp" >"${board}"
  rm -f "${board}.tmp"
}

run_events() {
  # Quiet hours default to "off" here: an empty value would fall back to the
  # 02-09 JST window and defer every delivery when the suite runs at night.
  local vault="$1" state="$2"
  shift 2
  CODEX_TASK_BOARD_VAULT="${vault}" \
  CODEX_TASK_BOARD_ROOT="${state}" \
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="${CODEX_TASK_BOARD_EVENT_QUIET_HOURS:-off}" \
  "$@" bb "${EVENTS}" tick
}

record() {
  local vault="$1" state="$2"
  shift 2
  CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${EVENTS}" record "$@"
}

new_case() {
  CASE_TMP="$(mktemp -d)"
  CASE_VAULT="${CASE_TMP}/vault"
  CASE_STATE="${CASE_TMP}/state"
  CASE_PORT="$(free_port)"
  CASE_URL="http://127.0.0.1:${CASE_PORT}/webhooks/task-board"
  write_vault "${CASE_VAULT}" "- [ ] [[Tickets/BOXP-901|BOXP-901: a]] #ticket status::in-progress
- [ ] [[Tickets/BOXP-902|BOXP-902: b]] #ticket status::in-progress"
  write_ticket "${CASE_VAULT}" BOXP-901 in-progress
  write_ticket "${CASE_VAULT}" BOXP-902 in-progress
}

test_signed_delivery_is_accepted() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/tick.out"

  assert_file_contains "${CASE_TMP}/receiver.log" '"outcome":"accepted"'
  assert_file_contains "${CASE_TMP}/receiver.log" '"event_id":"BOXP-901-r1-blocked"'
  assert_file_contains "${CASE_TMP}/receiver.log" '"event_type":"task-board.run-finished"'
  assert_file_contains "${CASE_TMP}/receiver.log" '"to_status":"blocked"'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':status :accepted'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':hermes-status "accepted"'
  # Transport acceptance alone never completes the event.
  [[ "$(count_files "${CASE_STATE}/outbox/done")" -eq 0 ]] || fail "accepted event must not be done yet"
  assert_file_not_contains "${CASE_TMP}/tick.out" "${SECRET}"
  stop_receiver
}

test_wrong_secret_is_rejected_and_retried_with_backoff() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="wrong-secret" >"${CASE_TMP}/tick1.out"

  assert_file_contains "${CASE_TMP}/receiver.log" '"outcome":"invalid-signature"'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':status :pending'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':attempts 1'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':last-http-status 401'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':next-attempt-at'

  # Not due yet: a second tick does not resend.
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/tick2.out"
  [[ "$(grep -c '"id":"BOXP-901-r1-blocked"' "${CASE_TMP}/receiver.log")" -eq 1 ]] || fail "backoff must suppress an immediate retry"

  # Once the backoff elapsed (clock moved forward) the correct secret succeeds.
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)" \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/tick3.out"
  # The receiver checks the timestamp against its real clock: a 10 minute skew
  # must be rejected, which is exactly the replay window Hermes enforces.
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':attempts 2'
  stop_receiver
}

test_duplicate_event_id_is_reported_as_duplicate() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress done done >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  # Force a redelivery of the same id by resetting the file to pending.
  sed -i 's/:status :accepted/:status :pending/' "${CASE_STATE}/outbox/pending/BOXP-901-r1-done.edn"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null

  [[ "$(grep -c '"outcome":"accepted"' "${CASE_TMP}/receiver.log")" -eq 1 ]] || fail "receiver must accept once"
  [[ "$(grep -c '"outcome":"duplicate"' "${CASE_TMP}/receiver.log")" -eq 1 ]] || fail "receiver must dedupe the second delivery"
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-done.edn" ':hermes-status "duplicate"'
  stop_receiver
}

test_receiver_down_keeps_event_until_recovery() {
  new_case
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  # Nothing listens on the port yet.
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/down.out"
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':status :pending'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':attempts 1'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':last-error "transport'

  # Receiver comes back; the dispatcher process is "restarted" (new process) and
  # the persisted event is delivered once the backoff elapsed.
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  sed -i 's/:next-attempt-at "[^"]*"/:next-attempt-at "2000-01-01T00:00:00Z"/' "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':status :accepted'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':attempts 2'
  assert_file_contains "${CASE_TMP}/receiver.log" '"outcome":"accepted"'
  stop_receiver
}

test_server_error_moves_to_failed_after_max_attempts() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  echo 500 >"${CASE_TMP}/mode"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  for _ in 1 2; do
    sed -i 's/:next-attempt-at "[^"]*"/:next-attempt-at "2000-01-01T00:00:00Z"/' "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" 2>/dev/null || true
    run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_MAX_ATTEMPTS=2 \
      CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  done
  [[ -f "${CASE_STATE}/outbox/failed/BOXP-901-r1-blocked.edn" ]] || fail "exhausted event must move to failed/"
  assert_file_contains "${CASE_STATE}/outbox/failed/BOXP-901-r1-blocked.edn" ':status :failed'
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "failed event must leave pending/"
  stop_receiver
}

test_quiet_hours_defer_and_flush_in_order() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  # 03:30 JST = 18:30 UTC previous day: quiet.
  CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-10-21T18:30:00Z" record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-10-21T18:31:00Z" record "${CASE_VAULT}" "${CASE_STATE}" BOXP-902 r2 in-progress blocked blocked >/dev/null
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-10-21T18:35:00Z" \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/quiet.out"
  assert_file_contains "${CASE_TMP}/quiet.out" 'deferred by quiet hours'
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "nothing may be sent during quiet hours"
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':attempts 0'

  # 09:05 JST: both events flush, oldest first. The receiver validates the
  # signature timestamp against the real clock, so the clock override is
  # dropped here and only the quiet-hours gate is exercised at the real time
  # when it is outside the window; otherwise the window is disabled explicitly.
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="off" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ "$(sed -n '1p' "${CASE_TMP}/receiver.log")" == *'"id":"BOXP-901-r1-blocked"'* ]] || fail "oldest event must be sent first"
  [[ "$(sed -n '2p' "${CASE_TMP}/receiver.log")" == *'"id":"BOXP-902-r2-blocked"'* ]] || fail "second event must follow"
  stop_receiver
}

test_quiet_hours_gate_uses_jst_window() {
  new_case
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  # 08:59 JST quiet, 09:00 JST open (no receiver: an attempt shows as transport error).
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-10-21T23:59:00Z" \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/q1.out"
  assert_file_contains "${CASE_TMP}/q1.out" 'deferred by quiet hours'
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-10-22T00:00:00Z" \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/q2.out"
  assert_file_not_contains "${CASE_TMP}/q2.out" 'deferred by quiet hours'
  assert_file_contains "${CASE_TMP}/q2.out" 'send failed'
}

test_manual_board_edit_is_detected_once() {
  new_case
  # First pass seeds the snapshot silently.
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >"${CASE_TMP}/seed.out"
  assert_file_contains "${CASE_TMP}/seed.out" 'seeded board snapshot'
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "seeding must not record events"

  # Owner moves BOXP-901 to Blocked by hand and BOXP-902 to Ready.
  move_card "${CASE_VAULT}" BOXP-901 Blocked blocked
  move_card "${CASE_VAULT}" BOXP-902 Ready ready
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >"${CASE_TMP}/diff.out"
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 1 ]] || fail "exactly one lane-changed event expected"
  local event
  event="$(ls "${CASE_STATE}"/outbox/pending/BOXP-901-lane-blocked-*.edn)"
  assert_file_contains "${event}" ':event-type "task-board.lane-changed"'
  assert_file_contains "${event}" ':source "board-diff"'
  assert_file_contains "${event}" ':from-status "in-progress"'
  assert_file_contains "${event}" ':run-id nil'

  # Unchanged board: no new events. A Notes-only edit (what Kohako writes) is
  # not a lane change either.
  echo "- 2026-10-22: [kohako-event] received something" >>"${CASE_VAULT}/Tickets/BOXP-901.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >/dev/null
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 1 ]] || fail "no lane change must not add events"
}

test_runner_event_and_board_diff_collapse() {
  new_case
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >/dev/null
  # The runner committed the transition and recorded its event; the Board now
  # shows the same move. The diff pass must not add a second wake-up.
  move_card "${CASE_VAULT}" BOXP-901 Blocked blocked
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >"${CASE_TMP}/diff.out"
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 1 ]] || fail "runner event and board diff must collapse into one"
  assert_file_contains "${CASE_TMP}/diff.out" 'skip duplicate event for BOXP-901 -> blocked'
  # Same ticket and target again from another run outside the window is a new event.
  CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)" \
    record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r2 in-progress blocked blocked >/dev/null
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 2 ]] || fail "a later run must produce its own event"
}

test_handled_marker_completes_event() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':status :accepted'

  # Kohako records completion in the ticket Notes (via the helper in production).
  echo "- 2026-10-22: [kohako-event] handled event=BOXP-901-r1-blocked ticket=BOXP-901 result=notified" >>"${CASE_VAULT}/Tickets/BOXP-901.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ -f "${CASE_STATE}/outbox/done/BOXP-901-r1-blocked.edn" ]] || fail "handled event must move to done/"
  assert_file_contains "${CASE_STATE}/outbox/done/BOXP-901-r1-blocked.edn" ':status :handled'
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "pending must be empty"
  # Only one delivery happened.
  [[ "$(grep -c '"id":"BOXP-901-r1-blocked"' "${CASE_TMP}/receiver.log")" -eq 1 ]] || fail "handled event must not be redelivered"
  stop_receiver
}

test_unhandled_event_is_redelivered_then_parked() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  # Still inside the handle timeout: nothing happens.
  run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=1800 \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ "$(grep -c '"id":"BOXP-901-r1-blocked"' "${CASE_TMP}/receiver.log")" -eq 1 ]] || fail "no redelivery before the handle timeout"

  # Handle timeout elapsed (timeout shortened instead of moving the clock so the
  # signature timestamp stays valid): redeliver with the same id, twice at most.
  sleep 1
  for _ in 1 2; do
    run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0 CODEX_TASK_BOARD_EVENT_MAX_REDELIVERIES=2 \
      CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  done
  [[ "$(grep -c '"id":"BOXP-901-r1-blocked"' "${CASE_TMP}/receiver.log")" -eq 3 ]] || fail "expected two redeliveries with the same id"
  [[ "$(grep -c '"outcome":"duplicate"' "${CASE_TMP}/receiver.log")" -eq 2 ]] || fail "receiver dedupes redeliveries while its cache holds the id"
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':redeliveries 2'
  run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0 CODEX_TASK_BOARD_EVENT_MAX_REDELIVERIES=2 \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ -f "${CASE_STATE}/outbox/unhandled/BOXP-901-r1-blocked.edn" ]] || fail "exhausted redeliveries must park the event in unhandled/"
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "pending must be empty after parking"
  stop_receiver
}

test_non_trigger_statuses_are_ignored() {
  new_case
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 ready in-progress "" >"${CASE_TMP}/rec1.out"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 backlog ready "" >"${CASE_TMP}/rec2.out"
  assert_file_contains "${CASE_TMP}/rec1.out" '^skipped$'
  assert_file_contains "${CASE_TMP}/rec2.out" '^skipped$'
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "start / groom transitions must not wake Kohako"
}

test_missing_secret_never_sends() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" >"${CASE_TMP}/nosecret.out"
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "no request may be sent without a secret"
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':last-error "CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET is not set"'
  stop_receiver
}

bb "${EVENTS}" test

# BOXP-395: leaving the retired Review lane is one migration, not one wake-up per card.
test_review_lane_migration_is_silent() {
  new_case
  move_card "${CASE_VAULT}" BOXP-901 Review review
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >/dev/null
  move_card "${CASE_VAULT}" BOXP-901 Blocked blocked
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >/dev/null
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "migration out of Review must not notify"
  # A later real transition of the same card still notifies.
  move_card "${CASE_VAULT}" BOXP-901 Done done
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >/dev/null
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 1 ]] || fail "a real transition after migration must notify"
}

# An event recorded for Review before the rollout must not be lost.
test_pending_legacy_review_event_is_still_delivered() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="" record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r9 in-progress blocked blocked >/dev/null
  sed -i 's/:to-status "blocked"/:to-status "review"/' "${CASE_STATE}/outbox/pending/BOXP-901-r9-blocked.edn"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/receiver.log" '"to_status":"review"'
  stop_receiver
}

test_digest_restart_and_delivery_receipt() {
  new_case
  mkdir -p "${CASE_STATE}/outbox/pending"
  cat >"${CASE_STATE}/outbox/pending/old.edn" <<'EDN'
{:event-id "old" :ticket-id "BOXP-901" :event-type "task-board.lane-changed" :to-status "blocked" :created-at "2026-01-01T00:00:00Z" :status :notify-pending}
EDN
  cat >"${CASE_STATE}/outbox/pending/new.edn" <<'EDN'
{:event-id "new" :ticket-id "BOXP-901" :event-type "task-board.lane-changed" :to-status "done" :created-at "2026-01-02T00:00:00Z" :status :notify-pending}
EDN
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >/dev/null
  local digest
  digest="$(find "${CASE_STATE}/outbox/pending" -name '*-digest-*.edn')"
  [[ -n "${digest}" ]] || fail "digest must be created"
  assert_file_contains "${digest}" ':event-id "new"'
  assert_file_contains "${digest}" ':superseded \["old"\]'
  # Reconstruct a crash after digest creation and before one item was stamped.
  sed -i -E 's/ :digest-id "[^"]+"//' "${CASE_STATE}/outbox/pending/old.edn"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >/dev/null
  [[ "$(find "${CASE_STATE}/outbox/pending" -name '*-digest-*.edn' | wc -l)" -eq 1 ]] || fail "restart duplicated digest"
  assert_file_contains "${CASE_STATE}/outbox/pending/old.edn" ':digest-id '
  local id
  id="$(basename "${digest}" .edn)"
  bb -e '(let [p (first *command-line-args*) e (clojure.edn/read-string (slurp p))] (spit p (pr-str (assoc e :status :accepted :accepted-at "2026-01-01T00:00:00Z"))))' "${digest}"
  printf '\nhandled event=%s result=notified summary=fixture\n' "${id}" >>"${CASE_VAULT}/Tickets/BOXP-901.md"
  mkdir -p "${CASE_VAULT}/Projects/task-board-events/delivery-receipts"
  printf '{"event":"%s","state":"sent"}' "${id}" >"${CASE_VAULT}/Projects/task-board-events/delivery-receipts/${id}.json"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=10000 >/dev/null
  [[ -f "${CASE_STATE}/outbox/done/${id}.edn" && -f "${CASE_STATE}/outbox/done/old.edn" && -f "${CASE_STATE}/outbox/done/new.edn" ]] || fail "sent digest must complete its items"
}

# --- BOXP-409: night processing and morning digest ---
ALWAYS_QUIET="0-24"

seed_event() {
  # seed_event <state> <id> <ticket> <status> <created-at> [extra edn]
  mkdir -p "$1/outbox/pending"
  printf '{:event-id "%s" :ticket-id "%s" :event-type "task-board.run-finished" :to-status "blocked" :created-at "%s" :status %s :attempts 0 :redeliveries 0 %s}' \
    "$2" "$3" "$5" "$4" "${6:-}" >"$1/outbox/pending/$2.edn"
}

night_tick() {
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="${ALWAYS_QUIET}" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" "$@" >"${CASE_TMP}/tick.out"
}

day_tick() {
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="off" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" "$@" >"${CASE_TMP}/tick.out"
}

note_marker() {
  printf '\n- 2026-11-04 18:00:00 UTC [kohako-event]: [kohako-event] handled event=%s run=r result=%s summary=%s\n' "$3" "$4" "${5:-fixture}" >>"$1/Tickets/$2.md"
}

write_receipt() {
  mkdir -p "$1/Projects/task-board-events/delivery-receipts"
  printf '{"event":"%s","state":"%s","updated_at":"%s"}' "$2" "$3" "$4" >"$1/Projects/task-board-events/delivery-receipts/$2.json"
}

digest_count() {
  find "${CASE_STATE}/outbox/pending" -name '*-digest-*.edn' | wc -l
}

test_night_gate_off_or_invalid_keeps_legacy_hold() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  night_tick
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "gate off must keep the night hold"
  echo '{:enabled "yes"' >"${CASE_STATE}/outbox/night-processing.edn"
  night_tick
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "invalid gate must fail closed"
  assert_file_contains "${CASE_TMP}/tick.out" 'invalid or unreadable night-processing.edn'
  stop_receiver
}

test_night_gate_posts_defer_and_limits_tickets() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  write_ticket "${CASE_VAULT}" BOXP-902 blocked
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-902 r2 in-progress blocked blocked >/dev/null
  echo '{:enabled true :only-tickets #{"BOXP-901"}}' >"${CASE_STATE}/outbox/night-processing.edn"
  night_tick
  assert_file_contains "${CASE_TMP}/receiver.log" 'BOXP-901-r1-blocked'
  assert_file_contains "${CASE_TMP}/receiver.log" 'notify_mode.*defer'
  assert_file_not_contains "${CASE_TMP}/receiver.log" 'BOXP-902-r2-blocked'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-902-r2-blocked.edn" ':attempts 0'
  stop_receiver
}

test_night_results_split_digest_and_done() {
  new_case
  local at="2026-11-04T18:00:00Z"
  write_ticket "${CASE_VAULT}" BOXP-902 blocked
  write_ticket "${CASE_VAULT}" BOXP-903 blocked
  seed_event "${CASE_STATE}" d1 BOXP-901 :accepted "${at}" ":accepted-at \"${at}\" :notify-mode \"defer\""
  seed_event "${CASE_STATE}" s1 BOXP-902 :accepted "${at}" ":accepted-at \"${at}\" :notify-mode \"defer\""
  seed_event "${CASE_STATE}" c1 BOXP-903 :accepted "${at}" ":accepted-at \"${at}\" :notify-mode \"defer\""
  note_marker "${CASE_VAULT}" BOXP-901 d1 deferred
  note_marker "${CASE_VAULT}" BOXP-902 s1 silent
  note_marker "${CASE_VAULT}" BOXP-903 c1 continued
  night_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  assert_file_contains "${CASE_STATE}/outbox/pending/d1.edn" ':status :notify-pending'
  [[ -f "${CASE_STATE}/outbox/done/s1.edn" && -f "${CASE_STATE}/outbox/done/c1.edn" ]] || fail "silent and continued must finish"
  [[ "$(digest_count)" -eq 0 ]] || fail "no digest may be built during quiet hours"
}

test_marker_summary_cannot_forge_result() {
  new_case
  local at="2026-11-04T18:00:00Z"
  seed_event "${CASE_STATE}" f1 BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 f1 silent 'result=deferred'
  night_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  [[ -f "${CASE_STATE}/outbox/done/f1.edn" ]] || fail "summary text must not change the result"
}

test_digest_collapses_and_is_sent_once() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  seed_event "${CASE_STATE}" newer BOXP-901 :notify-pending "2026-11-04T18:10:00Z"
  seed_event "${CASE_STATE}" older BOXP-901 :notify-pending "2026-11-04T18:00:00Z"
  day_tick
  [[ "$(digest_count)" -eq 1 ]] || fail "exactly one digest expected"
  assert_file_contains "${CASE_TMP}/receiver.log" 'task-board.morning-digest'
  assert_file_contains "$(find "${CASE_STATE}/outbox/pending" -name '*-digest-*.edn')" ':event-id "newer"'
  assert_file_contains "$(find "${CASE_STATE}/outbox/pending" -name '*-digest-*.edn')" ':superseded \["older"\]'
  day_tick
  day_tick
  [[ "$(digest_count)" -eq 1 ]] || fail "repeat ticks must not build another digest"
  [[ "$(grep -c 'morning-digest' "${CASE_TMP}/receiver.log")" -eq 1 ]] || fail "digest must be sent once"
  stop_receiver
}

test_digest_transport_failure_retries_then_unhandled() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  echo 500 >"${CASE_TMP}/mode"
  seed_event "${CASE_STATE}" item BOXP-901 :notify-pending "2026-11-04T18:00:00Z"
  day_tick CODEX_TASK_BOARD_EVENT_MAX_BACKOFF_SECONDS=0
  assert_file_contains "${CASE_STATE}/outbox/pending/item.edn" ':status :notify-pending'
  [[ "$(digest_count)" -eq 1 ]] || fail "digest must survive a failed POST"
  day_tick CODEX_TASK_BOARD_EVENT_MAX_ATTEMPTS=1 CODEX_TASK_BOARD_EVENT_MAX_BACKOFF_SECONDS=0
  sleep 1
  day_tick CODEX_TASK_BOARD_EVENT_MAX_ATTEMPTS=1 CODEX_TASK_BOARD_EVENT_MAX_BACKOFF_SECONDS=0
  day_tick CODEX_TASK_BOARD_EVENT_MAX_ATTEMPTS=1 CODEX_TASK_BOARD_EVENT_MAX_BACKOFF_SECONDS=0
  [[ -f "${CASE_STATE}/outbox/unhandled/item.edn" ]] || fail "item of a failed digest must reach unhandled"
  assert_file_contains "${CASE_STATE}/outbox/unhandled/item.edn" ':status :notify-undelivered'
  stop_receiver
}

accepted_digest() {
  # Prints the id of a digest accepted long ago, with one item.
  local id="BOXP-901-digest-20261104T180000Z-abc123"
  seed_event "${CASE_STATE}" item BOXP-901 :notify-pending "2026-11-04T18:00:00Z" ":digest-id \"${id}\""
  printf '{:event-id "%s" :ticket-id "BOXP-901" :event-type "task-board.morning-digest" :created-at "2026-11-05T00:00:00Z" :status :accepted :accepted-at "%s" :attempts 1 :redeliveries 0 :digest-items [{:ticket-id "BOXP-901" :event-id "item" :superseded []}]}' \
    "${id}" "$1" >"${CASE_STATE}/outbox/pending/${id}.edn"
  echo "${id}"
}

test_digest_marker_without_receipt_is_not_delivered() {
  new_case
  local id
  id="$(accepted_digest "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  note_marker "${CASE_VAULT}" BOXP-901 "${id}" notified
  day_tick
  [[ -f "${CASE_STATE}/outbox/pending/item.edn" ]] || fail "marker alone must not finish the item"
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0
  [[ -f "${CASE_STATE}/outbox/unhandled/item.edn" ]] || fail "unconfirmed digest item must reach unhandled"
}

test_digest_silent_needs_gate_proof() {
  new_case
  local id
  id="$(accepted_digest "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  note_marker "${CASE_VAULT}" BOXP-901 "${id}" silent
  day_tick
  [[ -f "${CASE_STATE}/outbox/pending/item.edn" ]] || fail "silent marker alone must not finish the item"
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0
  [[ -f "${CASE_STATE}/outbox/unhandled/item.edn" ]] || fail "unproven silent digest item must reach unhandled"

  new_case
  id="$(accepted_digest "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  note_marker "${CASE_VAULT}" BOXP-901 "${id}" silent
  write_receipt "${CASE_VAULT}" "${id}" silent "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  day_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  [[ -f "${CASE_STATE}/outbox/done/item.edn" ]] || fail "proven silent digest must finish its item"
}

test_quiet_policy_is_published_for_the_gate() {
  new_case
  local policy="${CASE_VAULT}/Projects/task-board-events/quiet-policy.json"
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="1-8" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_TIMEZONE=UTC >/dev/null
  assert_file_contains "${policy}" '"quiet_hours":"1-8"'
  assert_file_contains "${policy}" '"timezone":"UTC"'
}

test_digest_uncertain_receipt_is_never_resent() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  local id
  id="$(accepted_digest "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  note_marker "${CASE_VAULT}" BOXP-901 "${id}" notified
  write_receipt "${CASE_VAULT}" "${id}" uncertain "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  day_tick
  [[ -f "${CASE_STATE}/outbox/unhandled/${id}.edn" && -f "${CASE_STATE}/outbox/unhandled/item.edn" ]] || fail "uncertain must go to unhandled"
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "uncertain delivery must not be re-sent"
  stop_receiver
}

test_quiet_held_receipt_returns_to_digest_unless_stale() {
  new_case
  local accepted="2026-11-04T17:59:00Z"
  seed_event "${CASE_STATE}" held BOXP-901 :accepted "${accepted}" ":accepted-at \"${accepted}\""
  note_marker "${CASE_VAULT}" BOXP-901 held notified
  write_receipt "${CASE_VAULT}" held quiet-held "2026-11-04T18:01:00+00:00"
  night_tick
  assert_file_contains "${CASE_STATE}/outbox/pending/held.edn" ':status :notify-pending'

  new_case
  # The redelivery was accepted after the hold, so it really sent.
  seed_event "${CASE_STATE}" held BOXP-901 :accepted "${accepted}" ":accepted-at \"2026-11-05T00:05:00Z\""
  note_marker "${CASE_VAULT}" BOXP-901 held notified
  write_receipt "${CASE_VAULT}" held quiet-held "2026-11-04T18:01:00+00:00"
  day_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  [[ -f "${CASE_STATE}/outbox/done/held.edn" ]] || fail "stale quiet-held must not reopen a delivered event"
}

test_notified_marker_waits_for_gate_near_quiet_start() {
  new_case
  # 01:55 JST on 2026-11-05: 02:00 is inside the grace window.
  local at="2026-11-04T16:55:00Z"
  seed_event "${CASE_STATE}" edge BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 edge notified
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T16:55:30Z" >/dev/null
  [[ -f "${CASE_STATE}/outbox/pending/edge.edn" ]] || fail "marker before the quiet boundary must wait for the gate"
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T16:56:00Z" CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0 \
    CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000 >/dev/null
  [[ -f "${CASE_STATE}/outbox/done/edge.edn" ]] || fail "no hold reported before the timeout: the send happened"
}

test_signed_delivery_is_accepted
test_wrong_secret_is_rejected_and_retried_with_backoff
test_duplicate_event_id_is_reported_as_duplicate
test_receiver_down_keeps_event_until_recovery
test_server_error_moves_to_failed_after_max_attempts
test_quiet_hours_defer_and_flush_in_order
test_quiet_hours_gate_uses_jst_window
test_manual_board_edit_is_detected_once
test_runner_event_and_board_diff_collapse
test_handled_marker_completes_event
test_unhandled_event_is_redelivered_then_parked
test_non_trigger_statuses_are_ignored
test_missing_secret_never_sends
test_review_lane_migration_is_silent
test_pending_legacy_review_event_is_still_delivered
test_digest_restart_and_delivery_receipt
test_night_gate_off_or_invalid_keeps_legacy_hold
test_night_gate_posts_defer_and_limits_tickets
test_night_results_split_digest_and_done
test_marker_summary_cannot_forge_result
test_digest_collapses_and_is_sent_once
test_digest_transport_failure_retries_then_unhandled
test_digest_marker_without_receipt_is_not_delivered
test_digest_silent_needs_gate_proof
test_quiet_policy_is_published_for_the_gate
test_digest_uncertain_receipt_is_never_resent
test_quiet_held_receipt_returns_to_digest_unless_stale
test_notified_marker_waits_for_gate_near_quiet_start

echo "task-board-events tests passed"
