#!/usr/bin/env bash
set -euo pipefail

# CI and local images may pin the real Claude executable. Tests must always use
# their temporary fake unless a test deliberately supplies a pinned fake path.
unset CODEX_TASK_BOARD_CLAUDE_BIN
unset CODEX_TASK_BOARD_FABLE_MODEL
unset CODEX_TASK_BOARD_FABLE_AGENT
unset CODEX_TASK_BOARD_FABLE_EXTRA_ARGS

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
  grep -Eq -- "$pattern" "$file" || fail "expected ${file} to match ${pattern}"
}

assert_file_not_contains() {
  local file="$1"
  local pattern="$2"
  if grep -Eq -- "$pattern" "$file"; then
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
if [[ -n "${CLAUDE_FAKE_EXECUTABLE_LOG:-}" ]]; then
  printf '%s\n' "$0" >>"${CLAUDE_FAKE_EXECUTABLE_LOG}"
fi

prompt="$(cat)"
ticket="$(printf '%s\n' "${prompt}" | sed -n 's/^Ticket: //p' | head -n 1)"
if [[ -n "${CLAUDE_FAKE_ARG_LOG_DIR:-}" ]]; then
  mkdir -p "${CLAUDE_FAKE_ARG_LOG_DIR}"
  printf '%s\n' "$*" >"${CLAUDE_FAKE_ARG_LOG_DIR}/${ticket}.log"
fi
if [[ -n "${CLAUDE_FAKE_PROMPT_LOG:-}" ]]; then
  printf '%s\n' "${prompt}" >>"${CLAUDE_FAKE_PROMPT_LOG}"
fi
if [[ -n "${CLAUDE_FAKE_START_LOG:-}" ]]; then
  printf '%s %s\n' "${ticket}" "$(date +%s)" >>"${CLAUDE_FAKE_START_LOG}"
fi
if [[ -n "${CLAUDE_FAKE_PROGRESS_FILE:-}" ]]; then
  for _ in $(seq 1 "${CLAUDE_FAKE_PROGRESS_COUNT:-1}"); do
    sleep "${CLAUDE_FAKE_PROGRESS_INTERVAL:-0}"
    printf '%s\n' 'fake agent progress' >>"${CLAUDE_FAKE_PROGRESS_FILE}"
  done
fi
if [[ -n "${CLAUDE_FAKE_CHILD_PID_FILE:-}" ]]; then
  if [[ "${CLAUDE_FAKE_CHILD_IGNORES_TERM:-false}" == true ]]; then
    (trap '' TERM; sleep "${CLAUDE_FAKE_CHILD_SLEEP:-30}") &
  else
    sleep "${CLAUDE_FAKE_CHILD_SLEEP:-30}" &
  fi
  printf '%s\n' "$!" >"${CLAUDE_FAKE_CHILD_PID_FILE}"
  wait "$!"
fi
sleep "${CLAUDE_FAKE_SLEEP:-0}"
printf '%s\n' "${CLAUDE_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}"
exit "${CLAUDE_FAKE_EXIT:-0}"
EOF
  chmod +x "${bin_dir}/claude"
}

make_fake_gh() {
  local bin_dir="$1"
  cat >"${bin_dir}/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${GH_FAKE_FAIL:-false}" == true ]]; then
  echo "gh api failed: token=super-secret-token" >&2
  exit 1
fi

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

if [[ "$1" == "api" && "$2" =~ ^repos/boxp/example/commits/([0-9a-f]{40})$ ]]; then
  sha="${BASH_REMATCH[1]}"
  if [[ -n "${GH_FAKE_API_LOG:-}" ]]; then
    printf '%s\n' "${sha}" >>"${GH_FAKE_API_LOG}"
  fi
  if [[ -n "${GH_FAKE_KNOWN_SHAS:-}" ]] && grep -qx "${sha}" "${GH_FAKE_KNOWN_SHAS}"; then
    printf '%s\n' "${sha}"
    exit 0
  fi
  echo "gh: Not Found (HTTP 404)" >&2
  exit 1
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
  assert_file_not_contains "${args_log}" '--model'
  assert_file_not_contains "${args_log}" 'BOXP-150'
  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: fable$'
  assert_file_contains "${prompt_log}" 'Fable routing policy'
  assert_file_contains "${prompt_log}" 'gpt-6-astra'
  assert_file_contains "${prompt_log}" 'codex-astra'
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

test_explicit_claude_assignees_use_fixed_models_and_pinned_binary() {
  local tmp vault state path_bin pinned_bin args_log args_dir prompt_log executable_log assignee model ticket
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  path_bin="${tmp}/path-bin"
  pinned_bin="${tmp}/pinned-bin"
  args_log="${tmp}/claude-args.log"
  args_dir="${tmp}/claude-args"
  prompt_log="${tmp}/claude-prompt.log"
  executable_log="${tmp}/claude-executable.log"
  mkdir -p "${path_bin}" "${pinned_bin}"
  make_fake_claude "${path_bin}"
  make_fake_claude "${pinned_bin}"

  for assignee in claude-fable claude-opus claude-sonnet; do
    case "${assignee}" in
      claude-fable) model=claude-fable-5-1; ticket=BOXP-163 ;;
      claude-opus) model=claude-opus-5-5; ticket=BOXP-164 ;;
      claude-sonnet) model=claude-sonnet-5-5; ticket=BOXP-165 ;;
    esac
    write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: ${assignee}]] #ticket status::in-progress"
    write_ticket "${vault}" "${ticket}" in-progress "${assignee}"

    PATH="${path_bin}:$PATH" \
      CODEX_TASK_BOARD_CLAUDE_BIN="${pinned_bin}/claude" \
      CLAUDE_FAKE_ARG_LOG="${args_log}" \
      CLAUDE_FAKE_ARG_LOG_DIR="${args_dir}" \
      CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
      CLAUDE_FAKE_EXECUTABLE_LOG="${executable_log}" \
      CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
      run_tick "${vault}" "${state}" env >/tmp/task-board-"${assignee}".out

    assert_file_contains "${args_dir}/${ticket}.log" "--model ${model}"
    assert_file_not_contains "${args_dir}/${ticket}.log" '--agent'
    assert_file_contains "${prompt_log}" "^Task Board assignee/agent: ${assignee}$"
    assert_file_contains "${prompt_log}" 'Claude Code routing policy'
    assert_file_contains "${prompt_log}" "~/.claude/skills/obsidian-task-board/bin/task-board.bb append-note ${ticket}"
    assert_run_summary_contains "${state}" "${ticket}" ":agent \"${assignee}\""
    assert_run_summary_contains "${state}" "${ticket}" ':status :succeeded'
    assert_run_summary_contains "${state}" "${ticket}" ':exit-code 0'
    assert_file_contains "${vault}/Tickets/${ticket}.md" '^status: done$'
  done

  [[ "$(sort -u "${executable_log}")" == "${pinned_bin}/claude" ]] \
    || fail 'expected explicit Claude binary to win over PATH shadow'
}

