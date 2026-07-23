#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb"
HELPER="${ROOT_DIR}/docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb"

fail() {
  echo "error: $*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  grep -Eq "$pattern" "$file" || fail "expected ${file} to match ${pattern}"
}

assert_file_not_contains() {
  local file="$1"
  local pattern="$2"
  if grep -Eq "$pattern" "$file"; then
    fail "expected ${file} not to match ${pattern}"
  fi
}

assert_run_summary_contains() {
  local state="$1"
  local ticket="$2"
  local pattern="$3"
  local summary
  summary="$(find "${state}/runs/${ticket}" -name summary.edn -print | sort | tail -n 1)"
  [[ -n "${summary}" ]] || fail "expected summary for ${ticket}"
  assert_file_contains "${summary}" "${pattern}"
}

make_fake_codex() {
  local bin_dir="$1"
  cat >"${bin_dir}/codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

last_message=""
if [[ -n "${CODEX_FAKE_ARG_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"${CODEX_FAKE_ARG_LOG}"
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-last-message)
      last_message="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

prompt="$(mktemp)"
cat >"${prompt}"
ticket="$(sed -n 's/^Ticket: //p' "${prompt}" | head -n 1)"
if [[ -n "${CODEX_FAKE_PROMPT_LOG:-}" ]]; then
  cat "${prompt}" >>"${CODEX_FAKE_PROMPT_LOG}"
fi
mkdir -p "$(dirname "${last_message}")"
if grep -q '^CODEX_REVIEW_GATE$' "${prompt}"; then
  printf '%s\n' "${CODEX_FAKE_REVIEW_MESSAGE:-CODEX_REVIEW_RESULT: clean}" >"${last_message}"
  rm -f "${prompt}"
  exit 0
fi
if [[ -n "${CODEX_FAKE_START_LOG:-}" ]]; then
  printf '%s %s\n' "${ticket}" "$(date +%s)" >>"${CODEX_FAKE_START_LOG}"
fi
if [[ -n "${CODEX_FAKE_LOCK_SNAPSHOT:-}" && -n "${CODEX_FAKE_LOCK_FILE:-}" ]]; then
  cp "${CODEX_FAKE_LOCK_FILE}" "${CODEX_FAKE_LOCK_SNAPSHOT}"
fi
sleep "${CODEX_FAKE_SLEEP:-0}"
printf '%s\n' "${CODEX_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}" >"${last_message}"
rm -f "${prompt}"
EOF
  chmod +x "${bin_dir}/codex"
}

make_fake_claude() {
  local bin_dir="$1"
  cat >"${bin_dir}/claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${CLAUDE_FAKE_ARG_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"${CLAUDE_FAKE_ARG_LOG}"
fi

prompt="$(cat)"
ticket="$(printf '%s\n' "${prompt}" | sed -n 's/^Ticket: //p' | head -n 1)"
if [[ -n "${CLAUDE_FAKE_PROMPT_LOG:-}" ]]; then
  printf '%s\n' "${prompt}" >>"${CLAUDE_FAKE_PROMPT_LOG}"
fi
if [[ -n "${CLAUDE_FAKE_START_LOG:-}" ]]; then
  printf '%s %s\n' "${ticket}" "$(date +%s)" >>"${CLAUDE_FAKE_START_LOG}"
fi
sleep "${CLAUDE_FAKE_SLEEP:-0}"
printf '%s\n' "${CLAUDE_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}"
EOF
  chmod +x "${bin_dir}/claude"
}

make_fake_gh() {
  local bin_dir="$1"
  cat >"${bin_dir}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1 $2" == "pr view" && "$3" =~ ^https://github.com/boxp/example/pull/[0-9]+$ ]]; then
  if [[ -n "${GH_FAKE_LOCK_MTIME_LOG:-}" && -n "${GH_FAKE_LOCK_FILE:-}" ]]; then
    before="$(stat -c %Y "${GH_FAKE_LOCK_FILE}")"
    sleep "${GH_FAKE_PR_VIEW_SLEEP_SECONDS:-0}"
    after="$(stat -c %Y "${GH_FAKE_LOCK_FILE}")"
    printf '%s %s\n' "${before}" "${after}" >>"${GH_FAKE_LOCK_MTIME_LOG}"
  elif [[ -n "${GH_FAKE_PR_VIEW_SLEEP_SECONDS:-}" ]]; then
    sleep "${GH_FAKE_PR_VIEW_SLEEP_SECONDS}"
  fi
  pr_number="${3##*/}"
  checks_var="GH_FAKE_CHECKS_${pr_number}"
  if [[ -n "${GH_FAKE_CHECKS:-}" ]]; then
    checks="${GH_FAKE_CHECKS}"
  elif [[ -n "${!checks_var:-}" ]]; then
    checks="${!checks_var}"
  else
    checks='[{"name":"runner test","status":"COMPLETED","conclusion":"SUCCESS"}]'
  fi
  draft_var="GH_FAKE_IS_DRAFT_${pr_number}"
  merge_var="GH_FAKE_MERGE_STATE_${pr_number}"
  draft="${GH_FAKE_IS_DRAFT:-false}"
  merge_state="${GH_FAKE_MERGE_STATE:-CLEAN}"
  if [[ -n "${!draft_var:-}" ]]; then
    draft="${!draft_var}"
  fi
  if [[ -n "${!merge_var:-}" ]]; then
    merge_state="${!merge_var}"
  fi
  cat <<JSON
{
  "url": "${3}",
  "isDraft": ${draft},
  "mergeStateStatus": "${merge_state}",
  "statusCheckRollup": ${checks}
}
JSON
  exit 0
fi

if [[ "$1 $2" == "pr diff" && "$3" =~ ^https://github.com/boxp/example/pull/[0-9]+$ ]]; then
  pr_number="${3##*/}"
  diff_var="GH_FAKE_DIFF_${pr_number}"
  diff="${GH_FAKE_DIFF:-diff --git a/file b/file}"
  if [[ -n "${!diff_var:-}" ]]; then
    diff="${!diff_var}"
  fi
  printf '%s\n' "${diff}"
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
  chmod +x "${bin_dir}/gh"
}

write_board() {
  local vault="$1"
  local body="$2"
  mkdir -p "${vault}/Boards" "${vault}/Tickets"
  cat >"${vault}/Boards/Task Board.md" <<EOF
# Task Board

## Backlog

## Ready

## In Progress
${body}

## Blocked

## Review

## Done
EOF
}

write_ticket() {
  local vault="$1"
  local ticket="$2"
  local status="$3"
  local assignee="$4"
  local repo="${5:-}"
  cat >"${vault}/Tickets/${ticket}.md" <<EOF
---
id: ${ticket}
type: task
status: ${status}
priority: medium
assignee: ${assignee}
repo: ${repo}
closed:
---

# ${ticket}: test ticket

## Summary

Test ticket.

## Acceptance Criteria

- [ ] Done

## Context

Test context.

## Plan

- [ ] Run

## Notes
EOF
}

run_tick() {
  local vault="$1"
  local state_root="$2"
  shift 2
  CODEX_TASK_BOARD_VAULT="${vault}" \
  CODEX_TASK_BOARD_ROOT="${state_root}" \
  CODEX_TASK_BOARD_LOCK_STALE_SECONDS="${CODEX_TASK_BOARD_LOCK_STALE_SECONDS:-180}" \
  "$@" bb "${RUNNER}" tick
}

test_parallel_codex_runs() {
  local tmp vault state bin log first_start second_start start_delta
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  log="${tmp}/starts.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-101|BOXP-101: first]] #ticket status::in-progress
- [ ] [[Tickets/BOXP-102|BOXP-102: second]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-101 in-progress codex
  write_ticket "${vault}" BOXP-102 in-progress codex

  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${log}" CODEX_FAKE_SLEEP=2 run_tick "${vault}" "${state}" env >/tmp/task-board-parallel.out

  [[ "$(wc -l <"${log}")" -eq 2 ]] || fail "expected two fake codex starts"
  first_start="$(awk 'NR == 1 {print $2}' "${log}")"
  second_start="$(awk 'NR == 2 {print $2}' "${log}")"
  start_delta=$((second_start - first_start))
  [[ "${start_delta#-}" -le 1 ]] || fail "expected fake codex starts within 1s, got ${start_delta}s"
  assert_file_contains "${vault}/Boards/Task Board.md" 'status::done'
  assert_file_contains "${vault}/Tickets/BOXP-101.md" '^status: done$'
  assert_file_contains "${vault}/Tickets/BOXP-102.md" '^status: done$'
}

test_fable_assignee_runs_via_claude() {
  local tmp vault state bin prompt_log args_log summary last_message events
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/claude-prompt.log"
  args_log="${tmp}/claude-args.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-150|BOXP-150: fable]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-150 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
    CLAUDE_FAKE_ARG_LOG="${args_log}" \
    CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable.out

  assert_file_contains "${args_log}" '.*--print --output-format text.*--agent fable'
  assert_file_not_contains "${args_log}" 'BOXP-150'
  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: fable$'
  assert_file_contains "${prompt_log}" 'Fable routing policy'
  assert_file_contains "${prompt_log}" 'Delegate long investigation, implementation, file editing, and test execution to Codex'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-150\|BOXP-150: fable\]\].*status::done'
  assert_file_contains "${vault}/Tickets/BOXP-150.md" '^status: done$'
  summary="$(find "${state}/runs/BOXP-150" -name summary.edn -print | sort | tail -n 1)"
  last_message="$(find "${state}/runs/BOXP-150" -name last-message.md -print | sort | tail -n 1)"
  events="$(find "${state}/runs/BOXP-150" -name events.jsonl -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':agent "fable"'
  assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
  assert_file_contains "${events}" '^TASK_BOARD_RESULT: done$'
}

test_codex_sol_assignee_includes_delegation_policy() {
  local tmp vault state bin prompt_log summary last_message
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompt.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-152|BOXP-152: codex-sol]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-152 in-progress codex-sol

  PATH="${bin}:$PATH" \
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-codex-sol.out

  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: codex-sol$'
  assert_file_contains "${prompt_log}" 'High-cost model routing policy'
  assert_file_contains "${prompt_log}" 'You are the codex-sol high-cost entry point'
  assert_file_contains "${prompt_log}" 'Delegate independent investigation, implementation, and verification to lower-cost models whenever practical'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-152\|BOXP-152: codex-sol\]\].*status::done'
  assert_file_contains "${vault}/Tickets/BOXP-152.md" '^status: done$'
  summary="$(find "${state}/runs/BOXP-152" -name summary.edn -print | sort | tail -n 1)"
  last_message="$(find "${state}/runs/BOXP-152" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':agent "codex-sol"'
  assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
}

