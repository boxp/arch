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
export TASK_BOARD_DELEGATION_HELPER="${ROOT_DIR}/docker/codex-workspace/task-board/delegate.py"

root_guard_test() {
  local t bin before after cmd mode
  t="$(mktemp -d)"
  bin="$t/bin"
  mkdir -p "$bin" "$t/vault/Boards" "$t/vault/Tickets" "$t/tmp"
  cat > "$bin/id" <<'FAKE'
#!/bin/sh
printf '%s\n' "${FAKE_UID_VALUE:-0}"
FAKE
  chmod +x "$bin/id"
  cat > "$t/vault/Boards/Task Board.md" <<'BOARD'
# Task Board

## Backlog

- [ ] [[Tickets/BOXP-1|BOXP-1: Test]] #ticket status::backlog priority::medium

## Ready

## In Progress

## Blocked

## Done
BOARD
  cat > "$t/vault/Tickets/BOXP-1.md" <<'TICKET'
---
id: BOXP-1
type: task
status: backlog
priority: medium
---

# BOXP-1: Test

## Notes
TICKET
  before="$(cd "$t/vault" && find . -type f -print0 | sort -z | xargs -0 sha256sum)"
  for cmd in create update append-note request-codex delete reconcile-done; do
    for mode in normal dry; do
      local extra=()
      [[ "$mode" == dry ]] && extra=(--dry-run)
      if PATH="$bin:$PATH" bb -Djava.io.tmpdir="$t/tmp" "$HELPER" "$cmd" BOXP-1 --vault "$t/vault" "${extra[@]}" >"$t/out" 2>"$t/err"; then
        echo "root $cmd $mode unexpectedly succeeded" >&2; return 1
      fi
      grep -Fq 'kubectl -n hermes-agent exec deploy/hermes-agent -c hermes-agent -- /command/s6-setuidgid hermes bb /opt/data/skills/note-taking/obsidian-task-board/bin/task-board.bb <command> ...' "$t/err"
      [[ ! -e "$t/tmp/task-board-locks" ]]
    done
  done
  PATH="$bin:$PATH" bb -Djava.io.tmpdir="$t/tmp" "$HELPER" list --vault "$t/vault" >/dev/null
  PATH="$bin:$PATH" bb -Djava.io.tmpdir="$t/tmp" "$HELPER" show BOXP-1 --vault "$t/vault" >/dev/null
  [[ ! -e "$t/tmp/task-board-locks" ]]
  after="$(cd "$t/vault" && find . -type f -print0 | sort -z | xargs -0 sha256sum)"
  [[ "$before" == "$after" ]]
  FAKE_UID_VALUE=1000 PATH="$bin:$PATH" bb -Djava.io.tmpdir="$t/tmp" "$HELPER" append-note BOXP-1 --vault "$t/vault" --source test --note 'non-root write' >/dev/null
  grep -Fq 'non-root write' "$t/vault/Tickets/BOXP-1.md"
  rm -rf "$t"
}


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
json=false
if [[ -n "${CODEX_FAKE_ARG_LINES:-}" ]]; then printf '%s\n' "$@" >"${CODEX_FAKE_ARG_LINES}"; fi
if [[ -n "${CODEX_FAKE_ARG_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"${CODEX_FAKE_ARG_LOG}"
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      json=true
      shift
      ;;
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
if grep -q 'Delegation contract:' "${prompt}"; then
  python3 "${TASK_BOARD_DELEGATION_HELPER}" exempt small-task
fi
mkdir -p "$(dirname "${last_message}")"
if grep -q '^CODEX_REVIEW_GATE$' "${prompt}"; then
  printf '%s\n' "${CODEX_FAKE_REVIEW_MESSAGE:-CODEX_REVIEW_RESULT: clean}" >"${last_message}"
  if [[ "${json}" == true && "${CODEX_FAKE_REVIEW_NO_JSON:-0}" != 1 ]]; then
    printf '%s\n' '{"type":"thread.started","thread_id":"fake-review-thread"}' '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":20,"output_tokens":30,"reasoning_output_tokens":5}}'
  fi
  rm -f "${prompt}"
  exit 0
fi
if [[ -n "${CODEX_FAKE_START_LOG:-}" ]]; then
  printf '%s %s\n' "${ticket}" "$(date +%s)" >>"${CODEX_FAKE_START_LOG}"
fi
if [[ -n "${CODEX_FAKE_LOCK_SNAPSHOT:-}" && -n "${CODEX_FAKE_LOCK_FILE:-}" ]]; then
  cp "${CODEX_FAKE_LOCK_FILE}" "${CODEX_FAKE_LOCK_SNAPSHOT}"
fi
if [[ -n "${CODEX_FAKE_TODO_VAULT:-}" ]]; then
  rev="$(bb "${CODEX_FAKE_TODO_MODULE}" status "${ticket}" --vault "${CODEX_FAKE_TODO_VAULT}" --json | bb -e '(require (quote cheshire.core)) (println (:rev (cheshire.core/parse-string (slurp *in*) true)))')"
  bb "${CODEX_FAKE_TODO_MODULE}" ack "${ticket}" --vault "${CODEX_FAKE_TODO_VAULT}" --rev "${rev}" >/dev/null
  bb "${CODEX_FAKE_TODO_MODULE}" done "${ticket}" TD-01 --vault "${CODEX_FAKE_TODO_VAULT}" --evidence test >/dev/null
fi
sleep "${CODEX_FAKE_SLEEP:-0}"
printf '%s\n' "${CODEX_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}" >"${last_message}"
rm -f "${prompt}"
exit "${CODEX_FAKE_EXIT:-0}"
EOF
  chmod +x "${bin_dir}/codex"
}

make_fake_claude() {
  local bin_dir="$1"
  cat >"${bin_dir}/claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${CLAUDE_FAKE_IGNORES_TERM:-false}" == true ]]; then
  trap '' TERM
fi
if [[ -n "${CLAUDE_FAKE_ARG_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"${CLAUDE_FAKE_ARG_LOG}"
fi
if [[ -n "${CLAUDE_FAKE_EXECUTABLE_LOG:-}" ]]; then
  printf '%s\n' "$0" >>"${CLAUDE_FAKE_EXECUTABLE_LOG}"
fi

prompt="$(cat)"
if [[ "${prompt}" == *'Delegation contract:'* ]]; then
  case "${TEST_DELEGATION_MODE:-exempt}" in
    run) printf 'test subtask' | python3 "${TASK_BOARD_DELEGATION_HELPER}" run >&2 || true ;;
    missing) ;;
    *) python3 "${TASK_BOARD_DELEGATION_HELPER}" exempt small-task ;;
  esac
fi
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
if [[ "${CLAUDE_FAKE_STREAM_JSON:-false}" == true ]]; then
  if [[ -n "${CLAUDE_FAKE_STREAM_PROGRESS_COUNT:-}" ]]; then
    for _ in $(seq 1 "${CLAUDE_FAKE_STREAM_PROGRESS_COUNT}"); do
      sleep "${CLAUDE_FAKE_STREAM_PROGRESS_INTERVAL:-0}"
      printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"streaming progress"}]}}'
    done
  fi
  printf '%s\n' '  {"type":"rate_limit_event","rate_limit_info":{"status":"allowed","secretField":"SECRET_RATE_LIMIT","unifiedWindows":{"five_hour":{"utilization":0.2,"note":"SECRET_WINDOW"}}},"session_id":"secret","uuid":"secret-uuid"}'
  sleep "${CLAUDE_FAKE_STREAM_DELAY:-0}"
  printf '%s\n' '   {"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-0","name":"Bash","input":{"command":"SECRET_WS_INPUT"}}]}}'
  printf '%s\n' '{"type":"assistant","session_id":"secret","uuid":"secret-uuid","message":{"content":[{"type":"text","text":"working","citations":"SECRET_TEXT_EXTRA"},{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"SECRET_TOOL_INPUT"}}]}}' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"SECRET_TOOL_OUTPUT"}]},"tool_use_result":"SECRET_TOOL_OUTPUT"}' '{"type":"result","result":"TASK_BOARD_RESULT: done"}'
else
  printf '%s\n' "${CLAUDE_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}"
fi
exit "${CLAUDE_FAKE_EXIT:-0}"
EOF
  chmod +x "${bin_dir}/claude"
}

make_fake_curl() {
  # BOXP-405: stands in for the Grafana datasource proxy read. Serves
  # CURL_FAKE_RESPONSE_FILE, or fails with CURL_FAKE_EXIT; logs its arguments.
  local bin_dir="$1"
  cat >"${bin_dir}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${CURL_FAKE_ARG_LOG:-}" ]]; then
  printf '%s\n' "$*" >>"${CURL_FAKE_ARG_LOG}"
fi
if [[ "${CURL_FAKE_EXIT:-0}" != 0 ]]; then
  echo "curl: (${CURL_FAKE_EXIT}) fake failure" >&2
  exit "${CURL_FAKE_EXIT}"
fi
cat "${CURL_FAKE_RESPONSE_FILE}"
EOF
  chmod +x "${bin_dir}/curl"
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

if [[ "$1 $2" == "pr view" && "$*" == *"--json headRefOid"* ]]; then
  printf '%s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  exit 0
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
  state_var="GH_FAKE_PR_STATE_${pr_number}"
  draft="${GH_FAKE_IS_DRAFT:-false}"
  merge_state="${GH_FAKE_MERGE_STATE:-CLEAN}"
  pr_state="${GH_FAKE_PR_STATE:-OPEN}"
  if [[ -n "${!draft_var:-}" ]]; then
    draft="${!draft_var}"
  fi
  if [[ -n "${!merge_var:-}" ]]; then
    merge_state="${!merge_var}"
  fi
  if [[ -n "${!state_var:-}" ]]; then
    pr_state="${!state_var}"
  fi
  # Real GitHub returns mergeStateStatus=UNKNOWN (and a mergedAt) for merged PRs.
  merged_at="null"
  if [[ "${pr_state}" == "MERGED" ]]; then
    merged_at='"2026-10-22T10:50:58Z"'
    merge_state="UNKNOWN"
  fi
  cat <<JSON
{
  "url": "${3}",
  "state": "${pr_state}",
  "mergedAt": ${merged_at},
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

if [[ "$1" == "api" && "$2" =~ ^repos/boxp/(example|arch)/commits/([0-9a-f]{40})$ ]]; then
  sha="${BASH_REMATCH[2]}"
  if [[ -n "${GH_FAKE_API_LOG:-}" ]]; then
    printf '%s\n' "${sha}" >>"${GH_FAKE_API_LOG}"
  fi
  # Records whether another process holds the ticket guard during the lookup.
  # Simulates a run claiming the ticket right after the first lookup.
  if [[ -n "${GH_FAKE_LOCK_ON_LOOKUP:-}" && "${sha}" == "${GH_FAKE_LOCK_ON_SHA:-}" && ! -e "${GH_FAKE_LOCK_ON_LOOKUP}" ]]; then
    printf "%s\n" "${GH_FAKE_LOCK_CONTENT}" >"${GH_FAKE_LOCK_ON_LOOKUP}"
  elif [[ -n "${GH_FAKE_GUARD_PROBE_FILE:-}" && -e "${GH_FAKE_GUARD_PROBE_FILE}" ]]; then
    bb -e '(with-open [f (java.io.RandomAccessFile. (first *command-line-args*) "rw") c (.getChannel f)] (println (if (.tryLock c) "free" "held")))' "${GH_FAKE_GUARD_PROBE_FILE}" >>"${GH_FAKE_GUARD_PROBE_LOG}"
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

test_review_lane_retirement_contract() {
  local tmp vault state bin prompt_log pr_message
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/prompt"
  pr_message=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: continue'
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"

  # Gate pass and unmerged: back to Ready with the same assignee, nobody is waited for.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-501|BOXP-501: continue]] #ticket status::in-progress"
  sed -i '/^## Review$/d' "${vault}/Boards/Task Board.md"
  write_ticket "${vault}" BOXP-501 in-progress codex
  PATH="${bin}:$PATH" CODEX_FAKE_PROMPT_LOG="${prompt_log}" CODEX_FAKE_MESSAGE="${pr_message}" run_tick "${vault}" "${state}" env >"${tmp}/tick1"
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-501: continue\]\].*status::ready.*assignee::codex'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" '^assignee: codex$'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" 'Ready継続: 担当 codex のまま次 run へ（自動継続 1/8）'
  assert_file_contains "${prompt_log}" 'the board has no Review lane'
  assert_file_contains "${prompt_log}" 'TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: continue, or TASK_BOARD_RESULT: blocked'
  assert_file_not_contains "${prompt_log}" 'TASK_BOARD_RESULT: review'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '^## Review'

  # The next tick continues it and names the head the gates passed.
  PATH="${bin}:$PATH" CODEX_FAKE_PROMPT_LOG="${prompt_log}" CODEX_FAKE_MESSAGE=$'merged and verified\nTASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >"${tmp}/tick2"
  assert_file_contains "${prompt_log}" 'https://github.com/boxp/example/pull/123 @ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" '^status: done$'
  assert_file_not_contains "${state}/continuation-budget.edn" 'BOXP-501'

  # A legacy marker from a run started before the rollout does not re-create Review.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-502|BOXP-502: legacy]] #ticket status::in-progress"
  sed -i '/^## Review$/d' "${vault}/Boards/Task Board.md"
  write_ticket "${vault}" BOXP-502 in-progress codex
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >"${tmp}/tick3"
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-502: legacy\]\].*status::ready.*assignee::codex'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '^## Review'
  assert_file_not_contains "${vault}/Boards/Task Board.md" 'status::review'

  # Fixable gate failure: stays with the worker in In Progress, not with a person.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-503|BOXP-503: fixable]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-503 in-progress codex
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE="${pr_message}" run_tick "${vault}" "${state}" env >"${tmp}/tick4"
  assert_file_contains "${vault}/Tickets/BOXP-503.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-503.md" '^assignee: codex$'

  # The worker's own blocked: named input, resolver and next action, nothing merged.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-504|BOXP-504: scope]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-504 in-progress codex
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >"${tmp}/tick5"
  assert_file_contains "${vault}/Tickets/BOXP-504.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-504.md" 'needed-input=.*resolver=.*next-action='

  # A run that never finishes stops at the finite limit and is resumed only explicitly.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-505|BOXP-505: loop]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-505 in-progress codex
  local round
  for round in 1 2 3; do
    PATH="${bin}:$PATH" CODEX_TASK_BOARD_CONTINUATION_LIMIT=2 CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/loop${round}"
  done
  assert_file_contains "${vault}/Tickets/BOXP-505.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-505.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-505.md" 'category=continuation-limit'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-505'
  # Stays stopped: no candidate action while it belongs to boxp.
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/loop4"
  [[ ! -e "${tmp}/starts" ]] || fail 'a stopped continuation must not start again by itself'
  bb "${HELPER}" update BOXP-505 --vault "${vault}" --lane Blocked --assignee codex >/dev/null
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_CONTINUATION_LIMIT=2 CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/loop5"
  assert_file_contains "${vault}/Tickets/BOXP-505.md" '^status: ready$'

  # A leftover Review card: with a worker it is continued, for boxp it stays visible.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-506|BOXP-506: worker]] #ticket status::in-progress"
  sed -i '/BOXP-506/d; s/^## Review$/## Review\n\n- [ ] [[Tickets\/BOXP-506|BOXP-506: worker]] #ticket status::review\n- [ ] [[Tickets\/BOXP-507|BOXP-507: owner]] #ticket status::review/' "${vault}/Boards/Task Board.md"
  write_ticket "${vault}" BOXP-506 review codex
  write_ticket "${vault}" BOXP-507 review boxp
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/legacy"
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-506: worker\]\].*status::ready'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-507: owner\]\].*status::review'
  bb "${HELPER}" update BOXP-507 --vault "${vault}" --lane Blocked >/dev/null
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-507:.*status::blocked'
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

test_fable_stream_json() {
  local tmp vault state bin last_message
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-149|BOXP-149: stream]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-149 in-progress fable
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true CLAUDE_FAKE_STREAM_DELAY=3 run_tick "${vault}" "${state}" env >/tmp/task-board-stream.out
  assert_file_contains "${vault}/Tickets/BOXP-149.md" '^status: done$'
  last_message="$(find "${state}/runs/BOXP-149" -name last-message.md -print | head -n 1)"
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "unexpected stream result"
  [[ -f "${state}/ai-ops/subscription/claude.json" ]] || fail "missing subscription snapshot"
  local observed finished
  observed="$(bb -e '(require (quote cheshire.core)) (println (:observed_at (cheshire.core/parse-string (slurp (first *command-line-args*)) true)))' "${state}/ai-ops/subscription/claude.json")"
  finished="$(stat -c %Y "$(find "${state}/runs/BOXP-149" -name events.jsonl -print -quit)")"
  (( observed <= finished - 2 )) || fail "subscription observation was delayed until process exit"
}