test_fable_model_environment_is_legacy_only() {
  local tmp vault state bin args_log args_dir
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  args_log="${tmp}/claude-args.log"
  args_dir="${tmp}/claude-args"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"

  write_board "${vault}" "- [ ] [[Tickets/BOXP-159|BOXP-159: legacy fable]] #ticket status::in-progress
- [ ] [[Tickets/BOXP-160|BOXP-160: fixed opus]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-159 in-progress fable
  write_ticket "${vault}" BOXP-160 in-progress claude-opus

  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_FABLE_MODEL=legacy-fable-model \
    CODEX_TASK_BOARD_FABLE_AGENT=legacy-fable-agent \
    CODEX_TASK_BOARD_FABLE_EXTRA_ARGS='--model legacy-extra-model' \
    CLAUDE_FAKE_ARG_LOG="${args_log}" \
    CLAUDE_FAKE_ARG_LOG_DIR="${args_dir}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-model-scope.out

  assert_file_contains "${args_dir}/BOXP-159.log" '--model legacy-fable-model'
  assert_file_contains "${args_dir}/BOXP-159.log" '--agent legacy-fable-agent'
  assert_file_contains "${args_dir}/BOXP-159.log" '--model legacy-extra-model'
  assert_file_contains "${args_dir}/BOXP-160.log" '--model claude-opus-5-5'
  assert_file_not_contains "${args_dir}/BOXP-160.log" '--agent'
  assert_file_not_contains "${args_dir}/BOXP-160.log" 'legacy-fable-model'
  assert_file_not_contains "${args_dir}/BOXP-160.log" 'legacy-extra-model'
}

test_explicit_claude_error_and_review_markers_are_processed() {
  local tmp vault state bin summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"

  write_board "${vault}" "- [ ] [[Tickets/BOXP-161|BOXP-161: claude error]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-161 in-progress claude-sonnet
  PATH="${bin}:$PATH" CLAUDE_FAKE_EXIT=1 run_tick "${vault}" "${state}" env >/tmp/task-board-claude-error.out
  assert_file_contains "${vault}/Tickets/BOXP-161.md" '^status: blocked$'
  assert_run_summary_contains "${state}" BOXP-161 ':agent "claude-sonnet"'
  assert_run_summary_contains "${state}" BOXP-161 ':status :blocked'
  assert_run_summary_contains "${state}" BOXP-161 ':exit-code 1'

  write_board "${vault}" "- [ ] [[Tickets/BOXP-162|BOXP-162: claude review]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-162 in-progress claude-opus
  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-claude-review.out
  assert_file_contains "${vault}/Tickets/BOXP-162.md" '^status: review$'
  assert_run_summary_contains "${state}" BOXP-162 ':agent "claude-opus"'
  summary="$(find "${state}/runs/BOXP-162" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${summary}" '^TASK_BOARD_RESULT: review$'

  write_board "${vault}" "- [ ] [[Tickets/BOXP-166|BOXP-166: missing marker]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-166 in-progress claude-fable
  PATH="${bin}:$PATH" CLAUDE_FAKE_MESSAGE='completed without a task board marker' run_tick "${vault}" "${state}" env >/tmp/task-board-claude-missing-marker.out
  assert_file_contains "${vault}/Tickets/BOXP-166.md" '^status: blocked$'
  assert_run_summary_contains "${state}" BOXP-166 ':blocker-category "pr-gate-pr-url"'

  write_board "${vault}" "- [ ] [[Tickets/BOXP-167|BOXP-167: blocked marker]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-167 in-progress claude-fable
  PATH="${bin}:$PATH" CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-claude-blocked-marker.out
  assert_file_contains "${vault}/Tickets/BOXP-167.md" '^status: blocked$'
}

test_fable_agent_idle_timeout_retries() {
  local tmp vault state bin summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-154|BOXP-154: stalled fable]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-154 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_SLEEP=2 \
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-timeout.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-154\|BOXP-154: stalled fable\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-154.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-154.md" 'No agent progress was logged before the idle timeout; the run was stopped and will be retried automatically'
  summary="$(find "${state}/runs/BOXP-154" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':idle-timeout\? true'

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_SLEEP=2 \
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-timeout-retry.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-154\|BOXP-154: stalled fable\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-154.md" '^status: in-progress$'
}

test_fable_idle_timeout_stops_agent_children() {
  local tmp vault state bin child_pid_file child_pid child_state
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  child_pid_file="${tmp}/child.pid"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-156|BOXP-156: child process]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-156 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_CHILD_PID_FILE="${child_pid_file}" \
    CLAUDE_FAKE_CHILD_SLEEP=30 \
    CLAUDE_FAKE_CHILD_IGNORES_TERM=true \
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-child-timeout.out

  child_pid="$(cat "${child_pid_file}")"
  if kill -0 "${child_pid}" 2>/dev/null; then
    # The process group is stopped correctly, but its orphaned child can remain
    # as a zombie until PID 1 reaps it. A zombie has no running agent process.
    child_state="$(ps -o stat= -p "${child_pid}" 2>/dev/null | tr -d '[:space:]' || true)"
    [[ "${child_state}" == Z* ]] || ! kill -0 "${child_pid}" 2>/dev/null \
      || fail "expected idle timeout to stop Fable child process ${child_pid} (state=${child_state:-unknown})"
  fi
}

test_invalid_idle_timeout_does_not_start_agent() {
  local tmp vault state bin start_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  start_log="${tmp}/starts.log"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-158|BOXP-158: invalid timeout]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-158 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_START_LOG="${start_log}" \
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=-1 \
    run_tick "${vault}" "${state}" env >/tmp/task-board-invalid-idle-timeout.out

  [[ ! -e "${start_log}" ]] || fail "expected invalid idle timeout to prevent Fable startup"
  assert_file_contains "${vault}/Tickets/BOXP-158.md" '^status: blocked$'
}

test_fable_progress_prevents_idle_timeout() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-155|BOXP-155: long fable]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-155 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_PROGRESS_FILE="${vault}/Tickets/BOXP-155.md" \
    CLAUDE_FAKE_PROGRESS_COUNT=4 \
    CLAUDE_FAKE_PROGRESS_INTERVAL=0.4 \
    CLAUDE_FAKE_SLEEP=1 \
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-progress.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-155\|BOXP-155: long fable\]\].*status::done'
  assert_file_contains "${vault}/Tickets/BOXP-155.md" '^status: done$'
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
  write_board "${vault}" "- [ ] [[Tickets/BOXP-151|BOXP-151: human]] #ticket status::in-progress
- [ ] [[Tickets/BOXP-168|BOXP-168: invalid Claude route]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-151 in-progress boxp
  write_ticket "${vault}" BOXP-168 in-progress claude-unknown

  PATH="${bin}:$PATH" \
    CODEX_FAKE_START_LOG="${codex_log}" \
    CLAUDE_FAKE_START_LOG="${claude_log}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-unsupported-assignee.out

  [[ ! -e "${codex_log}" ]] || fail "expected codex not to start for unsupported assignee"
  [[ ! -e "${claude_log}" ]] || fail "expected claude not to start for unsupported assignee"
  [[ ! -d "${state}/runs/BOXP-151" ]] || fail "expected no run directory for unsupported assignee"
  [[ ! -d "${state}/runs/BOXP-168" ]] || fail "expected no run directory for invalid Claude assignee"
  assert_file_contains "${vault}/Tickets/BOXP-151.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-168.md" '^status: in-progress$'
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
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'reason=PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'Blocked transition recorded: ticket=BOXP-301; run='
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'action=implement; at=.*category=pr-gate-pr-url'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'inspect run artifacts: .*/summary\.edn, .*/last-message\.md, .*/events\.jsonl, .*/stderr\.log'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: review\]\].*status::review'
}

test_fable_reported_blocked_is_audited() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-302|BOXP-302: fable blocked]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-302 in-progress fable

  PATH="${bin}:$PATH" CLAUDE_FAKE_MESSAGE=$'TASK_BOARD_RESULT: blocked\napi_key=do-not-expose' run_tick "${vault}" "${state}" env >/tmp/task-board-fable-blocked.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-302\|BOXP-302: fable blocked\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" 'category=agent-reported-blocked'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" 'reason=Agent reported blocked; inspect the referenced run artifacts'
  assert_file_not_contains "${vault}/Tickets/BOXP-302.md" 'do-not-expose'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" 'inspect run artifacts:'
  assert_run_summary_contains "${state}" BOXP-302 ':status :blocked'
}

test_blocker_note_failure_keeps_current_lane() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-303|BOXP-303: notes failure]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-303 in-progress codex

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKER_NOTE=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-blocker-note-failure.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-303\|BOXP-303: notes failure\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-303.md" '^status: in-progress$'
  assert_file_not_contains "${vault}/Tickets/BOXP-303.md" 'Blocked transition recorded:'
  assert_run_summary_contains "${state}" BOXP-303 ':status :blocker-note-failed'
  assert_file_contains /tmp/task-board-blocker-note-failure.out 'blocked transition withheld'
}

test_runner_internal_error_is_audited() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-304|BOXP-304: runner error]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-304 in-progress codex

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FORCE_RUNNER_EXCEPTION=true run_tick "${vault}" "${state}" env >/tmp/task-board-runner-internal-error.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-304\|BOXP-304: runner error\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-304.md" 'category=runner-internal-error'
  assert_file_contains "${vault}/Tickets/BOXP-304.md" 'reason=Runner internal error; inspect the referenced run artifacts'
  assert_file_not_contains "${vault}/Tickets/BOXP-304.md" 'super-secret-token'
  assert_file_contains "${vault}/Tickets/BOXP-304.md" 'inspect run artifacts:'
  assert_run_summary_contains "${state}" BOXP-304 ':status :blocked'
}