test_codex_full_assignee_includes_delegation_policy() {
  local tmp vault state bin prompt_log summary last_message
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompt.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-153|BOXP-153: codex-full]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-153 in-progress codex-full

  PATH="${bin}:$PATH" \
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-codex-full.out

  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: codex-full$'
  assert_file_contains "${prompt_log}" 'High-cost model routing policy'
  assert_file_contains "${prompt_log}" 'You are the codex-full high-cost entry point'
  assert_file_contains "${prompt_log}" 'Delegate independent investigation, implementation, and verification to lower-cost models whenever practical'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-153\|BOXP-153: codex-full\]\].*status::done'
  assert_file_contains "${vault}/Tickets/BOXP-153.md" '^status: done$'
  summary="$(find "${state}/runs/BOXP-153" -name summary.edn -print | sort | tail -n 1)"
  last_message="$(find "${state}/runs/BOXP-153" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':agent "codex-full"'
  assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
}

test_unsupported_assignee_is_ignored() {
  local tmp vault state bin codex_log claude_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  codex_log="${tmp}/codex-starts.log"
  claude_log="${tmp}/claude-starts.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-151|BOXP-151: human]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-151 in-progress boxp

  PATH="${bin}:$PATH" \
    CODEX_FAKE_START_LOG="${codex_log}" \
    CLAUDE_FAKE_START_LOG="${claude_log}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-unsupported-assignee.out

  [[ ! -e "${codex_log}" ]] || fail "expected codex not to start for unsupported assignee"
  [[ ! -e "${claude_log}" ]] || fail "expected claude not to start for unsupported assignee"
  [[ ! -d "${state}/runs/BOXP-151" ]] || fail "expected no run directory for unsupported assignee"
  assert_file_contains "${vault}/Tickets/BOXP-151.md" '^status: in-progress$'
  assert_file_contains /tmp/task-board-unsupported-assignee.out 'no supported-agent-assigned Task Board tickets'
}