test_claude_pump_drains_when_events_log_cannot_open() {
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/events.jsonl"
  TEST_RUNNER="${RUNNER}" TEST_STATE="${tmp}/state" TEST_LOG_PATH="${tmp}/events.jsonl" bb -e '
    (require (quote [clojure.java.io :as io]) (quote [clojure.string :as str]) (quote [cheshire.core :as json]))
    (load-file (str (.getParent (io/file (System/getenv "TEST_RUNNER"))) "/ai_subscription_usage.bb"))
    (def subscription-module-loaded? (atom true))
    (defn root [] (System/getenv "TEST_STATE"))
    (def warnings (atom []))
    (defn log! [message] (swap! warnings conj message))
    (defn sanitize-claude-line [line] line)
    (with-open [reader (java.io.PushbackReader. (io/reader (System/getenv "TEST_RUNNER")))]
      (loop []
        (let [form (read {:eof nil} reader)]
          (when form
            (when (and (seq? form) (= (first form) (quote defn)) (contains? (quote #{pump-claude-stream! await-claude-pump!}) (second form)))
              (eval form))
            (when-not (resolve (quote await-claude-pump!)) (recur))))))
    (let [input (java.io.ByteArrayInputStream. (.getBytes (str (apply str (repeat 10000 "{\"type\":\"assistant\"}\n")) "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\"}}\n" "{\"type\":\"result\",\"result\":\"TASK_BOARD_RESULT: done\"}\n") "UTF-8"))]
      (assert (= "TASK_BOARD_RESULT: done" (:result (pump-claude-stream! input (System/getenv "TEST_LOG_PATH")))))
      (assert (zero? (.available input)))
      (assert (= "allowed" (get-in (ai-subscription-usage/snapshot (str (root) "/ai-ops/subscription/claude.json")) [:data :rate_limit_info :status])))
      (assert (= 1 (count (filter #(str/includes? % "claude events log open failed") @warnings)))))
    ;; The pump attributes events to the scope fixed at process start, not to the
    ;; login at receive time.
    (let [home (str (System/getenv "TEST_STATE") "-home")
          state (str (System/getenv "TEST_STATE") "-switch")
          snapshot-path (str state "/ai-ops/subscription/claude.json")
          event-line "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\"}}\n"
          pump! (fn [scope] (with-redefs [root (constantly state)]
                              (pump-claude-stream! (java.io.ByteArrayInputStream. (.getBytes event-line "UTF-8")) (System/getenv "TEST_LOG_PATH") (atom {}) scope)))
          old-home (System/getProperty "user.home")]
      (babashka.fs/create-dirs home)
      (spit (str home "/.claude.json") (json/generate-string {:oauthAccount {:accountUuid "account-b"}}))
      (System/setProperty "user.home" home)
      (try
        (pump! "scope-of-account-a")
        (assert (not (babashka.fs/exists? snapshot-path)) "event of a run started under another account must not be recorded")
        (pump! (ai-subscription-usage/claude-account-scope))
        (assert (babashka.fs/exists? snapshot-path) "event of a run under the current account must be recorded")
        (finally (System/setProperty "user.home" old-home))))
    ;; The caller may stop waiting for the drain (deref timeout): the shared
    ;; summary atom must already hold the result while the stream is still open.
    (let [out (java.io.PipedOutputStream.)
          in (java.io.PipedInputStream. out)
          summary (atom {})
          pump (future (pump-claude-stream! in (System/getenv "TEST_LOG_PATH") summary))]
      (.write out (.getBytes "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"late\"}]}}\n{\"type\":\"result\",\"result\":\"TASK_BOARD_RESULT: blocked\"}\n" "UTF-8"))
      (.flush out)
      (loop [n 0]
        (when (and (not= "TASK_BOARD_RESULT: blocked" (:result @summary)) (< n 200))
          (Thread/sleep 25)
          (recur (inc n))))
      (assert (= "TASK_BOARD_RESULT: blocked" (:result @summary)))
      (assert (= "late" (get-in @summary [:assistant :message :content 0 :text])))
      (assert (not (realized? pump)))
      (.close out)
      (assert (= "TASK_BOARD_RESULT: blocked" (:result (deref pump 5000 nil)))))
    ;; await-claude-pump!: when the drain outlives the grace period, keep
    ;; polling until the late result line arrives instead of reading the atom once.
    (let [out (java.io.PipedOutputStream.)
          in (java.io.PipedInputStream. out)
          summary (atom {})
          pump (future (pump-claude-stream! in (System/getenv "TEST_LOG_PATH") summary))
          _ (.write out (.getBytes "{\"type\":\"assistant\"}\n" "UTF-8"))
          _ (.flush out)
          writer (future (Thread/sleep 700)
                         (.write out (.getBytes "{\"type\":\"result\",\"result\":\"TASK_BOARD_RESULT: review\"}\n" "UTF-8"))
                         (.flush out))
          started (System/currentTimeMillis)
          awaited (await-claude-pump! pump summary 100 10000)]
      (assert (= "TASK_BOARD_RESULT: review" (:result awaited)))
      (assert (< (- (System/currentTimeMillis) started) 9000))
      (assert (not (realized? pump)))
      (deref writer 5000 nil)
      (.close out)
      (deref pump 5000 nil)
      (assert (some #(str/includes? % "final result received") @warnings)))
    ;; ...and gives up at max-ms when no result ever arrives, returning what it has.
    (let [out (java.io.PipedOutputStream.)
          in (java.io.PipedInputStream. out)
          summary (atom {})
          pump (future (pump-claude-stream! in (System/getenv "TEST_LOG_PATH") summary))
          _ (.write out (.getBytes "{\"type\":\"assistant\"}\n" "UTF-8"))
          _ (.flush out)
          started (System/currentTimeMillis)
          awaited (await-claude-pump! pump summary 100 1200)]
      (assert (nil? (:result awaited)))
      (assert (:json? awaited))
      (assert (>= (- (System/currentTimeMillis) started) 1000))
      (.close out)
      (deref pump 5000 nil)
      (assert (some #(str/includes? % "no final result received") @warnings)))'
}

test_claude_result_survives_events_log_failure() {
  local tmp vault state bin last_message RUNNER
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}" "${tmp}/runner"
  cp "$(dirname "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb")"/*.bb "${tmp}/runner/"
  RUNNER="${tmp}/runner/task_board_runner.bb"
  # Make the runner create a directory at the run's events.jsonl path so every
  # log open/write fails while the agent is still streaming its result.
  sed -i '/^(defn run-agent!/,/^    (fs\/create-dirs dir)$/ s|^    (fs/create-dirs dir)$|    (fs/create-dirs dir)\n    (fs/create-dirs stdout-path)|' "${RUNNER}"
  grep -q '(fs/create-dirs stdout-path)' "${RUNNER}" || fail "runner patch for log failure did not apply"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-144|BOXP-144: log failure]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-144 in-progress claude-sonnet
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true run_tick "${vault}" "${state}" env >/tmp/task-board-log-failure.out
  last_message="$(find "${state}/runs/BOXP-144" -name last-message.md -print -quit)"
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "result lost when events log cannot be written"
  assert_file_contains "${vault}/Tickets/BOXP-144.md" '^status: done$'
  [[ -d "$(dirname "${last_message}")/events.jsonl" ]] || fail "events log path was not blocked"
}

test_claude_stream_progress_prevents_idle_timeout_when_log_unwritable() {
  local tmp vault state bin last_message RUNNER
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}" "${tmp}/runner"
  cp "$(dirname "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb")"/*.bb "${tmp}/runner/"
  RUNNER="${tmp}/runner/task_board_runner.bb"
  sed -i '/^(defn run-agent!/,/^    (fs\/create-dirs dir)$/ s|^    (fs/create-dirs dir)$|    (fs/create-dirs dir)\n    (fs/create-dirs stdout-path)|' "${RUNNER}"
  grep -q '(fs/create-dirs stdout-path)' "${RUNNER}" || fail "runner patch for log failure did not apply"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-145|BOXP-145: streaming progress]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-145 in-progress claude-sonnet
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true CLAUDE_FAKE_STREAM_PROGRESS_COUNT=6 CLAUDE_FAKE_STREAM_PROGRESS_INTERVAL=0.5 CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 run_tick "${vault}" "${state}" env >/tmp/task-board-stream-progress-log-failure.out
  last_message="$(find "${state}/runs/BOXP-145" -name last-message.md -print -quit)"
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "result lost when streaming with an unwritable log"
  assert_file_contains "${vault}/Tickets/BOXP-145.md" '^status: done$'
  assert_run_summary_contains "${state}" BOXP-145 ':idle-timeout\? false'
  [[ -d "$(dirname "${last_message}")/events.jsonl" ]] || fail "events log path was not blocked"
}

test_claude_events_log_omits_tool_payloads() {
  local tmp vault state bin events last_message
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-148|BOXP-148: stream privacy]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-148 in-progress fable
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true run_tick "${vault}" "${state}" env >/tmp/task-board-stream-privacy.out
  events="$(find "${state}/runs/BOXP-148" -name events.jsonl -print -quit)"
  last_message="$(find "${state}/runs/BOXP-148" -name last-message.md -print -quit)"
  assert_file_not_contains "${events}" 'SECRET_TOOL_INPUT|SECRET_TOOL_OUTPUT|SECRET_RATE_LIMIT|SECRET_WINDOW|SECRET_WS_INPUT|SECRET_TEXT_EXTRA|"secret"|secret-uuid|session_id|"uuid"'
  assert_file_contains "${events}" '"status":"allowed"'
  assert_file_contains "${events}" '"utilization":0.2'
  assert_file_contains "${events}" '"name":"Bash"'
  assert_file_contains "${events}" 'working'
  assert_file_contains "${events}" 'TASK_BOARD_RESULT: done'
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "unexpected stream result"
  [[ -f "${state}/ai-ops/subscription/claude.json" ]] || fail "missing subscription snapshot"
}

test_claude_run_survives_subscription_snapshot_failure() {
  local tmp vault state bin events last_message
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}" "${state}/ai-ops"
  # A regular file where the snapshot directory should be makes every
  # record-claude-rate-limit! call throw; the run itself must still finish.
  : >"${state}/ai-ops/subscription"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-145|BOXP-145: snapshot failure]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-145 in-progress fable
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true run_tick "${vault}" "${state}" env >/tmp/task-board-snapshot-failure.out
  events="$(find "${state}/runs/BOXP-145" -name events.jsonl -print -quit)"
  last_message="$(find "${state}/runs/BOXP-145" -name last-message.md -print -quit)"
  assert_file_contains "${events}" 'TASK_BOARD_RESULT: done'
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "run must finish when the subscription snapshot cannot be written"
  assert_file_contains "${vault}/Tickets/BOXP-145.md" '^status: done$'
  [[ -f "${state}/ai-ops/subscription" ]] || fail "placeholder must stay a file"
}

test_subscription_metrics_disabled_removes_prom() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-146|BOXP-146: metrics]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-146 in-progress codex
  PATH="${bin}:$PATH" run_tick "${vault}" "${state}" env >/tmp/task-board-metrics-on.out
  [[ -f "${state}/ai-ops/subscription-usage.prom" ]] || fail "missing subscription metrics"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-147|BOXP-147: metrics disabled]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-147 in-progress codex
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_SUBSCRIPTION_METRICS=false run_tick "${vault}" "${state}" env >/tmp/task-board-metrics-off.out
  [[ ! -e "${state}/ai-ops/subscription-usage.prom" ]] || fail "subscription metrics still present"
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

  assert_file_contains "${args_log}" '.*--print --output-format stream-json --verbose.*--agent fable'
  assert_file_not_contains "${args_log}" '--model'
  assert_file_not_contains "${args_log}" 'BOXP-150'
  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: fable$'
  assert_file_contains "${prompt_log}" 'Fable routing policy'
  assert_file_contains "${prompt_log}" 'gpt-6-astra'
  assert_file_contains "${prompt_log}" 'codex-astra'
  assert_file_contains "${prompt_log}" 'Delegate long investigation, implementation, file editing, and test execution to Codex'
  assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
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
      claude-fable) model=claude-fable-5-2; ticket=BOXP-163 ;;
      claude-opus) model=claude-opus-5-5; ticket=BOXP-164 ;;
      claude-sonnet) model=claude-sonnet-5-5; ticket=BOXP-165 ;;
    esac
    write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: ${assignee}]] #ticket status::in-progress"
    write_ticket "${vault}" "${ticket}" in-progress "${assignee}"
    : > "${prompt_log}"

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
    case "${assignee}" in
      claude-fable|claude-opus)
        assert_file_contains "${prompt_log}" 'Delegate independent investigation, implementation, file editing, and test execution to Codex'
        assert_file_contains "${prompt_log}" 'gpt-6.1-terra'
        assert_file_contains "${prompt_log}" 'Retain final judgment and verify delegated results'
        assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
        assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
        ;;
      claude-sonnet)
        assert_file_not_contains "${prompt_log}" 'Delegate independent investigation, implementation, file editing, and test execution to Codex'
        ;;
    esac
    assert_file_not_contains "${prompt_log}" 'Fable routing policy'
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
  assert_file_contains "${vault}/Tickets/BOXP-162.md" '^status: ready$'
  assert_run_summary_contains "${state}" BOXP-162 ':agent "claude-opus"'
  summary="$(find "${state}/runs/BOXP-162" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${summary}" '^TASK_BOARD_RESULT: review$'

  write_board "${vault}" "- [ ] [[Tickets/BOXP-166|BOXP-166: missing marker]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-166 in-progress claude-fable
  PATH="${bin}:$PATH" CLAUDE_FAKE_MESSAGE='completed without a task board marker' run_tick "${vault}" "${state}" env >/tmp/task-board-claude-missing-marker.out
  assert_file_contains "${vault}/Tickets/BOXP-166.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-166.md" '^assignee: claude-fable$'
  assert_run_summary_contains "${state}" BOXP-166 ':status :retrying'

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
  assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
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
  assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
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

# Start `loop` in the background with the given owner / instance and wait until
# the lock for the ticket exists. Sets LOOP_PID (the loop must be a child of the
# calling shell so `wait` works; do not call this inside a subshell).
LOOP_PID=""
start_loop_with_lock() {
  local vault="$1" state="$2" ticket="$3" output="$4" bin="$5"
  shift 5
  local attempt
  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_VAULT="${vault}" \
    CODEX_TASK_BOARD_ROOT="${state}" \
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=old-instance \
    CODEX_TASK_BOARD_POLL_SECONDS=60 \
    "$@" bb "${RUNNER}" loop >"${output}" 2>&1 &
  LOOP_PID=$!
  for attempt in $(seq 1 200); do
    [[ -e "${state}/locks/${ticket}.edn" ]] && break
    sleep 0.1
  done
  if [[ ! -e "${state}/locks/${ticket}.edn" ]]; then
    kill -KILL "${LOOP_PID}" 2>/dev/null || true
    wait "${LOOP_PID}" 2>/dev/null || true
    fail "expected loop runner to lock ${ticket}"
  fi
}

wait_for_file() {
  local file="$1" attempt
  for attempt in $(seq 1 200); do
    [[ -s "${file}" ]] && return 0
    sleep 0.1
  done
  fail "expected ${file} to appear"
}

assert_process_stopped() {
  local pid="$1" what="$2" state
  if kill -0 "${pid}" 2>/dev/null; then
    # An orphan can remain as a zombie until PID 1 reaps it; a zombie is not running.
    state="$(ps -o stat= -p "${pid}" 2>/dev/null | tr -d '[:space:]' || true)"
    [[ "${state}" == Z* ]] || fail "expected ${what} ${pid} to be stopped (state=${state:-unknown})"
  fi
}

test_sigterm_stops_in_flight_agent_and_keeps_lock_for_next_owner() {
  local tmp vault state bin output child_pid_file child_pid pid started elapsed summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  output="${tmp}/runner.out"
  child_pid_file="${tmp}/child.pid"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-301|BOXP-301: shutdown in flight]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-301 in-progress fable

  start_loop_with_lock "${vault}" "${state}" BOXP-301 "${output}" "${bin}" \
    env CLAUDE_FAKE_CHILD_PID_FILE="${child_pid_file}" CLAUDE_FAKE_CHILD_SLEEP=120
  pid="${LOOP_PID}"
  wait_for_file "${child_pid_file}"
  child_pid="$(cat "${child_pid_file}")"

  started="$(date +%s)"
  kill -TERM "${pid}"
  wait "${pid}" 2>/dev/null || true
  elapsed=$(( $(date +%s) - started ))
  [[ "${elapsed}" -lt 15 ]] || fail "expected SIGTERM shutdown with a cooperative agent to finish quickly, took ${elapsed}s"

  # The agent and its child received TERM through the process group.
  assert_process_stopped "${child_pid}" "agent child"
  assert_file_contains "${output}" 'shutdown: signalling TERM to 1 in-flight agent process group'
  assert_file_contains "${output}" 'shutdown: in-flight agents stopped'
  assert_file_contains "${output}" 'shutdown: in-flight card processing finalized'
  assert_file_contains "${output}" 'interrupted by planned workspace shutdown; lock kept for the next owner'
  assert_file_not_contains "${output}" 'did not exit within grace'

  # Marker written, lock kept, run recorded as interrupted by the terminating side.
  assert_file_contains "${state}/terminating-owners/old-pod.edn" ':instance-id "old-instance"'
  [[ -e "${state}/locks/BOXP-301.edn" ]] || fail "expected the lock to stay for the next owner after planned shutdown"
  summary="$(find "${state}/runs/BOXP-301" -name summary.edn -print | sort | head -n 1)"
  assert_file_contains "${summary}" ':status :interrupted'
  assert_file_contains "${summary}" ':reason "planned workspace shutdown"'
  assert_file_contains "${summary}" ':agent-exit-code'

  # No lane / frontmatter / blocked transition from the dying runner.
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: shutdown in flight\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^assignee: fable$'
  assert_file_not_contains "${vault}/Tickets/BOXP-301.md" 'finished with result'
  assert_file_not_contains "${vault}/Tickets/BOXP-301.md" 'Blocked transition recorded'

  # The next owner recovers exactly once through the marker and re-runs the ticket.
  PATH="${bin}:$PATH" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    run_tick "${vault}" "${state}" env >/tmp/task-board-shutdown-next-owner.out
  assert_file_contains "${summary}" ':status :interrupted'
  assert_file_contains "${summary}" ':shutdown \{'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'marked interrupted after planned workspace shutdown of owner old-pod'
  [[ "$(grep -c 'marked interrupted' "${vault}/Tickets/BOXP-301.md")" == 1 ]] || fail "expected a single interrupted note"
  [[ ! -e "${state}/terminating-owners/old-pod.edn" ]] || fail "expected the recovered marker to be removed"
  [[ "$(find "${state}/runs/BOXP-301" -mindepth 1 -maxdepth 1 -type d | wc -l)" == 2 ]] || fail "expected exactly one replacement run"
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: done$'
  [[ ! -e "${state}/locks/BOXP-301.edn" ]] || fail "expected the replacement run to release its lock"
}

test_sigterm_kills_term_resistant_agent_within_grace() {
  local tmp vault state bin output child_pid_file child_pid pid started elapsed summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  output="${tmp}/runner.out"
  child_pid_file="${tmp}/child.pid"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-302|BOXP-302: resistant agent]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-302 in-progress fable

  start_loop_with_lock "${vault}" "${state}" BOXP-302 "${output}" "${bin}" \
    env CLAUDE_FAKE_IGNORES_TERM=true CLAUDE_FAKE_CHILD_IGNORES_TERM=true \
        CLAUDE_FAKE_CHILD_PID_FILE="${child_pid_file}" CLAUDE_FAKE_CHILD_SLEEP=120 \
        CODEX_TASK_BOARD_SHUTDOWN_AGENT_GRACE_SECONDS=2
  pid="${LOOP_PID}"
  wait_for_file "${child_pid_file}"
  child_pid="$(cat "${child_pid_file}")"

  started="$(date +%s)"
  kill -TERM "${pid}"
  wait "${pid}" 2>/dev/null || true
  elapsed=$(( $(date +%s) - started ))
  [[ "${elapsed}" -ge 2 && "${elapsed}" -lt 15 ]] || fail "expected bounded shutdown wait (2s grace) then KILL, took ${elapsed}s"

  assert_process_stopped "${child_pid}" "TERM-resistant agent child"
  assert_file_contains "${output}" 'did not exit within grace; sending KILL'
  assert_file_contains "${output}" 'shutdown: in-flight agents stopped'
  [[ -e "${state}/locks/BOXP-302.edn" ]] || fail "expected the lock to stay for the next owner"
  summary="$(find "${state}/runs/BOXP-302" -name summary.edn -print | sort | head -n 1)"
  assert_file_contains "${summary}" ':status :interrupted'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" '^status: in-progress$'
}

test_expired_foreign_shutdown_marker_is_retired() {
  local tmp vault state old_requested fresh_requested
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  old_requested="$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ)"
  fresh_requested="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${state}/terminating-owners" "${state}/owners"
  write_board "${vault}" ""
  cat >"${state}/terminating-owners/gone-pod.edn" <<EOF
{:owner-id "gone-pod" :instance-id "gone-instance" :host "gone-pod" :requested-at "${old_requested}"}
EOF
  cat >"${state}/owners/gone-pod.edn" <<EOF
{:owner-id "gone-pod" :instance-id "gone-instance" :status :terminating :host "gone-pod" :shutdown-requested-at "${old_requested}"}
EOF
  cat >"${state}/terminating-owners/recent-pod.edn" <<EOF
{:owner-id "recent-pod" :instance-id "recent-instance" :host "recent-pod" :requested-at "${fresh_requested}"}
EOF

  CODEX_TASK_BOARD_OWNER_ID=new-pod \
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    run_tick "${vault}" "${state}" env >/tmp/task-board-expired-marker.out

  [[ ! -e "${state}/terminating-owners/gone-pod.edn" ]] || fail "expected the expired foreign marker to be retired"
  assert_file_contains "${state}/owners/gone-pod.edn" ':status :terminated'
  [[ -e "${state}/terminating-owners/recent-pod.edn" ]] || fail "expected a recent foreign marker to remain for a later scan"
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

  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^assignee: codex$'
  assert_run_summary_contains "${state}" BOXP-301 ':status :retrying'
  PATH="${bin}:$PATH" CODEX_FAKE_PROMPT_LOG="${tmp}/prompt" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >"${tmp}/retry"
  assert_file_contains "${tmp}/prompt" 'Re-check Notes and PR state'
  assert_file_contains "${tmp}/prompt" 'TASK_BOARD_REVIEW_PR: none if no repository change was made, plus exactly one TASK_BOARD_RESULT marker'
  assert_file_contains "${tmp}/prompt" 'trailing reply to a background notification must not replace this report'
  assert_file_not_contains "${tmp}/prompt" 'Target PR URL: nil'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: in-progress$'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >"${tmp}/exhausted"
  assert_file_contains "${vault}/Boards/Task Board.md" '## Blocked'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: review\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'reason=PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'Blocked transition recorded: ticket=BOXP-301; run='
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'action=implement; at=.*category=pr-gate-pr-url'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'inspect run artifacts: .*/summary\.edn, .*/last-message\.md, .*/events\.jsonl, .*/stderr\.log'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: review\]\].*status::ready'

  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-399|BOXP-399: retry succeeds]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-399 in-progress codex boxp/example
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/missing"
  assert_file_contains "${vault}/Tickets/BOXP-399.md" '^status: in-progress$'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/success"
  assert_file_contains "${vault}/Tickets/BOXP-399.md" '^status: ready$'
  assert_file_not_contains "${state}/state.edn" '"BOXP-399"'
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
  assert_file_contains "${vault}/Boards/Task Board.md" 'status::blocked.*assignee::boxp'
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
  write_board "${vault}" "- [ ] [[Tickets/BOXP-306|BOXP-306: restore ready]] #ticket status::ready"
  write_ticket "${vault}" BOXP-306 ready codex
  bb "${HELPER}" update BOXP-306 --vault "${vault}" --lane Ready >/dev/null

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKER_NOTE=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-blocker-note-restore.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-306\|BOXP-306: test ticket\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-306.md" '^status: ready$'
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

  # A zero retry limit exhausts the :pr-url gate immediately.
  # The forced Blocked-state failure must restore the ticket while
  # keeping the provisional succeeded summary, rather than persisting :blocked.
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE=true CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=0 \
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

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-401\|BOXP-401: review pr\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" '^assignee: codex$'
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

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-402\|BOXP-402: no repo review\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-402.md" '^status: ready$'
  # A skipped gate (no PR to check) must not be counted as a pass.
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["all" "skip"\] 1'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["pr-url" "skip"\] 1'
  if grep -q '\["all" "pass"\]' "${state}/ai-ops/ledger-stats.edn"; then
    fail "review-none gate must not be counted as pass"
  fi
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

review_severity_setup() {
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-405|BOXP-405: review issue]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-405 in-progress codex boxp/example
}

review_severity_tick() {
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >"${tmp}/tick.out"
}

assert_no_review_budget() {
  if [[ -f "${state}/gate-failure-budget.edn" ]]; then
    assert_file_contains "${state}/gate-failure-budget.edn" ':failures \{\}'
  fi
  if [[ -f "${state}/state.edn" ]]; then
    assert_file_not_contains "${state}/state.edn" ':pr-gate-retries'
  fi
}

test_review_with_codex_review_issue_is_blocked() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\n- missing regression test' review_severity_tick
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-405: review issue.*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Review gate failed \(codex-review\)'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'missing regression test'
  assert_no_review_budget
}

test_review_p1_finding_retries_and_consumes_budget() {
  local tmp vault state bin artifact
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | src/a.clj:10 | nil deref on empty input' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Retrying with Codex instruction 1/2'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-findings'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'nil deref'
  artifact="$(find "${state}/runs/BOXP-405" -name codex-review-boxp__example-123-blocking.md -print -quit)"
  assert_file_contains "${artifact}" 'nil deref on empty input'
  assert_file_contains "${state}/gate-failure-budget.edn" 'BOXP-405'
  [[ "$(grep -o ':class "review-findings"' "${state}/gate-failure-budget.edn" | wc -l)" == 1 ]] || fail "expected one budget failure"
}

test_review_p0_finding_blocks() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P0 | x | credential leak' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: in-progress$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Retrying with Codex instruction 1/2'
  [[ "$(grep -o ':class "review-findings"' "${state}/gate-failure-budget.edn" | wc -l)" == 1 ]] || fail "expected one budget failure"
}

test_review_p2_only_passes_without_budget() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | improve wording\nCODEX_REVIEW_FINDING: P3 | x | rename\nCODEX_REVIEW_FINDING: nit | x | cleanup' review_severity_tick
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-405: review issue.*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Review gates passed'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Non-blocking low-priority review findings \(P2/P3/nit\): 3'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'improve wording'
  assert_run_summary_contains "${state}" BOXP-405 ':low-priority-findings'
  assert_no_review_budget
}

test_review_mixed_findings_retry_targets_only_blocking() {
  local tmp vault state bin artifact
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | x | real defect\nCODEX_REVIEW_FINDING: P2 | x | optional wording' review_severity_tick
  artifact="$(find "${state}/runs/BOXP-405" -name codex-review-boxp__example-123-blocking.md -print -quit)"
  assert_file_contains "${artifact}" 'real defect'
  assert_file_not_contains "${artifact}" 'optional wording'
  CODEX_FAKE_PROMPT_LOG="${tmp}/prompt" CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: clean' review_severity_tick
  assert_file_contains "${tmp}/prompt" 'Severity policy \(BOXP-377\)'
  assert_file_contains "${tmp}/prompt" 'codex-review-boxp__example-123-blocking.md'
  assert_file_not_contains "${tmp}/prompt" 'optional wording'
}

test_review_unknown_severity_output_stops() {
  local tmp vault state bin message
  for message in $'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P9 | x | y' 'no marker'; do
    review_severity_setup
    CODEX_FAKE_REVIEW_MESSAGE="${message}" review_severity_tick
    assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
    assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
    assert_no_review_budget
  done
}

test_review_p2_with_unstructured_lines_stops() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | wording\n- unformatted real defect' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'unformatted real defect'
  assert_no_review_budget
}

test_review_p1_with_unstructured_lines_stops() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | x | real defect\n- unformatted second defect' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'unformatted second defect'
  assert_no_review_budget
}

test_review_clean_with_unstructured_lines_stops() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: clean\n- unformatted real defect' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'unformatted real defect'
  assert_no_review_budget
}

test_review_finding_without_severity_stops() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | wording\nCODEX_REVIEW_FINDING: | x | real defect' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'real defect'
  assert_no_review_budget
}

test_review_malformed_finding_stops() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_no_review_budget
}

test_review_conflicting_result_marker_stops() {
  local tmp vault state bin
  review_severity_setup
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: clean\nCODEX_REVIEW_RESULT: issues' review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_no_review_budget
}

test_review_same_p1_retry_count_survives_p2_changes() {
  local tmp vault state bin count i message
  review_severity_setup
  for count in 1 2 3; do
    message=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | x | real defect'
    for ((i = 1; i <= count; i++)); do
      message+=$'\nCODEX_REVIEW_FINDING: P2 | x | wording'
    done
    CODEX_FAKE_REVIEW_MESSAGE="${message}" review_severity_tick
  done
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Retrying with Codex instruction 2/2'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=pr-gate-retry-limit'
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

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-406\|BOXP-406: pr wins\]\].*status::ready'
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

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-410\|BOXP-410: multiple prs\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-410.md" '^status: ready$'
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
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-412\|BOXP-412: gate heartbeat\]\].*status::ready'
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

  assert_file_contains "${log}" '--json.*codex-review-boxp__example-123\.md.*--model gpt-test.*--profile review-profile'
  local usage_file
  usage_file="$(find "${state}/runs/BOXP-413" -name codex-review-boxp__example-123-usage.jsonl -print -quit)"
  assert_file_contains "${usage_file}" '"usage_status":"recorded"'
  assert_file_contains "${usage_file}" '"input_tokens":120'
  assert_file_contains "${usage_file}" '"thread_id":"fake-review-thread"'
  assert_file_not_contains "${usage_file}" 'gpt-|CODEX_REVIEW'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-413\|BOXP-413: review codex config\]\].*status::ready'
}