test_blocker_reason_redacts_github_pat_and_spaced_api_key() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-305|BOXP-305: credential redaction]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-305 in-progress codex

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FORCE_RUNNER_EXCEPTION=true \
    CODEX_TASK_BOARD_TEST_RUNNER_EXCEPTION_MESSAGE='GitHub API failed: github_pat_abcdefghijklmnopqrstuvwxyz123456 API key: spaced-secret-value' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-blocker-credential-redaction.out

  assert_file_contains "${vault}/Tickets/BOXP-305.md" 'reason=Runner internal error; inspect the referenced run artifacts'
  assert_file_not_contains "${vault}/Tickets/BOXP-305.md" 'abcdefghijklmnopqrstuvwxyz123456'
  assert_file_not_contains "${vault}/Tickets/BOXP-305.md" 'spaced-secret-value'
}

test_blocker_note_failure_restores_original_lane() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-306|BOXP-306: restore review]] #ticket status::review"
  write_ticket "${vault}" BOXP-306 review codex
  bb "${HELPER}" update BOXP-306 --vault "${vault}" --lane Review >/dev/null

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKER_NOTE=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-blocker-note-restore.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-306\|BOXP-306: test ticket\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-306.md" '^status: review$'
  assert_file_contains "${vault}/Tickets/BOXP-306.md" '^assignee: codex$'
}

test_blocked_state_failure_records_a_single_audit_note_and_restores_lane() {
  local tmp vault state bin note_count
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-307|BOXP-307: state failure]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-307 in-progress codex

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-blocked-state-failure.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-307\|BOXP-307: state failure\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-307.md" '^status: in-progress$'
  note_count="$(grep -c 'Blocked transition recorded: ticket=BOXP-307;' "${vault}/Tickets/BOXP-307.md")"
  [[ "${note_count}" -eq 1 ]] || fail "expected one blocked audit note, got ${note_count}"
  assert_run_summary_contains "${state}" BOXP-307 ':status :succeeded'
  summary="$(find "${state}/runs/BOXP-307" -name summary.edn -print | sort | tail -n 1)"
  assert_file_not_contains "${summary}" ':status :blocked'
  assert_file_contains /tmp/task-board-blocked-state-failure.out 'blocked transition state update failed'
}

test_nonretryable_pr_gate_blocked_state_failure_keeps_summary_consistent() {
  local tmp vault state bin summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-308|BOXP-308: nonretryable gate state failure]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-308 in-progress codex

  # A review result without a PR URL is a non-retryable :pr-url gate
  # failure.  The forced Blocked-state failure must restore the ticket while
  # keeping the provisional succeeded summary, rather than persisting :blocked.
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE=true \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' \
    run_tick "${vault}" "${state}" env >/tmp/task-board-nonretryable-gate-state-failure.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-308\|BOXP-308: nonretryable gate state failure\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-308.md" '^status: in-progress$'
  summary="$(find "${state}/runs/BOXP-308" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':status :succeeded'
  assert_file_not_contains "${summary}" ':status :blocked'
  assert_file_contains /tmp/task-board-nonretryable-gate-state-failure.out 'blocked transition state update failed'
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

test_pr_gate_api_failure_is_audited() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-417|BOXP-417: pr api failure]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-417 in-progress codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_FAIL=true CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-pr-api-failure.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-417\|BOXP-417: pr api failure\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-417.md" 'category=pr-gate-pr-gate'
  assert_file_contains "${vault}/Tickets/BOXP-417.md" 'reason='
  assert_file_not_contains "${vault}/Tickets/BOXP-417.md" 'super-secret-token'
  assert_file_contains "${vault}/Tickets/BOXP-417.md" 'inspect run artifacts:'
  assert_run_summary_contains "${state}" BOXP-417 ':gate :pr-gate'
  assert_file_not_contains "$(find "${state}/runs/BOXP-417" -name summary.edn -print | sort | tail -n 1)" 'super-secret-token'
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
  assert_file_contains "${vault}/Tickets/BOXP-404.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-404.md" 'unit=FAILURE'
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
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'missing regression test'
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
  local tmp vault state bin summary
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
  assert_file_contains "${vault}/Tickets/BOXP-410.md" 'Review gates passed\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-410.md" 'GitHub mergeStateStatus'
  summary="$(find "${state}/runs/BOXP-410" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':checked-pr-urls \["https://github.com/boxp/example/pull/123" "https://github.com/boxp/example/pull/456"\]'
  assert_file_not_contains "${summary}" 'GitHub mergeStateStatus'
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
  assert_file_contains "${vault}/Tickets/BOXP-411.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-411.md" 'integration=FAILURE'
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
  assert_file_contains "${vault}/Tickets/BOXP-407.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-407.md" 'No CI checks have been reported'
}

test_review_with_empty_ci_rollup_passes_for_no_ci_repo() {
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

  # Explicit opt-in: repo listed in CODEX_TASK_BOARD_NO_CI_REPOS → empty checks + CLEAN merge passes immediately
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=10 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_TASK_BOARD_NO_CI_REPOS='boxp/example' GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-no-ci-repo.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-450\|BOXP-450: no ci repo\]\].*status::review'
  assert_file_contains "${vault}/Tickets/BOXP-450.md" '^status: review$'
  assert_file_contains "${vault}/Tickets/BOXP-450.md" 'Review gates passed\.'
}

test_review_with_empty_ci_rollup_times_out_without_no_ci_opt_in() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-451|BOXP-451: ci timeout]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-451 in-progress codex boxp/example

  # Without opt-in, empty checks with CLEAN merge should time out (not auto-pass)
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=3 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-ci-timeout.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-451\|BOXP-451: ci timeout\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-451.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-451.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-451.md" 'Timed out waiting for PR gates'
}

test_no_ci_repo_requires_clean_merge_state() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-452|BOXP-452: has hooks no ci]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-452 in-progress codex boxp/example

  # NO_CI_REPOS should NOT skip CI when mergeStateStatus=HAS_HOOKS (only CLEAN is allowed)
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=3 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_TASK_BOARD_NO_CI_REPOS='boxp/example' GH_FAKE_MERGE_STATE=HAS_HOOKS GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-has-hooks-no-ci.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-452\|BOXP-452: has hooks no ci\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-452.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-452.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-452.md" 'Timed out waiting for PR gates'
}