test_stale_lock_recovers() {
  local tmp vault state bin old_run
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  old_run="20260703T000000Z"
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-201/${old_run}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-201|BOXP-201: stale]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-201 in-progress codex
  cat >"${state}/locks/BOXP-201.edn" <<EOF
{:ticket "BOXP-201" :run-id "${old_run}" :action :implement :lane "In Progress" :heartbeat-at "2000-01-01T00:00:00Z"}
EOF

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 run_tick "${vault}" "${state}" env >/tmp/task-board-stale.out

  assert_file_contains "${state}/runs/BOXP-201/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${vault}/Tickets/BOXP-201.md" 'marked interrupted after heartbeat timeout'
  assert_file_contains "${vault}/Tickets/BOXP-201.md" '^status: done$'
  [[ ! -e "${state}/locks/BOXP-201.edn" ]] || fail "expected stale lock to be released"
}

test_planned_shutdown_lock_recovers_immediately() {
  local tmp vault state bin old_run lock_snapshot replacement_run started elapsed heartbeat
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  old_run="20260710T000000Z"
  lock_snapshot="${tmp}/new-lock.edn"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-202/${old_run}" "${state}/owners"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-202|BOXP-202: planned restart]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-202 in-progress codex
  cat >"${state}/owners/old-pod.edn" <<EOF
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :pid 10 :started-at "${heartbeat}"}
EOF
  cat >"${state}/locks/BOXP-202.edn" <<EOF
{:ticket "BOXP-202" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
EOF

  CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
    bb "${RUNNER}" prepare-shutdown >/tmp/task-board-prepare-shutdown.out
  assert_file_contains "${state}/terminating-owners/old-pod.edn" ':instance-id "old-instance"'

  started="${SECONDS}"
  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    CODEX_TASK_BOARD_RUN_TIMESTAMP="${old_run}" \
    CODEX_FAKE_LOCK_FILE="${state}/locks/BOXP-202.edn" \
    CODEX_FAKE_LOCK_SNAPSHOT="${lock_snapshot}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-planned-recovery.out
  elapsed=$((SECONDS - started))
  replacement_run="$(sed -n 's/.*:run-id "\([^"]*\)".*/\1/p' "${lock_snapshot}" | head -n 1)"

  [[ "${elapsed}" -lt 5 ]] || fail "expected planned shutdown recovery under 5s in simulation, got ${elapsed}s"
  [[ "${replacement_run}" == "${old_run}-"* ]] || fail "expected a unique replacement run ID for the same timestamp, got ${replacement_run}"
  assert_file_contains "${state}/runs/BOXP-202/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/runs/BOXP-202/${old_run}/summary.edn" ':reason "planned workspace shutdown"'
  assert_file_contains "${state}/runs/BOXP-202/${replacement_run}/summary.edn" ':status :succeeded'
  assert_file_contains "${vault}/Tickets/BOXP-202.md" 'marked interrupted after planned workspace shutdown of owner old-pod'
  assert_file_contains "${vault}/Tickets/BOXP-202.md" '^status: done$'
  assert_file_contains "${lock_snapshot}" ':owner-id "new-pod"'
  assert_file_contains "${lock_snapshot}" ':owner-instance-id "new-instance"'
  [[ ! -e "${state}/terminating-owners/old-pod.edn" ]] || fail "expected recovered owner marker to be removed"
  [[ ! -e "${state}/locks/BOXP-202.edn" ]] || fail "expected replacement run to release its lock"
  echo "planned shutdown recovery simulation passed in ${elapsed}s"
}

test_cross_process_lock_guard_preserves_replacement_lock() {
  local tmp vault state old_run heartbeat signal recover_pid replacement
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  old_run="20260710T000050Z"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  signal="${tmp}/before-delete"
  mkdir -p "${state}/locks" "${state}/runs/BOXP-205/${old_run}"
  write_board "${vault}" ""
  cat >"${state}/locks/BOXP-205.edn" <<EOF
{:ticket "BOXP-205" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "2000-01-01T00:00:00Z"}
EOF

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    CODEX_TASK_BOARD_TEST_BEFORE_LOCK_DELETE_SIGNAL="${signal}" \
    CODEX_TASK_BOARD_TEST_BEFORE_LOCK_DELETE_MILLIS=1500 \
    bb "${RUNNER}" recover >/tmp/task-board-cross-process-recover.out 2>&1 &
  recover_pid=$!

  for _attempt in $(seq 1 50); do
    [[ -e "${signal}" ]] && break
    sleep 0.1
  done
  if [[ ! -e "${signal}" ]]; then
    kill -KILL "${recover_pid}" 2>/dev/null || true
    wait "${recover_pid}" 2>/dev/null || true
    fail "expected recovery process to reach guarded compare-and-delete"
  fi

  replacement="{:ticket \"BOXP-205\" :run-id \"replacement-run\" :action :implement :lane \"In Progress\" :owner-id \"replacement-pod\" :owner-instance-id \"replacement-instance\" :heartbeat-at \"${heartbeat}\"}"
  bb -e '
    (let [[guard-path lock-path content] *command-line-args*
          guard-file (java.io.File. guard-path)]
      (.mkdirs (.getParentFile guard-file))
      (with-open [file (java.io.RandomAccessFile. guard-file "rw")
                  channel (.getChannel file)]
        (let [_file-lock (.lock channel)]
          (spit lock-path (str content "\n")))))' \
    "${state}/lock-guards/BOXP-205.lock" \
    "${state}/locks/BOXP-205.edn" \
    "${replacement}"

  wait "${recover_pid}"
  assert_file_contains "${state}/locks/BOXP-205.edn" ':run-id "replacement-run"'
  assert_file_contains "${state}/locks/BOXP-205.edn" ':owner-id "replacement-pod"'
  assert_file_contains "${state}/runs/BOXP-205/${old_run}/summary.edn" ':status :interrupted'
}

test_sigterm_writes_shutdown_marker_without_prestop() {
  local tmp vault state output pid marker attempt
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  output="${tmp}/runner.out"
  marker="${state}/terminating-owners/old-pod.edn"
  write_board "${vault}" ""

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=old-instance \
    CODEX_TASK_BOARD_POLL_SECONDS=60 \
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  pid=$!

  for attempt in $(seq 1 50); do
    [[ -e "${state}/owners/old-pod.edn" ]] && break
    sleep 0.1
  done
  if [[ ! -e "${state}/owners/old-pod.edn" ]]; then
    kill -KILL "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    fail "expected loop runner to activate old-pod owner"
  fi

  kill -TERM "${pid}"
  wait "${pid}" 2>/dev/null || true

  [[ -e "${marker}" ]] || fail "expected SIGTERM shutdown hook to write owner marker"
  assert_file_contains "${marker}" ':owner-id "old-pod"'
  assert_file_contains "${marker}" ':instance-id "old-instance"'
  assert_file_contains "${output}" 'prepared shutdown for owner old-pod, instance=old-instance'
}

test_one_shot_tick_does_not_replace_loop_owner_instance() {
  local tmp vault state output pid marker
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  output="${tmp}/runner.out"
  marker="${state}/terminating-owners/pod-x.edn"
  write_board "${vault}" ""

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=pod-x \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=loop-instance \
    CODEX_TASK_BOARD_POLL_SECONDS=60 \
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  pid=$!

  for _attempt in $(seq 1 50); do
    [[ -e "${state}/owners/pod-x.edn" ]] && break
    sleep 0.1
  done
  if [[ ! -e "${state}/owners/pod-x.edn" ]]; then
    kill -KILL "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    fail "expected loop runner to register its owner instance"
  fi

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=pod-x \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=tick-instance \
    bb "${RUNNER}" tick >/tmp/task-board-owner-one-shot-tick.out
  assert_file_contains "${state}/owners/pod-x.edn" ':instance-id "loop-instance"'
  assert_file_not_contains "${state}/owners/pod-x.edn" ':instance-id "tick-instance"'

  kill -TERM "${pid}"
  wait "${pid}" 2>/dev/null || true
  [[ -e "${marker}" ]] || fail "expected loop shutdown to create an owner marker"
  assert_file_contains "${marker}" ':instance-id "loop-instance"'
  assert_file_not_contains "${marker}" ':instance-id "tick-instance"'
}

test_current_owner_shutdown_marker_drains_without_recovery() {
  local tmp vault state bin old_run heartbeat start_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  old_run="20260710T000100Z"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  start_log="${tmp}/starts.log"
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-203/${old_run}" "${state}/owners"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-203|BOXP-203: draining]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-203 in-progress codex
  cat >"${state}/owners/current-pod.edn" <<EOF
{:owner-id "current-pod" :instance-id "current-instance" :host "current-pod" :pid 10 :started-at "${heartbeat}"}
EOF
  cat >"${state}/locks/BOXP-203.edn" <<EOF
{:ticket "BOXP-203" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "current-pod" :owner-instance-id "current-instance" :heartbeat-at "${heartbeat}"}
EOF
  CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=current-pod \
    bb "${RUNNER}" prepare-shutdown >/tmp/task-board-current-prepare.out

  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_OWNER_ID=current-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=current-instance \
    CODEX_FAKE_START_LOG="${start_log}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-current-drain.out

  [[ ! -e "${start_log}" ]] || fail "expected draining owner not to start a replacement run"
  [[ -e "${state}/locks/BOXP-203.edn" ]] || fail "expected current owner lock to remain active"
  assert_file_contains /tmp/task-board-current-drain.out 'is draining; not accepting new tickets'
  assert_file_contains "${vault}/Tickets/BOXP-203.md" '^status: in-progress$'
}

test_same_owner_new_instance_recovers_previous_instance() {
  local tmp vault state bin old_run heartbeat start_log output marker pid
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  old_run="20260710T000150Z"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  start_log="${tmp}/starts.log"
  output="${tmp}/runner.out"
  marker="${state}/terminating-owners/restarted-pod.edn"
  mkdir -p \
    "${bin}" \
    "${state}/locks" \
    "${state}/runs/BOXP-210/${old_run}" \
    "${state}/terminating-owners" \
    "${state}/owners"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-210|BOXP-210: container restart]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-210 in-progress codex
  cat >"${state}/owners/restarted-pod.edn" <<EOF
{:owner-id "restarted-pod" :instance-id "old-instance" :status :terminating :host "restarted-pod" :shutdown-requested-at "${heartbeat}"}
EOF
  cat >"${marker}" <<EOF
{:owner-id "restarted-pod" :instance-id "old-instance" :host "restarted-pod" :requested-at "${heartbeat}"}
EOF
  cat >"${state}/locks/BOXP-210.edn" <<EOF
{:ticket "BOXP-210" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "restarted-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
EOF

  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=restarted-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    CODEX_TASK_BOARD_POLL_SECONDS=1 \
    CODEX_FAKE_START_LOG="${start_log}" \
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  pid=$!

  for _attempt in $(seq 1 100); do
    if [[ -e "${start_log}" ]] && grep -Eq '^status: done$' "${vault}/Tickets/BOXP-210.md"; then
      break
    fi
    sleep 0.1
  done
  if [[ ! -e "${start_log}" ]] || ! grep -Eq '^status: done$' "${vault}/Tickets/BOXP-210.md"; then
    kill -KILL "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    fail "expected a new runner instance with the same owner to recover and accept tickets"
  fi

  [[ ! -e "${marker}" ]] || fail "expected the previous instance marker to be consumed"
  assert_file_contains "${state}/owners/restarted-pod.edn" ':instance-id "new-instance"'
  assert_file_contains "${state}/owners/restarted-pod.edn" ':status :active'
  assert_file_contains "${state}/runs/BOXP-210/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/runs/BOXP-210/${old_run}/summary.edn" ':reason "planned workspace shutdown"'

  kill -TERM "${pid}"
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${marker}" ':instance-id "new-instance"'
}

test_same_owner_new_instance_retires_empty_previous_marker() {
  local tmp vault state bin heartbeat start_log output marker pid
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  start_log="${tmp}/starts.log"
  output="${tmp}/runner.out"
  marker="${state}/terminating-owners/restarted-empty-pod.edn"
  mkdir -p "${bin}" "${state}/terminating-owners" "${state}/owners"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-211|BOXP-211: empty container restart]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-211 in-progress codex
  cat >"${state}/owners/restarted-empty-pod.edn" <<EOF
{:owner-id "restarted-empty-pod" :instance-id "old-instance" :status :terminating :host "restarted-empty-pod" :shutdown-requested-at "${heartbeat}"}
EOF
  cat >"${marker}" <<EOF
{:owner-id "restarted-empty-pod" :instance-id "old-instance" :host "restarted-empty-pod" :requested-at "${heartbeat}"}
EOF

  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=restarted-empty-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    CODEX_TASK_BOARD_POLL_SECONDS=1 \
    CODEX_FAKE_START_LOG="${start_log}" \
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  pid=$!

  for _attempt in $(seq 1 100); do
    if [[ -e "${start_log}" ]] && grep -Eq '^status: done$' "${vault}/Tickets/BOXP-211.md"; then
      break
    fi
    sleep 0.1
  done
  if [[ ! -e "${start_log}" ]] || ! grep -Eq '^status: done$' "${vault}/Tickets/BOXP-211.md"; then
    kill -KILL "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    fail "expected a new runner instance to retire an empty previous marker and accept tickets"
  fi

  [[ ! -e "${marker}" ]] || fail "expected the empty previous instance marker to be retired"
  assert_file_contains "${state}/owners/restarted-empty-pod.edn" ':instance-id "new-instance"'
  assert_file_contains "${state}/owners/restarted-empty-pod.edn" ':status :active'
  assert_file_not_contains "${output}" 'is draining; not accepting new tickets'

  kill -TERM "${pid}"
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${marker}" ':instance-id "new-instance"'
}

test_mismatched_shutdown_marker_does_not_recover_fresh_lock() {
  local tmp vault state bin old_run heartbeat start_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  old_run="20260710T000200Z"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  start_log="${tmp}/starts.log"
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-204/${old_run}" "${state}/terminating-owners"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-204|BOXP-204: mismatched owner]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-204 in-progress codex
  cat >"${state}/locks/BOXP-204.edn" <<EOF
{:ticket "BOXP-204" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "still-active" :heartbeat-at "${heartbeat}"}
EOF
  cat >"${state}/terminating-owners/old-pod.edn" <<EOF
{:owner-id "old-pod" :instance-id "different-instance" :host "old-pod" :requested-at "${heartbeat}"}
EOF

  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    CODEX_FAKE_START_LOG="${start_log}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-mismatched-owner.out

  [[ ! -e "${start_log}" ]] || fail "expected mismatched marker not to start a replacement run"
  [[ -e "${state}/locks/BOXP-204.edn" ]] || fail "expected fresh mismatched lock to remain"
  [[ -e "${state}/terminating-owners/old-pod.edn" ]] || fail "expected unmatched marker to remain for a later scan"
  assert_file_not_contains "${vault}/Tickets/BOXP-204.md" 'marked interrupted'
  assert_file_contains "${vault}/Tickets/BOXP-204.md" '^status: in-progress$'
}

test_shutdown_marker_waits_for_late_matching_lock() {
  local tmp vault state old_run heartbeat marker owner_state
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  old_run="20260710T000300Z"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  marker="${state}/terminating-owners/old-pod.edn"
  owner_state="${state}/owners/old-pod.edn"
  mkdir -p "${state}/locks" "${state}/runs/BOXP-206/${old_run}" "${state}/terminating-owners" "${state}/owners"
  write_board "${vault}" ""
  cat >"${marker}" <<EOF
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :requested-at "${heartbeat}"}
EOF
  cat >"${owner_state}" <<EOF
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :pid 10 :started-at "${heartbeat}"}
EOF

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    bb "${RUNNER}" recover >/tmp/task-board-marker-before-lock.out

  [[ -e "${marker}" ]] || fail "expected marker without a matching lock to survive recovery"
  [[ -e "${owner_state}" ]] || fail "expected owner state to remain with an unmatched marker"
  cat >"${state}/locks/BOXP-206.edn" <<EOF
{:ticket "BOXP-206" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
EOF

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    bb "${RUNNER}" recover >/tmp/task-board-marker-after-lock.out

  [[ ! -e "${state}/locks/BOXP-206.edn" ]] || fail "expected late matching lock to be recovered"
  [[ ! -e "${marker}" ]] || fail "expected consumed marker to be removed"
  [[ -e "${owner_state}" ]] || fail "expected recovered owner state to remain as a termination tombstone"
  assert_file_contains "${owner_state}" ':status :terminated'
  assert_file_contains "${owner_state}" ':instance-id "old-instance"'
  assert_file_contains "${state}/runs/BOXP-206/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/runs/BOXP-206/${old_run}/summary.edn" ':reason "planned workspace shutdown"'
}