test_review_gate_missing_usage_still_passes() {
  local tmp vault state bin usage_file
  review_severity_setup
  CODEX_FAKE_REVIEW_NO_JSON=1 review_severity_tick
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: ready$'
  usage_file="$(find "${state}/runs/BOXP-405" -name codex-review-boxp__example-123-usage.jsonl -print -quit)"
  assert_file_contains "${usage_file}" '"usage_status":"unrecorded"'
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

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-450\|BOXP-450: no ci repo\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-450.md" '^status: ready$'
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

test_review_with_merged_pr_skips_gates() {
  local tmp vault state bin prompt_log summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompts.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-420|BOXP-420: merged pr]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-420 in-progress codex boxp/example

  # Merged PRs report mergeStateStatus=UNKNOWN; without the state check the gate
  # would poll until this timeout and fail with gate=mergeability.
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=30 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_FAKE_PROMPT_LOG="${prompt_log}" GH_FAKE_PR_STATE=MERGED CODEX_FAKE_MESSAGE=$'Merged PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-merged-pr.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-420\|BOXP-420: merged pr\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-420.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/BOXP-420.md" 'Review gates passed\. Already-merged PR\(s\) skipped gates and codex review: https://github.com/boxp/example/pull/123\.'
  summary="$(find "${state}/runs/BOXP-420" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':ok\? true'
  assert_file_contains "${summary}" ':merged-pr-urls \["https://github.com/boxp/example/pull/123"\]'
  assert_file_contains "${summary}" ':checked-pr-urls \[\]'
  if [[ -f "${prompt_log}" ]] && grep -q '^CODEX_REVIEW_GATE$' "${prompt_log}"; then
    fail "codex review should not run for a merged PR"
  fi
}

test_review_with_none_marker_and_merged_pr_moves_review() {
  local tmp vault state bin summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-421|BOXP-421: none plus merged]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-421 in-progress codex boxp/example

  # BOXP-270 regression: the final message references already-merged PRs and
  # declares TASK_BOARD_REVIEW_PR: none. PR URLs still win over the marker, but
  # merged PRs must not stall the gate until the timeout.
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=30 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_PR_STATE=MERGED CODEX_FAKE_MESSAGE=$'Deployed https://github.com/boxp/example/pull/123 and https://github.com/boxp/example/pull/456 earlier.\nTASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-none-merged.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-421\|BOXP-421: none plus merged\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-421.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/BOXP-421.md" 'Already-merged PR\(s\) skipped gates and codex review: https://github.com/boxp/example/pull/123, https://github.com/boxp/example/pull/456\.'
  assert_file_not_contains "${vault}/Tickets/BOXP-421.md" 'Review gate failed'
  summary="$(find "${state}/runs/BOXP-421" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':merged-pr-urls \["https://github.com/boxp/example/pull/123" "https://github.com/boxp/example/pull/456"\]'
}

test_review_with_open_and_merged_prs_gates_open_only() {
  local tmp vault state bin prompt_log summary
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompts.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-422|BOXP-422: open and merged]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-422 in-progress codex boxp/example

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=30 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_FAKE_PROMPT_LOG="${prompt_log}" GH_FAKE_PR_STATE_123=MERGED CODEX_FAKE_MESSAGE=$'Context: https://github.com/boxp/example/pull/123 (merged)\nCreated PR: https://github.com/boxp/example/pull/456\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-open-and-merged.out

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-422\|BOXP-422: open and merged\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-422.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/BOXP-422.md" 'Already-merged PR\(s\) skipped gates and codex review: https://github.com/boxp/example/pull/123\.'
  summary="$(find "${state}/runs/BOXP-422" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${summary}" ':checked-pr-urls \["https://github.com/boxp/example/pull/456"\]'
  assert_file_contains "${summary}" ':merged-pr-urls \["https://github.com/boxp/example/pull/123"\]'
  assert_file_contains "${prompt_log}" '^PR: https://github.com/boxp/example/pull/456$'
  assert_file_not_contains "${prompt_log}" '^PR: https://github.com/boxp/example/pull/123$'
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

  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-415\|BOXP-415: pass after retry\]\].*status::ready'
  assert_file_contains "${vault}/Tickets/BOXP-415.md" '^status: ready$'
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

test_ai_ops_alerts_prompt_section_and_summary() {
  # BOXP-405: the runner reads AiOps* alerts once per run and shows the agent
  # only allowlisted names; summary.edn keeps the names and the read status.
  local tmp vault state bin prompt_log response arg_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/claude-prompt.log"
  response="${tmp}/alerts.json"
  arg_log="${tmp}/curl-args.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_claude "${bin}"
  make_fake_curl "${bin}"
  cat >"${response}" <<'EOF'
{"status":"success","data":{"alerts":[
 {"labels":{"alertname":"Watchdog","severity":"none"},"annotations":{"description":"pipeline"},"state":"firing","activeAt":"2026-11-04T00:00:00Z","value":"1e+00"},
 {"labels":{"alertname":"AiOpsOutcomeMeasurementStale","severity":"warning","component":"ai-ops","definition_version":"outcome/v1-draft"},"annotations":{"description":"SECRET-ANNOTATION"},"state":"pending","activeAt":"2026-11-04T00:00:00Z","value":"0e+00"},
 {"labels":{"alertname":"AiOpsOutcomeBurnFast","severity":"warning","component":"ai-ops","window":"7d","definition_version":"outcome/v1-draft"},"annotations":{"description":"SECRET-ANNOTATION"},"state":"firing","activeAt":"2026-11-04T00:00:00Z","value":"2.5e+00"}
]}}
EOF
  write_board "${vault}" "- [ ] [[Tickets/BOXP-640|BOXP-640: ai ops alerts]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-640 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
    CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    CODEX_TASK_BOARD_AI_OPS_ALERTS_DATASOURCE_UID=ds-test \
    GRAFANA_URL='http://grafana.test:3000/' \
    GRAFANA_SERVICE_ACCOUNT_TOKEN='glsa_fake_token_value' \
    CURL_FAKE_RESPONSE_FILE="${response}" \
    CURL_FAKE_ARG_LOG="${arg_log}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-alerts.out

  assert_file_contains "${prompt_log}" '^AI Ops decision support'
  assert_file_contains "${prompt_log}" 'Status: alerts AiOpsOutcomeBurnFast\{state=firing,severity=warning,window=7d,definition_version=outcome/v1-draft\}; AiOpsOutcomeMeasurementStale\{state=pending,severity=warning,definition_version=outcome/v1-draft\}\.'
  assert_file_contains "${prompt_log}" 'Not allowed because of these alerts'
  assert_file_not_contains "${prompt_log}" 'Watchdog'
  assert_file_not_contains "${prompt_log}" 'SECRET-ANNOTATION'
  assert_file_not_contains "${prompt_log}" 'glsa_fake_token_value'
  assert_file_contains "${arg_log}" '--max-time 5 .*http://grafana.test:3000/api/datasources/proxy/uid/ds-test/api/v1/alerts'
  assert_file_not_contains "${arg_log}" 'glsa_fake_token_value'
  assert_run_summary_contains "${state}" BOXP-640 ':ai-ops-alerts-status "ok"'
  assert_run_summary_contains "${state}" BOXP-640 ':ai-ops-alerts \["AiOpsOutcomeBurnFast" "AiOpsOutcomeMeasurementStale"\]'
  assert_run_summary_contains "${state}" BOXP-640 ':result "done"'
  if grep -q 'SECRET-ANNOTATION' "$(find "${state}/runs/BOXP-640" -name summary.edn | sort | tail -n 1)"; then
    fail "summary must not keep alert annotations"
  fi
}

test_ai_ops_alerts_read_failure_is_unknown_not_empty() {
  local tmp vault state bin prompt_log
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/claude-prompt.log"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_claude "${bin}"
  make_fake_curl "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-641|BOXP-641: ai ops alerts down]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-641 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
    CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    CODEX_TASK_BOARD_AI_OPS_ALERTS_DATASOURCE_UID=ds-test \
    GRAFANA_URL='http://grafana.test:3000' \
    GRAFANA_SERVICE_ACCOUNT_TOKEN='glsa_fake_token_value' \
    CURL_FAKE_EXIT=7 \
    run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-alerts-down.out

  assert_file_contains "${prompt_log}" "Status: unavailable \(measurement could not be read: curl-exit-7\)\. Treat this as unknown, not as 'no alerts'\."
  assert_run_summary_contains "${state}" BOXP-641 ':ai-ops-alerts-status "unavailable"'
  assert_run_summary_contains "${state}" BOXP-641 ':result "done"'
  if grep -q ':ai-ops-alerts \[' "$(find "${state}/runs/BOXP-641" -name summary.edn | sort | tail -n 1)"; then
    fail "an unavailable read must not record an empty alert list"
  fi
}

test_ai_ops_alerts_section_absent_when_disabled() {
  local tmp vault state bin prompt_log response
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  prompt_log="${tmp}/codex-prompt.log"
  response="${tmp}/alerts.json"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_curl "${bin}"
  printf '%s\n' '{"status":"success","data":{"alerts":[]}}' >"${response}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-642|BOXP-642: ai ops alerts off]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-642 in-progress codex

  PATH="${bin}:$PATH" \
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    CODEX_TASK_BOARD_AI_OPS_ALERTS_DATASOURCE_UID= \
    GRAFANA_URL='http://grafana.test:3000' \
    GRAFANA_SERVICE_ACCOUNT_TOKEN='glsa_fake_token_value' \
    CURL_FAKE_RESPONSE_FILE="${response}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-alerts-off.out

  assert_file_not_contains "${prompt_log}" 'AI Ops decision support'
  if grep -q ':ai-ops-alerts' "$(find "${state}/runs/BOXP-642" -name summary.edn | sort | tail -n 1)"; then
    fail "summary must not mention AI Ops alerts when the read is disabled"
  fi

  # Enabled with no AiOps alert firing: the section says so explicitly and
  # the summary records an empty list, distinct from an unavailable read.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-643|BOXP-643: ai ops alerts none]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-643 in-progress codex
  PATH="${bin}:$PATH" \
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
    CODEX_TASK_BOARD_AI_OPS_ALERTS_DATASOURCE_UID=ds-test \
    GRAFANA_URL='http://grafana.test:3000' \
    GRAFANA_SERVICE_ACCOUNT_TOKEN='glsa_fake_token_value' \
    CURL_FAKE_RESPONSE_FILE="${response}" \
    run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-alerts-none.out

  assert_file_contains "${prompt_log}" 'Status: no AiOps alerts are firing or pending\.'
  assert_run_summary_contains "${state}" BOXP-643 ':ai-ops-alerts-status "ok"'
  assert_run_summary_contains "${state}" BOXP-643 ':ai-ops-alerts \[\]'
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
  local pairs=("codex:gpt-6.1-terra" "codex-sol:gpt-6.1-sol" "codex-full:gpt-6.1-sol" "codex-terra:gpt-6.1-terra" "codex-mini:gpt-5.6-luna" "codex-astra:gpt-6-astra")
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
    "codex-minimal:gpt-6.1-terra:minimal"
    "codex-sol-low:gpt-6.1-sol:low"
    "codex-full-medium:gpt-6.1-sol:medium"
    "codex-sol-xhigh:gpt-6.1-sol:xhigh"
    "codex-terra-high:gpt-6.1-terra:high"
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
    assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
    assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
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

test_task_board_pbt_properties() { bb "${ROOT_DIR}/tests/codex-workspace/task_board_pbt_test.bb"; }

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
  CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE="${CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE:-false}" \
  CODEX_TASK_BOARD_VAULT="${vault}" \
  CODEX_TASK_BOARD_ROOT="${state_root}" \
  bb "${RUNNER}" prune-workspaces "$@"
}

test_stale_prune_studio_dist() {
  local tmp vault state bin source other known out ws ticket run co i dist
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  source="${tmp}/source"; other="${tmp}/other"; known="${tmp}/known"; out="${tmp}/out"; ws="${state}/workspaces"
  mkdir -p "${bin}" "${state}/locks" "${tmp}/proc/100"
  ln -s / "${tmp}/proc/100/cwd"
  echo '22 1 0:21 / / rw - ext4 /dev/root rw' >"${tmp}/mountinfo"
  export CODEX_TASK_BOARD_PRUNE_PROC_ROOT="${tmp}/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="${tmp}/mountinfo"
  make_fake_gh "${bin}"; make_prune_source_repo "${source}"
  git -C "${source}" remote set-url origin https://github.com/boxp/arch.git
  mkdir -p "${source}/apps/kohako-studio/web/public"
  printf 'dist/\nresults/\n' >"${source}/.gitignore"
  printf 'abcd' >"${source}/apps/kohako-studio/web/public/copied.txt"
  touch "${source}/apps/kohako-studio/web/"{package.json,package-lock.json,vite.config.ts,candidates.html}
  git -C "${source}" add .; prune_git -C "${source}" commit -q -m fixture
  git -C "${source}" update-ref refs/remotes/origin/main HEAD
  git -C "${source}" rev-list HEAD >"${known}"
  git clone -q "${source}" "${other}"; git -C "${other}" remote set-url origin https://github.com/boxp/example.git
  write_board "${vault}" ''
  for ticket in $(seq 920 933); do
    ticket="BOXP-${ticket}"; write_prune_ticket "${vault}" "${ticket}" blocked 2020-01-01
    for i in 1 2 3 4; do
      run="2020010${i}T000000Z"
      if [[ "${ticket}" == BOXP-930 ]]; then co="$(add_prune_run "${state}" "${other}" "${ticket}" "${run}")"; else co="$(add_prune_run "${state}" "${source}" "${ticket}" "${run}")"; fi
      dist="${co}/apps/kohako-studio/web/dist"; mkdir -p "${dist}/assets"
      printf html >"${dist}/index.html"; printf entry >"${dist}/candidates.html"; printf asset >"${dist}/assets/main-Abc_1234.js"
      cp "${co}/apps/kohako-studio/web/public/copied.txt" "${dist}/copied.txt"
      if [[ "${i}" == 1 ]]; then
        case "${ticket}" in
          BOXP-921) echo x >"${dist}/render.png" ;;
          BOXP-922) printf wxyz >"${dist}/copied.txt" ;;
          BOXP-923) echo x >"${co}/apps/kohako-studio/web/public/untracked.txt"; echo x >"${dist}/untracked.txt"; echo apps/kohako-studio/web/public/untracked.txt >>"$(git -C "${co}" rev-parse --git-path info/exclude)" ;;
          BOXP-924) ln -s index.html "${dist}/link" ;;
          BOXP-925) ln "${dist}/index.html" "${dist}/studio.html" ;;
          BOXP-926) mkdir -p "${co}/apps/g2-client/dist"; touch "${co}/apps/g2-client/dist/a" ;;
          BOXP-927) mkdir -p "${co}/x/apps/kohako-studio/web/dist"; touch "${co}/x/apps/kohako-studio/web/dist/a" ;;
          BOXP-928) echo dirty >"${co}/dirty" ;;
          BOXP-931) mkdir -p "${co}/results"; touch "${co}/results/a" ;;
          BOXP-933) printf html >"${dist}/extra.html" ;;
          BOXP-932) git -C "${co}" rm -q --cached apps/kohako-studio/web/vite.config.ts; echo apps/kohako-studio/web/vite.config.ts >>"$(git -C "${co}" rev-parse --git-path info/exclude)" ;;
        esac
      fi
    done
  done
  printf '{:ticket "BOXP-929" :run-id "20200101T000000Z"}\n' >"${state}/locks/BOXP-929.edn"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true run_prune "${vault}" "${state}" >"${out}"
  [[ ! -e "${ws}/BOXP-920/20200101T000000Z" && ! -e "${ws}/BOXP-920/20200102T000000Z" ]] || fail 'normal studio dist retained'
  [[ -d "${ws}/BOXP-920/20200103T000000Z" && -d "${ws}/BOXP-920/20200104T000000Z" ]] || fail 'latest studio dist removed'
  for i in $(seq 921 933); do [[ -d "${ws}/BOXP-${i}/20200101T000000Z" ]] || fail "unsafe studio run removed: ${i}"; done
  # A dist HTML page counts as a build entry only when its source is tracked.
  assert_file_contains "${out}" 'BOXP-933/20200101T000000Z.*reason=ignored-unknown path=apps/kohako-studio/web/dist/extra.html'
  assert_file_contains "${out}" 'BOXP-921/20200101T000000Z.*reason=ignored-unknown path=apps/kohako-studio/web/dist/render.png'
  assert_file_contains "${out}" 'BOXP-922/20200101T000000Z.*reason=ignored-unknown path=apps/kohako-studio/web/dist/copied.txt'
  assert_file_contains "${out}" 'BOXP-923/20200101T000000Z.*reason=ignored-unknown path=apps/kohako-studio/web/public/untracked.txt'
  assert_file_contains "${out}" 'BOXP-924/20200101T000000Z.*reason=ignored-unknown path=apps/kohako-studio/web/dist/link'
  assert_file_contains "${out}" 'BOXP-925/20200101T000000Z.*reason=ignored-unknown path=apps/kohako-studio/web/dist/'
  assert_file_contains "${out}" 'BOXP-926/20200101T000000Z.*reason=ignored-unknown path=apps/g2-client/dist/'
  assert_file_contains "${out}" 'BOXP-927/20200101T000000Z.*reason=ignored-unknown path=x/apps/kohako-studio/web/dist/'
  assert_file_contains "${out}" 'BOXP-928/20200101T000000Z.*reason=uncommitted-changes'
  assert_file_contains "${out}" 'BOXP-930/20200101T000000Z.*reason=ignored-unknown path=apps/kohako-studio/web/dist/'
  assert_file_contains "${out}" 'BOXP-931/20200101T000000Z.*reason=ignored-unknown path=results/'
  co="${ws}/BOXP-923/20200101T000000Z/ghq/github.com/boxp/example"
  TEST_RUNNER="${RUNNER}" TEST_CHECKOUT="${co}" bb -e '(System/setProperty "babashka.file" "/tmp/load-runner.bb") (load-file (System/getenv "TEST_RUNNER")) (println (studio-dist-hold (System/getenv "TEST_CHECKOUT")))' >"${tmp}/public-hold"
  assert_file_contains "${tmp}/public-hold" 'ignored-unknown path=apps/kohako-studio/web/dist/untracked.txt'
  co="${ws}/BOXP-932/20200101T000000Z/ghq/github.com/boxp/example"
  TEST_RUNNER="${RUNNER}" TEST_CHECKOUT="${co}" bb -e '(System/setProperty "babashka.file" "/tmp/load-runner.bb") (load-file (System/getenv "TEST_RUNNER")) (println (studio-dist-hold (System/getenv "TEST_CHECKOUT")))' >"${tmp}/input-hold"
  assert_file_contains "${tmp}/input-hold" 'studio-dist-build-input-untracked path=apps/kohako-studio/web/vite.config.ts'
  unset CODEX_TASK_BOARD_PRUNE_PROC_ROOT CODEX_TASK_BOARD_PRUNE_MOUNTINFO
  rm -rf "${tmp}"
}

test_stale_prune() {
  local tmp vault state bin source known out ws ticket run co i
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  source="${tmp}/source"; known="${tmp}/known"; out="${tmp}/out"; ws="${state}/workspaces"
  mkdir -p "${bin}" "${state}/locks"
  make_fake_gh "${bin}"; make_prune_source_repo "${source}"; git -C "${source}" rev-parse HEAD >"${known}"
  write_board "${vault}" ""
  for ticket in BOXP-901 BOXP-902 BOXP-903 BOXP-904 BOXP-905 BOXP-906 BOXP-907 BOXP-908 BOXP-909 BOXP-910; do
    if [[ "${ticket}" == BOXP-907 ]]; then
      write_prune_ticket "${vault}" "${ticket}" done "$(date -u +%Y-%m-%d)"
    else
      write_prune_ticket "${vault}" "${ticket}" blocked 2020-01-01
    fi
    for i in 1 2 3 4; do
      run="2020010${i}T000000Z"
      co="$(add_prune_run "${state}" "${source}" "${ticket}" "${run}")"
      if [[ "${i}" == 1 ]]; then
        case "${ticket}" in
          BOXP-910|BOXP-902) echo dirty >"${co}/dirty" ;;
          BOXP-903) prune_commit "${co}" unpushed >/dev/null ;;
          BOXP-904) echo results/ >>"$(git -C "${co}" rev-parse --git-path info/exclude)"; mkdir -p "${co}/results"; echo x >"${co}/results/out.bin" ;;
          BOXP-905) printf 'node_modules/\n.terraform/\n' >>"$(git -C "${co}" rev-parse --git-path info/exclude)"; mkdir -p "${co}/node_modules" "${co}/.terraform"; touch "${co}/node_modules/x" "${co}/.terraform/x" ;;
          BOXP-908) echo note >"${ws}/${ticket}/${run}/agent-notes.md" ;;
        esac
      fi
    done
  done
  echo lock >"${state}/locks/BOXP-906.edn"
  printf '{:ticket "BOXP-909" :run-id "20200101T000000Z" :heartbeat-at "2020-01-01T00:00:00Z"}\n' >"${state}/locks/BOXP-909.edn"
  printf '{:ticket "BOXP-910" :run-id "20200105T000000Z"}\n' >"${state}/locks/BOXP-910.edn"
  # Scan a fixture process table: CI hosts have root processes whose cwd is
  # unreadable, which the fail-closed scan would (correctly) treat as a hold.
  mkdir -p "${tmp}/proc/100"; ln -s / "${tmp}/proc/100/cwd"
  echo "22 1 0:21 / / rw - ext4 /dev/root rw" >"${tmp}/mountinfo"
  export CODEX_TASK_BOARD_PRUNE_PROC_ROOT="${tmp}/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="${tmp}/mountinfo"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=false run_prune "${vault}" "${state}" >"${out}"
  for ticket in BOXP-909 BOXP-910; do
    for i in 1 2 3 4; do
      [[ -d "${ws}/${ticket}/2020010${i}T000000Z" ]] || fail "locked run removed with stale prune disabled: ${ticket}"
    done
  done
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true run_prune "${vault}" "${state}" --dry-run >"${out}"
  [[ -d "${ws}/BOXP-901/20200101T000000Z" && -d "${ws}/BOXP-909/20200102T000000Z" && -d "${ws}/BOXP-910/20200102T000000Z" ]] || fail "stale dry run removed data"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true run_prune "${vault}" "${state}" >"${out}"
  for ticket in BOXP-901 BOXP-905 BOXP-907; do
    [[ ! -e "${ws}/${ticket}/20200101T000000Z" && ! -e "${ws}/${ticket}/20200102T000000Z" ]] || fail "old stale runs retained: ${ticket}"
    [[ -d "${ws}/${ticket}/20200103T000000Z" && -d "${ws}/${ticket}/20200104T000000Z" ]] || fail "latest runs removed: ${ticket}"
  done
  for ticket in BOXP-902 BOXP-903 BOXP-904 BOXP-906 BOXP-908; do
    [[ -d "${ws}/${ticket}/20200101T000000Z" ]] || fail "unsafe stale run removed: ${ticket}"
  done
  for ticket in BOXP-909 BOXP-910; do
    [[ -d "${ws}/${ticket}/20200101T000000Z" && ! -e "${ws}/${ticket}/20200102T000000Z" && -d "${ws}/${ticket}/20200103T000000Z" && -d "${ws}/${ticket}/20200104T000000Z" ]] || fail "locked stale run retention incorrect: ${ticket}"
  done
  assert_file_contains "${out}" 'BOXP-910/20200101T000000Z.*reason=uncommitted-changes'
  assert_file_contains "${out}" 'reason=ignored-unknown path=results/'
  assert_file_contains "${out}" "reason=outside-checkout path=agent-notes.md"
  assert_file_contains "${out}" 'reason=uncommitted-changes'
  assert_file_contains "${out}" 'reason=commit-not-on-github'
  # A live process inside an otherwise deletable stale run keeps it.
  co="$(add_prune_run "${state}" "${source}" BOXP-901 20191231T000000Z)"
  mkdir -p "${tmp}/proc/101"; ln -s "${co}" "${tmp}/proc/101/cwd"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true run_prune "${vault}" "${state}" >"${out}"
  [[ -d "${ws}/BOXP-901/20191231T000000Z" ]] || fail "stale run with live process removed"
  assert_file_contains "${out}" "reason=process-active"
  # A locked ticket's old runs are inspected without the ticket guard, so the
  # live run's heartbeat is never stalled by GitHub lookups or deletion.
  write_prune_ticket "${vault}" BOXP-911 blocked 2020-01-01
  for i in 1 2 3 4; do
    co="$(add_prune_run "${state}" "${source}" BOXP-911 "2020010${i}T000000Z")"
    [[ "${i}" == 1 ]] && prune_commit "${co}" pushed >>"${known}"
  done
  printf '{:ticket "BOXP-911" :run-id "20200104T000000Z"}\n' >"${state}/locks/BOXP-911.edn"
  mkdir -p "${state}/lock-guards"; touch "${state}/lock-guards/BOXP-911.lock"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" GH_FAKE_GUARD_PROBE_FILE="${state}/lock-guards/BOXP-911.lock" GH_FAKE_GUARD_PROBE_LOG="${tmp}/guard-probe" \
    CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true run_prune "${vault}" "${state}" >"${out}"
  [[ ! -e "${ws}/BOXP-911/20200101T000000Z" && -d "${ws}/BOXP-911/20200103T000000Z" && -d "${ws}/BOXP-911/20200104T000000Z" ]] || fail "locked ticket stale run retention incorrect"
  assert_file_contains "${tmp}/guard-probe" '^free$'
  if grep -q '^held$' "${tmp}/guard-probe"; then fail "ticket guard held during locked ticket inspection"; fi
  # A run that claims the ticket after the unguarded pre-check must not make
  # the guarded path inspect the remaining runs while holding the guard.
  write_prune_ticket "${vault}" BOXP-912 blocked 2020-01-01
  for i in 1 2 3 4; do
    co="$(add_prune_run "${state}" "${source}" BOXP-912 "2020010${i}T000000Z")"
    if [[ "${i}" -le 2 ]]; then
      prune_commit "${co}" pushed >"${tmp}/sha-912-${i}"; cat "${tmp}/sha-912-${i}" >>"${known}"
    fi
  done
  mkdir -p "${state}/lock-guards"; touch "${state}/lock-guards/BOXP-912.lock"
  : >"${tmp}/guard-probe-912"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" GH_FAKE_LOCK_ON_SHA="$(cat "${tmp}/sha-912-1")" GH_FAKE_LOCK_ON_LOOKUP="${state}/locks/BOXP-912.edn" GH_FAKE_LOCK_CONTENT='{:ticket "BOXP-912" :run-id "20200105T000000Z"}' \
    GH_FAKE_GUARD_PROBE_FILE="${state}/lock-guards/BOXP-912.lock" GH_FAKE_GUARD_PROBE_LOG="${tmp}/guard-probe-912" \
    CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true run_prune "${vault}" "${state}" >"${out}"
  [[ -f "${state}/locks/BOXP-912.edn" && -d "${ws}/BOXP-912/20200102T000000Z" ]] || fail "run inspected under guard after concurrent claim"
  if grep -q '^held$' "${tmp}/guard-probe-912"; then fail "ticket guard held after concurrent claim"; fi
  rm -f "${state}/locks/BOXP-912.edn"
  unset CODEX_TASK_BOARD_PRUNE_PROC_ROOT CODEX_TASK_BOARD_PRUNE_MOUNTINFO
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
  assert_file_contains "${out}" '^prune: summary deleted=2 stale-deleted=0 held=6 skipped=4 recent-runs=1 branches=1 empty-dirs=3 dry-run=true skipped-detail=locked:1,not-done:1,ticket-missing:1,within-retention:1( reclaimed-est-bytes=[0-9]+ held-bytes=[0-9]+)?$'

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
  assert_file_contains "${out}" '^prune: summary deleted=2 stale-deleted=0 held=6 skipped=4 recent-runs=1 branches=1 empty-dirs=3 dry-run=false '
  # Each SHA is looked up at most once per pass.
  [[ -z "$(sort "${tmp}/api.log" | uniq -d)" ]] || fail "expected GitHub lookups to be cached per prune pass"

  # A second pass is idempotent and keeps reporting held runs.
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "second prune-workspaces failed"
  assert_file_contains "${out}" '^prune: summary deleted=0 stale-deleted=0 held=6 skipped=4 recent-runs=1 branches=0 empty-dirs=0 dry-run=false '

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

