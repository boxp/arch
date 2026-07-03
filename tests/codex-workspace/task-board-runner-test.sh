#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb"

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

make_fake_codex() {
  local bin_dir="$1"
  cat >"${bin_dir}/codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

last_message=""
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
mkdir -p "$(dirname "${last_message}")"
if [[ -n "${CODEX_FAKE_START_LOG:-}" ]]; then
  printf '%s %s\n' "${ticket}" "$(date +%s)" >>"${CODEX_FAKE_START_LOG}"
fi
sleep "${CODEX_FAKE_SLEEP:-0}"
printf '%s\n' "${CODEX_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}" >"${last_message}"
rm -f "${prompt}"
EOF
  chmod +x "${bin_dir}/codex"
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
  CODEX_TASK_BOARD_LOCK_STALE_SECONDS="${CODEX_TASK_BOARD_LOCK_STALE_SECONDS:-1800}" \
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

test_parallel_codex_runs
test_stale_lock_recovers
test_review_without_pr_is_blocked

echo "task-board-runner tests passed"
