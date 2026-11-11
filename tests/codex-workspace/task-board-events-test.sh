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
# The two-phase digest claim has its own test; elsewhere the digest forms on the first tick.
export CODEX_TASK_BOARD_EVENT_DIGEST_CLAIM_GRACE_SECONDS=0
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
        ;; Hermes finishing before the dispatcher sees the response.
        (when (and (not dup?) (= mode "receipt-first"))
          (let [dir (str (System/getenv "FAKE_RECEIPT_DIR"))]
            (fs/create-dirs dir)
            (spit (str (fs/path dir (str id ".md")))
                  (json/generate-string {:event id :state "sent" :updated_at (str (java.time.Instant/now))})))
          (Thread/sleep 50))
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

write_fake_home() {
  cat >"$1" <<'CLJ'
(require '[org.httpkit.server :as srv] '[cheshire.core :as json] '[clojure.string :as str] '[babashka.fs :as fs])
(def seen (atom #{}))
(def log-path (System/getenv "FAKE_LOG"))
(def mode-file (System/getenv "FAKE_MODE_FILE"))
(defn handler [req]
  (let [body (json/parse-string (slurp (:body req)) true)
        mode (when (fs/exists? mode-file) (str/trim (slurp mode-file)))
        auth (get-in req [:headers "authorization"])]
    (cond
      (= mode "500") (do (spit log-path (str "server-error " (:eventId body) "\n") :append true) {:status 500 :body "{}"})
      (not= auth "Bearer home-token") (do (spit log-path "unauthorized\n" :append true) {:status 403 :body "{}"})
      :else (let [dup? (contains? @seen (:eventId body))]
              (swap! seen conj (:eventId body))
              (spit log-path (str (if dup? "duplicate " "stored ") (json/generate-string body) "\n") :append true)
              {:status 200 :headers {"content-type" "application/json"}
               :body (json/generate-string {:status (if dup? "duplicate" "stored")})}))))
(srv/run-server handler {:port (Long/parseLong (System/getenv "FAKE_PORT"))})
(println "home listening")
@(promise)
CLJ
}

test_home_inbox_copy_is_independent_of_telegram() {
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  local home_port home_pid
  home_port="$(free_port)"
  write_fake_home "${CASE_TMP}/home.clj"
  : >"${CASE_TMP}/home.log"
  printf 'home-token\n' >"${CASE_TMP}/token"
  FAKE_PORT="${home_port}" FAKE_LOG="${CASE_TMP}/home.log" FAKE_MODE_FILE="${CASE_TMP}/home-mode" \
    bb "${CASE_TMP}/home.clj" >"${CASE_TMP}/home.out" 2>&1 &
  home_pid=$!
  for _ in $(seq 1 50); do grep -q listening "${CASE_TMP}/home.out" 2>/dev/null && break; sleep 0.2; done
  local home_env=(CODEX_TASK_BOARD_EVENT_HOME_URL="http://127.0.0.1:${home_port}/kohako/api/v1/notifications/ingest"
                  CODEX_TASK_BOARD_EVENT_HOME_TOKEN_FILE="${CASE_TMP}/token")

  # Home down: Telegram delivery is still accepted, the home copy waits for a retry.
  echo 500 >"${CASE_TMP}/home-mode"
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-901 r1 in-progress blocked blocked >/dev/null
  mkdir -p "${CASE_VAULT}/Projects/task-board-events/delivered-copies"
  printf '{"event":"BOXP-901-r1-blocked","text":"Telegram report"}' >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-901-r1-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ':status :accepted'
  assert_file_contains "${CASE_STATE}/outbox/home/BOXP-901-r1-blocked.report.edn" ':status :retry'

  # Home back after the backoff: stored once with ids and the ticket title; later ticks never resend.
  rm -f "${CASE_TMP}/home-mode"
  for _ in 1 2; do
    run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" \
      CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)" \
      CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  done
  [[ "$(grep -c '^stored ' "${CASE_TMP}/home.log")" -eq 1 ]] || fail "home copy must be stored exactly once"
  assert_file_contains "${CASE_TMP}/home.log" '"eventId":"BOXP-901-r1-blocked.report"'
  assert_file_contains "${CASE_TMP}/home.log" '"ticketId":"BOXP-901"'
  assert_file_contains "${CASE_TMP}/home.log" '"source":"task-board-report"'
  assert_file_contains "${CASE_TMP}/home.log" '"body":"Telegram report"'
  assert_file_contains "${CASE_STATE}/outbox/home/BOXP-901-r1-blocked.report.edn" ':status :sent'
  assert_file_not_contains "${CASE_TMP}/home.log" 'unauthorized'

  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-903 r3 in-progress blocked blocked >/dev/null
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-904 r4 in-progress blocked blocked >/dev/null
  mkdir -p "${CASE_VAULT}/Projects/task-board-events/delivery-receipts"
  printf '{"event":"BOXP-903-r3-blocked","state":"silent"}' >"${CASE_VAULT}/Projects/task-board-events/delivery-receipts/BOXP-903-r3-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/home/BOXP-903-r3-blocked.report.edn" ':status :skipped'
  assert_file_not_contains "${CASE_TMP}/home.log" 'BOXP-903'
  [[ ! -e "${CASE_STATE}/outbox/home/BOXP-904-r4-blocked.report.edn" ]] || fail "missing copy must wait"

  # A reconciliation notice is shown under its own ID; the later formal report of the
  # same event still reaches the inbox instead of being deduplicated against the notice.
  printf '{"event":"BOXP-904-r4-blocked","text":"reconcile notice"}' >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-904-r4-blocked.notice.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/home.log" '"eventId":"BOXP-904-r4-blocked.notice"'
  [[ ! -e "${CASE_STATE}/outbox/home/BOXP-904-r4-blocked.report.edn" ]] || fail "report must keep waiting after a notice"
  printf '{"event":"BOXP-904-r4-blocked","text":"formal report"}' >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-904-r4-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/home.log" '"eventId":"BOXP-904-r4-blocked.report"'
  assert_file_contains "${CASE_TMP}/home.log" '"body":"formal report"'
  [[ "$(grep -c 'BOXP-904-r4-blocked.notice' "${CASE_TMP}/home.log")" -eq 1 ]] || fail "notice must be sent once"

  # A report copy synced before its notice must not cut the notice off.
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-906 r6 in-progress blocked blocked >/dev/null
  printf '{"event":"BOXP-906-r6-blocked","text":"report first"}' >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-906-r6-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/home.log" '"eventId":"BOXP-906-r6-blocked.report"'
  printf '{"event":"BOXP-906-r6-blocked","text":"notice later"}' >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-906-r6-blocked.notice.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/home.log" '"eventId":"BOXP-906-r6-blocked.notice"'
  assert_file_contains "${CASE_STATE}/outbox/home/BOXP-906-r6-blocked.notice.edn" ':status :sent'

  # quiet-held is not final: the report delivered after the quiet window still reaches home.
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-907 r7 in-progress blocked blocked >/dev/null
  printf '{"event":"BOXP-907-r7-blocked","state":"quiet-held"}' >"${CASE_VAULT}/Projects/task-board-events/delivery-receipts/BOXP-907-r7-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ ! -e "${CASE_STATE}/outbox/home/BOXP-907-r7-blocked.report.edn" ]] || fail "quiet-held report must keep waiting"
  printf '{"event":"BOXP-907-r7-blocked","state":"sent"}' >"${CASE_VAULT}/Projects/task-board-events/delivery-receipts/BOXP-907-r7-blocked.md"
  printf '{"event":"BOXP-907-r7-blocked","text":"after quiet","sent_at":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%S.000000+00:00)" >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-907-r7-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/home.log" '"body":"after quiet"'
  assert_file_contains "${CASE_STATE}/outbox/home/BOXP-907-r7-blocked.report.edn" ':status :sent'

  # An event older than the normal home window, whose "sent" receipt (after a quiet hold)
  # synced before its copy, keeps waiting and forwards the late copy instead of skipping.
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-908 r8 in-progress blocked blocked >/dev/null
  old_event="$(grep -rl ':event-id "BOXP-908-r8-blocked"' "${CASE_STATE}/outbox" | grep -v '/home/' | head -1)"
  [[ -n "${old_event}" ]] || fail "BOXP-908 event file missing"
  sed -i -E "s/:created-at \"[^\"]+\"/:created-at \"$(date -u -d '-8 hours' +%Y-%m-%dT%H:%M:%SZ)\"/" "${old_event}"
  printf '{"event":"BOXP-908-r8-blocked","state":"sent"}' >"${CASE_VAULT}/Projects/task-board-events/delivery-receipts/BOXP-908-r8-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  [[ ! -e "${CASE_STATE}/outbox/home/BOXP-908-r8-blocked.report.edn" ]] || fail "sent receipt before its copy must keep waiting"
  printf '{"event":"BOXP-908-r8-blocked","text":"late sync","sent_at":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%S.000000+00:00)" >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-908-r8-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/home.log" '"body":"late sync"'
  assert_file_contains "${CASE_STATE}/outbox/home/BOXP-908-r8-blocked.report.edn" ':status :sent'

  # Legacy raw lane-change state (old <event>.edn :sent) must not block the delivered copy.
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-905 r5 in-progress blocked blocked >/dev/null
  printf '{:event-id "BOXP-905-r5-blocked" :status :sent}' >"${CASE_STATE}/outbox/home/BOXP-905-r5-blocked.edn"
  printf '{"event":"BOXP-905-r5-blocked","text":"late telegram copy"}' >"${CASE_VAULT}/Projects/task-board-events/delivered-copies/BOXP-905-r5-blocked.md"
  run_events "${CASE_VAULT}" "${CASE_STATE}" env "${home_env[@]}" CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_contains "${CASE_TMP}/home.log" '"eventId":"BOXP-905-r5-blocked.report"'
  assert_file_contains "${CASE_STATE}/outbox/home/BOXP-905-r5-blocked.report.edn" ':status :sent'

  # Unset URL = rollback: nothing is sent to the home inbox.
  record "${CASE_VAULT}" "${CASE_STATE}" BOXP-902 r2 in-progress done done >/dev/null
  run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="${CASE_URL}" CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET="${SECRET}" >/dev/null
  assert_file_not_contains "${CASE_TMP}/home.log" 'BOXP-902'
  [[ ! -e "${CASE_STATE}/outbox/home/BOXP-902-r2-done.report.edn" ]] || fail "disabled home copy must not write state"
  kill "${home_pid}" 2>/dev/null || true; wait "${home_pid}" 2>/dev/null || true
  stop_receiver
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
  [[ -f "${CASE_STATE}/outbox/pending/BOXP-901-r1-blocked.edn" ]] || fail "a notified marker alone must not finish the event"
  write_receipt "${CASE_VAULT}" BOXP-901-r1-blocked sent "2099-01-01T00:00:00+00:00"
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
  printf '{"event":"%s","state":"sent"}' "${id}" >"${CASE_VAULT}/Projects/task-board-events/delivery-receipts/${id}.md"
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
  printf '{"event":"%s","state":"%s","updated_at":"%s"}' "$2" "$3" "$4" >"$1/Projects/task-board-events/delivery-receipts/$2.md"
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
  write_receipt "${CASE_VAULT}" d1 silent "2026-11-04T18:00:01+00:00"
  note_marker "${CASE_VAULT}" BOXP-902 s1 silent
  note_marker "${CASE_VAULT}" BOXP-903 c1 continued
  night_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  assert_file_contains "${CASE_STATE}/outbox/pending/d1.edn" ':status :notify-pending'
  [[ -f "${CASE_STATE}/outbox/done/s1.edn" && -f "${CASE_STATE}/outbox/done/c1.edn" ]] || fail "silent and continued must finish"
  [[ "$(digest_count)" -eq 0 ]] || fail "no digest may be built during quiet hours"
}

test_deferred_marker_waits_for_gate_proof() {
  new_case
  local at="2026-11-04T18:00:00Z"
  seed_event "${CASE_STATE}" race BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 race deferred
  # The final reply is still running: the marker alone does not queue it for the digest.
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="off" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:10:00Z" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/race.edn" ':status :accepted'
  [[ "$(digest_count)" -eq 0 ]] || fail "a deferred marker without proof must not enter a digest"
  # The reply goes out: nothing for the digest to repeat.
  write_receipt "${CASE_VAULT}" race sent "2026-11-04T18:11:00+00:00"
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="off" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:12:00Z" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/race.edn" ':status :accepted'
  [[ "$(digest_count)" -eq 0 ]] || fail "a sent deferred event must not enter a digest"

  # No proof by the timeout: the digest still reports it, and a send landing later pulls it out.
  new_case
  seed_event "${CASE_STATE}" late BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 late deferred
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:31:00Z" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/late.edn" ':status :notify-pending'
  write_receipt "${CASE_VAULT}" late sent "2026-11-04T18:32:00+00:00"
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="off" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:33:00Z" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/unhandled/late.edn" ':status :notify-undelivered'
  [[ "$(digest_count)" -eq 0 ]] || fail "a late send must not be repeated by the digest"
}

test_digest_claim_waits_for_a_crossing_send() {
  new_case
  local at="2026-11-04T18:00:00Z" claim="${CASE_VAULT}/Projects/task-board-events/delivery-claims/slow.md"
  local grace=(CODEX_TASK_BOARD_EVENT_DIGEST_CLAIM_GRACE_SECONDS=300)
  seed_event "${CASE_STATE}" slow BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 slow notified
  # The same tick that gives up on the reply publishes the claim, but no digest yet.
  day_tick "${grace[@]}" CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:31:00Z"
  assert_file_contains "${CASE_STATE}/outbox/pending/slow.edn" ':status :notify-pending'
  assert_file_contains "${claim}" '"owner":"digest"'
  [[ "$(digest_count)" -eq 0 ]] || fail "a digest must not form inside the claim grace"
  # The send crossed the claim: its receipt arrives inside the grace, so nothing repeats it.
  write_receipt "${CASE_VAULT}" slow sent "2026-11-04T18:32:00+00:00"
  day_tick "${grace[@]}" CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:33:00Z"
  assert_file_contains "${CASE_STATE}/outbox/unhandled/slow.edn" ':status :notify-undelivered'
  [[ "$(digest_count)" -eq 0 ]] || fail "a send inside the grace must not be repeated"

  # No send: the first publish time counts, and the report still reaches the digest.
  new_case
  seed_event "${CASE_STATE}" quietone BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 quietone notified
  day_tick "${grace[@]}" CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:31:00Z"
  day_tick "${grace[@]}" CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:35:59Z"
  [[ "$(digest_count)" -eq 0 ]] || fail "a later tick must not restart or skip the grace"
  day_tick "${grace[@]}" CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:36:00Z"
  [[ "$(digest_count)" -eq 1 ]] || fail "the report must reach the digest after the grace"
  assert_file_contains "${CASE_STATE}/outbox/pending/quietone.edn" ':digest-id '

  # A newer item inside its grace must not hold back a report that is already due.
  new_case
  seed_event "${CASE_STATE}" due BOXP-901 :notify-pending "${at}" ':digest-claimed-at "2026-11-04T18:00:00Z"'
  seed_event "${CASE_STATE}" fresh BOXP-902 :notify-pending "${at}"
  day_tick "${grace[@]}" CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:06:00Z"
  [[ "$(digest_count)" -eq 1 ]] || fail "a due report must not wait for a newer item"
  assert_file_contains "${CASE_STATE}/outbox/pending/due.edn" ':digest-id '
  assert_file_not_contains "${CASE_STATE}/outbox/pending/fresh.edn" ':digest-id '
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
  local policy="${CASE_VAULT}/Projects/task-board-events/quiet-policy.md"
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
  # The redelivery was accepted after the hold, so that hold says nothing about it.
  seed_event "${CASE_STATE}" held BOXP-901 :accepted "${accepted}" ":accepted-at \"2026-11-05T00:05:00Z\""
  note_marker "${CASE_VAULT}" BOXP-901 held notified
  write_receipt "${CASE_VAULT}" held quiet-held "2026-11-04T18:01:00+00:00"
  day_tick CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-05T00:06:00Z"
  assert_file_contains "${CASE_STATE}/outbox/pending/held.edn" ':status :accepted'
  write_receipt "${CASE_VAULT}" held sent "2026-11-05T00:05:30+00:00"
  day_tick CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-05T00:06:00Z" CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  [[ -f "${CASE_STATE}/outbox/done/held.edn" ]] || fail "a fresh sent receipt must finish the redelivery"
}

test_receipt_without_marker_is_not_redelivered() {
  local accepted="2026-11-04T17:59:00Z" stale_accepted="2026-11-05T00:05:00Z" receipt_at="2026-11-04T18:01:00+00:00"

  # A held report without a marker goes to the digest, even after the handling timeout.
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  seed_event "${CASE_STATE}" held BOXP-901 :accepted "${accepted}" ":accepted-at \"${accepted}\""
  write_receipt "${CASE_VAULT}" held quiet-held "${receipt_at}"
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0 CODEX_TASK_BOARD_EVENT_MAX_REDELIVERIES=0
  [[ ! -f "${CASE_STATE}/outbox/unhandled/held.edn" ]] || fail "a held event must not be parked as unhandled"
  assert_file_contains "${CASE_STATE}/outbox/pending/held.edn" ':status :notify-pending'
  [[ "$(count_files "${CASE_STATE}/outbox/pending")" == 2 ]] || fail "the held event must be collected by one digest"
  stop_receiver

  # An uncertain send without a marker is parked at once and never sent again.
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  seed_event "${CASE_STATE}" unsure BOXP-901 :accepted "${accepted}" ":accepted-at \"${accepted}\""
  write_receipt "${CASE_VAULT}" unsure uncertain "${receipt_at}"
  day_tick
  assert_file_contains "${CASE_STATE}/outbox/unhandled/unsure.edn" ':status :notify-undelivered'
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "an uncertain event must not be re-sent"
  stop_receiver

  # The same for a digest: its items are parked with it.
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  local id
  id="$(accepted_digest "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  write_receipt "${CASE_VAULT}" "${id}" uncertain "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  day_tick
  [[ -f "${CASE_STATE}/outbox/unhandled/${id}.edn" && -f "${CASE_STATE}/outbox/unhandled/item.edn" ]] || fail "an uncertain digest must go to unhandled with its items"
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "an uncertain digest must not be re-sent"
  stop_receiver

  # A sent receipt without a marker waits for a late marker, then is parked and never re-sent.
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  seed_event "${CASE_STATE}" reported BOXP-901 :accepted "${now}" ":accepted-at \"${now}\""
  write_receipt "${CASE_VAULT}" reported sent "${now}"
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=1800
  assert_file_contains "${CASE_STATE}/outbox/pending/reported.edn" ':status :accepted'
  sleep 1
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0
  assert_file_contains "${CASE_STATE}/outbox/unhandled/reported.edn" ':status :notify-undelivered'
  assert_file_contains "${CASE_STATE}/outbox/unhandled/reported.edn" ':delivery-receipt "sent"'
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "a sent event must not be re-sent"
  stop_receiver

  # A marker arriving before the timeout still completes it.
  new_case
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  seed_event "${CASE_STATE}" late BOXP-901 :accepted "${now}" ":accepted-at \"${now}\""
  write_receipt "${CASE_VAULT}" late sent "${now}"
  note_marker "${CASE_VAULT}" BOXP-901 late notified
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=1800
  [[ -f "${CASE_STATE}/outbox/done/late.edn" ]] || fail "a late marker with a sent receipt must complete the event"

  # A send that carried only the gate's notice does not prove a notified report.
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  seed_event "${CASE_STATE}" noticed BOXP-901 :accepted "${now}" ":accepted-at \"${now}\""
  note_marker "${CASE_VAULT}" BOXP-901 noticed notified
  mkdir -p "${CASE_VAULT}/Projects/task-board-events/delivery-receipts"
  printf '{"event":"noticed","state":"sent","classification":"unresolved","updated_at":"%s"}' "${now}" \
    >"${CASE_VAULT}/Projects/task-board-events/delivery-receipts/noticed.md"
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=1800
  assert_file_contains "${CASE_STATE}/outbox/pending/noticed.edn" ':status :accepted'
  sleep 1
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0
  assert_file_contains "${CASE_STATE}/outbox/unhandled/noticed.edn" ':status :notify-undelivered'
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "a noticed event must not be re-sent"
  stop_receiver

  # An uncertain send beats a deferred marker: the digest must not repeat what may have arrived.
  new_case
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  seed_event "${CASE_STATE}" unsure-deferred BOXP-901 :accepted "${now}" ":accepted-at \"${now}\""
  note_marker "${CASE_VAULT}" BOXP-901 unsure-deferred deferred
  write_receipt "${CASE_VAULT}" unsure-deferred uncertain "${now}"
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=1800
  assert_file_contains "${CASE_STATE}/outbox/unhandled/unsure-deferred.edn" ':status :notify-undelivered'

  # A deferred report that was already sent is not repeated: unhandled after the timeout, no digest.
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  seed_event "${CASE_STATE}" sent-deferred BOXP-901 :accepted "${now}" ":accepted-at \"${now}\""
  note_marker "${CASE_VAULT}" BOXP-901 sent-deferred deferred
  write_receipt "${CASE_VAULT}" sent-deferred sent "${now}"
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=1800
  assert_file_contains "${CASE_STATE}/outbox/pending/sent-deferred.edn" ':status :accepted'
  sleep 1
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0
  assert_file_contains "${CASE_STATE}/outbox/unhandled/sent-deferred.edn" ':status :notify-undelivered'
  assert_file_contains "${CASE_STATE}/outbox/unhandled/sent-deferred.edn" ':delivery-receipt "sent"'
  [[ "$(digest_count)" == 0 ]] || fail "a sent deferred event must not enter a digest"
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "a sent deferred event must not be re-sent"
  stop_receiver

  # The same for a digest: its items are parked with it and nothing is re-sent.
  new_case
  start_receiver "${CASE_TMP}" "${CASE_PORT}"
  id="$(accepted_digest "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  write_receipt "${CASE_VAULT}" "${id}" sent "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sleep 1
  day_tick CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0
  [[ -f "${CASE_STATE}/outbox/unhandled/${id}.edn" && -f "${CASE_STATE}/outbox/unhandled/item.edn" ]] || fail "a sent digest without a marker must go to unhandled with its items"
  [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "a sent digest must not be re-sent"
  stop_receiver

  # A receipt older than the delivery says nothing: normal redelivery still applies.
  local state
  for state in quiet-held uncertain sent; do
    new_case
    seed_event "${CASE_STATE}" old BOXP-901 :accepted "${accepted}" ":accepted-at \"${stale_accepted}\""
    write_receipt "${CASE_VAULT}" old "${state}" "${receipt_at}"
    day_tick CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-05T00:06:00Z" CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS=0
    [[ ! -f "${CASE_STATE}/outbox/unhandled/old.edn" ]] || fail "a stale ${state} receipt must not park the event"
    assert_file_not_contains "${CASE_STATE}/outbox/pending/old.edn" ':status :notify-pending'
  done
}

test_quiet_held_digest_is_reissued_under_a_new_id() {
  local with_marker id new_digest new_id
  for with_marker in yes no; do
    new_case
    start_receiver "${CASE_TMP}" "${CASE_PORT}"
    id="$(accepted_digest "2026-11-04T16:59:00Z")"
    [[ "${with_marker}" == no ]] || note_marker "${CASE_VAULT}" BOXP-901 "${id}" notified
    write_receipt "${CASE_VAULT}" "${id}" quiet-held "2026-11-04T17:01:00+00:00"
    night_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
    assert_file_contains "${CASE_STATE}/outbox/done/${id}.edn" ':status :superseded'
    [[ "$(digest_count)" -eq 1 ]] || fail "a held digest must continue as exactly one digest"
    new_digest="$(find "${CASE_STATE}/outbox/pending" -name '*-digest-*.edn')"
    new_id="$(basename "${new_digest}" .edn)"
    [[ "${new_id}" != "${id}" && "${new_id}" =~ ^BOXP-901-digest-[0-9]{8}T[0-9]{6}Z-[a-f0-9]+$ ]] || fail "reissue id must be new and match the gate pattern: ${new_id}"
    assert_file_contains "${new_digest}" ':status :pending'
    assert_file_contains "${CASE_STATE}/outbox/pending/item.edn" ":digest-id \"${new_id}\""
    [[ ! -s "${CASE_TMP}/receiver.log" ]] || fail "a reissued digest must wait for the end of quiet hours"
    day_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
    assert_file_contains "${CASE_TMP}/receiver.log" "${new_id}"
    assert_file_not_contains "${CASE_TMP}/receiver.log" "${id}"
    [[ "$(digest_count)" -eq 1 ]] || fail "morning tick must not build another digest"
    # The old marker and receipt say nothing about the reissued digest.
    assert_file_contains "${new_digest}" ':status :accepted'
    note_marker "${CASE_VAULT}" BOXP-901 "${new_id}" notified
    write_receipt "${CASE_VAULT}" "${new_id}" sent "$(date -u +%Y-%m-%dT%H:%M:%S+00:00 -d '+1 minute')"
    day_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
    [[ -f "${CASE_STATE}/outbox/done/${new_id}.edn" && -f "${CASE_STATE}/outbox/done/item.edn" ]] || fail "a sent reissue must finish its item"
    stop_receiver
  done

  # An interrupted reissue resumes without a second digest or a lost stamp.
  new_case
  id="$(accepted_digest "2026-11-04T16:59:00Z")"
  write_receipt "${CASE_VAULT}" "${id}" quiet-held "2026-11-04T17:01:00+00:00"
  cp "${CASE_STATE}/outbox/pending/${id}.edn" "${CASE_TMP}/old.edn"
  cp "${CASE_STATE}/outbox/pending/item.edn" "${CASE_TMP}/item.edn"
  night_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  cp "${CASE_TMP}/old.edn" "${CASE_STATE}/outbox/pending/${id}.edn"
  cp "${CASE_TMP}/item.edn" "${CASE_STATE}/outbox/pending/item.edn"
  rm "${CASE_STATE}/outbox/done/${id}.edn"
  night_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  [[ "$(digest_count)" -eq 1 ]] || fail "a resumed reissue must not duplicate the digest"
  new_id="$(basename "$(find "${CASE_STATE}/outbox/pending" -name '*-digest-*.edn')" .edn)"
  assert_file_contains "${CASE_STATE}/outbox/pending/item.edn" ":digest-id \"${new_id}\""
}

test_notified_marker_needs_gate_evidence() {
  new_case
  local at="2026-11-04T16:30:00Z"
  # The send is still running well after the marker, and the quiet window opens meanwhile.
  seed_event "${CASE_STATE}" late BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 late notified
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T16:40:00Z" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/late.edn" ':status :accepted'
  # Past the timeout without a receipt: never done, the digest still reports it.
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T17:01:00Z" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/pending/late.edn" ':status :notify-pending'
  [[ ! -f "${CASE_STATE}/outbox/done/late.edn" ]] || fail "a marker without evidence must not finish"

  new_case
  seed_event "${CASE_STATE}" unsure BOXP-901 :accepted "${at}" ":accepted-at \"${at}\""
  note_marker "${CASE_VAULT}" BOXP-901 unsure question
  write_receipt "${CASE_VAULT}" unsure uncertain "2026-11-04T16:31:00+00:00"
  CODEX_TASK_BOARD_EVENT_QUIET_HOURS="2-9" run_events "${CASE_VAULT}" "${CASE_STATE}" env \
    CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T16:40:00Z" >/dev/null
  assert_file_contains "${CASE_STATE}/outbox/unhandled/unsure.edn" ':status :notify-undelivered'
}

test_receipt_written_before_the_response_counts() {
  new_case
  printf 'receipt-first' >"${CASE_TMP}/mode"
  FAKE_RECEIPT_DIR="${CASE_VAULT}/Projects/task-board-events/delivery-receipts" start_receiver "${CASE_TMP}" "${CASE_PORT}"
  seed_event "${CASE_STATE}" fast BOXP-901 :pending "2026-11-04T18:00:00Z"
  note_marker "${CASE_VAULT}" BOXP-901 fast notified
  # A tick reconciles before it sends, so the receipt is judged on the next one.
  day_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  assert_file_contains "${CASE_STATE}/outbox/pending/fast.edn" ':status :accepted'
  day_tick CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  stop_receiver
  [[ -f "${CASE_STATE}/outbox/done/fast.edn" ]] || fail "a receipt written before the POST response must count"
}

test_delivery_start_survives_retry_and_is_cleared_for_a_new_delivery() {
  # A retry of the same delivery keeps the start, so a receipt from an attempt
  # whose response was lost still counts.
  new_case
  local started="2026-11-04T18:00:00Z"
  seed_event "${CASE_STATE}" retried BOXP-901 :pending "${started}" ":delivery-started-at \"${started}\""
  day_tick CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="http://127.0.0.1:${CASE_PORT}/down"
  assert_file_contains "${CASE_STATE}/outbox/pending/retried.edn" ":delivery-started-at \"${started}\""
  assert_file_contains "${CASE_STATE}/outbox/pending/retried.edn" ':status :pending'

  # The start is on disk before the POST even when the first attempt fails.
  new_case
  seed_event "${CASE_STATE}" first BOXP-901 :pending "${started}"
  day_tick CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="http://127.0.0.1:${CASE_PORT}/down"
  assert_file_contains "${CASE_STATE}/outbox/pending/first.edn" ':delivery-started-at'

  # A redelivery is a new delivery: the earlier receipt no longer speaks for it.
  new_case
  seed_event "${CASE_STATE}" again BOXP-901 :accepted "${started}" ":delivery-started-at \"${started}\" :accepted-at \"${started}\""
  day_tick CODEX_TASK_BOARD_EVENT_WEBHOOK_URL="http://127.0.0.1:${CASE_PORT}/down" CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T19:00:00Z"
  assert_file_contains "${CASE_STATE}/outbox/pending/again.edn" ':redeliveries 1'
  assert_file_contains "${CASE_STATE}/outbox/pending/again.edn" ':delivery-started-at "2026-11-04T19:00:00Z"'

  # Mid-delivery evidence: after the start but before :accepted-at still counts.
  new_case
  seed_event "${CASE_STATE}" mid BOXP-901 :accepted "${started}" ":delivery-started-at \"${started}\" :accepted-at \"2026-11-04T18:00:10Z\""
  note_marker "${CASE_VAULT}" BOXP-901 mid notified
  write_receipt "${CASE_VAULT}" mid sent "2026-11-04T18:00:05+00:00"
  day_tick CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE="2026-11-04T18:01:00Z" CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS=100000
  [[ -f "${CASE_STATE}/outbox/done/mid.edn" ]] || fail "a receipt after the start must count"
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
test_deferred_marker_waits_for_gate_proof
test_digest_claim_waits_for_a_crossing_send
test_marker_summary_cannot_forge_result
test_digest_collapses_and_is_sent_once
test_digest_transport_failure_retries_then_unhandled
test_digest_marker_without_receipt_is_not_delivered
test_digest_silent_needs_gate_proof
test_quiet_policy_is_published_for_the_gate
test_digest_uncertain_receipt_is_never_resent
test_quiet_held_receipt_returns_to_digest_unless_stale
test_receipt_without_marker_is_not_redelivered
test_quiet_held_digest_is_reissued_under_a_new_id
test_notified_marker_needs_gate_evidence
test_receipt_written_before_the_response_counts
test_delivery_start_survives_retry_and_is_cleared_for_a_new_delivery
test_home_inbox_copy_is_independent_of_telegram

echo "task-board-events tests passed"