# Adds `count` empty commits to a checkout. The message carries the checkout
# path: commit timestamps have second resolution, so two checkouts committing
# the same sequence on the same parent within one second would otherwise share
# commit SHAs and leak between fixtures (flaky on fast CI runners).
prune_empty_commits() {
  local checkout="$1"
  local count="$2"
  local i
  for ((i = 0; i < count; i++)); do
    prune_git -C "${checkout}" commit -q --allow-empty -m "empty ${i} ${checkout}"
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
  assert_file_contains "${out}" '^prune: summary deleted=1 stale-deleted=0 held=1 '
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
  assert_file_contains "${out}" '^prune: summary deleted=1 stale-deleted=0 held=3 '

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
  assert_file_contains "${out}" '^prune: summary deleted=1 stale-deleted=0 held=3 '
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
  assert_file_contains "${out}" '^prune: summary deleted=2 stale-deleted=0 held=2 skipped=0 recent-runs=0 branches=1 '

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
  assert_file_contains "${out}" '^prune: summary deleted=2 stale-deleted=0 held=2 skipped=0 recent-runs=0 branches=1 '
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
  assert_file_contains "${out}" '^prune: summary deleted=1 stale-deleted=0 held=0 skipped=1 .* skipped-detail=not-done:1( reclaimed-est-bytes=[0-9]+ held-bytes=[0-9]+)?$'

  # Without a readable board nothing is deleted.
  write_prune_ticket "${vault}" BOXP-363 done 2020-01-01
  add_prune_run "${state}" "${source}" BOXP-363 "${old}" >/dev/null
  rm "${vault}/Boards/Task Board.md"
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
    || fail "prune-workspaces without a board failed"
  [[ -d "${ws}/BOXP-363/${old}" ]] || fail "expected run to remain when the board is missing"
  assert_file_contains "${out}" '^prune: summary deleted=0 stale-deleted=0 held=0 skipped=2 .* skipped-detail=board-unreadable:2( reclaimed-est-bytes=[0-9]+ held-bytes=[0-9]+)?$'
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
  assert_file_contains "${tmp}/runner.out" '^prune: summary deleted=1 stale-deleted=0 held=0 skipped=0 recent-runs=0 branches=1 '
  assert_file_contains "${tmp}/runner.out" '^prune: summary deleted=0 stale-deleted=0 held=0 skipped=0 '
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


test_ai_ops_ledger_records_run_lifecycle() {
  local tmp vault state bin ledger
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  make_fake_gh "${bin}"
  write_board "${vault}" ""
  # The card starts in the Ready lane so run.started records the Ready -> ack transition.
  sed -i 's/^## Ready$/## Ready\n- [ ] [[Tickets\/BOXP-416|BOXP-416: ledger secret title]] #ticket status::ready/' "${vault}/Boards/Task Board.md"
  write_ticket "${vault}" BOXP-416 ready codex boxp/example

  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-1.out
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-2.out

  ledger="$(ls "${state}"/ai-ops/ledger/events-*.jsonl)"
  # JSON key order is not fixed: select each event by its id suffix, then check fields.
  grep ':ledger:started"' "${ledger}" | grep -q '"lane_from":"ready"' || fail "expected run.started from ready"
  grep ':ledger:correction"' "${ledger}" | grep '"correction_class":"gate_defect"' | grep -q '"correction_origin":"agent-system"' \
    || fail "expected an agent-system gate_defect correction"
  grep ':ledger:finished"' "${ledger}" | grep -q '"status":"retrying"' || fail "expected a retrying run.finished"
  grep ':ledger:finished"' "${ledger}" | grep -q '"status":"succeeded"' || fail "expected a succeeded run.finished"
  grep ':ledger:lane"' "${ledger}" | grep -q '"lane_to":"ready"' || fail "expected lane.changed to ready"
  assert_file_not_contains "${ledger}" 'secret title'
  assert_file_not_contains "${ledger}" 'http'
  assert_file_not_contains "${ledger}" 'privacy_rejected'
  [[ "$(grep -c '"event_type":"run.started"' "${ledger}")" -eq 2 ]] || fail "expected two run.started ledger events"
  grep ':ledger:lane-start"' "${ledger}" | grep '"lane_from":"ready"' | grep -q '"lane_to":"in-progress"' \
    || fail "expected a start lane.changed ready -> in-progress"
  # Start Ready -> In Progress, finish In Progress -> Ready. A retry stays In
  # Progress: no lane.changed for in-progress -> in-progress.
  [[ "$(grep -c '"event_type":"lane.changed"' "${ledger}")" -eq 2 ]] || fail "expected two lane.changed ledger events"
  grep ':ledger:correction"' "${ledger}" | grep -q '"confidence":"high"' \
    || fail "expected a failed CI check to be a high-confidence correction"
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["ci" "fail"\] 1'
  # gate="all" is the overall denominator and must count the failure too.
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["all" "fail"\] 1'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["all" "pass"\] 1'
  # Individual gates count their successes too, not only failures.
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["ci" "pass"\] 1'
  # The CI-failed run also passed mergeability; that success must be counted.
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["mergeability" "pass"\] 2'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["codex-review" "pass"\] 1'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["pr-url" "pass"\] 2'
  # One-shot `tick` (not only `loop`) must refresh metrics.prom from the stats.
  assert_file_contains "${state}/ai-ops/metrics.prom" 'ai_ops_review_gate_total\{gate="ci",result="fail"\} 1'
  # One-shot `tick` waits for the SLI refresh (bb exits without awaiting futures),
  # so the attempt is finished, not left with only :last-attempt.
  assert_file_contains "${state}/ai-ops/sli-export-status.edn" ':last-success|:failures'
}

test_ai_ops_ledger_groom_from_backlog_records_actual_lane() {
  local tmp vault state bin ledger
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}" "${vault}/Boards" "${vault}/Tickets"
  make_fake_codex "${bin}"
  cat >"${vault}/Boards/Task Board.md" <<'EOF'
# Task Board

## Backlog
- [ ] [[Tickets/BOXP-418|BOXP-418: ledger groom]] #ticket status::backlog

## Ready

## In Progress

## Blocked

## Review

## Done
EOF
  write_ticket "${vault}" BOXP-418 backlog codex

  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-groom.out

  ledger="$(ls "${state}"/ai-ops/ledger/events-*.jsonl)"
  # A Backlog groom run never moves the card to In Progress: no start
  # transition, and the finish transition starts from backlog.
  assert_file_not_contains "${ledger}" ':ledger:lane-start"'
  assert_file_not_contains "${ledger}" '"lane_from":"in-progress"'
  grep ':ledger:started"' "${ledger}" | grep -q '"lane_to":"backlog"' || fail "expected run.started to stay in backlog"
  grep ':ledger:lane"' "${ledger}" | grep -q '"lane_from":"backlog"' || fail "expected lane.changed from backlog"
}

test_ai_ops_ledger_disabled_by_env() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-417|BOXP-417: ledger off]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-417 in-progress codex

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_AI_OPS_LEDGER_ENABLED=false run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-off.out

  assert_file_contains "${vault}/Tickets/BOXP-417.md" '^status: done$'
  [[ ! -e "${state}/ai-ops/ledger" ]] || fail "ledger must not be written when disabled"
  [[ -f "${state}/ai-ops/subscription-usage.prom" ]] || fail "subscription metrics must remain enabled"
}

test_run_finished_records_outbox_event() {
  local tmp vault state bin event
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-701|BOXP-701: done]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-701 in-progress codex

  PATH="${bin}:$PATH" run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-done.out

  # Second ticket: exhaust the PR URL retry limit to exercise the Blocked event.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-701|BOXP-701: done]] #ticket status::done
- [ ] [[Tickets/BOXP-702|BOXP-702: blocked]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-702 in-progress codex
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=0 CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-blocked.out

  # done: lane, frontmatter and Notes are committed before the event is written.
  event="$(ls "${state}"/outbox/pending/BOXP-701-*-done.edn)"
  assert_file_contains "${event}" ':event-type "task-board.run-finished"'
  assert_file_contains "${event}" ':from-status "in-progress"'
  assert_file_contains "${event}" ':to-status "done"'
  assert_file_contains "${event}" ':source "task-board-runner"'
  assert_file_contains "${event}" ':status :pending'
  assert_file_contains "${event}" ':revision "[0-9a-f]{12}"'
  # review result without PR -> blocked by the gate: the blocked transition is an event too.
  event="$(ls "${state}"/outbox/pending/BOXP-702-*-blocked.edn)"
  assert_file_contains "${event}" ':to-status "blocked"'
  assert_file_contains "${vault}/Tickets/BOXP-702.md" '^status: blocked$'
  # The runner never needs the webhook secret or URL to record events.
  assert_file_not_contains "${event}" 'secret'
}

test_in_progress_retry_records_no_outbox_event() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-703|BOXP-703: idle]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-703 in-progress fable

  PATH="${bin}:$PATH" \
    CLAUDE_FAKE_SLEEP=2 \
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
    run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-idle.out

  assert_file_contains "${vault}/Tickets/BOXP-703.md" '^status: in-progress$'
  if ls "${state}"/outbox/pending/BOXP-703-* >/dev/null 2>&1; then
    fail "idle-timeout retry must not wake Kohako"
  fi
}

test_outbox_disabled_by_env() {
  local tmp vault state bin
  tmp="$(mktemp -d)"
  vault="${tmp}/vault"
  state="${tmp}/state"
  bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-704|BOXP-704: off]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-704 in-progress codex

  PATH="${bin}:$PATH" CODEX_TASK_BOARD_EVENTS_ENABLED=false run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-off.out

  assert_file_contains "${vault}/Tickets/BOXP-704.md" '^status: done$'
  if ls "${state}"/outbox/pending/BOXP-704-* >/dev/null 2>&1; then
    fail "outbox must stay empty when CODEX_TASK_BOARD_EVENTS_ENABLED=false"
  fi
}

# BOXP-369: cumulative gate-failure budget fixtures.  Each tick is a fresh
# runner process, so every case also covers "runner restart".
budget_fail_tick() {
  # $1 vault $2 state $3 bin $4 check-name (varies the failure text) $5 PR number
  PATH="${3}:$PATH" GH_FAKE_CHECKS="[{\"name\":\"${4}\",\"status\":\"COMPLETED\",\"conclusion\":\"FAILURE\"}]" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/'"${5:-123}"$'\nTASK_BOARD_RESULT: review' run_tick "$1" "$2" env "${@:6}" >/dev/null
}

budget_set_lane() {
  # Simulate the owner (or another assignee) putting the card back to work.
  local vault="$1" ticket="$2" title="$3" assignee="$4"
  write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: ${title}]] #ticket status::in-progress"
  sed -i -e 's/^status: .*/status: in-progress/' -e "s/^assignee: .*/assignee: ${assignee}/" "${vault}/Tickets/${ticket}.md"
}

budget_run_count() {
  find "$1/runs/$2" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l
}

test_gate_failure_budget_boundary_9_10_11() {
  local tmp vault state bin i assignee
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-369|BOXP-369: budget]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-369 in-progress codex boxp/example

  # A distinct failure text every run keeps the short-term fingerprint limit
  # at 1/2 (the BOXP-360 pattern); assignees alternate (担当交代).  An env
  # budget above 10 must not loosen the initial limit.
  for i in 1 2 3 4 5 6 7 8 9; do
    if (( i % 2 )); then assignee=codex; else assignee=codex-sol; fi
    sed -i "s/^assignee: .*/assignee: ${assignee}/" "${vault}/Tickets/BOXP-369.md"
    budget_fail_tick "${vault}" "${state}" "${bin}" "unit-${i}-token=super-secret-token" 123 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=50
  done
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-369: budget\]\].*status::in-progress'
  assert_file_not_contains "${vault}/Tickets/BOXP-369.md" 'gate-failure-budget-exhausted'

  budget_fail_tick "${vault}" "${state}" "${bin}" "unit-10-token=super-secret-token" 123 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=50
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-369: budget\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'category=gate-failure-budget-exhausted'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'ゲート累積失敗上限に到達したため自動再試行を停止しました'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'ticket BOXP-369 10/10 \(PR数N=1×10\), PR \(旧上限・監査\) boxp/example#123 10/10'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" '分類=ci-failure \(gate=ci; failure-kind=check-failure\)'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" '未解決=ci-check-failure'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'gate-budget-grant BOXP-369'
  # Every exhausted scope gets its own resume command (ticket and PR).
  assert_file_not_contains "${vault}/Tickets/BOXP-369.md" 'gate-budget-grant boxp/example#123 --amount N'
  assert_file_not_contains "${vault}/Tickets/BOXP-369.md" 'super-secret-token'
  assert_file_not_contains "${state}/gate-failure-budget.edn" 'super-secret-token'
  [[ "$(budget_run_count "${state}" BOXP-369)" == 10 ]] || fail "expected exactly 10 runs"

  # 11th: moving the card / assignee back without a grant starts no run.
  budget_set_lane "${vault}" BOXP-369 budget codex
  budget_fail_tick "${vault}" "${state}" "${bin}" "unit-11" 123
  [[ "$(budget_run_count "${state}" BOXP-369)" == 10 ]] || fail "11th automatic attempt must not start"
  # A Notes-only PR does not increase the ticket budget.
  printf '%s\n' '- see https://github.com/boxp/example/pull/777' >> "${vault}/Tickets/BOXP-369.md"
  budget_set_lane "${vault}" BOXP-369 budget codex
  # A new PR for the same ticket cannot escape the ticket budget either.
  budget_fail_tick "${vault}" "${state}" "${bin}" "unit-11" 777
  [[ "$(budget_run_count "${state}" BOXP-369)" == 10 ]] || fail "a new PR must not reopen the ticket budget"
}

test_gate_failure_budget_evaluated_merged_pr() {
  local tmp vault state bin i out
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-448|BOXP-448: budget]] #ticket status::in-progress'
  write_ticket "${vault}" BOXP-448 in-progress codex boxp/example
  PATH="${bin}:$PATH" GH_FAKE_PR_STATE_124=MERGED GH_FAKE_CHECKS='[{"name":"first","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'https://github.com/boxp/example/pull/124\nhttps://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/dev/null
  for i in {2..10}; do budget_fail_tick "${vault}" "${state}" "${bin}" "case-${i}" 123; done
  out="$(CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-status BOXP-448)"
  [[ "${out}" == *':n 2'* && "${out}" == *':limit 20'* && "${out}" == *':used 10, :limit 10'* ]] || fail "expected ticket 10/20 and PR 10/10: ${out}"
  [[ "${out}" == *':legacy-limit-reached? true'* && "${out}" == *':exhausted? false'* ]] || fail "PR threshold must be audit-only: ${out}"
  budget_fail_tick "${vault}" "${state}" "${bin}" continued 123
  [[ "$(budget_run_count "${state}" BOXP-448)" == 11 ]] || fail 'PR 10/10 must not stop the 11th run'
  assert_file_not_contains "${vault}/Tickets/BOXP-448.md" 'gate-budget-grant boxp/example#123'
}

test_gate_failure_budget_multiple_prs_and_shared_pr() {
  local tmp vault state bin t
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-461|BOXP-461: multi pr]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-461 in-progress codex boxp/example
  # Each evaluated PR increases the ticket budget.
  budget_fail_tick "${vault}" "${state}" "${bin}" a 201 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  budget_fail_tick "${vault}" "${state}" "${bin}" b 202 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-461: multi pr\]\].*status::in-progress'
  budget_fail_tick "${vault}" "${state}" "${bin}" c 203 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-461: multi pr\]\].*status::in-progress'
  local status
  status="$(CODEX_TASK_BOARD_ROOT="${state}" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3 bb "${RUNNER}" gate-budget-status BOXP-461)"
  [[ "${status}" == *':n 3'* && "${status}" == *':limit 9'* ]] || fail "expected N=3 and limit=9: ${status}"
  status="$(CODEX_TASK_BOARD_ROOT="${state}" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3 bb "${RUNNER}" gate-budget-exclude-pr BOXP-461 boxp/example#203 --by owner)"
  [[ "${status}" == *':n 2'* && "${status}" == *':limit 6'* ]] || fail "expected exclusion to reduce N: ${status}"

  # A shared PR's historical count does not block other tickets, including
  # alternate URL spellings, but remains aggregated for audit.
  for t in BOXP-462 BOXP-468 BOXP-470 BOXP-471; do
    write_board "${vault}" "- [ ] [[Tickets/${t}|${t}: shared pr]] #ticket status::in-progress"
    write_ticket "${vault}" "${t}" in-progress codex boxp/example
    printf '%s\n' '- continue https://GitHub.com/BOXP/Example/pull/201/files' >> "${vault}/Tickets/${t}.md"
    budget_fail_tick "${vault}" "${state}" "${bin}" "case-${t}" 201 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
    [[ "$(budget_run_count "${state}" "${t}")" == 1 ]] || fail "historical PR limit must not block ${t}"
    assert_file_not_contains "${vault}/Tickets/${t}.md" 'gate-budget-grant boxp/example#201'
  done
}

test_gate_failure_budget_concurrent_start_on_shared_pr_is_serialized() {
  local tmp vault state bin t
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  # Two tickets referencing PR 601 start in separate runner processes at
  # the same time: only one may hold the PR reservation.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-472|BOXP-472: seed]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-472 in-progress codex boxp/example
  budget_fail_tick "${vault}" "${state}" "${bin}" seed 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  write_board "${vault}" "- [ ] [[Tickets/BOXP-473|BOXP-473: race a]] #ticket status::in-progress
- [ ] [[Tickets/BOXP-474|BOXP-474: race b]] #ticket status::in-progress"
  for t in BOXP-473 BOXP-474; do
    write_ticket "${vault}" "${t}" in-progress codex boxp/example
    printf '%s\n' '- continue https://github.com/boxp/example/pull/601' >> "${vault}/Tickets/${t}.md"
  done
  for t in BOXP-473 BOXP-474; do
    PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"r","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_SLEEP=3 CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/601\nTASK_BOARD_RESULT: review' CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket "${t}" >/dev/null &
  done
  wait
  [[ "$(( $(budget_run_count "${state}" BOXP-473) + $(budget_run_count "${state}" BOXP-474) ))" == 1 ]] || fail "concurrent starts on one PR must be serialized"
  [[ "$(bb -e '(let [b (read-string (slurp (first *command-line-args*)))] (println (count (filter #(= "boxp/example#601" (:pr %)) (vals (:failures b))))))' "${state}/gate-failure-budget.edn")" == 2 ]] || fail "serialized failures must be recorded for PR 601"
  # The loser may start on a later tick after the reservation is released.
  for t in BOXP-473 BOXP-474; do
    if [[ "$(budget_run_count "${state}" "${t}")" == 0 ]]; then
      PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket "${t}" >/dev/null
      [[ "$(budget_run_count "${state}" "${t}")" == 1 ]] || fail "released PR must allow the other ticket"
    fi
  done
}

test_gate_failure_budget_grant_resume_and_no_reset_on_success() {
  local tmp vault state bin out
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-463|BOXP-463: grant]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-463 in-progress codex boxp/example
  budget_fail_tick "${vault}" "${state}" "${bin}" a 301 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  budget_fail_tick "${vault}" "${state}" "${bin}" b 301 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-463: grant\]\].*status::blocked'

  # Invalid grants are rejected and change nothing.
  if CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-463 --amount 0 --by boxp >/dev/null 2>&1; then
    fail "grant with amount 0 must fail"
  fi
  # PR grants are retained for audit and do not increase the ticket pool.
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant boxp/example#301 --amount 1 --by boxp >/dev/null
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-463 --amount 1 --by boxp >/dev/null
  budget_set_lane "${vault}" BOXP-463 grant codex
  # Now one more run is allowed; it passes, and success does not reset counts.
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/301\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 >/dev/null
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-463: grant\]\].*status::ready'
  out="$(CODEX_TASK_BOARD_ROOT="${state}" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 bb "${RUNNER}" gate-budget-status BOXP-463)"
  [[ "${out}" == *':used 2, :limit 3'* ]] || fail "success must not reset the budget: ${out}"
  # Granted budget is consumed by the next failure, which blocks again at 3/3.
  budget_set_lane "${vault}" BOXP-463 grant codex
  budget_fail_tick "${vault}" "${state}" "${bin}" d 301 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-463: grant\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-463.md" 'ticket BOXP-463 3/3 \(PR数N=1×2\), PR \(旧上限・監査\) boxp/example#301 3/3'
}