test_shutdown_marker_survives_late_second_lock() {
  local tmp vault state first_run late_run heartbeat marker owner_state signal recover_pid
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  first_run="20260710T000400Z"
  late_run="20260710T000401Z"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  marker="${state}/terminating-owners/old-pod.edn"
  owner_state="${state}/owners/old-pod.edn"
  signal="${tmp}/before-marker-delete"
  mkdir -p \
    "${state}/locks" \
    "${state}/runs/BOXP-207/${first_run}" \
    "${state}/runs/BOXP-208/${late_run}" \
    "${state}/terminating-owners" \
    "${state}/owners"
  write_board "${vault}" ""
  cat >"${marker}" <<EOF
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :requested-at "${heartbeat}"}
EOF
  cat >"${owner_state}" <<EOF
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :pid 10 :started-at "${heartbeat}"}
EOF
  cat >"${state}/locks/BOXP-207.edn" <<EOF
{:ticket "BOXP-207" :run-id "${first_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
EOF

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    CODEX_TASK_BOARD_TEST_BEFORE_MARKER_DELETE_SIGNAL="${signal}" \
    CODEX_TASK_BOARD_TEST_BEFORE_MARKER_DELETE_MILLIS=1500 \
    bb "${RUNNER}" recover >/tmp/task-board-marker-late-second.out 2>&1 &
  recover_pid=$!

  for _attempt in $(seq 1 50); do
    [[ -e "${signal}" ]] && break
    sleep 0.1
  done
  if [[ ! -e "${signal}" ]]; then
    kill -KILL "${recover_pid}" 2>/dev/null || true
    wait "${recover_pid}" 2>/dev/null || true
    fail "expected recovery to pause before deleting a consumed marker"
  fi
  cat >"${state}/locks/BOXP-208.edn" <<EOF
{:ticket "BOXP-208" :run-id "${late_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
EOF
  wait "${recover_pid}"

  [[ ! -e "${state}/locks/BOXP-207.edn" ]] || fail "expected the first matching lock to be recovered"
  [[ -e "${state}/locks/BOXP-208.edn" ]] || fail "expected the late lock to remain for the next scan"
  [[ -e "${marker}" ]] || fail "expected a marker with a late second lock to be retained"
  [[ -e "${owner_state}" ]] || fail "expected owner state to remain while a matching lock exists"
  assert_file_contains "${state}/runs/BOXP-207/${first_run}/summary.edn" ':status :interrupted'

  CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    bb "${RUNNER}" recover >/tmp/task-board-marker-late-second-retry.out

  [[ ! -e "${state}/locks/BOXP-208.edn" ]] || fail "expected the late lock to be recovered on the next scan"
  [[ ! -e "${marker}" ]] || fail "expected marker removal after all matching locks were recovered"
  [[ -e "${owner_state}" ]] || fail "expected owner termination tombstone after all matching locks were recovered"
  assert_file_contains "${owner_state}" ':status :terminated'
  assert_file_contains "${owner_state}" ':instance-id "old-instance"'
  assert_file_contains "${state}/runs/BOXP-208/${late_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/runs/BOXP-208/${late_run}/summary.edn" ':reason "planned workspace shutdown"'
}

test_terminated_owner_cannot_create_lock_after_marker_cleanup() {
  local tmp vault state bin start_log heartbeat
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  start_log="${tmp}/starts.log"
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${bin}" "${state}/owners"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-209|BOXP-209: retired owner]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-209 in-progress codex
  cat >"${state}/owners/old-pod.edn" <<EOF
{:owner-id "old-pod" :instance-id "old-instance" :status :terminated :host "old-pod" :terminated-at "${heartbeat}"}
EOF

  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=old-instance \
    CODEX_FAKE_START_LOG="${start_log}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-terminated-owner.out

  [[ ! -e "${start_log}" ]] || fail "expected a terminated owner not to start an agent"
  [[ ! -e "${state}/locks/BOXP-209.edn" ]] || fail "expected a terminated owner not to create a lock"
  assert_file_contains /tmp/task-board-terminated-owner.out 'is draining; not accepting new tickets'
  assert_file_contains "${vault}/Tickets/BOXP-209.md" '^status: in-progress$'
}

test_review_without_pr_is_blocked() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-301|BOXP-301: review]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-301 in-progress codex

  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review.out

  assert_file_contains "${vault}/Boards/Task Board.md" '## Blocked'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: review\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'Review was requested without a GitHub PR URL'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: review\]\].*status::review'
}