test_canonical_path_hash_symlink_isolation() {
  local tmp vault real_dir symlink_dir lock_dir
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  real_dir="${tmp}/real-vault"
  symlink_dir="${tmp}/link-vault"
  lock_dir="/tmp/task-board-locks"
  mkdir -p "${real_dir}/Tickets"
  ln -s "${real_dir}" "${symlink_dir}"

  cat >"${real_dir}/Tickets/BOXP-889.md" <<'EOF'
---
id: BOXP-889
type: task
status: in-progress
priority: medium
assignee: codex
repo:
closed:
---

# BOXP-889: symlink test

## Notes
EOF

  rm -f "${lock_dir}"/*BOXP-889* 2>/dev/null || true

  bb "${HELPER}" append-note BOXP-889 --vault "${real_dir}" --source "test" --note "real-path-note"
  bb "${HELPER}" append-note BOXP-889 --vault "${symlink_dir}" --source "test" --note "symlink-path-note"

  grep -q "real-path-note" "${real_dir}/Tickets/BOXP-889.md" \
    || fail "real-path note was not written"
  grep -q "symlink-path-note" "${real_dir}/Tickets/BOXP-889.md" \
    || fail "symlink-path note was not written"

  # With getCanonicalPath, symlink and real path resolve to the same canonical path,
  # producing only one lock file (not two distinct ones as with cross-vault).
  local lock_count
  lock_count="$(ls "${lock_dir}" 2>/dev/null | grep -c 'BOXP-889' || echo 0)"
  [ "${lock_count}" -eq 1 ] \
    || fail "expected exactly 1 lock file for symlink/real-path (got ${lock_count}): same canonical path must share a lock"
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
  assert_file_contains "${vault}/Tickets/BOXP-408.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" 'Safe diagnostic: .*/pr-gate-diagnostic\.edn \(category=mergeability; detail=The PR is not mergeable yet\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-408.md" 'still a draft'

  PATH="${bin}:$PATH" GH_FAKE_IS_DRAFT=true CODEX_FAKE_PROMPT_LOG="${prompt_log}" CODEX_FAKE_MESSAGE=$'TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-review-draft-retry-prompt.out

  assert_file_contains "${prompt_log}" 'Pending PR gate retry instruction'
  assert_file_contains "${prompt_log}" 'Target PR URL: https://github.com/boxp/example/pull/123'
  assert_file_contains "${prompt_log}" 'Failed gate: mergeability'
  assert_file_contains "${prompt_log}" 'Failure reason: PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${prompt_log}" 'Safe diagnostic: .*/pr-gate-diagnostic\.edn \(category=mergeability; detail=The PR is not mergeable yet\.'
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
  assert_file_contains "${vault}/Tickets/BOXP-409.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-409.md" 'mergeStateStatus=BEHIND'
}

test_retryable_pr_gate_failure_does_not_persist_raw_reason_in_notes() {
  local tmp vault state bin diagnostic
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-454|BOXP-454: retry note redaction]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-454 in-progress codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit-token=super-secret-token","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-note-redaction.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-454\|BOXP-454: retry note redaction\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-454.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${vault}/Tickets/BOXP-454.md" 'category=ci-check-failure; detail=One or more required CI checks failed\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-454.md" 'super-secret-token'
  assert_file_not_contains "${vault}/Tickets/BOXP-454.md" 'unit-token='
  assert_run_summary_contains "${state}" BOXP-454 ':diagnostic \{:path ".*/pr-gate-diagnostic\.edn", :category "ci-check-failure"'
  diagnostic="$(find "${state}/runs/BOXP-454" -name pr-gate-diagnostic.edn -print | head -n 1)"
  [[ -n "${diagnostic}" ]] || fail "expected a safe PR gate diagnostic artifact"
  assert_file_contains "${diagnostic}" ':category "ci-check-failure"'
  assert_file_not_contains "${diagnostic}" 'super-secret-token'
  assert_file_not_contains "${diagnostic}" 'unit-token='
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
  assert_file_contains "${vault}/Tickets/BOXP-414.md" 'category=pr-gate-retry-limit'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" 'inspect run artifacts:'
  assert_run_summary_contains "${state}" BOXP-414 ':retry-exhausted\? true'
}

test_review_gate_retry_limit_is_scoped_to_failure_reason() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-453|BOXP-453: retry reason scope]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-453 in-progress codex boxp/example

  # Two identical failures consume their own budget. A distinct CI failure
  # must start at 1/2 instead of incorrectly blocking on the third run.
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-reason-unit-1.out
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-reason-unit-2.out
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"integration","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-reason-integration.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-453\|BOXP-453: retry reason scope\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-453.md" 'Retrying with Codex instruction 1/2'
  assert_file_not_contains "${vault}/Tickets/BOXP-453.md" 'category=pr-gate-retry-limit'
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
  CODEX_TASK_BOARD_AUTONOMY_V2=false bb "${RUNNER}" test
  # I1 deliberately has no activation switch, even with a requested opt-in.
  CODEX_TASK_BOARD_AUTONOMY_V2=true bb "${RUNNER}" test >/dev/null
}

test_assignee_model_tick_routing() {
  local tmp vault state bin args_log assignee expected_model
  local pairs=("codex:gpt-5.6-terra" "codex-sol:gpt-6.1-sol" "codex-full:gpt-6.1-sol" "codex-terra:gpt-5.6-terra" "codex-mini:gpt-5.6-luna" "codex-astra:gpt-6-astra")
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
    "codex-sol-low:gpt-6.1-sol:low"
    "codex-full-medium:gpt-6.1-sol:medium"
    "codex-sol-xhigh:gpt-6.1-sol:xhigh"
    "codex-terra-high:gpt-5.6-terra:high"
    "codex-mini-xhigh:gpt-5.6-luna:xhigh"
    "codex-astra-low:gpt-6-astra:low"
    "codex-astra-medium:gpt-6-astra:medium"
    "codex-astra-high:gpt-6-astra:high"
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
  local assignees=("codex-terra-ultra" "unknown-high" "fable-high" "codex-astra-minimal" "codex-astra-xhigh" "codex-sol-minimal" "codex-full-minimal")
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

test_codex_astra_assignee_includes_delegation_policy() {
  local tmp vault state bin prompt_log args_log summary last_message assignee
  for assignee in "codex-astra" "codex-astra-low" "codex-astra-medium" "codex-astra-high"; do
    tmp="$(mktemp -d)"
    vault="${tmp}/vault"
    state="${tmp}/state"
    bin="${tmp}/bin"
    prompt_log="${tmp}/codex-prompt.log"
    args_log="${tmp}/codex-args.log"
    mkdir -p "${bin}"
    make_fake_codex "${bin}"
    make_fake_gh "${bin}"
    write_board "${vault}" "- [ ] [[Tickets/BOXP-160|BOXP-160: codex-astra]] #ticket status::in-progress"
    write_ticket "${vault}" BOXP-160 in-progress "${assignee}"

    PATH="${bin}:$PATH" \
      CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
      CODEX_FAKE_ARG_LOG="${args_log}" \
      CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
      run_tick "${vault}" "${state}" env >"/tmp/task-board-codex-astra-${assignee}.out"

    assert_file_contains "${prompt_log}" "^Task Board assignee/agent: ${assignee}$"
    assert_file_contains "${prompt_log}" 'Highest-capability model routing policy'
    assert_file_contains "${prompt_log}" 'You are the '"${assignee}"' top-tier entry point'
    assert_file_contains "${prompt_log}" 'gpt-6-astra'
    assert_file_contains "${prompt_log}" 'Aggressively delegate to lower-cost models'
    assert_file_contains "${args_log}" "exec.*--model gpt-6-astra"
    assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-160\|BOXP-160: codex-astra\]\].*status::done'
    assert_file_contains "${vault}/Tickets/BOXP-160.md" '^status: done$'
    summary="$(find "${state}/runs/BOXP-160" -name summary.edn -print | sort | tail -n 1)"
    last_message="$(find "${state}/runs/BOXP-160" -name last-message.md -print | sort | tail -n 1)"
    assert_file_contains "${summary}" ':agent "'"${assignee}"'"'
    assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
    if [[ "${assignee}" == codex-astra-* ]]; then
      assert_file_contains "${args_log}" "-c model_reasoning_effort=${assignee##*-}"
    fi
    rm -rf "${tmp}"
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

test_cross_vault_lock_isolation() {
  local tmp vault_a vault_b lock_dir lock_count
  tmp="$(mktemp -d)"
  vault_a="${tmp}/vault-a"
  vault_b="${tmp}/vault-b"
  lock_dir="/tmp/task-board-locks"
  mkdir -p "${vault_a}/Tickets" "${vault_b}/Tickets"
  rm -f "${lock_dir}"/BOXP-888* 2>/dev/null || true

  for vault in "${vault_a}" "${vault_b}"; do
    cat >"${vault}/Tickets/BOXP-888.md" <<'EOF'
---
id: BOXP-888
type: task
status: in-progress
priority: medium
assignee: codex
repo:
closed:
---

# BOXP-888: cross-vault test

## Notes
EOF
  done

  bb "${HELPER}" append-note BOXP-888 --vault "${vault_a}" --source "test" --note "vault-a-note"
  bb "${HELPER}" append-note BOXP-888 --vault "${vault_b}" --source "test" --note "vault-b-note"

  grep -q "vault-a-note" "${vault_a}/Tickets/BOXP-888.md" \
    || fail "vault-a note was not written"
  grep -q "vault-b-note" "${vault_b}/Tickets/BOXP-888.md" \
    || fail "vault-b note was not written"

  # With path-hash prefixing each vault must produce a distinct lock file.
  # Without path hashing both vaults would share one lock file (count == 1).
  lock_count="$(ls "${lock_dir}" 2>/dev/null | grep -c 'BOXP-888' || echo 0)"
  [ "${lock_count}" -ge 2 ] \
    || fail "expected >= 2 distinct lock files for cross-vault tickets (got ${lock_count}): separate vaults must not share a lock"
}