test_gate_failure_budget_stop_completes_after_interrupted_transition() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-465|BOXP-465: interrupted]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-465 in-progress codex boxp/example
  budget_fail_tick "${vault}" "${state}" "${bin}" a 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  budget_fail_tick "${vault}" "${state}" "${bin}" b 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  # The 3rd (last) failure is recorded in the budget, but the Blocked
  # transition fails after the record (runner death / state write failure):
  # the card is restored to its prior lane.
  budget_fail_tick "${vault}" "${state}" "${bin}" c 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3 CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE=true
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-465: interrupted\]\].*status::in-progress'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" '^assignee: codex$'
  [[ "$(grep -o ':class "ci-failure"' "${state}/gate-failure-budget.edn" | wc -l)" == 3 ]] || fail "3rd failure must be recorded"
  [[ "$(budget_run_count "${state}" BOXP-465)" == 3 ]] || fail "expected exactly 3 runs"

  # The next tick must not start a run; it completes the formal stop instead.
  budget_fail_tick "${vault}" "${state}" "${bin}" d 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  [[ "$(budget_run_count "${state}" BOXP-465)" == 3 ]] || fail "no run may start on the exhausted ticket"
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-465: interrupted\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'run=none; transition-id=BOXP-465/gate-budget-stop-'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'run を開始せず停止状態へ戻しました'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'ticket BOXP-465 3/3 \(PR数N=1×3\)'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'gate-budget-grant BOXP-465 --amount N'
  assert_file_not_contains "${vault}/Tickets/BOXP-465.md" 'gate-budget-grant boxp/example#501 --amount N'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-465.md")" == 1 ]] || fail "exactly one stop note expected"
  if ! ls "${state}"/outbox/pending/BOXP-465-*-blocked.edn >/dev/null 2>&1; then
    fail "the formal stop must record a blocked event"
  fi
  if ls "${state}"/locks/BOXP-465.edn >/dev/null 2>&1; then
    fail "the stop must release the ticket lock"
  fi

  # Blocked + boxp has no automatic action: a further tick changes nothing.
  budget_fail_tick "${vault}" "${state}" "${bin}" e 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  [[ "$(budget_run_count "${state}" BOXP-465)" == 3 ]] || fail "still no run after the stop"
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-465.md")" == 1 ]] || fail "stop note must not repeat"
  # Only a grant for both exhausted scopes reopens one run.
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-465 --amount 1 --by boxp >/dev/null
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant boxp/example#501 --amount 1 --by boxp >/dev/null
  budget_set_lane "${vault}" BOXP-465 interrupted codex
  budget_fail_tick "${vault}" "${state}" "${bin}" f 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  [[ "$(budget_run_count "${state}" BOXP-465)" == 4 ]] || fail "a grant for both scopes must allow one run"
}

test_gate_failure_budget_stop_reports_when_blocked_card_is_reassigned() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-466|BOXP-466: reassigned]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-466 in-progress codex boxp/example
  budget_fail_tick "${vault}" "${state}" "${bin}" a 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  budget_fail_tick "${vault}" "${state}" "${bin}" b 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^assignee: boxp$'
  [[ "$(budget_run_count "${state}" BOXP-466)" == 2 ]] || fail "expected exactly 2 runs"
  local stops_before
  stops_before="$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-466.md" || true)"
  [[ "${stops_before}" == 0 ]] || fail "no run=none stop expected before the reassignment"

  # The Owner hands the card back to an agent but leaves it in Blocked
  # (candidate :blocked-retry) without a grant: no run may start, and the
  # refusal must not stay silent -- report + assignee boxp, card stays Blocked.
  sed -i "s/^assignee: .*/assignee: codex/" "${vault}/Tickets/BOXP-466.md"
  sed -i 's/\(BOXP-466: reassigned\]\].*\)assignee::boxp/\1assignee::codex/' "${vault}/Boards/Task Board.md"
  budget_fail_tick "${vault}" "${state}" "${bin}" c 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  [[ "$(budget_run_count "${state}" BOXP-466)" == 2 ]] || fail "no run may start on the reassigned Blocked card"
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-466: reassigned\]\].*status::blocked'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-466: reassigned\]\].*assignee::boxp'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'run=none; transition-id=BOXP-466/gate-budget-stop-'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'action=blocked-retry'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'ticket BOXP-466 2/2 \(PR数N=1×2\), PR \(旧上限・監査\) boxp/example#601 2/2'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'gate-budget-grant BOXP-466 --amount N'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-466.md")" == 1 ]] || fail "exactly one stop note expected"
  if ls "${state}"/locks/BOXP-466.edn >/dev/null 2>&1; then
    fail "the stop must release the ticket lock"
  fi
  # Blocked + boxp again: a further tick is silent.
  budget_fail_tick "${vault}" "${state}" "${bin}" d 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  [[ "$(budget_run_count "${state}" BOXP-466)" == 2 ]] || fail "still no run after the stop"
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-466.md")" == 1 ]] || fail "stop note must not repeat"
}

test_gate_failure_budget_stop_is_written_once_under_concurrent_ticks() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-468|BOXP-468: race stop]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-468 in-progress codex boxp/example
  budget_fail_tick "${vault}" "${state}" "${bin}" a 801 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  budget_fail_tick "${vault}" "${state}" "${bin}" b 801 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${vault}/Tickets/BOXP-468.md" '^assignee: boxp$'
  sed -i "s/^assignee: .*/assignee: codex/" "${vault}/Tickets/BOXP-468.md"
  sed -i 's/\(BOXP-468: race stop\]\].*\)assignee::boxp/\1assignee::codex/' "${vault}/Boards/Task Board.md"
  # Two ticks both read the reassigned card before either takes the ticket
  # lock (the hold widens that window deterministically); the second must
  # re-read the card under the lock and not write a second stop report.
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_TEST_GATE_BUDGET_STOP_HOLD_MILLIS=1500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-468 >/dev/null &
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_TEST_GATE_BUDGET_STOP_HOLD_MILLIS=1500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-468 >/dev/null &
  wait
  [[ "$(budget_run_count "${state}" BOXP-468)" == 2 ]] || fail "no run may start on the reassigned Blocked card"
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-468.md")" == 1 ]] || fail "exactly one stop note expected under concurrent ticks"
  assert_file_contains "${vault}/Tickets/BOXP-468.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-468.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-468: race stop\]\].*status::blocked'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-468: race stop\]\].*assignee::boxp'
  if ls "${state}"/locks/BOXP-468.edn >/dev/null 2>&1; then
    fail "the stop must release the ticket lock"
  fi
}

test_gate_failure_budget_stop_is_serialized_with_grant() {
  local tmp vault state bin i
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-469|BOXP-469: grant race]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-469 in-progress codex boxp/example
  budget_fail_tick "${vault}" "${state}" "${bin}" a 901 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  budget_fail_tick "${vault}" "${state}" "${bin}" b 901 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${vault}/Tickets/BOXP-469.md" '^assignee: boxp$'
  sed -i "s/^assignee: .*/assignee: codex/" "${vault}/Tickets/BOXP-469.md"
  sed -i 's/\(BOXP-469: grant race\]\].*\)assignee::boxp/\1assignee::codex/' "${vault}/Boards/Task Board.md"
  # The stop re-reads the budget, then (test hook) holds the budget lock
  # before the Blocked transition.  An Owner grant issued in that window must
  # wait for the transition instead of landing between the re-read and the
  # Blocked move; otherwise the card would be stopped as "exhausted" while
  # the budget file already shows remaining budget.
  # The hold lasts until the release file is written (30s cap), so the
  # check below does not depend on process start-up time.
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_TEST_GATE_BUDGET_STOP_HOLD_AFTER_READ_MILLIS=30000 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-469 >/dev/null &
  local tick_pid=$!
  for i in $(seq 1 300); do
    [[ -f "${state}/test-gate-budget-stop-holding" ]] && break
    sleep 0.1
  done
  [[ -f "${state}/test-gate-budget-stop-holding" ]] || fail "the stop never reached the hold window"
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-469 --amount 1 --by boxp >/dev/null &
  local grant_pid=$!
  # Wait until the grant process has opened the budget lock file (it is then
  # inside the lock attempt) or has already finished (zombie / gone).  While
  # the stop still holds the lock, the grant must not have been recorded.
  for i in $(seq 1 300); do
    if ! grep -q 'State:[[:space:]]*[RSD]' "/proc/${grant_pid}/status" 2>/dev/null; then break; fi
    if ls -l "/proc/${grant_pid}/fd" 2>/dev/null | grep -q 'gate-failure-budget.lock'; then break; fi
    sleep 0.1
  done
  sleep 0.5
  assert_file_not_contains "${state}/gate-failure-budget.edn" ':scope :ticket, :key "BOXP-469", :amount 1'
  assert_file_not_contains "${vault}/Tickets/BOXP-469.md" 'gate-budget-stop-'
  : > "${state}/test-gate-budget-stop-release"
  wait "${grant_pid}" || fail "grant must succeed after the stop"
  # The grant returned: the stop must already have completed (the grant was
  # serialized behind the transition), and the card must not still be in the
  # pre-stop state with the grant recorded underneath it.
  assert_file_contains "${vault}/Tickets/BOXP-469.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-469.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-469.md" 'run=none; transition-id=BOXP-469/gate-budget-stop-'
  wait "${tick_pid}"
  [[ "$(budget_run_count "${state}" BOXP-469)" == 2 ]] || fail "no run may start on the reassigned Blocked card"
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-469.md")" == 1 ]] || fail "exactly one stop note expected"
  assert_file_contains "${state}/gate-failure-budget.edn" ':scope :ticket, :key "BOXP-469", :amount 1'
  if ls "${state}"/locks/BOXP-469.edn >/dev/null 2>&1; then
    fail "the stop must release the ticket lock"
  fi
  # A grant that lands before the re-read is honoured: with both scopes
  # granted, the Owner's lane move starts exactly one run and no stop is
  # written.
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant boxp/example#901 --amount 1 --by boxp >/dev/null
  budget_set_lane "${vault}" BOXP-469 "grant race" codex
  budget_fail_tick "${vault}" "${state}" "${bin}" c 901 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  [[ "$(budget_run_count "${state}" BOXP-469)" == 3 ]] || fail "a grant for both scopes must allow one run"
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-469.md")" == 1 ]] || fail "a granted card must not be stopped again"
}

test_gate_failure_budget_stricter_short_term_limit_still_applies() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-464|BOXP-464: short]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-464 in-progress codex boxp/example
  budget_fail_tick "${vault}" "${state}" "${bin}" same 401 CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=1
  budget_fail_tick "${vault}" "${state}" "${bin}" same 401 CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=1
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-464: short\]\].*status::blocked'
  assert_file_contains "${vault}/Tickets/BOXP-464.md" 'category=pr-gate-retry-limit'
}

test_gate_failure_budget_concurrent_updates_do_not_lose_counts() {
  local tmp state i out
  tmp="$(mktemp -d)"; state="${tmp}/state"
  # Concurrent processes append grants under the FileLock; none may be lost.
  for i in 1 2 3 4 5 6 7 8; do
    CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-465 --amount 1 --by boxp >/dev/null &
  done
  wait
  out="$(CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-status BOXP-465)"
  [[ "${out}" == *':used 0'* && "${out}" == *':limit 18'* ]] || fail "concurrent grants lost: ${out}"
}

test_gate_failure_budget_concurrent_ticks_do_not_lose_counts() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-466|BOXP-466: race a]] #ticket status::in-progress
- [ ] [[Tickets/BOXP-467|BOXP-467: race b]] #ticket status::in-progress"
  write_ticket "${vault}" BOXP-466 in-progress codex boxp/example
  write_ticket "${vault}" BOXP-467 in-progress codex boxp/example
  # Both tickets fail on the same PR in separate processes while the budget
  # writer holds the lock; the shared PR must count 2.
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"x","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/501\nTASK_BOARD_RESULT: review' CODEX_TASK_BOARD_TEST_GATE_BUDGET_HOLD_MILLIS=500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-466 >/dev/null &
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"y","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/501\nTASK_BOARD_RESULT: review' CODEX_TASK_BOARD_TEST_GATE_BUDGET_HOLD_MILLIS=500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-467 >/dev/null &
  wait
  [[ "$(bb -e '(let [b (read-string (slurp (first *command-line-args*)))] (println (count (filter #(= "boxp/example#501" (:pr %)) (vals (:failures b))))))' "${state}/gate-failure-budget.edn")" == 2 ]] || fail "concurrent gate failures lost a count"
}

test_delegation_gate_end_to_end() {
  local tmp vault state bin mode ticket summary
  for mode in success failed missing; do
    tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
    mkdir -p "${bin}" "${tmp}/codex-home/sessions"
    make_fake_claude "${bin}"
    cat >"${bin}/codex" <<'FAKE'
#!/usr/bin/env python3
import json, os, pathlib, sys
pathlib.Path(os.environ['TEST_CHILD_ARGS']).write_text(json.dumps(sys.argv))
ident = '11111111-1111-4111-8111-111111111111'
model = sys.argv[sys.argv.index('--model') + 1]
path = pathlib.Path(os.environ['CODEX_HOME']) / 'sessions' / ('rollout-' + ident + '.jsonl')
events = [{'type':'session_meta','payload':{'id':ident}}, {'type':'turn_context','payload':{'model':model}}, {'type':'event_msg','payload':{'type':'task_complete'}}]
path.write_text(''.join(json.dumps(x) + '\n' for x in events))
print(json.dumps({'type':'thread.started','thread_id':ident}))
print(json.dumps({'type':'turn.completed'}))
sys.exit(1 if os.environ['TEST_CHILD_FAILURE'] == 'true' else 0)
FAKE
    chmod +x "${bin}/codex"
    ticket=BOXP-999
    write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: delegation]] #ticket status::in-progress"
    write_ticket "${vault}" "${ticket}" in-progress fable
    PATH="${bin}:$PATH" CODEX_HOME="${tmp}/codex-home" \
      CODEX_TASK_BOARD_BYPASS_APPROVALS=false CLAUDE_FAKE_ARG_LOG="${tmp}/parent-args" TEST_CHILD_ARGS="${tmp}/child-args" \
      TEST_DELEGATION_MODE="$(if [[ "${mode}" == missing ]]; then echo missing; else echo run; fi)" \
      TEST_CHILD_FAILURE="$(if [[ "${mode}" == failed ]]; then echo true; else echo false; fi)" \
      CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >/dev/null
    summary="$(find "${state}/runs/${ticket}" -name summary.edn -print | head -n 1)"
    if [[ "${mode}" == success ]]; then
      assert_file_contains "${summary}" ':status :succeeded'
      assert_file_contains "${tmp}/parent-args" "--add-dir $(dirname "${summary}")"
      python3 - "${tmp}/child-args" "${vault}" <<'CHECK'
import json, sys
args = json.load(open(sys.argv[1]))
assert sys.argv[2] in [args[i + 1] for i, arg in enumerate(args) if arg == '--add-dir']
CHECK
    else
      assert_file_contains "${summary}" ':status :blocked'
      assert_file_contains "${summary}" ':exit-code 1'
      assert_file_not_contains "${vault}/Tickets/${ticket}.md" '^status: done$'
    fi
  done
}

test_recoverable_delegation_failure_continues() {
  # BOXP-395: a run-local delegation failure stays with the worker, inside the
  # continuation limit. It does not wait for a person and cannot reach done.
  local tmp vault state bin ticket=BOXP-998 prompt_log
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; prompt_log="${tmp}/prompt"
  mkdir -p "${bin}"
  make_fake_claude "${bin}"
  printf '#!/bin/sh\nexit 1\n' >"${bin}/codex"
  chmod +x "${bin}/codex"
  write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: delegation]] #ticket status::in-progress"
  write_ticket "${vault}" "${ticket}" in-progress fable
  PATH="${bin}:$PATH" CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" TEST_DELEGATION_MODE=run \
    CLAUDE_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >/dev/null
  assert_file_contains "${vault}/Tickets/${ticket}.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/${ticket}.md" '^assignee: fable$'
  assert_file_contains "${prompt_log}" 'is not a blocker by itself'
  # The failed attempt is not erased.
  assert_file_contains "$(find "${state}/runs/${ticket}" -name delegation.json | head -n 1)" 'failed|"exit": 1'

  # The next run has its own attempt, and done without verified delegation is still refused.
  PATH="${bin}:$PATH" TEST_DELEGATION_MODE=run CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >/dev/null
  assert_file_not_contains "${vault}/Tickets/${ticket}.md" '^status: done$'
  assert_file_contains "${vault}/Tickets/${ticket}.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/${ticket}.md" 'category=agent-process-error'
}

test_helper_update_keeps_notes_copy() {
  local tmp vault board copy
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; board="${vault}/Boards/Task Board.md"
  copy='- [ ] [[Tickets/BOXP-993|BOXP-993: test]] #ticket status::in-progress assignee::boxp'
  write_board "${vault}" "${copy}"
  write_ticket "${vault}" BOXP-993 in-progress boxp
  printf '\n## Notes\n%s\nnote about BOXP-993\n' "${copy}" >>"${board}"
  bb "${HELPER}" update BOXP-993 --vault "${vault}" --lane Ready --json >/dev/null
  [[ "$(grep -Fc '[[Tickets/BOXP-993|' "${board}")" == 2 ]] || fail 'expected two BOXP-993 copies'
  sed -n '/^## Notes/,/^## /p' "${board}" | grep -Fxq -- "${copy}" || fail 'Notes copy missing'
  assert_file_contains "${board}" '^note about BOXP-993$'
  sed -n '/^## Ready/,/^## In Progress/p' "${board}" | grep -Fq '[[Tickets/BOXP-993|' || fail 'Ready card missing'
  if sed -n '/^## In Progress/,/^## Blocked/p' "${board}" | grep -Fq '[[Tickets/BOXP-993|'; then
    fail 'In Progress card remains'
  fi
  rm -rf "${tmp}"
}

test_assignment_revisions() {
  local tmp vault state bin rev result code
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-990|BOXP-990: test]] #ticket status::in-progress assignee::boxp'
  write_ticket "${vault}" BOXP-990 review boxp
  result="$(bb "${HELPER}" update BOXP-990 --vault "${vault}" --lane Ready --assignee codex --note 'assignment note' --json)"
  rev="$(printf '%s' "${result}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["rev"])')"
  assert_file_contains "${vault}/Tickets/BOXP-990.md" "^board_rev: ${rev}$"
  assert_file_contains "${vault}/Tickets/BOXP-990.md" 'assignment note'
  assert_file_contains "${vault}/Boards/Task Board.md" "rev::${rev}"
  bb "${HELPER}" show BOXP-990 --vault "${vault}" --json | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["consistency"]["rev-match"] and x["consistency"]["assignee-match"]'
  bb "${HELPER}" verify-dispatch BOXP-990 --vault "${vault}" --expected-rev "${rev}" --assignee codex --json | python3 -c 'import json,sys; assert json.load(sys.stdin)["state"] == "awaiting-pickup"'
  sed -i "s/^board_rev: .*/board_rev: old/; s/^assignee: .*/assignee: boxp/; s/^status: .*/status: review/" "${vault}/Tickets/BOXP-990.md"
  cp "${vault}/Tickets/BOXP-990.md" "${tmp}/before"
  set +e
  bb "${HELPER}" verify-dispatch BOXP-990 --vault "${vault}" --expected-rev "${rev}" --json >"${tmp}/verify"
  code=$?
  set -e
  [[ "$code" == 5 ]] || fail 'expected pending-sync exit 5'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/tick"
  cmp "${tmp}/before" "${vault}/Tickets/BOXP-990.md" || fail 'mismatch rewrote ticket'
  [[ ! -e "${tmp}/starts" ]] || fail 'mismatch started agent'
  sed -i "s/^board_rev: .*/board_rev: ${rev}/; s/^assignee: .*/assignee: codex/; s/^status: .*/status: ready/" "${vault}/Tickets/BOXP-990.md"
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/tick2"
  assert_file_contains "${tmp}/starts" BOXP-990
  assert_file_contains "${vault}/Boards/Task Board.md" 'assignee::boxp'
  bb "${HELPER}" verify-dispatch BOXP-990 --vault "${vault}" --expected-rev "${rev}" --json | python3 -c 'import json,sys; assert json.load(sys.stdin)["state"] == "started"'
  sed -n '/\[\[Tickets\/BOXP-990|/p' "${vault}/Boards/Task Board.md" >>"${vault}/Boards/Task Board.md"
  bb "${HELPER}" show BOXP-990 --vault "${vault}" --json | python3 -c 'import json,sys; assert json.load(sys.stdin)["consistency"]["duplicate-cards"] == 2'
}

test_assignment_superseded() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-991|BOXP-991: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-991 in-progress codex
  # A superseded run's done is discarded, so it must not reset the continuation budget.
  mkdir -p "${state}"
  printf '{"BOXP-991" {:count 3}}\n' >"${state}/continuation-budget.edn"
  bb "${HELPER}" update BOXP-991 --vault "${vault}" --lane Ready --assignee codex >/dev/null
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >"${tmp}/tick" &
  local pid=$!
  for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
  [[ -e "${tmp}/starts" ]] || fail 'agent did not start'
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-991 --vault "${vault}" --required --text late --source test >/dev/null
  bb "${HELPER}" update BOXP-991 --vault "${vault}" --lane Ready --assignee boxp --note 'new assignment' >/dev/null
  wait "${pid}"
  assert_file_contains "${vault}/Tickets/BOXP-991.md" '^assignee: boxp$'
  assert_file_contains "${vault}/Tickets/BOXP-991.md" 'newer assignment \(board_rev'
  assert_file_contains "${vault}/Boards/Task Board.md" 'status::ready.*assignee::boxp'
  assert_run_summary_contains "${state}" BOXP-991 ':superseded-by'
  assert_file_not_contains "${vault}/Tickets/BOXP-991.md" 'runの結果を保留'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}