test_review_with_pr_url_is_noted() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-401|BOXP-401: review pr]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-401 in-progress codex boxp/example

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=1 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-pr.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-401\|BOXP-401: review pr\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" '^status: review$'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" 'PR: https://github.com/boxp/example/pull/123'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" 'Review gates passed'
}

test_review_without_repo_marker_skips_pr_gates() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-402|BOXP-402: no repo review]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-402 in-progress codex

  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-none.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-402\|BOXP-402: no repo review\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-402.md" '^status: review$'
}

test_review_with_conflict_is_blocked() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-403|BOXP-403: conflict]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-403 in-progress codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_MERGE_STATE=DIRTY CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-conflict.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-403\|BOXP-403: conflict\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" '^assignee: codex$'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" 'Review gate failed \(conflict\)'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" 'Retrying with Codex instruction 1/2'
  assert_run_summary_contains "${state}" BOXP-403 ':gate :conflict'
  assert_run_summary_contains "${state}" BOXP-403 ':status :retrying'
}

test_fable_review_gate_retry_keeps_fable_assignee() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-416|BOXP-416: fable conflict]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-416 in-progress fable boxp/example

  PATH="${bin}:$PATH" GH_FAKE_MERGE_STATE=DIRTY CLAUDE_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-fable-review-conflict.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-416\|BOXP-416: fable conflict\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-416.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-416.md" '^assignee: fable$'
  assert_file_contains "${vault}/Tickets/BOXP-416.md" 'Retrying with Codex instruction 1/2'
  assert_run_summary_contains "${state}" BOXP-416 ':agent "fable"'
  assert_file_contains "${state}/state.edn" ':agent "fable"'
}