test_concurrent_board_update_no_lost_writes() {
  local tmp vault rounds failures i pid1 pid2 board_content found_1 found_2
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  mkdir -p "${vault}/Tickets" "${vault}/Boards"

  for id in BOXP-701 BOXP-702; do
    title="ticket-${id}"
    cat >"${vault}/Tickets/${id}.md" <<EOF
---
id: ${id}
type: task
status: backlog
priority: medium
assignee: boxp
reporter: boxp
project: BOXP
epic:
sprint:
repo:
estimate:
created: 2026-01-01
due:
closed:
tags:
  - ticket
---

# ${id}: ${title}

## Notes

initial note.
EOF
  done

  rounds=10
  failures=0
  for i in $(seq 1 "${rounds}"); do
    # Reset board to initial state with both tickets in Backlog
    cat >"${vault}/Boards/Task Board.md" <<'BOARD'
# Task Board

## Backlog

- [ ] [[Tickets/BOXP-701|BOXP-701: ticket-BOXP-701]] #ticket status::backlog priority::medium
- [ ] [[Tickets/BOXP-702|BOXP-702: ticket-BOXP-702]] #ticket status::backlog priority::medium

## Ready

## In Progress

## Review

## Blocked

## Done
BOARD
    # Reset tickets to backlog
    sed -i 's/^status: .*/status: backlog/' \
      "${vault}/Tickets/BOXP-701.md" "${vault}/Tickets/BOXP-702.md"

    # Run concurrent updates to different tickets
    bb "${HELPER}" update BOXP-701 --vault "${vault}" --lane "In Progress" >/dev/null 2>&1 &
    pid1=$!
    bb "${HELPER}" update BOXP-702 --vault "${vault}" --lane "In Progress" >/dev/null 2>&1 &
    pid2=$!
    wait "${pid1}" || true
    wait "${pid2}" || true

    board_content="$(cat "${vault}/Boards/Task Board.md")"
    found_1=0; found_2=0
    echo "${board_content}" | grep -q "BOXP-701.*status::in-progress" && found_1=1 || true
    echo "${board_content}" | grep -q "BOXP-702.*status::in-progress" && found_2=1 || true

    if [ "${found_1}" -eq 0 ] || [ "${found_2}" -eq 0 ]; then
      failures=$((failures + 1))
    fi
  done

  [ "${failures}" -eq 0 ] \
    || fail "concurrent board updates lost entries in ${failures}/${rounds} rounds"
}

prune_git() {
  git -c user.name=prune-test -c user.email=prune-test@example.com -c commit.gpgsign=false "$@"
}

make_prune_source_repo() {
  local source="$1"
  git init -q -b main "${source}"
  prune_git -C "${source}" commit -q --allow-empty -m init
  git -C "${source}" remote add origin https://github.com/boxp/example.git
  # Pretend the initial commit was fetched from GitHub.
  git -C "${source}" update-ref refs/remotes/origin/main HEAD
}

write_prune_ticket() {
  local vault="$1"
  local ticket="$2"
  local status="$3"
  local closed="$4"
  write_ticket "${vault}" "${ticket}" "${status}" codex boxp/example
  sed -i "s/^closed:.*/closed: ${closed}/" "${vault}/Tickets/${ticket}.md"
}

# Adds a run worktree the same way prepare-repo-worktree! does and prints its path.
add_prune_run() {
  local state="$1"
  local source="$2"
  local ticket="$3"
  local run="$4"
  local checkout="${state}/workspaces/${ticket}/${run}/ghq/github.com/boxp/example"
  mkdir -p "$(dirname "${checkout}")"
  git -C "${source}" worktree add -q -b "codex-task-board/${ticket}-${run}" "${checkout}" HEAD
  printf '%s\n' "${checkout}"
}

# Commits a file in a checkout and prints the new commit SHA.
prune_commit() {
  local checkout="$1"
  local name="$2"
  printf '%s\n' "${name}" >"${checkout}/${name}"
  git -C "${checkout}" add "${name}"
  prune_git -C "${checkout}" commit -q -m "${name}"
  git -C "${checkout}" rev-parse HEAD
}

run_prune() {
  local vault="$1"
  local state_root="$2"
  shift 2
  CODEX_TASK_BOARD_VAULT="${vault}" \
  CODEX_TASK_BOARD_ROOT="${state_root}" \
  bb "${RUNNER}" prune-workspaces "$@"
}