test_assignment_repairs() {
  local tmp vault state bin old new rev1 rev2
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"
  make_fake_codex "${bin}"
  old="rs-0000"; new="pnhdlqrk-0000"
  # A newer ticket is a complete helper write whose card update was lost: the card is repaired and dispatched.
  write_board "${vault}" "- [ ] [[Tickets/BOXP-992|BOXP-992: test]] #ticket status::in-progress assignee::boxp rev::${old}"
  write_ticket "${vault}" BOXP-992 ready codex
  sed -i "s/^type: task$/type: task\nboard_rev: ${new}/" "${vault}/Tickets/BOXP-992.md"
  cp "${vault}/Boards/Task Board.md" "${tmp}/board-before"
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/tick0" 2>&1
  cmp "${tmp}/board-before" "${vault}/Boards/Task Board.md" || fail 'card repaired inside the warn window'
  [[ ! -e "${tmp}/starts" ]] || fail 'stale card dispatched inside the warn window'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env CODEX_TASK_BOARD_REV_MISMATCH_WARN_SECONDS=0 >"${tmp}/tick" 2>&1
  assert_file_contains "${tmp}/tick" 'the card write was lost, repairing the card from ticket rev=.* for BOXP-992|BOXP-992; the card write was lost'
  assert_file_contains "${tmp}/starts" BOXP-992
  # The dispatched run's terminal transition issues a fresh revision on both
  # the card and the ticket, so the repaired stale revision is gone.
  rev1="$(sed -n 's/^board_rev: //p' "${vault}/Tickets/BOXP-992.md")"
  [[ -n "${rev1}" && "${rev1}" != "${old}" ]] || fail "stale ticket revision after repair: ${rev1}"
  assert_file_contains "${vault}/Boards/Task Board.md" "BOXP-992.*rev::${rev1}"
  assert_file_not_contains "${vault}/Boards/Task Board.md" "BOXP-992.*rev::${old}"
  # A newer card whose ticket never arrives: after the warn window the ticket frontmatter is repaired from the card.
  rm -rf "${vault}" "${state}" "${tmp}/starts"
  write_board "${vault}" "- [ ] [[Tickets/BOXP-993|BOXP-993: test]] #ticket status::in-progress assignee::codex rev::${new}"
  write_ticket "${vault}" BOXP-993 review boxp
  sed -i "s/^type: task$/type: task\nboard_rev: ${old}/" "${vault}/Tickets/BOXP-993.md"
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env CODEX_TASK_BOARD_REV_MISMATCH_WARN_SECONDS=0 >"${tmp}/tick" 2>&1
  assert_file_contains "${tmp}/tick" 'WARN: assignment revision mismatch persisted for BOXP-993'
  # The repaired ticket carries the card's assignee, so the same tick dispatches it.
  assert_file_contains "${tmp}/tick" 'processing BOXP-993 from In Progress'
  assert_file_contains "${tmp}/starts" BOXP-993
  # The dispatched run's terminal transition then issues a fresh revision to both.
  rev1="$(sed -n 's/^board_rev: //p' "${vault}/Tickets/BOXP-993.md")"
  [[ -n "${rev1}" && "${rev1}" != "${old}" ]] || fail "stale ticket revision after repair: ${rev1}"
  assert_file_contains "${vault}/Boards/Task Board.md" "BOXP-993.*rev::${rev1}"
  # Notes and text edits keep the revision; only a lane or assignee change issues a new one.
  rm -rf "${vault}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-994|BOXP-994: test]] #ticket status::in-progress assignee::boxp'
  write_ticket "${vault}" BOXP-994 in-progress boxp
  rev1="$(bb "${HELPER}" update BOXP-994 --vault "${vault}" --lane Ready --assignee codex --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["rev"])')"
  rev2="$(bb "${HELPER}" update BOXP-994 --vault "${vault}" --note 'progress only' --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["rev"])')"
  [[ -n "${rev1}" && "${rev1}" == "${rev2}" ]] || fail "note-only update changed revision ${rev1} -> ${rev2}"
  assert_file_contains "${vault}/Boards/Task Board.md" "rev::${rev1}"
}


test_dynamic_todo_midrun() {
  local tmp vault state bin pid rev board_rev
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-990|BOXP-990: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-990 in-progress codex
  bb "${HELPER}" update BOXP-990 --vault "${vault}" --lane Ready --assignee codex >/dev/null
  board_rev="$(sed -n 's/^board_rev: //p' "${vault}/Tickets/BOXP-990.md")"
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TODO_HOOKS=false CODEX_FAKE_ARG_LINES="${tmp}/args" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 run_tick "${vault}" "${state}" env >"${tmp}/tick" &
  pid=$!
  for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
  [[ -e "${tmp}/starts" ]] || fail 'agent did not start'
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-990 --vault "${vault}" --required --text task --source test >/dev/null
  wait "${pid}"
  assert_file_contains "${vault}/Tickets/BOXP-990.md" '^status: ready$'
  assert_file_contains "${vault}/Tickets/BOXP-990.md" '^assignee: codex$'
  assert_file_contains "${vault}/Tickets/BOXP-990.md" 'runの結果を保留'
  [[ "${board_rev}" == "$(sed -n 's/^board_rev: //p' "${vault}/Tickets/BOXP-990.md")" ]] || fail 'todo_state changed board_rev'
  assert_file_not_contains "${tmp}/tick" 'newer assignment'
  assert_file_not_contains "${tmp}/args" '^--dangerously-bypass-hook-trust$'
  assert_run_summary_contains "${state}" BOXP-990 ':gate "held"'
  assert_run_summary_contains "${state}" BOXP-990 ':result "continue"'
  PATH="${bin}:$PATH" CODEX_FAKE_PROMPT_LOG="${tmp}/prompt" CODEX_FAKE_TODO_VAULT="${vault}" CODEX_FAKE_TODO_MODULE="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" run_tick "${vault}" "${state}" env >"${tmp}/tick2"
  assert_file_contains "${tmp}/prompt" "read back merges and external operations"
  assert_file_contains "${tmp}/prompt" "TD-01【必須】task"
  assert_file_contains "${vault}/Tickets/BOXP-990.md" '^status: done$'
}

# Mock paths: agents and vaults below are isolated temporary fixtures.
test_todo_optional_and_legacy() {
  local tmp vault state bin pid
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-980|BOXP-980: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-980 in-progress codex
  # Establish a received body before the optional-only mid-run addition.
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-980 --vault "${vault}" --optional --text baseline --source test >/dev/null
  local rev
  rev="$(bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" status BOXP-980 --vault "${vault}" --json | bb -e '(require (quote cheshire.core)) (println (:rev (cheshire.core/parse-string (slurp *in*) true)))')"
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" ack BOXP-980 --vault "${vault}" --rev "${rev}" >/dev/null
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
  for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-980 --vault "${vault}" --optional --text optional --source test >/dev/null
  wait "${pid}"
  assert_file_contains "${vault}/Tickets/BOXP-980.md" '^status: done$'
  assert_file_contains "${vault}/Tickets/BOXP-980.md" 'todo_state: .*unreceived=1 open=1'
  rm -rf "${vault}" "${state}" "${tmp}/starts"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-981|BOXP-981: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-981 in-progress codex
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 run_tick "${vault}" "${state}" env >"${tmp}/legacy" & pid=$!
  for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
  sed -i '/^## Summary$/a changed legacy body' "${vault}/Tickets/BOXP-981.md"
  wait "${pid}"
  assert_file_contains "${vault}/Tickets/BOXP-981.md" '^status: ready$'
  PATH="${bin}:$PATH" run_tick "${vault}" "${state}" env >"${tmp}/legacy2"
  assert_file_contains "${vault}/Tickets/BOXP-981.md" '^status: done$'
}

test_todo_post_move_recheck() {
  local tmp vault state bin pid
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-982|BOXP-982: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-982 in-progress codex
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_TODO_RECHECK_DIR="${tmp}" run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
  for _ in $(seq 1 300); do [[ -e "${tmp}/moved" ]] && break; sleep 0.1; done
  [[ -e "${tmp}/moved" ]] || fail 'post-move rendezvous missing'
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-982 --vault "${vault}" --required --text late --source test >/dev/null
  touch "${tmp}/continue"; wait "${pid}"
  if [[ "${CODEX_TASK_BOARD_CONTINUATION_LIMIT:-8}" == 0 ]]; then
    assert_file_contains "${vault}/Tickets/BOXP-982.md" '^status: blocked$'
    assert_file_contains "${vault}/Tickets/BOXP-982.md" 'todo-gate-exhausted'
    assert_file_contains "${vault}/Tickets/BOXP-982.md" 'finished with result blocked'
  else
    assert_file_contains "${vault}/Tickets/BOXP-982.md" '^status: ready$'
    assert_file_contains "${vault}/Tickets/BOXP-982.md" 'finished with result ready'
  fi
  assert_file_not_contains "${vault}/Tickets/BOXP-982.md" 'finished with result done'
  assert_run_summary_contains "${state}" BOXP-982 ':gate "held"'
  assert_run_summary_contains "${state}" BOXP-982 ':result "continue"'
  local ledger
  ledger="$(find "${state}/ai-ops/ledger" -name 'events-*.jsonl' | head -n 1)"
  if [[ "${CODEX_TASK_BOARD_CONTINUATION_LIMIT:-8}" == 0 ]]; then
    assert_run_summary_contains "${state}" BOXP-982 ':blocker-category "todo-gate-exhausted"'
    assert_file_contains "${ledger}" '"lane_to":"blocked"'
    assert_file_contains "${ledger}" '"status":"blocked"'
  else
    assert_file_contains "${ledger}" '"lane_to":"ready"'
    assert_file_not_contains "${ledger}" '"lane_to":"done"'
    [[ ! -d "${state}/outbox/pending" ]] || ! find "${state}/outbox/pending" -type f | grep -q . || fail 'held run emitted a Task Board wake event'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-982'
}

test_todo_post_move_recheck_exhausted() {
  CODEX_TASK_BOARD_CONTINUATION_LIMIT=0 test_todo_post_move_recheck
}

test_todo_blocked_post_move_recheck() {
  local tmp vault state bin pid limit="${CODEX_TASK_BOARD_CONTINUATION_LIMIT:-8}"
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-986|BOXP-986: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-986 in-progress codex
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_CONTINUATION_LIMIT="${limit}" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' CODEX_TASK_BOARD_TEST_TODO_RECHECK_DIR="${tmp}" run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
  for _ in $(seq 1 300); do [[ -e "${tmp}/moved" ]] && break; sleep 0.1; done
  [[ -e "${tmp}/moved" ]] || fail 'blocked post-move rendezvous missing'
  assert_file_contains "${vault}/Tickets/BOXP-986.md" '^status: blocked$'
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-986 --vault "${vault}" --required --text late --source test >/dev/null
  touch "${tmp}/continue"; wait "${pid}"
  assert_run_summary_contains "${state}" BOXP-986 ':gate "held"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-986'
  local ledger
  ledger="$(find "${state}/ai-ops/ledger" -name 'events-*.jsonl' | head -n 1)"
  if [[ "${limit}" == 0 ]]; then
    assert_file_contains "${vault}/Tickets/BOXP-986.md" '^status: blocked$'
    assert_file_contains "${vault}/Tickets/BOXP-986.md" '継続予算切れのためBlockedのまま。未受領: .*TD-01'
    assert_run_summary_contains "${state}" BOXP-986 ':status :blocked'
    assert_file_contains "${ledger}" '"lane_to":"blocked"'
  else
    assert_file_contains "${vault}/Tickets/BOXP-986.md" '^status: ready$'
    assert_file_contains "${vault}/Tickets/BOXP-986.md" '^assignee: codex$'
    assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-986'
    assert_file_contains "${vault}/Tickets/BOXP-986.md" 'Blockedを保留して担当の次runへ継続: .*TD-01'
    assert_run_summary_contains "${state}" BOXP-986 ':result "continue"'
    assert_file_not_contains "$(find "${state}/runs/BOXP-986" -name summary.edn | sort | tail -n 1)" ':blocker-category'
    assert_file_contains "${ledger}" '"lane_to":"ready"'
    assert_file_not_contains "${ledger}" '"lane_to":"blocked"'
  fi
  # An optional addition leaves the Blocked result alone.
  local vault2="${tmp}/vault2" state2="${tmp}/state2"
  rm -f "${tmp}/moved" "${tmp}/continue"
  write_board "${vault2}" '- [ ] [[Tickets/BOXP-987|BOXP-987: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault2}" BOXP-987 in-progress codex
  local todo_module="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" rev
  bb "${todo_module}" add BOXP-987 --vault "${vault2}" --required --text work --source test >/dev/null
  rev="$(bb "${todo_module}" status BOXP-987 --vault "${vault2}" --json | bb -e '(require (quote cheshire.core)) (println (:rev (cheshire.core/parse-string (slurp *in*) true)))')"
  bb "${todo_module}" ack BOXP-987 --vault "${vault2}" --rev "${rev}" >/dev/null
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' CODEX_TASK_BOARD_TEST_TODO_RECHECK_DIR="${tmp}" run_tick "${vault2}" "${state2}" env >"${tmp}/tick2" & pid=$!
  for _ in $(seq 1 300); do [[ -e "${tmp}/moved" ]] && break; sleep 0.1; done
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-987 --vault "${vault2}" --optional --text later --source test >/dev/null
  touch "${tmp}/continue"; wait "${pid}"
  assert_file_contains "${vault2}/Tickets/BOXP-987.md" '^status: blocked$'
  assert_file_not_contains "${vault2}/Tickets/BOXP-987.md" '判定直後の追加'
}

test_todo_blocked_post_move_recheck_exhausted() {
  CODEX_TASK_BOARD_CONTINUATION_LIMIT=0 test_todo_blocked_post_move_recheck
}

test_todo_plan_protection() {
  local tmp vault
  tmp="$(mktemp -d)"; vault="${tmp}/vault"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-983|BOXP-983: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-983 in-progress codex
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-983 --vault "${vault}" --required --text protected --source test >/dev/null
  if bb "${HELPER}" update BOXP-983 --vault "${vault}" --plan 'other' >"${tmp}/out" 2>"${tmp}/err"; then fail 'plan protection did not reject'; fi
  assert_file_contains "${tmp}/err" 'changes existing TD items'
  bb "${HELPER}" update BOXP-983 --vault "${vault}" --plan 'other' --force-plan >"${tmp}/out"
  assert_file_not_contains "${vault}/Tickets/BOXP-983.md" 'TD-01'
}

test_todo_budget_exhausted() {
  local tmp vault state bin pid
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-984|BOXP-984: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-984 in-progress codex
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_CONTINUATION_LIMIT=0 CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
  for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
  bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-984 --vault "${vault}" --required --text task --source test >/dev/null
  wait "${pid}"
  assert_file_contains "${vault}/Tickets/BOXP-984.md" '^status: blocked$'
  assert_file_contains "${vault}/Tickets/BOXP-984.md" 'todo-gate-exhausted'
  assert_run_summary_contains "${state}" BOXP-984 ':gate "held"'
  assert_run_summary_contains "${state}" BOXP-984 ':result "continue"'
}

test_todo_hook_arguments() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault with 'quote"; state="${tmp}/state with \"quote"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-985|BOXP-985: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-985 in-progress codex
  PATH="${bin}:$PATH" CODEX_FAKE_ARG_LINES="${tmp}/args" run_tick "${vault}" "${state}" env >"${tmp}/tick"
  assert_file_contains "${tmp}/args" '^--dangerously-bypass-hook-trust$'
  bb -e '
    (require (quote [clojure.string :as str]))
    (let [lines (filter #(str/starts-with? % "hooks.") (str/split-lines (slurp (first *command-line-args*))))
          ;; TOML basic strings allow only these escapes and exclude control characters.
          basic "\\\"(?:[^\\\"\\\\\\x00-\\x1f]|\\\\(?:[\\\"\\\\bfnrt]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}))*\\\""
          pattern (re-pattern (str "hooks\\.(PostToolUse|PreToolUse|Stop)=\\[\\{matcher=" basic ",hooks=\\[\\{type=\\\"command\\\",command=" basic "\\}\\]\\}\\]"))]
      (when-not (and (= 3 (count lines)) (every? #(re-matches pattern %) lines))
        (binding [*out* *err*] (println "invalid hook TOML"))
        (System/exit 1)))' "${tmp}/args"
}

test_todo_concurrent_writers() {
  local tmp vault state bin pid rev todo plan
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  todo="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-986|BOXP-986: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-986 in-progress codex
  bb "${todo}" add BOXP-986 --vault "${vault}" --id TD-01 --required --text first --source test >/dev/null
  rev="$(bb "${todo}" status BOXP-986 --vault "${vault}" --json | bb -e '(require (quote cheshire.core)) (println (:rev (cheshire.core/parse-string (slurp *in*) true)))')"
  # Race helper writes with the runner's frontmatter and Notes writes. A stale
  # ack is an expected CAS failure and is retried after all changes settle.
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
  for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
  plan=$'- [x] TD-01【必須】first\n  - 由来: test'
  bb "${HELPER}" update BOXP-986 --vault "${vault}" --plan "$plan" >"${tmp}/checkbox" 2>&1 & local c=$!
  bb "${todo}" add BOXP-986 --vault "${vault}" --id TD-02 --optional --text second --source test >"${tmp}/add" & local a=$!
  bb "${HELPER}" append-note BOXP-986 --vault "${vault}" --source test --note 'parallel note' >"${tmp}/note" & local n=$!
  bb "${todo}" ack BOXP-986 --vault "${vault}" --rev "${rev}" >"${tmp}/ack" 2>&1 & local k=$!
  wait "$a"; wait "$n"; wait "$k" || true
  # If the add won, the plan guard correctly rejects the stale plan.
  wait "$c" || true
  wait "$pid"
  rev="$(bb "${todo}" status BOXP-986 --vault "${vault}" --json | bb -e '(require (quote cheshire.core)) (println (:rev (cheshire.core/parse-string (slurp *in*) true)))')"
  bb "${todo}" ack BOXP-986 --vault "${vault}" --rev "$rev" >/dev/null
  # update --plan serializes checkbox edits with the same file lock.
  plan=$'- [x] TD-01【必須】first\n  - 由来: test\n- [ ] TD-02【任意】second\n  - 由来: test'
  bb "${HELPER}" update BOXP-986 --vault "${vault}" --plan "$plan" >/dev/null
  assert_file_contains "${vault}/Tickets/BOXP-986.md" 'parallel note'
  assert_file_contains "${vault}/Tickets/BOXP-986.md" '\[x\] TD-01【必須】first'
  assert_file_contains "${vault}/Tickets/BOXP-986.md" 'TD-02【任意】second'
  assert_file_contains "${vault}/Tickets/BOXP-986.md" '^todo_ack_rev:'
  assert_file_contains "${vault}/Tickets/BOXP-986.md" 'runの結果を保留'
}

test_todo_restart_delivery() {
  local tmp vault state bin old_run todo before rev
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; old_run="20260710T000000Z"
  todo="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb"
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-987/${old_run}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-987|BOXP-987: test]] #ticket status::in-progress assignee::codex'
  write_ticket "${vault}" BOXP-987 in-progress codex
  bb "${todo}" add BOXP-987 --vault "${vault}" --required --text restart-work --source test >/dev/null
  before="$(cat "${vault}/Tickets/BOXP-987.md")"
  bb "${todo}" add BOXP-987 --vault "${vault}" --required --text restart-work --source test >/dev/null
  [[ "${before}" == "$(cat "${vault}/Tickets/BOXP-987.md")" ]] || fail 'duplicate add changed ticket'
  printf '%s\n' '{:ticket "BOXP-987" :run-id "20260710T000000Z" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "2000-01-01T00:00:00Z"}' >"${state}/locks/BOXP-987.edn"
  PATH="${bin}:$PATH" CODEX_FAKE_PROMPT_LOG="${tmp}/prompt" CODEX_FAKE_TODO_VAULT="${vault}" CODEX_FAKE_TODO_MODULE="${todo}" run_tick "${vault}" "${state}" env >"${tmp}/tick"
  assert_file_contains "${state}/runs/BOXP-987/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${tmp}/prompt" 'TD-01【必須】restart-work'
  assert_file_contains "${vault}/Tickets/BOXP-987.md" '^status: done$'
  rev="$(bb "${todo}" status BOXP-987 --vault "${vault}" --json | bb -e '(require (quote cheshire.core)) (println (:rev (cheshire.core/parse-string (slurp *in*) true)))')"
  before="$(cat "${vault}/Tickets/BOXP-987.md")"
  bb "${todo}" ack BOXP-987 --vault "${vault}" --rev "${rev}" >/dev/null
  [[ "${before}" == "$(cat "${vault}/Tickets/BOXP-987.md")" ]] || fail 'duplicate ack changed ticket'
}

test_todo_preserves_existing_outcomes() {
  local tmp vault state bin pid mode
  for mode in continue nonzero; do
    tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
    mkdir -p "${bin}"; make_fake_codex "${bin}"
    write_board "${vault}" '- [ ] [[Tickets/BOXP-988|BOXP-988: test]] #ticket status::in-progress assignee::codex'
    write_ticket "${vault}" BOXP-988 in-progress codex
    local result=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' exitcode=0
    if [[ "$mode" == nonzero ]]; then result='TASK_BOARD_RESULT: done'; exitcode=2; fi
    PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 CODEX_FAKE_EXIT="${exitcode}" CODEX_FAKE_MESSAGE="${result}" run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
    for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
    bb "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb" add BOXP-988 --vault "${vault}" --required --text later --source test >/dev/null
    wait "${pid}"
    if [[ "$mode" == nonzero ]]; then
      assert_file_contains "${vault}/Tickets/BOXP-988.md" '^status: blocked$'
    else
      assert_file_contains "${vault}/Tickets/BOXP-988.md" '^status: ready$'
    fi
    assert_file_not_contains "${vault}/Tickets/BOXP-988.md" 'runの結果を保留'
  done
}

test_todo_existing_holds_win() {
  local tmp vault state bin pid mode todo
  todo="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb"
  for mode in review idle; do
    tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
    mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_claude "${bin}"
    if [[ "$mode" == review ]]; then
      write_board "${vault}" '- [ ] [[Tickets/BOXP-989|BOXP-989: test]] #ticket status::in-progress assignee::codex'
      write_ticket "${vault}" BOXP-989 in-progress codex
      PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
    else
      write_board "${vault}" '- [ ] [[Tickets/BOXP-989|BOXP-989: test]] #ticket status::in-progress assignee::fable'
      write_ticket "${vault}" BOXP-989 in-progress fable
      PATH="${bin}:$PATH" CLAUDE_FAKE_START_LOG="${tmp}/starts" CLAUDE_FAKE_SLEEP=8 CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=2 run_tick "${vault}" "${state}" env >"${tmp}/tick" & pid=$!
    fi
    for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
    [[ -e "${tmp}/starts" ]] || fail 'mock agent did not start'
    bb "${todo}" add BOXP-989 --vault "${vault}" --required --text pending --source test >/dev/null
    wait "${pid}"
    assert_file_contains "${vault}/Tickets/BOXP-989.md" '^status: in-progress$'
    assert_file_not_contains "${vault}/Tickets/BOXP-989.md" 'runの結果を保留'
    if [[ "$mode" == review ]]; then
      assert_file_contains "${vault}/Tickets/BOXP-989.md" 'Review gate failed'
    else
      assert_run_summary_contains "${state}" BOXP-989 ':idle-timeout\? true'
    fi
  done
}