test_review_with_ci_failure_is_blocked() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-404|BOXP-404: ci fail]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-404 in-progress codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-ci.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-404\|BOXP-404: ci fail\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-404.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-404.md" 'Review gate failed \(ci\)'
  assert_file_contains "${vault}/Tickets/BOXP-404.md" 'unit=FAILURE'
}

test_review_with_codex_review_issue_is_blocked() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-405|BOXP-405: review issue]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-405 in-progress codex boxp/example

  PATH="${bin}:$PATH" CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\n- missing regression test' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-issue.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-405\|BOXP-405: review issue\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Review gate failed \(codex-review\)'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'missing regression test'
}

test_review_with_pr_and_none_marker_checks_pr() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-406|BOXP-406: pr wins]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-406 in-progress codex boxp/example

  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nCreated PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-pr-wins.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-406\|BOXP-406: pr wins\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-406.md" 'Review gates passed'
}

test_review_with_multiple_pr_urls_checks_all() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-410|BOXP-410: multiple prs]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-410 in-progress codex boxp/example

  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PRs:\nhttps://github.com/boxp/example/pull/123\nhttps://github.com/boxp/example/pull/456\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-multiple-prs.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-410\|BOXP-410: multiple prs\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-410.md" '^status: review$'
  assert_file_contains "${vault}/Tickets/BOXP-410.md" 'PR: https://github.com/boxp/example/pull/123, https://github.com/boxp/example/pull/456'
  assert_file_contains "${vault}/Tickets/BOXP-410.md" 'All PR gates passed for 2 PR\(s\)'
}

test_review_with_multiple_pr_urls_blocks_on_second_failure() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-411|BOXP-411: second pr fails]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-411 in-progress codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_CHECKS_456='[{"name":"integration","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PRs:\nhttps://github.com/boxp/example/pull/123\nhttps://github.com/boxp/example/pull/456\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-multiple-prs-fail.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-411\|BOXP-411: second pr fails\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" 'Review gate failed \(ci\)'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" 'https://github.com/boxp/example/pull/456'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" 'integration=FAILURE'
}

test_review_gate_keeps_lock_heartbeat_active() {
  local tmp vault state bin log before after
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  log="${tmp}/lock-mtime.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-412|BOXP-412: gate heartbeat]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-412 in-progress codex boxp/example

  PATH="${bin}:$PATH" \
    GH_FAKE_LOCK_FILE="${state}/locks/BOXP-412.edn" \
    GH_FAKE_LOCK_MTIME_LOG="${log}" \
    GH_FAKE_PR_VIEW_SLEEP_SECONDS=2 \
    CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-review-gate-heartbeat.out

  read -r before after <"${log}"
  [[ "${after}" -gt "${before}" ]] || fail "expected lock heartbeat to update during PR gate, got ${before} -> ${after}"
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-412\|BOXP-412: gate heartbeat\]\].*status::review'
}

test_review_gate_passes_codex_model_profile_to_review() {
  local tmp vault state bin log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  log="${tmp}/codex-args.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-413|BOXP-413: review codex config]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-413 in-progress codex boxp/example

  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_MODEL=gpt-test \
    CODEX_TASK_BOARD_PROFILE=review-profile \
    CODEX_FAKE_ARG_LOG="${log}" \
    CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-review-codex-config.out

  assert_file_contains "${log}" 'codex-review-123\.md.*--model gpt-test.*--profile review-profile'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-413\|BOXP-413: review codex config\]\].*status::review'
}