test_prune_workspaces() {
  local tmp vault state bin source known out old recent today ws co ticket clone snapshot
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  source="${tmp}/source"
  known="${tmp}/known-shas"
  out="${tmp}/prune.out"
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  recent="$(date -u +%Y%m%dT%H%M%SZ)-00000000-0000-0000-0000-000000000000"
  today="$(date -u +%Y-%m-%d)"
  ws="${state}/workspaces"
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-301/${old}"
  : >"${known}"
  make_fake_gh "${bin}"
  make_prune_source_repo "${source}"
  git -C "${source}" rev-parse HEAD >>"${known}"
  write_board "${vault}" ""

  # BOXP-301: old done, clean, commit is on GitHub -> run, branch and ticket dir are deleted.
  # A second checkout (independent clone outside ghq/) and a loose file go with the run.
  write_prune_ticket "${vault}" BOXP-301 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-301 "${old}")"
  prune_commit "${co}" pushed >>"${known}"
  git clone -q "${source}" "${ws}/BOXP-301/${old}/scratch/clone"
  git -C "${ws}/BOXP-301/${old}/scratch/clone" remote set-url origin git@github.com:boxp/example.git
  printf 'memo\n' >"${ws}/BOXP-301/${old}/notes.txt"
  printf '{:status :succeeded}\n' >"${state}/runs/BOXP-301/${old}/summary.edn"

  # BOXP-302: done but closed today -> kept.
  write_prune_ticket "${vault}" BOXP-302 done "${today}"
  add_prune_run "${state}" "${source}" BOXP-302 "${old}" >/dev/null

  # BOXP-303: review with a stale closed date -> kept.
  write_prune_ticket "${vault}" BOXP-303 review 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-303 "${old}" >/dev/null

  # BOXP-304: old done but locked -> kept. The lock is written after the tick
  # below, which would otherwise recover it as stale.
  write_prune_ticket "${vault}" BOXP-304 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-304 "${old}" >/dev/null

  # BOXP-305: old done with an untracked file -> held.
  write_prune_ticket "${vault}" BOXP-305 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-305 "${old}")"
  printf 'wip\n' >"${co}/untracked.txt"

  # BOXP-306: old done with a commit that is not on GitHub -> held.
  write_prune_ticket "${vault}" BOXP-306 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-306 "${old}")"
  prune_commit "${co}" unpushed >/dev/null

  # BOXP-307: old done, HEAD detached at a pushed commit while the run branch
  # points to a local-only commit the worktree never had checked out -> run
  # deleted, branch kept.
  write_prune_ticket "${vault}" BOXP-307 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-307 "${old}")"
  git -C "${co}" checkout -q --detach
  git -C "${source}" update-ref "refs/heads/codex-task-board/BOXP-307-${old}" \
    "$(prune_git -C "${source}" commit-tree -m local-only -p HEAD 'HEAD^{tree}')"

  # BOXP-308: empty directory without a ticket file -> deleted.
  mkdir -p "${ws}/BOXP-308"

  # BOXP-309: non-empty directory without a ticket file -> kept.
  add_prune_run "${state}" "${source}" BOXP-309 "${old}" >/dev/null

  # BOXP-310: old closed date but a recent run (reopened ticket) -> kept.
  write_prune_ticket "${vault}" BOXP-310 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-310 "${recent}" >/dev/null

  # BOXP-311: old done, origin is not GitHub -> held.
  write_prune_ticket "${vault}" BOXP-311 done 2020-01-01
  mkdir -p "${ws}/BOXP-311/${old}"
  git clone -q "${source}" "${ws}/BOXP-311/${old}/clone"

  # BOXP-312: old done, independent clone with a local-only branch other than HEAD -> held.
  write_prune_ticket "${vault}" BOXP-312 done 2020-01-01
  mkdir -p "${ws}/BOXP-312/${old}"
  clone="${ws}/BOXP-312/${old}/clone"
  git clone -q "${source}" "${clone}"
  git -C "${clone}" remote set-url origin https://github.com/boxp/example.git
  git -C "${clone}" checkout -q -b side
  prune_commit "${clone}" side-only >/dev/null
  git -C "${clone}" checkout -q main

  # BOXP-315: old done, independent clone with a local-only commit that only a tag points to -> held.
  write_prune_ticket "${vault}" BOXP-315 done 2020-01-01
  mkdir -p "${ws}/BOXP-315/${old}"
  clone="${ws}/BOXP-315/${old}/clone"
  git clone -q "${source}" "${clone}"
  git -C "${clone}" remote set-url origin https://github.com/boxp/example.git
  git -C "${clone}" checkout -q --detach
  prune_commit "${clone}" tag-only >/dev/null
  git -C "${clone}" tag local-release
  git -C "${clone}" checkout -q main

  # BOXP-314: old done, HEAD is covered by a stale remote-tracking ref but the
  # commit is gone from GitHub -> held. Tracking refs alone are not proof.
  write_prune_ticket "${vault}" BOXP-314 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-314 "${old}")"
  git -C "${source}" update-ref refs/remotes/origin/stale "$(prune_commit "${co}" force-pushed-away)"

  # A one-shot tick must not prune.
  PATH="${bin}:$PATH" run_tick "${vault}" "${state}" env >"${tmp}/tick.out"
  [[ -d "${ws}/BOXP-301/${old}" ]] || fail "one-shot tick must not prune workspaces"
  assert_file_not_contains "${tmp}/tick.out" 'prune:'
  printf '{:ticket "BOXP-304"}\n' >"${state}/locks/BOXP-304.edn"

  # Dry run reports the plan and deletes nothing.
  snapshot="$(cd "${state}" && find workspaces locks runs | sort)"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" --dry-run >"${out}" \
    || fail "prune-workspaces --dry-run failed"
  [[ "$(cd "${state}" && find workspaces locks runs | sort)" == "${snapshot}" ]] \
    || fail "dry run must not change workspaces, locks or runs"
  git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-301-${old}" \
    || fail "dry run must not delete branches"
  assert_file_contains "${out}" "^prune: delete ${ws}/BOXP-301/${old} \\(dry-run\\)$"
  assert_file_contains "${out}" "^prune: delete-empty ${ws}/BOXP-301 \\(dry-run\\)$"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-305/${old} reason=uncommitted-changes checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-306/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${out}" '^prune: summary deleted=2 held=6 skipped=4 recent-runs=1 branches=1 empty-dirs=3 dry-run=true skipped-detail=locked:1,not-done:1,ticket-missing:1,within-retention:1$'

  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" GH_FAKE_API_LOG="${tmp}/api.log" \
    run_prune "${vault}" "${state}" >"${out}" || fail "prune-workspaces failed"

  [[ ! -e "${ws}/BOXP-301" ]] || fail "expected old done clean run and its ticket directory to be deleted"
  if git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-301-${old}"; then
    fail "expected run branch with a pushed tip to be deleted"
  fi
  [[ -d "${ws}/BOXP-302/${old}" ]] || fail "expected done run inside retention to remain"
  [[ -d "${ws}/BOXP-303/${old}" ]] || fail "expected non-done run to remain"
  [[ -d "${ws}/BOXP-304/${old}" ]] || fail "expected locked ticket run to remain"
  [[ -f "${ws}/BOXP-305/${old}/ghq/github.com/boxp/example/untracked.txt" ]] \
    || fail "expected run with uncommitted changes to remain"
  [[ -d "${ws}/BOXP-306/${old}" ]] || fail "expected run with a commit missing on GitHub to remain"
  [[ ! -e "${ws}/BOXP-307" ]] || fail "expected run with pushed HEAD to be deleted"
  git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-307-${old}" \
    || fail "expected run branch with a local-only tip to remain"
  [[ ! -e "${ws}/BOXP-308" ]] || fail "expected empty ticket directory to be deleted"
  [[ -d "${ws}/BOXP-309/${old}" ]] || fail "expected run of a missing ticket to remain"
  [[ -d "${ws}/BOXP-310/${recent}" ]] || fail "expected recent run of an old done ticket to remain"
  [[ -d "${ws}/BOXP-311/${old}" ]] || fail "expected run with a non-GitHub origin to remain"
  [[ -d "${ws}/BOXP-312/${old}" ]] || fail "expected clone with a local-only branch to remain"
  [[ -d "${ws}/BOXP-315/${old}" ]] || fail "expected clone with a local-only tag to remain"
  [[ -d "${ws}/BOXP-314/${old}" ]] || fail "expected run whose HEAD is only on a stale tracking ref to remain"
  for ticket in BOXP-301 BOXP-307; do
    if git -C "${source}" worktree list --porcelain | grep -q "/workspaces/${ticket}/"; then
      fail "expected ${ticket} worktree to be unregistered from the source repository"
    fi
  done
  git -C "${source}" worktree list --porcelain | grep -q "/workspaces/BOXP-305/" \
    || fail "expected held worktree to stay registered"
  [[ -f "${state}/runs/BOXP-301/${old}/summary.edn" ]] || fail "prune must not touch runs/"
  [[ -f "${state}/locks/BOXP-304.edn" ]] || fail "prune must not touch locks/"
  [[ ! -e "${state}/state.edn" ]] || fail "prune must not write state.edn"
  assert_file_contains "${out}" "^prune: delete ${ws}/BOXP-301/${old}$"
  assert_file_contains "${out}" "^prune: delete-branch ${source}/.git codex-task-board/BOXP-301-${old}$"
  assert_file_contains "${out}" "^prune: keep-branch ${source}/.git codex-task-board/BOXP-307-${old} reason=tip-not-on-github "
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-311/${old} reason=origin-not-github checkout=clone$"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-312/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=clone$"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-314/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${out}" '^prune: summary deleted=2 held=6 skipped=4 recent-runs=1 branches=1 empty-dirs=3 dry-run=false '
  # Each SHA is looked up at most once per pass.
  [[ -z "$(sort "${tmp}/api.log" | uniq -d)" ]] || fail "expected GitHub lookups to be cached per prune pass"

  # A second pass is idempotent and keeps reporting held runs.
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "second prune-workspaces failed"
  assert_file_contains "${out}" '^prune: summary deleted=0 held=6 skipped=4 recent-runs=1 branches=0 empty-dirs=0 dry-run=false '

  # gh failures (auth, rate limit, network) are not treated as proof either way.
  write_prune_ticket "${vault}" BOXP-313 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-313 "${old}")"
  prune_commit "${co}" pushed-313 >>"${known}"
  cat >"${bin}/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh: API rate limit exceeded (HTTP 403)" >&2
exit 1
EOF
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "prune-workspaces with failing gh failed"
  [[ -d "${ws}/BOXP-313/${old}" ]] || fail "expected run to remain when gh cannot verify commits"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-313/${old} reason=github-check-failed sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
}

# Adds `count` empty commits to a checkout.
prune_empty_commits() {
  local checkout="$1"
  local count="$2"
  local i
  for ((i = 0; i < count; i++)); do
    prune_git -C "${checkout}" commit -q --allow-empty -m "empty ${i}"
  done
}

test_prune_holds_checkout_over_commit_limit() {
  local tmp vault state bin source known out old ws co
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  source="${tmp}/source"
  known="${tmp}/known-shas"
  out="${tmp}/prune.out"
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  ws="${state}/workspaces"
  mkdir -p "${bin}" "${state}/locks"
  make_fake_gh "${bin}"
  make_prune_source_repo "${source}"
  write_board "${vault}" ""

  # The commit the worktree was created at is in the HEAD reflog, so it counts
  # towards the limit together with the unpushed commits.
  # BOXP-331: exactly 200 commits to verify, all on GitHub -> deleted.
  write_prune_ticket "${vault}" BOXP-331 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-331 "${old}")"
  prune_empty_commits "${co}" 199
  git -C "${co}" log -g --format=%H HEAD | sort -u >"${known}"
  [[ "$(wc -l <"${known}")" -eq 200 ]] || fail "expected 200 commits to verify in the fixture"

  # BOXP-332: 201 commits to verify -> held without asking GitHub about any of them.
  write_prune_ticket "${vault}" BOXP-332 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-332 "${old}")"
  prune_empty_commits "${co}" 200
  git -C "${co}" rev-list HEAD --not --remotes >"${tmp}/over-limit-shas"
  cat "${tmp}/over-limit-shas" >>"${known}"

  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" GH_FAKE_API_LOG="${tmp}/api.log" \
    run_prune "${vault}" "${state}" >"${out}" || fail "prune-workspaces at the commit limit failed"

  [[ ! -e "${ws}/BOXP-331" ]] || fail "expected run with exactly 200 commits to verify to be deleted"
  [[ -d "${ws}/BOXP-332/${old}" ]] || fail "expected run with 201 commits to verify to remain"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-332/${old} reason=too-many-unpushed-commits checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${out}" '^prune: summary deleted=1 held=1 '
  if grep -qxFf "${tmp}/over-limit-shas" "${tmp}/api.log"; then
    fail "expected no GitHub lookups for a checkout over the commit limit"
  fi
}