test_terminal_revision_lww_and_duplicates() {
  local tmp vault state bin mode rev before variant
  # norev: a legacy card without rev:: before the terminal stamp must not be
  # projected back either when the old Board copy is restored.
  for variant in rev norev; do
  for mode in blocked done; do
    tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
    mkdir -p "${bin}"; make_fake_codex "${bin}"
    if [[ "${variant}" == rev ]]; then
      write_board "${vault}" '- [ ] [[Tickets/BOXP-991|BOXP-991: test]] #ticket status::in-progress assignee::codex rev::old'
      write_ticket "${vault}" BOXP-991 in-progress codex
      sed -i '/^status:/a board_rev: old' "${vault}/Tickets/BOXP-991.md"
    else
      write_board "${vault}" '- [ ] [[Tickets/BOXP-991|BOXP-991: test]] #ticket status::in-progress assignee::codex'
      write_ticket "${vault}" BOXP-991 in-progress codex
    fi
    cp "${vault}/Boards/Task Board.md" "${tmp}/old"
    PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE="TASK_BOARD_RESULT: ${mode}" run_tick "${vault}" "${state}" env >"${tmp}/run"
    assert_file_contains "${vault}/Tickets/BOXP-991.md" "^status: ${mode}$"
    rev="$(sed -n 's/^board_rev: //p' "${vault}/Tickets/BOXP-991.md")"
    [[ "$rev" != old && "$rev" =~ ^[a-z0-9]+-[0-9a-f]{4}$ ]] || fail 'missing fresh revision'
    assert_file_contains "${vault}/Boards/Task Board.md" "rev::${rev}"
    assert_run_summary_contains "${state}" BOXP-991 ':status :(blocked|succeeded)'
    cp "${tmp}/old" "${vault}/Boards/Task Board.md"
    for _ in 1 2 3; do PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/held-starts" CODEX_TASK_BOARD_REV_MISMATCH_WARN_SECONDS=0 run_tick "${vault}" "${state}" env >>"${tmp}/sync"; done
    assert_file_contains "${vault}/Tickets/BOXP-991.md" "^status: ${mode}$"
    [[ ! -e "${tmp}/held-starts" ]] || fail 'restored card dispatched'
    if [[ "${variant}" == rev ]]; then
      assert_file_contains "${vault}/Boards/Task Board.md" "status::${mode}.*rev::${rev}"
    else
      # The pre-transition rev-less line is indistinguishable from a user who
      # rebuilt it by hand: it is held (no projection / dispatch) but never
      # rewritten, so a hand-made re-request is not reverted to ${mode}.
      cmp -s "${tmp}/old" "${vault}/Boards/Task Board.md" || fail 'held rev-less card was rewritten'
      assert_file_contains "${tmp}/sync" "WARN: BOXP-991 card equals the pre-transition rev-less line"
      # A re-request moves the same rev-less line to another lane (here Ready,
      # e.g. edited on a replica that still showed the old Board). It differs
      # from the pre-transition Board and must be followed, not reverted.
      sed -n '/BOXP-991/p' "${tmp}/old" >"${tmp}/line"
      write_board "${vault}" ''
      sed -i "/^## Ready/r ${tmp}/line" "${vault}/Boards/Task Board.md"
      for _ in 1 2; do PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: continue' CODEX_TASK_BOARD_REV_MISMATCH_WARN_SECONDS=0 run_tick "${vault}" "${state}" env >"${tmp}/rerequest"; done
      assert_file_not_contains "${vault}/Tickets/BOXP-991.md" "^status: ${mode}$"
      assert_file_not_contains "${vault}/Boards/Task Board.md" "BOXP-991.*status::${mode}"
    fi
  done
  done
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-990|BOXP-990: test]] #ticket status::in-progress assignee::codex rev::old'
  write_ticket "${vault}" BOXP-990 in-progress codex
  sed -i '/^status:/a board_rev: old' "${vault}/Tickets/BOXP-990.md"
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FORCE_POST_COMMIT_EXCEPTION=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >"${tmp}/exception"
  assert_run_summary_contains "${state}" BOXP-990 ':status :blocked'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  mkdir -p "${bin}"; make_fake_codex "${bin}"
  write_board "${vault}" '- [ ] [[Tickets/BOXP-992|BOXP-992: test]] #ticket status::in-progress assignee::codex rev::old'
  sed -i '/^## Done/a\\n- [x] [[Tickets/BOXP-992|BOXP-992: test]] #ticket status::done assignee::boxp rev::old done::2026-01-01' "${vault}/Boards/Task Board.md"
  write_ticket "${vault}" BOXP-992 in-progress codex
  before="$(sha256sum "${vault}/Tickets/BOXP-992.md") $(stat -c %Y "${vault}/Tickets/BOXP-992.md")"
  for _ in 1 2; do PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/duplicate"; done
  [[ "$before" == "$(sha256sum "${vault}/Tickets/BOXP-992.md") $(stat -c %Y "${vault}/Tickets/BOXP-992.md")" && ! -e "${tmp}/starts" ]] || fail 'duplicate projected or dispatched'
  if CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" TEST_RUNNER="${RUNNER}" bb -e '(System/setProperty "babashka.file" "/tmp/load-runner.bb") (load-file (System/getenv "TEST_RUNNER")) (move-card! "BOXP-992" "done")' >"${tmp}/move" 2>&1; then
    fail 'duplicate move succeeded'
  fi
  assert_file_contains "${tmp}/move" 'duplicate board cards for BOXP-992'
}

test_workspace_reuse() {
  local tmp source state bin old new known
  tmp="$(mktemp -d)"; source="$tmp/source"; state="$tmp/state"; bin="$tmp/bin"; known="$tmp/known"
  mkdir -p "$bin" "$state/locks" "$tmp/proc/100"
  ln -s / "$tmp/proc/100/cwd"
  echo '22 1 0:21 / / rw - ext4 /dev/root rw' >"$tmp/mountinfo"
  make_fake_gh "$bin"; make_prune_source_repo "$source"
  git -C "$source" rev-parse HEAD >"$known"
  old="$(add_prune_run "$state" "$source" BOXP-999 20200101T000000Z)"
  echo 'node_modules/' >>"$(git -C "$old" rev-parse --git-path info/exclude)"
  mkdir -p "$old/node_modules"; echo keep >"$old/node_modules/data"
  local inode; inode="$(stat -c %i "$old/node_modules/data")"
  echo note >"$state/workspaces/BOXP-999/20200101T000000Z/note.txt"
  printf '{:run-id "20200102T000000Z"}\n' >"$state/locks/BOXP-999.edn"
  new="$state/workspaces/BOXP-999/20200102T000000Z/ghq/github.com/boxp/example"
  PATH="$bin:$PATH" GH_FAKE_KNOWN_SHAS="$known" CODEX_TASK_BOARD_ROOT="$state" CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" TEST_RUNNER="$RUNNER" TEST_SOURCE="$source" bb -e '
    (System/setProperty "babashka.file" "/tmp/load-runner.bb")
    (load-file (System/getenv "TEST_RUNNER"))
    (alter-var-root (var local-repo-path) (constantly (fn [_] (System/getenv "TEST_SOURCE"))))
    (alter-var-root (var ticket-repos) (constantly (fn [_] ["boxp/example"])))
    (let [r (first (:repo-worktrees (prepare-run-workspace! "BOXP-999" "20200102T000000Z")))]
      (assert (= "20200101T000000Z" (:reused-from r))))'
  assert_file_contains "$state/runs/BOXP-999/20200102T000000Z/workspace-reuse.edn" ":reused-from \"20200101T000000Z\""
  [[ ! -e "$old" && "$(stat -c %i "$new/node_modules/data")" == "$inode" ]] || fail 'worktree was not moved'
  [[ "$(git -C "$new" rev-parse HEAD)" == "$(git -C "$source" rev-parse HEAD)" ]] || fail 'wrong HEAD'
  [[ "$(git -C "$new" branch --show-current)" == codex-task-board/BOXP-999-20200102T000000Z ]] || fail 'wrong branch'
  [[ -f "$state/workspaces/BOXP-999/20200101T000000Z/note.txt" ]] || fail 'old note lost'
  ! git -C "$source" show-ref --verify --quiet refs/heads/codex-task-board/BOXP-999-20200101T000000Z || fail 'old branch retained'
  printf '{:run-id "20200103T000000Z"}\n' >"$state/locks/BOXP-999.edn"
  PATH="$bin:$PATH" GH_FAKE_KNOWN_SHAS="$known" CODEX_TASK_BOARD_ROOT="$state" CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" TEST_RUNNER="$RUNNER" TEST_SOURCE="$source" bb -e '
    (System/setProperty "babashka.file" "/tmp/load-runner.bb")
    (load-file (System/getenv "TEST_RUNNER"))
    (alter-var-root (var local-repo-path) (constantly (fn [_] (System/getenv "TEST_SOURCE"))))
    (let [r (prepare-repo-worktree! (run-workspace-dir "BOXP-999" "20200103T000000Z") "BOXP-999" "20200103T000000Z" "boxp/example")]
      (assert (= "20200102T000000Z" (:reused-from r)))
      (assert (nil? (:hold (inspect-checkout (fs/real-path (run-workspace-dir "BOXP-999" "20200103T000000Z")) (:path r) (atom {}))))))'
  local third="$state/workspaces/BOXP-999/20200103T000000Z/ghq/github.com/boxp/example"
  [[ "$(stat -c %i "$third/node_modules/data")" == "$inode" ]] || fail 'chain copied ignored output'
  [[ "$(git -C "$third" reflog show HEAD | wc -l)" -le 1 ]] || fail 'reflog grew across reuse'
}

test_workspace_reuse_fallbacks() {
  local mode tmp source state bin old known reason before
  for mode in dirty untracked unpushed ignored venv nested process mount gh lock missing-lock disabled low switch; do
    tmp="$(mktemp -d)"; source="$tmp/source"; state="$tmp/state"; bin="$tmp/bin"; known="$tmp/known"
    mkdir -p "$bin" "$state/locks" "$tmp/proc/100"
    ln -s / "$tmp/proc/100/cwd"
    echo '22 1 0:21 / / rw - ext4 /dev/root rw' >"$tmp/mountinfo"
    make_fake_gh "$bin"; make_prune_source_repo "$source"
    echo tracked >"$source/tracked"; git -C "$source" add tracked; prune_git -C "$source" commit -qm tracked
    git -C "$source" rev-parse HEAD >"$known"
    old="$(add_prune_run "$state" "$source" BOXP-999 20200101T000000Z)"
    printf '{:run-id "20200102T000000Z"}\n' >"$state/locks/BOXP-999.edn"
    case "$mode" in
      dirty) echo dirty >>"$old/tracked"; reason=uncommitted-changes ;;
      untracked) echo x >"$old/untracked"; reason=uncommitted-changes ;;
      unpushed) prune_commit "$old" unpushed >/dev/null; reason=commit-not-on-github ;;
      ignored|venv) echo "$([[ "$mode" == venv ]] && echo .venv || echo unknown)/" >>"$(git -C "$old" rev-parse --git-path info/exclude)"; mkdir -p "$old/$([[ "$mode" == venv ]] && echo .venv || echo unknown)"; reason="$([[ "$mode" == venv ]] && echo path-bound-ignored || echo ignored-unknown)" ;;
      nested) git init -q "$old/nested"; reason=nested-checkout ;;
      process) ln -s "$old" "$tmp/proc/101"; rm "$tmp/proc/101"; mkdir "$tmp/proc/101"; ln -s "$old" "$tmp/proc/101/cwd"; reason=process-active ;;
      mount) echo "23 22 0:22 / $old rw - ext4 /dev/root rw" >>"$tmp/mountinfo"; reason=mount-present ;;
      gh) reason=github-check-failed ;;
      lock) echo '{:run-id "other"}' >"$state/locks/BOXP-999.edn"; reason=lock-not-owned ;;
      missing-lock) rm "$state/locks/BOXP-999.edn"; reason=lock-not-owned ;;
      disabled) reason=disabled ;;
      low) reason=keep-latest-too-low ;;
      switch) reason=switch-failed ;;
    esac
    before="$(git -C "$old" rev-parse HEAD) $(git -C "$old" branch --show-current) $(git -C "$old" status --porcelain)"
    PATH="$bin:$PATH" GH_FAKE_KNOWN_SHAS="$known" GH_FAKE_FAIL="$([[ "$mode" == gh ]] && echo true || echo false)" CODEX_TASK_BOARD_ROOT="$state" CODEX_TASK_BOARD_WORKSPACE_REUSE="$([[ "$mode" == disabled ]] && echo false || echo true)" CODEX_TASK_BOARD_WORKSPACE_KEEP_LATEST_RUNS="$([[ "$mode" == low ]] && echo 1 || echo 2)" CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" TEST_RUNNER="$RUNNER" TEST_SOURCE="$source" TEST_REASON="$reason" TEST_MODE="$mode" bb -e '
      (System/setProperty "babashka.file" "/tmp/load-runner.bb")
      (load-file (System/getenv "TEST_RUNNER"))
      (alter-var-root (var local-repo-path) (constantly (fn [_] (System/getenv "TEST_SOURCE"))))
      (let [original command-result
            wrapped (fn [args & options]
                      (if (and (= "switch" (nth args 3 nil)) (= "switch" (System/getenv "TEST_MODE")))
                        {:exit 1 :out "" :err "simulated switch failure"}
                        (apply original args options)))]
        (with-redefs [command-result wrapped]
          (let [r (prepare-repo-worktree! (run-workspace-dir "BOXP-999" "20200102T000000Z") "BOXP-999" "20200102T000000Z" "boxp/example")]
            (assert (:path r)) (assert (clojure.string/starts-with? (:reuse-fallback r) (System/getenv "TEST_REASON"))))))'
    [[ "$before" == "$(git -C "$old" rev-parse HEAD) $(git -C "$old" branch --show-current) $(git -C "$old" status --porcelain)" ]] || fail "old checkout changed: $mode"
  done
}

# Runs prepare-run-workspace! for one run against fixture repositories.
reuse_prepare() {
  local tmp="$1" ticket="$2" run="$3" repos="${4:-boxp/example}"
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_ROOT="$tmp/state" \
    CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" \
    TEST_RUNNER="$RUNNER" TEST_SOURCE="$tmp/source" TEST_OTHER="$tmp/other" TEST_REPOS="$repos" \
    TEST_TICKET="$ticket" TEST_RUN="$run" bb -e '
      (System/setProperty "babashka.file" "/tmp/load-runner.bb")
      (load-file (System/getenv "TEST_RUNNER"))
      (alter-var-root (var local-repo-path)
                      (constantly (fn [r] (if (= r "boxp/other") (System/getenv "TEST_OTHER") (System/getenv "TEST_SOURCE")))))
      (alter-var-root (var ticket-repos)
                      (constantly (fn [_] (clojure.string/split (System/getenv "TEST_REPOS") #","))))
      (when-let [other-lock (System/getenv "TEST_LOCK_SWAP")]
        (alter-var-root (var stale-process-hold)
                        (fn [original]
                          (fn [& args]
                            (spit (str (lock-path (System/getenv "TEST_TICKET"))) other-lock)
                            (apply original args)))))
      (let [workspace (prepare-run-workspace! (System/getenv "TEST_TICKET") (System/getenv "TEST_RUN"))
            result (first (:repo-worktrees workspace))
            prompt (workspace-prompt workspace)]
        (when (:carryover result)
          (assert (clojure.string/includes? prompt "Carried over from previous run"))
          (assert (not (clojure.string/includes? prompt "private-untracked"))))
        (when (:reuse-base-reason result)
          (assert (clojure.string/includes? prompt "kept to preserve its verified studio dist"))
          (assert (clojure.string/includes? prompt "switch to the correct base or PR branch before committing")))
        (prn (:repo-worktrees workspace)))'
}

reuse_fixture() {
  local tmp="$1"
  mkdir -p "$tmp/bin" "$tmp/state/locks" "$tmp/proc/100"
  ln -s / "$tmp/proc/100/cwd"
  echo '22 1 0:21 / / rw - ext4 /dev/root rw' >"$tmp/mountinfo"
  make_fake_gh "$tmp/bin"; make_prune_source_repo "$tmp/source"
  git -C "$tmp/source" rev-list HEAD >"$tmp/known"
}

reuse_lock() { printf '{:ticket "%s" :run-id "%s"}\n' "$2" "$3" >"$1/state/locks/$2.edn"; }

test_workspace_carryover_preserves_work() {
  local tmp old new before head branch
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  echo initial >"$tmp/source/tracked"; git -C "$tmp/source" add tracked; prune_git -C "$tmp/source" commit -qm tracked
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
  git -C "$old" switch -c custom-carryover >/dev/null
  echo committed >"$old/committed"; git -C "$old" add committed; prune_git -C "$old" commit -qm unpushed
  echo modified >"$old/tracked"
  printf '#!/bin/sh\necho called >>"%s"\nexit 99\n' "$tmp/gh-called" >"$tmp/bin/gh"; chmod +x "$tmp/bin/gh"
  echo staged >"$old/staged"; git -C "$old" add staged
  echo untracked >"$old/private-untracked"
  echo 'ignored/' >>"$(git -C "$old" rev-parse --git-path info/exclude)"
  mkdir "$old/ignored"; echo ignored >"$old/ignored/data"
  head="$(git -C "$old" rev-parse HEAD)"; branch="$(git -C "$old" branch --show-current)"
  before="$(git -C "$old" status --porcelain=v1 --untracked-files=all)"
  local hashes staged_before
  hashes="$(cd "$old" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)"
  staged_before="$(git -C "$old" diff --cached)"
  printf '{:mode :on}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200102T000000Z
  reuse_prepare "$tmp" BOXP-901 20200102T000000Z >"$tmp/out"
  new="$tmp/state/workspaces/BOXP-901/20200102T000000Z/ghq/github.com/boxp/example"
  assert_file_contains "$tmp/out" ':carryover true'
  [[ ! -e "$old" && -f "$new/ignored/data" && -f "$new/private-untracked" ]] || fail 'carryover files missing'
  [[ "$(git -C "$new" rev-parse HEAD)" == "$head" && "$(git -C "$new" branch --show-current)" == "$branch" ]] || fail 'carryover changed HEAD or branch'
  [[ "$(git -C "$new" status --porcelain=v1 --untracked-files=all)" == "$before" ]] || fail 'carryover changed status'
  [[ "$(cd "$new" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)" == "$hashes" ]] || fail 'carryover changed file contents'
  [[ "$(git -C "$new" diff --cached)" == "$staged_before" ]] || fail 'carryover changed the index'
  [[ "$(git -C "$new" log -1 --format=%s)" == unpushed ]] || fail 'unpushed commit lost'
  [[ ! -e "$tmp/gh-called" ]] || fail 'carryover called GitHub'
  [[ "$(git -C "$tmp/source" worktree list --porcelain | grep -c "^worktree .*BOXP-901")" == 1 ]] || fail 'carryover left more than one worktree'
  assert_file_contains "$tmp/state/runs/BOXP-901/20200102T000000Z/workspace-reuse.edn" ':carryover-dirty \{:modified 2, :untracked 1, :ignored-present true, :unpushed [1-9][0-9]*\}'
  git -C "$new" switch --detach >/dev/null
  reuse_lock "$tmp" BOXP-901 20200103T000000Z
  reuse_prepare "$tmp" BOXP-901 20200103T000000Z >"$tmp/detached"
  assert_file_contains "$tmp/detached" ':detached\? true'
  [[ "$(git -C "$tmp/state/workspaces/BOXP-901/20200103T000000Z/ghq/github.com/boxp/example" rev-parse HEAD)" == "$head" ]] || fail 'detached HEAD changed'
}

test_workspace_carryover_safety_fallbacks() {
  local case_name tmp old head
  for case_name in merge venv lock process mount nested; do
    tmp="$(mktemp -d)"; reuse_fixture "$tmp"
    old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
    head="$(git -C "$old" rev-parse HEAD)"
    printf '{:mode :on}\n' >"$tmp/state/workspace-carryover.edn"
    reuse_lock "$tmp" BOXP-901 20200102T000000Z
    case "$case_name" in
      merge) echo "$head" >"$(git -C "$old" rev-parse --git-path MERGE_HEAD)"; expected=git-operation-in-progress ;;
      venv) echo '.venv/' >>"$(git -C "$old" rev-parse --git-path info/exclude)"; mkdir "$old/.venv"; echo x >"$old/.venv/x"; expected=path-bound-ignored ;;
      lock) reuse_lock "$tmp" BOXP-901 20200103T000000Z; expected=lock-not-owned ;;
      process) mkdir "$tmp/proc/101"; ln -s "$old" "$tmp/proc/101/cwd"; expected=process-active ;;
      mount) echo "23 22 0:22 / $old rw - ext4 /dev/root rw" >>"$tmp/mountinfo"; expected=mount-present ;;
      nested) git init -q "$old/nested"; expected=nested-checkout ;;
    esac
    reuse_prepare "$tmp" BOXP-901 20200102T000000Z >"$tmp/out"
    assert_file_contains "$tmp/out" ":reuse-fallback \"$expected\""
    [[ "$(git -C "$old" rev-parse HEAD)" == "$head" ]] || fail 'safety fallback changed old worktree'
    [[ -e "$tmp/state/workspaces/BOXP-901/20200102T000000Z/ghq/github.com/boxp/example/.git" ]] || fail 'safety fallback did not create a fresh checkout'
  done
}

test_workspace_carryover_flag_modes_and_rollback() {
  local tmp old carried
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
  echo keep >"$old/untracked"
  printf '{:mode :canary :tickets ["BOXP-901"]}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200102T000000Z
  reuse_prepare "$tmp" BOXP-901 20200102T000000Z >"$tmp/out1"
  assert_file_contains "$tmp/out1" ':carryover true'
  carried="$tmp/state/workspaces/BOXP-901/20200102T000000Z/ghq/github.com/boxp/example"
  printf '{:mode :off}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200103T000000Z
  reuse_prepare "$tmp" BOXP-901 20200103T000000Z >"$tmp/out2"
  assert_file_contains "$tmp/out2" ':reuse-fallback "uncommitted-changes"'
  [[ -f "$carried/untracked" ]] || fail 'rollback lost work'
  printf '{:mode :canary :tickets ["BOXP-999"]}\n' >"$tmp/state/workspace-carryover.edn"
  CODEX_TASK_BOARD_ROOT="$tmp/state" TEST_RUNNER="$RUNNER" bb -e '
    (System/setProperty "babashka.file" "/tmp/load-runner.bb") (load-file (System/getenv "TEST_RUNNER"))
    (assert (= :off (workspace-carryover-mode "BOXP-901")))' >"$tmp/mode"
  printf '{:mode :invalid}\n' >"$tmp/state/workspace-carryover.edn"
  CODEX_TASK_BOARD_ROOT="$tmp/state" TEST_RUNNER="$RUNNER" bb -e '
    (System/setProperty "babashka.file" "/tmp/load-runner.bb") (load-file (System/getenv "TEST_RUNNER"))
    (assert (= :off (workspace-carryover-mode "BOXP-901")))' >"$tmp/mode" 2>&1
  assert_file_contains "$tmp/mode" 'workspace-carryover: warning invalid config'
  rm "$tmp/state/workspace-carryover.edn"
  CODEX_TASK_BOARD_WORKSPACE_CARRYOVER=on CODEX_TASK_BOARD_ROOT="$tmp/state" TEST_RUNNER="$RUNNER" bb -e '
    (System/setProperty "babashka.file" "/tmp/load-runner.bb") (load-file (System/getenv "TEST_RUNNER"))
    (assert (= :on (workspace-carryover-mode "BOXP-901")))'
}

test_workspace_carryover_skips_localllm_coder() {
  local tmp old head
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
  echo keep >"$old/untracked"; head="$(git -C "$old" rev-parse HEAD)"
  printf '{:mode :on}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200102T000000Z
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_ROOT="$tmp/state" \
    CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" \
    TEST_RUNNER="$RUNNER" TEST_SOURCE="$tmp/source" bb -e '
      (System/setProperty "babashka.file" "/tmp/load-runner.bb")
      (load-file (System/getenv "TEST_RUNNER"))
      (alter-var-root (var local-repo-path) (constantly (fn [_] (System/getenv "TEST_SOURCE"))))
      (alter-var-root (var ticket-repos) (constantly (fn [_] ["boxp/example"])))
      (let [r (first (:repo-worktrees (binding [*workspace-carryover-allowed?* false] (prepare-run-workspace! "BOXP-901" "20200102T000000Z"))))]
        (assert (not (:carryover r)))
        (assert (= "uncommitted-changes" (:reuse-fallback r))))' || fail 'localllm coder took the carryover path'
  [[ -f "$old/untracked" && "$(git -C "$old" rev-parse HEAD)" == "$head" ]] || fail 'coder fallback touched the old worktree'
}


