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
  local vault="$1" state="$2"
  shift 2
  CODEX_TASK_BOARD_VAULT="${vault}" \
  CODEX_TASK_BOARD_ROOT="${state}" \
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="${CODEX_TASK_BOARD_EVENT_QUIET_HOURS:-}" \
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
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress review review >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/tick.out"

  assert_file_contains "${CASE_TMP}/receiver.log" '"outcome":"accepted"'
  assert_file_contains "${CASE_TMP}/receiver.log" '"event_id":"BOXP-901-r1-review"'
  assert_file_contains "${CASE_TMP}/receiver.log" '"event_type":"task-board.run-finished"'
  assert_file_contains "${CASE_TMP}/receiver.log" '"to_status":"review"'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':status :accepted'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':hermes-status "accepted"'
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
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress review review >/dev/null
  # Nothing listens on the port yet.
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >"${CASE_TMP}/down.out"
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':status :pending'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':attempts 1'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':last-error "transport'

  # Receiver comes back; the dispatcher process is "restarted" (new process) and
  # the persisted event is delivered once the backoff elapsed.
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  sed -i 's/:next-attempt-at "[^"]*"/:next-attempt-at "2000-01-01T00:00:00Z"/' "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':status :accepted'
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':attempts 2'
  assert_file_contains "${CASE_TMP}/receiver.log" '"outcome":"accepted"'
  stop_receiver
}

test_server_error_moves_to_failed_after_max_attempts() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  echo 500 >"${CASE_TMP}/mode"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress review review >/dev/null
  for _ in 1 2; do
    sed -i 's/:next-attempt-at "[^"]*"/:next-attempt-at "2000-01-01T00:00:00Z"/' "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" 2>/dev/null || true
    run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_MAX_ATTEMPTS=2 \
      CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  done
  [[ -f "${CASE_STATE}/outbox/failed/BOXP-901-r1-review.edn" ]] || fail "exhausted event must move to failed/"
  assert_file_contains "${CASE_STATE}/outbox/failed/BOXP-901-r1-review.edn" ':status :failed'
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "failed event must leave pending/"
  stop_receiver
}

test_quiet_hours_defer_and_flush_in_order() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  # 03:30 JST = 18:30 UTC previous day: quiet.
  CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-10-21T18:30:00Z" record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-10-21T18:31:00Z" record "${CASE_VAULT}" "${CASE_STATE}" BOXP-902 r2 in-progress review review >/dev/null
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
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ "$(sed -n '1p' "${CASE_TMP}/receiver.log")" == *'"id":"BOXP-901-r1-blocked"'* ]] || fail "oldest event must be sent first"
  [[ "$(sed -n '2p' "${CASE_TMP}/receiver.log")" == *'"id":"BOXP-902-r2-review"'* ]] || fail "second event must follow"
  stop_receiver
}

test_quiet_hours_gate_uses_jst_window() {
  new_case
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress review review >/dev/null
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
  move_card "${CASE_VAULT}" BOXP-901 Review review
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress review review >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env >"${CASE_TMP}/diff.out"
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 1 ]] || fail "runner event and board diff must collapse into one"
  assert_file_contains "${CASE_TMP}/diff.out" 'skip duplicate event for BOXP-901 -> review'
  # Same ticket and target again from another run outside the window is a new event.
  CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)" \
    record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r2 in-progress review review >/dev/null
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 2 ]] || fail "a later run must produce its own event"
}

test_handled_marker_completes_event() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress review review >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':status :accepted'

  # Kohako records completion in the ticket Notes (via the helper in production).
  echo "- 2026-10-22: [kohako-event] handled event=BOXP-901-r1-review ticket=BOXP-901 result=notified" >>"${CASE_VAULT}/Tickets/BOXP-901.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ -f "${CASE_STATE}/outbox/done/BOXP-901-r1-review.edn" ]] || fail "handled event must move to done/"
  assert_file_contains "${CASE_STATE}/outbox/done/BOXP-901-r1-review.edn" ':status :handled'
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" -eq 0 ]] || fail "pending must be empty"
  # Only one delivery happened.
  [[ "$(grep -c '"id":"BOXP-901-r1-review"' "${CASE_TMP}/receiver.log")" -eq 1 ]] || fail "handled event must not be redelivered"
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
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress review review >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" >"${CASE_TMP}/nosecret.out"
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "no request may be sent without a secret"
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-review.edn" ':last-error "CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET is not set"'
  stop_receiver
}

bb "${EVENTS}" test
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

echo "task-board-events tests passed"