test_prune_inspects_nested_checkouts() {
  local tmp vault state bin source known out old ws co nested ticket
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  source="${tmp}/source"
  known="${tmp}/known-shas"
  out="${tmp}/prune.out"
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  ws="${state}/workspaces"
  mkdir -p "${bin}" "${state}/locks"
  make_fake_gh "${bin}"
  make_prune_source_repo "${source}"
  # The parent checkout ignores vendor/, so its own git status never shows
  # what a clone placed there contains.
  printf 'vendor/\n' >"${source}/.gitignore"
  git -C "${source}" add .gitignore
  prune_git -C "${source}" commit -q -m ignore-vendor
  git -C "${source}" update-ref refs/remotes/origin/main HEAD
  git -C "${source}" rev-parse HEAD >"${known}"
  write_board "${vault}" ""

  # BOXP-341: gitignored nested clone with an untracked file -> held.
  write_prune_ticket "${vault}" BOXP-341 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-341 "${old}")"
  nested="${co}/vendor/clone"
  git clone -q "${source}" "${nested}"
  git -C "${nested}" remote set-url origin https://github.com/boxp/example.git
  printf 'wip\n' >"${nested}/untracked.txt"
  [[ -z "$(git -C "${co}" status --porcelain)" ]] || fail "expected the parent checkout to ignore the nested clone"

  # BOXP-342: gitignored nested clone with a commit that is not on GitHub -> held.
  write_prune_ticket "${vault}" BOXP-342 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-342 "${old}")"
  nested="${co}/vendor/clone"
  git clone -q "${source}" "${nested}"
  git -C "${nested}" remote set-url origin https://github.com/boxp/example.git
  prune_commit "${nested}" nested-unpushed >/dev/null

  # BOXP-343: gitignored nested clone with a stash -> held.
  write_prune_ticket "${vault}" BOXP-343 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-343 "${old}")"
  nested="${co}/vendor/clone"
  git clone -q "${source}" "${nested}"
  git -C "${nested}" remote set-url origin https://github.com/boxp/example.git
  printf 'vendor/\nstashed\n' >"${nested}/.gitignore"
  prune_git -C "${nested}" stash -q

  # BOXP-344: clean nested clone and a clean nested worktree of the source
  # repository, all on GitHub -> deleted, both worktrees unregistered.
  write_prune_ticket "${vault}" BOXP-344 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-344 "${old}")"
  git clone -q "${source}" "${co}/vendor/clone"
  git -C "${co}/vendor/clone" remote set-url origin https://github.com/boxp/example.git
  git -C "${source}" worktree add -q --detach "${co}/vendor/worktree" HEAD

  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" --dry-run >"${out}" \
    || fail "prune-workspaces --dry-run with nested checkouts failed"
  assert_file_contains "${out}" '^prune: summary deleted=1 held=3 '

  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "prune-workspaces with nested checkouts failed"

  [[ -f "${ws}/BOXP-341/${old}/ghq/github.com/boxp/example/vendor/clone/untracked.txt" ]] \
    || fail "expected run with uncommitted changes in a nested clone to remain"
  [[ -f "${ws}/BOXP-342/${old}/ghq/github.com/boxp/example/vendor/clone/nested-unpushed" ]] \
    || fail "expected run with an unpushed commit in a nested clone to remain"
  git -C "${ws}/BOXP-343/${old}/ghq/github.com/boxp/example/vendor/clone" rev-parse -q --verify refs/stash >/dev/null \
    || fail "expected run with a stash in a nested clone to remain"
  [[ ! -e "${ws}/BOXP-344" ]] || fail "expected run with clean nested checkouts to be deleted"
  if git -C "${source}" worktree list --porcelain | grep -q "/workspaces/BOXP-344/"; then
    fail "expected nested and parent worktrees to be unregistered from the source repository"
  fi
  for ticket in BOXP-341 BOXP-342 BOXP-343; do
    git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/${ticket}-${old}" \
      || fail "expected the branch of held run ${ticket} to remain"
  done
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-341/${old} reason=uncommitted-changes checkout=ghq/github.com/boxp/example/vendor/clone$"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-342/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example/vendor/clone$"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-343/${old} reason=stash-present checkout=ghq/github.com/boxp/example/vendor/clone$"
  assert_file_contains "${out}" "^prune: delete ${ws}/BOXP-344/${old}$"
  assert_file_contains "${out}" '^prune: summary deleted=1 held=3 '
}

test_prune_checks_reflog_commits() {
  local tmp vault state bin source known out old ws co clone branch dropped
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  source="${tmp}/source"
  known="${tmp}/known-shas"
  out="${tmp}/prune.out"
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  ws="${state}/workspaces"
  mkdir -p "${bin}" "${state}/locks"
  make_fake_gh "${bin}"
  make_prune_source_repo "${source}"
  git -C "${source}" rev-parse HEAD >"${known}"
  write_board "${vault}" ""

  # BOXP-351: independent clone whose only local commit was dropped by
  # `git reset --hard` and survives in the reflog alone -> held.
  write_prune_ticket "${vault}" BOXP-351 done 2020-01-01
  mkdir -p "${ws}/BOXP-351/${old}"
  clone="${ws}/BOXP-351/${old}/clone"
  git clone -q "${source}" "${clone}"
  git -C "${clone}" remote set-url origin https://github.com/boxp/example.git
  prune_commit "${clone}" reset-away >/dev/null
  git -C "${clone}" reset -q --hard HEAD~1
  [[ -z "$(git -C "${clone}" rev-list HEAD --branches --tags --not --remotes)" ]] \
    || fail "expected the dropped commit to be reachable from the reflog only"

  # BOXP-352: the same in a run worktree, whose HEAD reflog goes away with it -> held.
  write_prune_ticket "${vault}" BOXP-352 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-352 "${old}")"
  prune_commit "${co}" reset-away >/dev/null
  git -C "${co}" reset -q --hard HEAD~1

  # BOXP-353: amended in a worktree, and the commit from before the amend is
  # on GitHub as well -> run and branch deleted.
  write_prune_ticket "${vault}" BOXP-353 done 2020-01-01
  co="$(add_prune_run "${state}" "${source}" BOXP-353 "${old}")"
  prune_commit "${co}" amended >>"${known}"
  prune_git -C "${co}" commit -q --amend -m amended-again
  git -C "${co}" rev-parse HEAD >>"${known}"

  # BOXP-354: the worktree only ever saw pushed commits, but the run branch
  # was moved to a local-only commit and back from the source repository ->
  # run deleted, branch (and with it the branch reflog) kept.
  write_prune_ticket "${vault}" BOXP-354 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-354 "${old}" >/dev/null
  branch="refs/heads/codex-task-board/BOXP-354-${old}"
  dropped="$(prune_git -C "${source}" commit-tree -m dropped -p HEAD 'HEAD^{tree}')"
  git -C "${source}" update-ref -m test "${branch}" "${dropped}"
  git -C "${source}" update-ref -m test "${branch}" HEAD
  git -C "${source}" log -g --format=%H "${branch}" | grep -qx "${dropped}" \
    || fail "expected the dropped commit in the run branch reflog"

  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" --dry-run >"${out}" \
    || fail "prune-workspaces --dry-run with reflog-only commits failed"
  assert_file_contains "${out}" '^prune: summary deleted=2 held=2 skipped=0 recent-runs=0 branches=1 '

  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "prune-workspaces with reflog-only commits failed"

  [[ -n "$(git -C "${ws}/BOXP-351/${old}/clone" log -g --format=%H --grep-reflog='commit: reset-away' HEAD)" ]] \
    || fail "expected clone with a commit left only in the reflog to remain"
  [[ -n "$(git -C "${ws}/BOXP-352/${old}/ghq/github.com/boxp/example" log -g --format=%H --grep-reflog='commit: reset-away' HEAD)" ]] \
    || fail "expected worktree with a commit left only in the reflog to remain"
  git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-352-${old}" \
    || fail "expected the branch of a held run to remain"
  [[ ! -e "${ws}/BOXP-353" ]] || fail "expected run whose reflog commits are all on GitHub to be deleted"
  if git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-353-${old}"; then
    fail "expected run branch whose reflog commits are all on GitHub to be deleted"
  fi
  [[ ! -e "${ws}/BOXP-354" ]] || fail "expected run whose worktree only saw pushed commits to be deleted"
  git -C "${source}" log -g --format=%H "${branch}" | grep -qx "${dropped}" \
    || fail "expected run branch with a local-only commit in its reflog to remain"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-351/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=clone$"
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-352/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${out}" "^prune: delete-branch ${source}/.git codex-task-board/BOXP-353-${old}$"
  assert_file_contains "${out}" "^prune: keep-branch ${source}/.git codex-task-board/BOXP-354-${old} reason=reflog-commit-not-on-github sha=${dropped}$"
  assert_file_contains "${out}" '^prune: summary deleted=2 held=2 skipped=0 recent-runs=0 branches=1 '
}