test_workspace_carryover_skips_localllm_coder() {
  local tmp old head
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
  echo keep >"$old/untracked"; head="$(git -C "$old" rev-parse HEAD)"
  printf '{:mode :on}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200102T000000Z
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_ROOT="$tmp/state" \
    CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" \
    TEST_RUNNER="$RUNNER" TEST_SOURCE="$tmp/source" bb -e '
      (System/setProperty "babashka.file" "/tmp/load-runner.bb")
      (load-file (System/getenv "TEST_RUNNER"))
      (alter-var-root (var local-repo-path) (constantly (fn [_] (System/getenv "TEST_SOURCE"))))
      (alter-var-root (var ticket-repos) (constantly (fn [_] ["boxp/example"])))
      (let [r (first (:repo-worktrees (binding [*workspace-carryover-allowed?* false] (prepare-run-workspace! "BOXP-901" "20200102T000000Z"))))]
        (assert (not (:carryover r)))
        (assert (= "uncommitted-changes" (:reuse-fallback r))))' >/dev/null || fail 'localllm coder took the carryover path'
  [[ -f "$old/untracked" && "$(git -C "$old" rev-parse HEAD)" == "$head" ]] || fail 'coder fallback touched the old worktree'
}
test_workspace_carryover_chain_and_restart() {
  local tmp old second third
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
  echo keep >"$old/untracked"
  printf '{:mode :on}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200102T000000Z
  reuse_prepare "$tmp" BOXP-901 20200102T000000Z >"$tmp/out1"
  second="$tmp/state/workspaces/BOXP-901/20200102T000000Z/ghq/github.com/boxp/example"
  rm "$tmp/state/runs/BOXP-901/20200102T000000Z/workspace-reuse.edn"
  reuse_lock "$tmp" BOXP-901 20200103T000000Z
  reuse_prepare "$tmp" BOXP-901 20200103T000000Z >"$tmp/out2"
  third="$tmp/state/workspaces/BOXP-901/20200103T000000Z/ghq/github.com/boxp/example"
  assert_file_contains "$tmp/out2" ':reused-from "20200102T000000Z"'
  [[ ! -e "$second" && -f "$third/untracked" ]] || fail 'chain did not preserve work'
}

test_workspace_metrics_ledger() {
  local tmp old ledger
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  echo payload >"$tmp/source/tracked"; git -C "$tmp/source" add tracked; prune_git -C "$tmp/source" commit -qm payload
  reuse_lock "$tmp" BOXP-901 20200101T000000Z
  reuse_prepare "$tmp" BOXP-901 20200101T000000Z >"$tmp/out1"
  printf '{:mode :on}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200102T000000Z
  reuse_prepare "$tmp" BOXP-901 20200102T000000Z >"$tmp/out2"
  ledger="$tmp/state/metrics/workspace-capacity.edn"
  assert_file_contains "$ledger" ':mode :new-checkout'
  assert_file_contains "$ledger" ':mode :carryover'
  assert_file_contains "$ledger" ':moved true'
  CODEX_TASK_BOARD_ROOT="$tmp/state" bb "$RUNNER" workspace-metrics --since-hours 48 >"$tmp/summary"
  assert_file_contains "$tmp/summary" 'generated-bytes-est='
  assert_file_contains "$tmp/summary" 'net-bytes-est='

  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  write_board "$tmp/vault" ""
  write_prune_ticket "$tmp/vault" BOXP-901 done 2020-01-01
  write_prune_ticket "$tmp/vault" BOXP-902 done 2020-01-01
  add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z >/dev/null
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-902 20200101T000000Z)"
  echo keep >"$old/untracked"
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" run_prune "$tmp/vault" "$tmp/state" >"$tmp/prune1"
  ledger="$tmp/state/metrics/workspace-capacity.edn"
  assert_file_contains "$ledger" ':result :deleted.*:measured\? true'
  assert_file_contains "$ledger" ':result :held.*:measured\? true'
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" run_prune "$tmp/vault" "$tmp/state" >"$tmp/prune2"
  assert_file_contains "$ledger" ':basis "du-sxk-cached"'
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_WORKSPACE_METRICS_MAX_MEASURE=0 \
    run_prune "$tmp/vault" "$tmp/state" >"$tmp/prune3"

  # Metrics never change prune decisions, and an unwritable ledger is harmless.
  local mode summary_on summary_off summary_ro summary_zero
  for mode in on off ro zero; do
    tmp="$(mktemp -d)"; reuse_fixture "$tmp"
    write_board "$tmp/vault" ""
    write_prune_ticket "$tmp/vault" BOXP-901 done 2020-01-01
    write_prune_ticket "$tmp/vault" BOXP-902 done 2020-01-01
    add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z >/dev/null
    old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-902 20200101T000000Z)"
    echo keep >"$old/untracked"
    if [[ "$mode" == ro ]]; then echo blocker >"$tmp/state/metrics"; fi
    PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_WORKSPACE_METRICS="$([[ "$mode" == off ]] && echo off || echo on)" \
      CODEX_TASK_BOARD_WORKSPACE_METRICS_MAX_MEASURE="$([[ "$mode" == zero ]] && echo 0 || echo 20)" \
      run_prune "$tmp/vault" "$tmp/state" >"$tmp/prune" || fail "prune failed with metrics $mode"
    grep -o '^prune: summary deleted=[0-9]* stale-deleted=[0-9]* held=[0-9]* skipped=[0-9]* recent-runs=[0-9]* branches=[0-9]* empty-dirs=[0-9]*' "$tmp/prune" >"$tmp/summary-$mode"
    [[ -s "$tmp/summary-$mode" ]] || fail "no prune summary with metrics $mode"
    [[ -d "$tmp/state/workspaces/BOXP-902/20200101T000000Z" && ! -e "$tmp/state/workspaces/BOXP-901/20200101T000000Z" ]] || fail "prune decision changed with metrics $mode"
    if [[ "$mode" == off ]]; then [[ ! -e "$tmp/state/metrics" ]] || fail 'metrics off wrote files'; fi
    if [[ "$mode" == ro ]]; then assert_file_contains "$tmp/prune" 'workspace-metrics: warning'; fi
    if [[ "$mode" == zero ]]; then
      assert_file_contains "$tmp/state/metrics/workspace-capacity.edn" ':result :deleted.*:measured\? false'
      assert_file_contains "$tmp/state/metrics/workspace-capacity.edn" ':held-unmeasured 1'
      assert_file_contains "$tmp/state/metrics/workspace-capacity.edn" ':fs-free-bytes [1-9]'
      [[ ! -e "$tmp/state/metrics/workspace-size-cache.edn" ]] || fail 'MAX_MEASURE=0 measured'
    fi
    eval "summary_$mode=\"\$(cat \"$tmp/summary-$mode\")\""
  done
  [[ "$summary_on" == "$summary_off" && "$summary_on" == "$summary_ro" && "$summary_on" == "$summary_zero" ]] || fail "metrics changed prune summary: $summary_on / $summary_off / $summary_ro"
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  reuse_lock "$tmp" BOXP-901 20200101T000000Z
  CODEX_TASK_BOARD_WORKSPACE_METRICS=off reuse_prepare "$tmp" BOXP-901 20200101T000000Z >"$tmp/out"
  [[ ! -e "$tmp/state/metrics" ]] || fail 'disabled metrics wrote files'
}

test_workspace_carryover_prune_interplay() {
  local tmp old vault
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"; vault="$tmp/vault"
  write_board "$vault" ""
  write_prune_ticket "$vault" BOXP-901 in-progress 2020-01-01
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
  echo keep >"$old/untracked"
  printf '{:mode :on}\n' >"$tmp/state/workspace-carryover.edn"
  reuse_lock "$tmp" BOXP-901 20200102T000000Z
  reuse_prepare "$tmp" BOXP-901 20200102T000000Z >"$tmp/prepared"
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true \
    CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" \
    run_prune "$vault" "$tmp/state" >"$tmp/prune"
  [[ -f "$tmp/state/workspaces/BOXP-901/20200102T000000Z/ghq/github.com/boxp/example/untracked" ]] || fail 'prune lost carried work'
}

test_workspace_reuse_interplay() {
  local tmp ws old new dist out
  # Another ticket and another repository are never adopted; decisions are per repo.
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"; ws="$tmp/state/workspaces"
  make_prune_source_repo "$tmp/other"; git -C "$tmp/other" remote set-url origin https://github.com/boxp/other.git
  git -C "$tmp/other" rev-list HEAD >>"$tmp/known"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-901 20200101T000000Z)"
  reuse_lock "$tmp" BOXP-902 20200102T000000Z
  reuse_prepare "$tmp" BOXP-902 20200102T000000Z >"$tmp/o1"
  assert_file_contains "$tmp/o1" ':reuse-fallback "no-previous-run"'
  [[ -e "$old/.git" ]] || fail 'another ticket adopted the worktree'
  reuse_lock "$tmp" BOXP-901 20200103T000000Z
  reuse_prepare "$tmp" BOXP-901 20200103T000000Z 'boxp/example,boxp/other' >"$tmp/o2"
  assert_file_contains "$tmp/o2" ':reused-from "20200101T000000Z"'
  assert_file_contains "$tmp/o2" ':repo "boxp/other", :reuse-fallback "no-previous-checkout"'
  [[ -e "$ws/BOXP-901/20200103T000000Z/ghq/github.com/boxp/other/.git" ]] || fail 'other repo not created fresh'

  # A claim that changes the lock before the move leaves the old run alone.
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-903 20200101T000000Z)"
  reuse_lock "$tmp" BOXP-903 20200102T000000Z
  TEST_LOCK_SWAP='{:ticket "BOXP-903" :run-id "20200103T000000Z"}' reuse_prepare "$tmp" BOXP-903 20200102T000000Z >"$tmp/o"
  assert_file_contains "$tmp/o" ':reuse-fallback "lock-not-owned"'
  [[ "$(git -C "$old" branch --show-current)" == codex-task-board/BOXP-903-20200101T000000Z ]] || fail 'race changed the old run'

  # A symlinked previous checkout is not followed into another run.
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"; ws="$tmp/state/workspaces"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-904 20200101T000000Z)"
  mkdir -p "$ws/BOXP-905/20200101T000000Z/ghq/github.com/boxp"
  ln -s "$old" "$ws/BOXP-905/20200101T000000Z/ghq/github.com/boxp/example"
  reuse_lock "$tmp" BOXP-905 20200102T000000Z
  reuse_prepare "$tmp" BOXP-905 20200102T000000Z >"$tmp/o"
  assert_file_contains "$tmp/o" ':reuse-fallback "unsafe-path"'
  [[ "$(git -C "$old" branch --show-current)" == codex-task-board/BOXP-904-20200101T000000Z ]] || fail 'symlink followed'

  # Crash after the move and before the switch: the next run adopts it normally.
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"; ws="$tmp/state/workspaces"
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-906 20200101T000000Z)"
  new="$ws/BOXP-906/20200102T000000Z/ghq/github.com/boxp/example"
  mkdir -p "$(dirname "$new")"; git -C "$tmp/source" worktree move "$old" "$new"
  reuse_lock "$tmp" BOXP-906 20200103T000000Z
  reuse_prepare "$tmp" BOXP-906 20200103T000000Z >"$tmp/o"
  assert_file_contains "$tmp/o" ':reused-from "20200102T000000Z"'
  new="$ws/BOXP-906/20200103T000000Z/ghq/github.com/boxp/example"
  [[ "$(git -C "$new" branch --show-current)" == codex-task-board/BOXP-906-20200103T000000Z ]] || fail 'crash recovery branch'

  # Prune: a prior run stays protected before the reuse, and deleting it after
  # the reuse does not touch the worktree now owned by the active run.
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"; ws="$tmp/state/workspaces"
  write_board "$tmp/vault" ''; write_prune_ticket "$tmp/vault" BOXP-907 blocked 2020-01-01
  old="$(add_prune_run "$tmp/state" "$tmp/source" BOXP-907 20200101T000000Z)"
  mkdir -p "$ws/BOXP-907/20200102T000000Z"
  reuse_lock "$tmp" BOXP-907 20200102T000000Z
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true \
    CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" \
    run_prune "$tmp/vault" "$tmp/state" >"$tmp/p1"
  [[ -e "$old/.git" ]] || fail 'prune removed the run about to be reused'
  reuse_prepare "$tmp" BOXP-907 20200102T000000Z >"$tmp/o"
  assert_file_contains "$tmp/o" ':reused-from "20200101T000000Z"'
  new="$ws/BOXP-907/20200102T000000Z/ghq/github.com/boxp/example"
  mkdir -p "$ws/BOXP-907/20200103T000000Z"
  PATH="$tmp/bin:$PATH" GH_FAKE_KNOWN_SHAS="$tmp/known" CODEX_TASK_BOARD_WORKSPACE_STALE_PRUNE=true \
    CODEX_TASK_BOARD_PRUNE_PROC_ROOT="$tmp/proc" CODEX_TASK_BOARD_PRUNE_MOUNTINFO="$tmp/mountinfo" \
    run_prune "$tmp/vault" "$tmp/state" >"$tmp/p2"
  [[ ! -e "$ws/BOXP-907/20200101T000000Z" ]] || fail 'emptied old run was not reclaimed'
  [[ "$(git -C "$new" rev-parse HEAD)" == "$(git -C "$tmp/source" rev-parse HEAD)" ]] || fail 'prune damaged the reused worktree'
  git -C "$tmp/source" worktree list --porcelain | grep -Fq "$new" || fail 'worktree entry lost'

  # A verified studio dist moves with the worktree only while it still matches public.
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"; ws="$tmp/state/workspaces"
  git -C "$tmp/source" remote set-url origin https://github.com/boxp/arch.git
  mkdir -p "$tmp/source/apps/kohako-studio/web/public"
  printf 'dist/\n' >"$tmp/source/.gitignore"
  printf 'abcd' >"$tmp/source/apps/kohako-studio/web/public/copied.txt"
  touch "$tmp/source/apps/kohako-studio/web/"{package.json,package-lock.json,vite.config.ts}
  git -C "$tmp/source" add .; prune_git -C "$tmp/source" commit -q -m fixture
  git -C "$tmp/source" update-ref refs/remotes/origin/main HEAD
  git -C "$tmp/source" rev-list HEAD >"$tmp/known"
  old="$ws/BOXP-908/20200101T000000Z/ghq/github.com/boxp/arch"
  mkdir -p "$(dirname "$old")"
  git -C "$tmp/source" worktree add -q -b codex-task-board/BOXP-908-20200101T000000Z "$old" HEAD
  dist="$old/apps/kohako-studio/web/dist"; mkdir -p "$dist/assets"
  printf html >"$dist/index.html"; printf asset >"$dist/assets/main-Abc_1234.js"; printf abcd >"$dist/copied.txt"
  reuse_lock "$tmp" BOXP-908 20200102T000000Z
  reuse_prepare "$tmp" BOXP-908 20200102T000000Z boxp/arch >"$tmp/o"
  assert_file_contains "$tmp/o" ':reused-from "20200101T000000Z"'
  old="$ws/BOXP-908/20200102T000000Z/ghq/github.com/boxp/arch"
  [[ -f "$old/apps/kohako-studio/web/dist/copied.txt" ]] || fail 'verified dist was not carried over'
  printf 'efgh' >"$tmp/source/apps/kohako-studio/web/public/copied.txt"
  git -C "$tmp/source" add .; prune_git -C "$tmp/source" commit -q -m public
  git -C "$tmp/source" update-ref refs/remotes/origin/main HEAD
  git -C "$tmp/source" rev-list HEAD >"$tmp/known"
  local before_stale; before_stale="$(git -C "$old" rev-parse HEAD) $(git -C "$old" branch --show-current) $(git -C "$old" status --porcelain)"
  reuse_lock "$tmp" BOXP-908 20200103T000000Z
  reuse_prepare "$tmp" BOXP-908 20200103T000000Z boxp/arch >"$tmp/o"
  assert_file_contains "$tmp/o" ':reuse-fallback "studio-dist-public-diff"'
  [[ -f "$old/apps/kohako-studio/web/dist/copied.txt" && "$before_stale" == "$(git -C "$old" rev-parse HEAD) $(git -C "$old" branch --show-current) $(git -C "$old" status --porcelain)" ]] || fail 'run with stale dist changed'

  # A pushed run commit that changes public keeps its matching verified dist.
  tmp="$(mktemp -d)"; reuse_fixture "$tmp"; ws="$tmp/state/workspaces"
  git -C "$tmp/source" remote set-url origin https://github.com/boxp/arch.git
  mkdir -p "$tmp/source/apps/kohako-studio/web/public"
  printf 'dist/\n' >"$tmp/source/.gitignore"
  printf 'abcd' >"$tmp/source/apps/kohako-studio/web/public/copied.txt"
  touch "$tmp/source/apps/kohako-studio/web/"{package.json,package-lock.json,vite.config.ts}
  git -C "$tmp/source" add .; prune_git -C "$tmp/source" commit -q -m fixture
  git -C "$tmp/source" update-ref refs/remotes/origin/main HEAD
  old="$ws/BOXP-910/20200101T000000Z/ghq/github.com/boxp/arch"
  mkdir -p "$(dirname "$old")"
  git -C "$tmp/source" worktree add -q -b codex-task-board/BOXP-910-20200101T000000Z "$old" HEAD
  printf 'efgh' >"$old/apps/kohako-studio/web/public/copied.txt"
  git -C "$old" add .; prune_git -C "$old" commit -q -m public
  local old_head; old_head="$(git -C "$old" rev-parse HEAD)"
  git -C "$old" rev-list HEAD >"$tmp/known"
  dist="$old/apps/kohako-studio/web/dist"; mkdir -p "$dist/assets"
  printf html >"$dist/index.html"; printf asset >"$dist/assets/main-Abc_1234.js"; printf efgh >"$dist/copied.txt"
  reuse_lock "$tmp" BOXP-910 20200102T000000Z
  reuse_prepare "$tmp" BOXP-910 20200102T000000Z boxp/arch >"$tmp/o"
  assert_file_contains "$tmp/o" ':reused-from "20200101T000000Z"'
  assert_file_contains "$tmp/o" ":reuse-base \"$old_head\""
  assert_file_contains "$tmp/o" ':reuse-base-reason "studio-dist-keep-head"'
  local audit="$tmp/state/runs/BOXP-910/20200102T000000Z/workspace-reuse.edn"
  assert_file_contains "$audit" ':reused-from "20200101T000000Z"'
  assert_file_contains "$audit" ":reuse-base \"$old_head\""
  assert_file_contains "$audit" ':reuse-base-reason "studio-dist-keep-head"'
  new="$ws/BOXP-910/20200102T000000Z/ghq/github.com/boxp/arch"
  [[ ! -e "$old" && "$(git -C "$new" rev-parse HEAD)" == "$old_head" ]] || fail 'run HEAD was not preserved'
  [[ "$(cat "$new/apps/kohako-studio/web/public/copied.txt")" == efgh && "$(cat "$new/apps/kohako-studio/web/dist/copied.txt")" == efgh ]] || fail 'public or dist changed'

  # The shared source checkout can sit far behind main. Rewinding a reused
  # worktree to it would delete tracked assets that the run then re-expands.
  local main file inode case_name ticket
  for case_name in stale-source unmerged-head source-newer diverged-source; do
    tmp="$(mktemp -d)"; reuse_fixture "$tmp"; ws="$tmp/state/workspaces"; ticket=BOXP-909
    old="$(add_prune_run "$tmp/state" "$tmp/source" "$ticket" 20200101T000000Z)"
    main="$(prune_commit "$old" asset)"
    git -C "$tmp/source" update-ref refs/remotes/origin/main "$main"
    file="$old/asset"; inode="$(stat -c %i "$file")"
    case "$case_name" in
      unmerged-head) prune_commit "$old" feature >/dev/null ;;
      source-newer) git -C "$tmp/source" merge -q --ff-only "$main"; main="$(prune_commit "$tmp/source" newer)"; git -C "$tmp/source" update-ref refs/remotes/origin/main "$main" ;;
      diverged-source) main="$(prune_commit "$tmp/source" local-only)" ;;
    esac
    git -C "$tmp/source" rev-list --all >"$tmp/known"
    reuse_lock "$tmp" "$ticket" 20200102T000000Z
    reuse_prepare "$tmp" "$ticket" 20200102T000000Z >"$tmp/o"
    assert_file_contains "$tmp/o" ':reused-from "20200101T000000Z"'
    new="$ws/$ticket/20200102T000000Z/ghq/github.com/boxp/example"
    [[ "$(git -C "$new" rev-parse HEAD)" == "$main" ]] || fail "wrong reuse base: $case_name"
    [[ -z "$(git -C "$new" status --porcelain)" ]] || fail "reused worktree dirty: $case_name"
    if [[ "$case_name" == diverged-source ]]; then
      [[ ! -e "$new/asset" ]] || fail 'diverged source kept the run base'
    else
      [[ "$(stat -c %i "$new/asset")" == "$inode" ]] || fail "tracked asset was re-expanded: $case_name"
    fi
  done
}

test_claude_catalog_and_hold_resolution() {
  local tmp vault state bin catalog model_state args case_name expected source ticket summary
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  catalog="${tmp}/catalog.edn"; model_state="${tmp}/model-state.edn"; args="${tmp}/args"
  mkdir -p "${bin}"; make_fake_claude "${bin}"
  for case_name in missing previous invalid family; do
    ticket="BOXP-876"
    rm -rf "${vault}" "${state}" "${args}" "${catalog}" "${model_state}"
    case "${case_name}" in
      missing) expected=claude-fable-5-2; source=builtin ;;
      previous) expected=claude-fable-5-1; source=hold ;;
      invalid) expected=claude-fable-5-2; source=catalog ;;
      family) expected=claude-fable-5-2; source=builtin ;;
    esac
    if [[ "${case_name}" != missing ]]; then
      if [[ "${case_name}" == family ]]; then
        printf '%s\n' '{:version 1 :roles {"claude-fable" {:family "opus" :model "claude-opus-5-5"}}}' > "${catalog}"
      else
        printf '%s\n' '{:version 1 :roles {"claude-fable" {:family "fable" :model "claude-fable-5-2" :previous "claude-fable-5-1"}}}' > "${catalog}"
      fi
    fi
    [[ "${case_name}" != previous ]] || printf '%s\n' '{:hold {"claude-fable" "claude-fable-5-1"}}' > "${model_state}"
    [[ "${case_name}" != invalid ]] || printf '%s\n' '{:hold {"claude-fable" "claude-opus-5-5"}}' > "${model_state}"
    write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: model]] #ticket status::in-progress"
    write_ticket "${vault}" "${ticket}" in-progress claude-fable
    CODEX_TASK_BOARD_CLAUDE_BIN="${bin}/claude" CODEX_TASK_BOARD_MODEL_CATALOG="${catalog}" \
      CODEX_TASK_BOARD_MODEL_STATE="${model_state}" CLAUDE_FAKE_ARG_LOG_DIR="${args}" \
      CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >"${tmp}/out"
    assert_file_contains "${args}/${ticket}.log" "--model ${expected}"
    summary="$(find "${state}/runs/${ticket}" -name summary.edn | head -1)"
    assert_file_contains "${summary}" ":model \"${expected}\""
    assert_file_contains "${summary}" ":model-source :${source}"
  done
}

# Every invocation is recorded in the checked-in baseline. Each CI shard runs a
# deterministic subset in its own job, so vaults, processes and locks are isolated.
mapfile -t cases < "${ROOT_DIR}/tests/codex-workspace/task-board-runner-cases.txt"
if [[ -n "${TASK_BOARD_TEST_ONLY:-}" ]]; then
  read -r -a cases <<< "${TASK_BOARD_TEST_ONLY}"
fi
shard="${TASK_BOARD_TEST_SHARD:-0}"
shards="${TASK_BOARD_TEST_SHARDS:-1}"
[[ "${shards}" =~ ^[1-9][0-9]*$ && "${shard}" =~ ^[0-9]+$ ]] && (( shard < shards )) || { echo 'invalid shard' >&2; exit 1; }
for i in "${!cases[@]}"; do
  (( i % shards == shard )) || continue
  t="${cases[$i]}"
  declare -F "${t}" >/dev/null || { echo "unknown case: ${t}" >&2; exit 1; }
  start=${SECONDS}
  "${t}"
  echo "CASE ${t} $((SECONDS - start))s"
done
# BOXP-344: isolated shared-GPU evaluation state machine; no model/network.
if [[ "${shard}" == 0 && -z "${TASK_BOARD_TEST_ONLY:-}" ]]; then
  start=${SECONDS}
  python3 -B -m unittest discover -s "${ROOT_DIR}/tests/qwen-eval" -v
  echo "CASE qwen-eval $((SECONDS - start))s"
fi
echo "task-board-runner shard ${shard}/${shards} passed"