test_review_with_empty_ci_rollup_times_out() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-407|BOXP-407: no checks yet]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-407 in-progress codex boxp/example

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=1 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-empty-ci.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-407\|BOXP-407: no checks yet\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-407.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-407.md" 'Review gate failed \(ci\)'
  assert_file_contains "${vault}/Tickets/BOXP-407.md" 'No CI checks have been reported'
}

test_review_with_empty_ci_rollup_passes_after_grace_period() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-450|BOXP-450: no ci repo]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-450 in-progress codex boxp/example

  # Short grace (1s) with longer timeout (10s): empty checks + CLEAN merge → passes after grace period
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=10 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_TASK_BOARD_PR_CI_GRACE_SECONDS=1 GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-empty-ci-grace.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-450\|BOXP-450: no ci repo\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-450.md" '^status: review$'
  assert_file_contains "${vault}/Tickets/BOXP-450.md" 'No CI checks configured'
}

test_review_with_draft_pr_is_retried() {
  local tmp vault state bin prompt_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/prompts.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-408|BOXP-408: draft pr]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-408 in-progress codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_IS_DRAFT=true CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-draft.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-408\|BOXP-408: draft pr\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" '^assignee: codex$'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" 'Review gate failed \(mergeability\)'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" 'still a draft'

  PATH="${bin}:$PATH" GH_FAKE_IS_DRAFT=true CODEX_FAKE_PROMPT_LOG="${prompt_log}" CODEX_FAKE_MESSAGE=$'TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-review-draft-retry-prompt.out

  assert_file_contains "${prompt_log}" 'Pending PR gate retry instruction'
  assert_file_contains "${prompt_log}" 'Target PR URL: https://github.com/boxp/example/pull/123'
  assert_file_contains "${prompt_log}" 'Failed gate: mergeability'
  assert_file_contains "${prompt_log}" 'Failure reason: GitHub reports this PR is still a draft'
  assert_file_contains "${prompt_log}" 'Previous run summary: .*/summary.edn'
  assert_file_contains "${prompt_log}" 'Expected completion state: update the same PR'
}

test_review_with_behind_merge_state_times_out() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-409|BOXP-409: behind]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-409 in-progress codex boxp/example

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=1 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_MERGE_STATE=BEHIND CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-behind.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-409\|BOXP-409: behind\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-409.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-409.md" 'Review gate failed \(mergeability\)'
  assert_file_contains "${vault}/Tickets/BOXP-409.md" 'mergeStateStatus=BEHIND'
}

test_review_gate_retry_limit_blocks() {
  local tmp vault state bin i
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-414|BOXP-414: retry limit]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-414 in-progress codex boxp/example

  for i in 1 2 3; do
    PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-retry-limit-"${i}".out
  done

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-414\|BOXP-414: retry limit\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" 'Review gate failed \(ci\)'
  assert_run_summary_contains "${state}" BOXP-414 ':retry-exhausted\? true'
}

test_review_gate_pass_after_retry_moves_review() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-415|BOXP-415: pass after retry]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-415 in-progress codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-retry-then-pass-1.out
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-retry-then-pass-2.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-415\|BOXP-415: pass after retry\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-415.md" '^status: review$'
  assert_file_contains "${vault}/Tickets/BOXP-415.md" 'PR: https://github.com/boxp/example/pull/123'
  assert_file_contains "${vault}/Tickets/BOXP-415.md" 'Review gates passed'
  assert_file_not_contains "${state}/state.edn" 'BOXP-415'
}

test_groom_prompt_contains_investigation_steps() {
  local tmp vault state bin prompt_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompt.log"
  mkdir -p "${bin}" "${vault}/Boards" "${vault}/Tickets"
  make_fake_codex "${bin}"
  cat >"${vault}/Boards/Task Board.md" <<'EOF'
# Task Board

## Backlog
- [ ] [[Tickets/BOXP-600|BOXP-600: groom prompt]] #ticket status::backlog

## Ready

## In Progress

## Blocked

## Review

## Done
EOF
  write_ticket "${vault}" BOXP-600 backlog codex

  PATH="${bin}:$PATH" \
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-groom-prompt.out

  assert_file_contains "${prompt_log}" 'First investigate before writing'
  assert_file_contains "${prompt_log}" 'Notes'
  assert_file_contains "${prompt_log}" 'GitHub'
  assert_file_contains "${prompt_log}" 'gh CLI'
  assert_file_contains "${prompt_log}" 'Fill Context with investigation findings'
  assert_file_contains "${prompt_log}" 'Fill Plan with concrete implementation steps'
}

test_implement_prompt_includes_append_note() {
  local tmp vault state bin prompt_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompt.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-603|BOXP-603: append-note]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-603 in-progress codex

  PATH="${bin}:$PATH" \
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-append-note-codex.out

  assert_file_contains "${prompt_log}" 'append-note BOXP-603'
  assert_file_contains "${prompt_log}" 'milestone'
}

test_fable_implement_prompt_includes_append_note() {
  local tmp vault state bin prompt_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/claude-prompt.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-604|BOXP-604: fable append-note]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-604 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
    CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-append-note-fable.out

  assert_file_contains "${prompt_log}" 'append-note BOXP-604'
  assert_file_contains "${prompt_log}" 'milestone'
  assert_file_contains "${prompt_log}" '\.claude/skills/obsidian-task-board'
}

test_groom_prompt_includes_append_note() {
  local tmp vault state bin prompt_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompt.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-605|BOXP-605: groom append-note]] #ticket status::backlog"
  write_ticket "${vault}" BOXP-605 backlog codex

  PATH="${bin}:$PATH" \
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-groom-append-note.out

  assert_file_contains "${prompt_log}" 'append-note BOXP-605'
  assert_file_contains "${prompt_log}" 'milestone'
}

test_assignee_model_routing() {
  bb "${RUNNER}" test
}