test_prune_respects_board_lane() {
  local tmp vault state bin source known out old ws
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  source="${tmp}/source"
  known="${tmp}/known-shas"
  out="${tmp}/prune.out"
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  ws="${state}/workspaces"
  mkdir -p "${bin}" "${state}/locks"
  make_fake_gh "${bin}"
  make_prune_source_repo "${source}"
  git -C "${source}" rev-parse HEAD >"${known}"

  # BOXP-361: frontmatter still says done, but the card was moved back to
  # In Progress and no sync has run since -> kept.
  # BOXP-362: card in Done and frontmatter done -> deleted.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-361|BOXP-361: reopened]] #ticket status::in-progress"
  printf '%s\n' "- [x] [[Tickets/BOXP-362|BOXP-362: finished]] #ticket status::done" >>"${vault}/Boards/Task Board.md"
  write_prune_ticket "${vault}" BOXP-361 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-361 "${old}" >/dev/null
  write_prune_ticket "${vault}" BOXP-362 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-362 "${old}" >/dev/null

  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "prune-workspaces with a reopened card failed"
  [[ -d "${ws}/BOXP-361/${old}" ]] || fail "expected run of a ticket whose card left Done to remain"
  [[ ! -e "${ws}/BOXP-362" ]] || fail "expected run of a ticket whose card is in Done to be deleted"
  assert_file_contains "${out}" '^prune: summary deleted=1 held=0 skipped=1 .* skipped-detail=not-done:1$'

  # Without a readable board nothing is deleted.
  write_prune_ticket "${vault}" BOXP-363 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-363 "${old}" >/dev/null
  rm "${vault}/Boards/Task Board.md"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "prune-workspaces without a board failed"
  [[ -d "${ws}/BOXP-363/${old}" ]] || fail "expected run to remain when the board is missing"
  assert_file_contains "${out}" '^prune: summary deleted=0 held=0 skipped=2 .* skipped-detail=board-unreadable:2$'
}

test_prune_invalid_settings_fall_back_to_defaults() {
  local tmp vault state out
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  out="${tmp}/prune.out"
  write_board "${vault}" ""

  CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS=soon \
    run_prune "${vault}" "${state}" --dry-run >"${out}" || fail "prune with invalid retention failed"
  assert_file_contains "${out}" '^prune: warning invalid CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS="soon", using default 3$'
  assert_file_contains "${out}" '^prune: start retention-days=3 dry-run=true$'

  CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS=10 \
    run_prune "${vault}" "${state}" --dry-run >"${out}" || fail "prune with custom retention failed"
  assert_file_contains "${out}" '^prune: start retention-days=10 dry-run=true$'
  assert_file_not_contains "${out}" 'warning'
}

# Starts `loop` with a prunable run; the runner PID is written to ${tmp}/runner.pid.
start_prune_loop() {
  local tmp="$1"
  shift
  local vault="${tmp}/vault" state="${tmp}/state" bin="${tmp}/bin" source="${tmp}/source"
  local old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  mkdir -p "${bin}"
  make_fake_gh "${bin}"
  make_prune_source_repo "${source}"
  git -C "${source}" rev-parse HEAD >"${tmp}/known-shas"
  write_board "${vault}" ""
  write_prune_ticket "${vault}" BOXP-321 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-321 "${old}" >/dev/null

  PATH="${bin}:$PATH" \
    GH_FAKE_KNOWN_SHAS="${tmp}/known-shas" \
    CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=prune-pod \
    CODEX_TASK_BOARD_POLL_SECONDS=1 \
    "$@" bb "${RUNNER}" loop >"${tmp}/runner.out" 2>&1 &
  printf '%s\n' "$!" >"${tmp}/runner.pid"
}

stop_prune_loop() {
  local pid
  pid="$(cat "$1/runner.pid")"
  kill -TERM "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
}

test_loop_prunes_in_background() {
  local tmp attempt
  tmp="$(mktemp -d)"
  start_prune_loop "${tmp}" env CODEX_TASK_BOARD_WORKSPACE_PRUNE_INTERVAL_SECONDS=2

  # The interval is 2s, so a second pass proves the schedule repeats.
  for attempt in $(seq 1 150); do
    [[ "$(grep -c '^prune: summary ' "${tmp}/runner.out" || true)" -ge 2 ]] && break
    sleep 0.1
  done
  stop_prune_loop "${tmp}"

  [[ ! -e "${tmp}/state/workspaces/BOXP-321" ]] || fail "expected loop to prune the old done run"
  assert_file_contains "${tmp}/runner.out" '^workspace prune enabled, retention-days=3, interval-seconds=2$'
  assert_file_contains "${tmp}/runner.out" '^prune: summary deleted=1 held=0 skipped=0 recent-runs=0 branches=1 '
  assert_file_contains "${tmp}/runner.out" '^prune: summary deleted=0 held=0 skipped=0 '
}

test_loop_prune_can_be_disabled() {
  local tmp attempt
  tmp="$(mktemp -d)"
  start_prune_loop "${tmp}" env CODEX_TASK_BOARD_WORKSPACE_PRUNE=0

  for attempt in $(seq 1 150); do
    [[ "$(grep -c '^no supported-agent-assigned Task Board tickets$' "${tmp}/runner.out" || true)" -ge 3 ]] && break
    sleep 0.1
  done
  stop_prune_loop "${tmp}"

  [[ -d "${tmp}/state/workspaces/BOXP-321" ]] || fail "expected disabled prune to keep the run"
  assert_file_contains "${tmp}/runner.out" '^workspace prune disabled by CODEX_TASK_BOARD_WORKSPACE_PRUNE$'
  assert_file_not_contains "${tmp}/runner.out" '^prune: '
}

test_parallel_codex_runs
test_fable_assignee_runs_via_claude
test_explicit_claude_assignees_use_fixed_models_and_pinned_binary
test_fable_model_environment_is_legacy_only
test_explicit_claude_error_and_review_markers_are_processed
test_fable_agent_idle_timeout_retries
test_fable_idle_timeout_stops_agent_children
test_invalid_idle_timeout_does_not_start_agent
test_fable_progress_prevents_idle_timeout
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
test_fable_reported_blocked_is_audited
test_blocker_note_failure_keeps_current_lane
test_runner_internal_error_is_audited
test_blocker_reason_redacts_github_pat_and_spaced_api_key
test_blocker_note_failure_restores_original_lane
test_blocked_state_failure_records_a_single_audit_note_and_restores_lane
test_nonretryable_pr_gate_blocked_state_failure_keeps_summary_consistent
test_review_with_pr_url_is_noted
test_review_without_repo_marker_skips_pr_gates
test_review_with_conflict_is_blocked
test_pr_gate_api_failure_is_audited
test_fable_review_gate_retry_keeps_fable_assignee
test_review_with_ci_failure_is_blocked
test_review_with_codex_review_issue_is_blocked
test_review_with_pr_and_none_marker_checks_pr
test_review_with_multiple_pr_urls_checks_all
test_review_with_multiple_pr_urls_blocks_on_second_failure
test_review_gate_keeps_lock_heartbeat_active
test_review_gate_passes_codex_model_profile_to_review
test_review_with_empty_ci_rollup_times_out
test_review_with_empty_ci_rollup_passes_for_no_ci_repo
test_review_with_empty_ci_rollup_times_out_without_no_ci_opt_in
test_no_ci_repo_requires_clean_merge_state
test_canonical_path_hash_symlink_isolation
test_review_with_draft_pr_is_retried
test_review_with_behind_merge_state_times_out
test_retryable_pr_gate_failure_does_not_persist_raw_reason_in_notes
test_review_gate_retry_limit_blocks
test_review_gate_retry_limit_is_scoped_to_failure_reason
test_review_gate_pass_after_retry_moves_review
test_groom_prompt_contains_investigation_steps
test_implement_prompt_includes_append_note
test_fable_implement_prompt_includes_append_note
test_groom_prompt_includes_append_note
test_assignee_model_routing
test_assignee_model_tick_routing
test_assignee_reasoning_tick_routing
test_invalid_reasoning_assignees_are_ignored
test_codex_astra_assignee_includes_delegation_policy
test_concurrent_append_note_no_lost_writes
test_cross_vault_lock_isolation
test_concurrent_board_update_no_lost_writes
test_prune_workspaces
test_prune_holds_checkout_over_commit_limit
test_prune_inspects_nested_checkouts
test_prune_checks_reflog_commits
test_prune_respects_board_lane
test_prune_invalid_settings_fall_back_to_defaults
test_loop_prunes_in_background
test_loop_prune_can_be_disabled

echo "task-board-runner tests passed"