test_assignee_model_tick_routing() {
  local tmp vault state bin args_log assignee expected_model
  local pairs=("codex:gpt-5.6-terra" "codex-sol:gpt-5.6-sol" "codex-full:gpt-5.6-sol" "codex-terra:gpt-5.6-terra" "codex-mini:gpt-5.6-luna")
  for pair in "${pairs[@]}"; do
    assignee="${pair%%:*}"
    expected_model="${pair##*:}"
    tmp="$(mktemp -d)"
    vault="${tmp}/vault"
    state="${tmp}/state"
    bin="${tmp}/bin"
    args_log="${tmp}/codex-args.log"
    mkdir -p "${bin}"
    make_fake_codex "${bin}"
    make_fake_gh "${bin}"
    write_board "${vault}" "- [ ] [[Tickets/BOXP-500|BOXP-500: model tick]] #ticket status::in-progress"
    write_ticket "${vault}" BOXP-500 in-progress "${assignee}"
    PATH="${bin}:$PATH" CODEX_FAKE_ARG_LOG="${args_log}" run_tick "${vault}" "${state}" env >"/tmp/task-board-model-tick-${assignee}.out"
    assert_file_contains "${args_log}" "exec.*--model ${expected_model}"
    assert_file_not_contains "${args_log}" 'model_reasoning_effort='
  done
}

test_assignee_reasoning_tick_routing() {
  local tmp vault state bin args_log assignee expected_model level
  local pairs=(
    "codex-minimal:gpt-5.6-terra:minimal"
    "codex-sol-low:gpt-5.6-sol:low"
    "codex-full-medium:gpt-5.6-sol:medium"
    "codex-terra-high:gpt-5.6-terra:high"
    "codex-mini-xhigh:gpt-5.6-luna:xhigh"
  )
  for pair in "${pairs[@]}"; do
    IFS=: read -r assignee expected_model level <<<"${pair}"
    tmp="$(mktemp -d)"
    vault="${tmp}/vault"
    state="${tmp}/state"
    bin="${tmp}/bin"
    args_log="${tmp}/codex-args.log"
    mkdir -p "${bin}"
    make_fake_codex "${bin}"
    write_board "${vault}" "- [ ] [[Tickets/BOXP-501|BOXP-501: reasoning tick]] #ticket status::in-progress"
    write_ticket "${vault}" BOXP-501 in-progress "${assignee}"
    PATH="${bin}:$PATH" CODEX_FAKE_ARG_LOG="${args_log}" run_tick "${vault}" "${state}" env >"/tmp/task-board-reasoning-tick-${assignee}.out"
    assert_file_contains "${args_log}" "exec.*--model ${expected_model}.*-c model_reasoning_effort=${level}"
    assert_file_contains "${vault}/Tickets/BOXP-501.md" '^status: done$'
  done
}

test_invalid_reasoning_assignees_are_ignored() {
  local tmp vault state bin args_log assignee
  local assignees=("codex-terra-ultra" "unknown-high" "fable-high")
  for assignee in "${assignees[@]}"; do
    tmp="$(mktemp -d)"
    vault="${tmp}/vault"
    state="${tmp}/state"
    bin="${tmp}/bin"
    args_log="${tmp}/codex-args.log"
    mkdir -p "${bin}"
    make_fake_codex "${bin}"
    write_board "${vault}" "- [ ] [[Tickets/BOXP-502|BOXP-502: invalid reasoning]] #ticket status::in-progress"
    write_ticket "${vault}" BOXP-502 in-progress "${assignee}"
    PATH="${bin}:$PATH" CODEX_FAKE_ARG_LOG="${args_log}" run_tick "${vault}" "${state}" env >"/tmp/task-board-invalid-reasoning-${assignee}.out"
    [[ ! -e "${args_log}" ]] || fail "expected codex not to start for invalid assignee ${assignee}"
    [[ ! -d "${state}/runs/BOXP-502" ]] || fail "expected no run directory for invalid assignee ${assignee}"
  done
}

test_concurrent_append_note_no_lost_writes() {
  local tmp vault ticket_file
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  mkdir -p "${vault}/Tickets"
  cat >"${vault}/Tickets/BOXP-999.md" <<'EOF'
---
id: BOXP-999
type: task
status: in-progress
priority: medium
assignee: codex
repo:
closed:
---

# BOXP-999: concurrent append test

## Notes
EOF
  local n=5
  local pids=()
  for i in $(seq 1 "${n}"); do
    bb "${HELPER}" append-note BOXP-999 --vault "${vault}" --source "test" --note "concurrent-note-${i}" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "${pid}"
  done
  ticket_file="${vault}/Tickets/BOXP-999.md"
  for i in $(seq 1 "${n}"); do
    grep -q "concurrent-note-${i}" "${ticket_file}" \
      || fail "note ${i} was lost in concurrent append-note writes"
  done
}

test_parallel_codex_runs
test_fable_assignee_runs_via_claude
test_codex_sol_assignee_includes_delegation_policy
test_codex_full_assignee_includes_delegation_policy
test_unsupported_assignee_is_ignored
test_stale_lock_recovers
test_planned_shutdown_lock_recovers_immediately
test_cross_process_lock_guard_preserves_replacement_lock
test_sigterm_writes_shutdown_marker_without_prestop
test_one_shot_tick_does_not_replace_loop_owner_instance
test_current_owner_shutdown_marker_drains_without_recovery
test_same_owner_new_instance_recovers_previous_instance
test_same_owner_new_instance_retires_empty_previous_marker
test_mismatched_shutdown_marker_does_not_recover_fresh_lock
test_shutdown_marker_waits_for_late_matching_lock
test_shutdown_marker_survives_late_second_lock
test_terminated_owner_cannot_create_lock_after_marker_cleanup
test_review_without_pr_is_blocked
test_review_with_pr_url_is_noted
test_review_without_repo_marker_skips_pr_gates
test_review_with_conflict_is_blocked
test_fable_review_gate_retry_keeps_fable_assignee
test_review_with_ci_failure_is_blocked
test_review_with_codex_review_issue_is_blocked
test_review_with_pr_and_none_marker_checks_pr
test_review_with_multiple_pr_urls_checks_all
test_review_with_multiple_pr_urls_blocks_on_second_failure
test_review_gate_keeps_lock_heartbeat_active
test_review_gate_passes_codex_model_profile_to_review
test_review_with_empty_ci_rollup_times_out
test_review_with_empty_ci_rollup_passes_after_grace_period
test_review_with_draft_pr_is_retried
test_review_with_behind_merge_state_times_out
test_review_gate_retry_limit_blocks
test_review_gate_pass_after_retry_moves_review
test_groom_prompt_contains_investigation_steps
test_implement_prompt_includes_append_note
test_fable_implement_prompt_includes_append_note
test_groom_prompt_includes_append_note
test_assignee_model_routing
test_assignee_model_tick_routing
test_assignee_reasoning_tick_routing
test_invalid_reasoning_assignees_are_ignored
test_concurrent_append_note_no_lost_writes

echo "task-board-runner tests passed"
