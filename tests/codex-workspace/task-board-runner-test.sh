#!/usr/bin/env bash
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
set -euo pipefail
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# CI and local images may pin the real Claude executable. Tests must always use
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# their temporary fake unless a test deliberately supplies a pinned fake path.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
unset CODEX_TASK_BOARD_CLAUDE_BIN
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
unset CODEX_TASK_BOARD_FABLE_MODEL
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
unset CODEX_TASK_BOARD_FABLE_AGENT
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
unset CODEX_TASK_BOARD_FABLE_EXTRA_ARGS
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
RUNNER="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
HELPER="${ROOT_DIR}/docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
export TASK_BOARD_DELEGATION_HELPER="${ROOT_DIR}/docker/codex-workspace/task-board/delegate.py"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fail() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  echo "error: $*" >&2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assert_file_contains() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local file="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pattern="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep -Eq -- "$pattern" "$file" || fail "expected ${file} to match ${pattern}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assert_file_not_contains() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local file="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pattern="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if grep -Eq -- "$pattern" "$file"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected ${file} not to match ${pattern}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assert_run_summary_contains() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local state="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local ticket="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pattern="$3"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/${ticket}" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -n "${summary}" ]] || fail "expected summary for ${ticket}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" "${pattern}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
make_fake_codex() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local bin_dir="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${bin_dir}/codex" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
#!/usr/bin/env bash
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
set -euo pipefail
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
last_message=""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
json=false
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CODEX_FAKE_ARG_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "$*" >>"${CODEX_FAKE_ARG_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
while [[ $# -gt 0 ]]; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  case "$1" in
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    --json)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      json=true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      shift
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    --output-last-message)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      last_message="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      shift 2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    *)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      shift
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  esac
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
prompt="$(mktemp)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
cat >"${prompt}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
ticket="$(sed -n 's/^Ticket: //p' "${prompt}" | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CODEX_FAKE_PROMPT_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat "${prompt}" >>"${CODEX_FAKE_PROMPT_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if grep -q 'Delegation contract:' "${prompt}"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  python3 "${TASK_BOARD_DELEGATION_HELPER}" exempt small-task
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
mkdir -p "$(dirname "${last_message}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if grep -q '^CODEX_REVIEW_GATE$' "${prompt}"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "${CODEX_FAKE_REVIEW_MESSAGE:-CODEX_REVIEW_RESULT: clean}" >"${last_message}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ "${json}" == true && "${CODEX_FAKE_REVIEW_NO_JSON:-0}" != 1 ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    printf '%s\n' '{"type":"thread.started","thread_id":"fake-review-thread"}' '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":20,"output_tokens":30,"reasoning_output_tokens":5}}'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rm -f "${prompt}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CODEX_FAKE_START_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s %s\n' "${ticket}" "$(date +%s)" >>"${CODEX_FAKE_START_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CODEX_FAKE_LOCK_SNAPSHOT:-}" && -n "${CODEX_FAKE_LOCK_FILE:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cp "${CODEX_FAKE_LOCK_FILE}" "${CODEX_FAKE_LOCK_SNAPSHOT}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
sleep "${CODEX_FAKE_SLEEP:-0}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
printf '%s\n' "${CODEX_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}" >"${last_message}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
rm -f "${prompt}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  chmod +x "${bin_dir}/codex"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
make_fake_claude() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local bin_dir="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${bin_dir}/claude" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
#!/usr/bin/env bash
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
set -euo pipefail
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "${CLAUDE_FAKE_IGNORES_TERM:-false}" == true ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  trap '' TERM
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CLAUDE_FAKE_ARG_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "$*" >>"${CLAUDE_FAKE_ARG_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CLAUDE_FAKE_EXECUTABLE_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "$0" >>"${CLAUDE_FAKE_EXECUTABLE_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
prompt="$(cat)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "${prompt}" == *'Delegation contract:'* ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  case "${TEST_DELEGATION_MODE:-exempt}" in
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run) printf 'test subtask' | python3 "${TASK_BOARD_DELEGATION_HELPER}" run >&2 || true ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    missing) ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    *) python3 "${TASK_BOARD_DELEGATION_HELPER}" exempt small-task ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  esac
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
ticket="$(printf '%s\n' "${prompt}" | sed -n 's/^Ticket: //p' | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CLAUDE_FAKE_ARG_LOG_DIR:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${CLAUDE_FAKE_ARG_LOG_DIR}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "$*" >"${CLAUDE_FAKE_ARG_LOG_DIR}/${ticket}.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CLAUDE_FAKE_PROMPT_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "${prompt}" >>"${CLAUDE_FAKE_PROMPT_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CLAUDE_FAKE_START_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s %s\n' "${ticket}" "$(date +%s)" >>"${CLAUDE_FAKE_START_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CLAUDE_FAKE_PROGRESS_FILE:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for _ in $(seq 1 "${CLAUDE_FAKE_PROGRESS_COUNT:-1}"); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep "${CLAUDE_FAKE_PROGRESS_INTERVAL:-0}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    printf '%s\n' 'fake agent progress' >>"${CLAUDE_FAKE_PROGRESS_FILE}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${CLAUDE_FAKE_CHILD_PID_FILE:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ "${CLAUDE_FAKE_CHILD_IGNORES_TERM:-false}" == true ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (trap '' TERM; sleep "${CLAUDE_FAKE_CHILD_SLEEP:-30}") &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  else
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep "${CLAUDE_FAKE_CHILD_SLEEP:-30}" &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "$!" >"${CLAUDE_FAKE_CHILD_PID_FILE}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "$!"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
sleep "${CLAUDE_FAKE_SLEEP:-0}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "${CLAUDE_FAKE_STREAM_JSON:-false}" == true ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${CLAUDE_FAKE_STREAM_PROGRESS_COUNT:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    for _ in $(seq 1 "${CLAUDE_FAKE_STREAM_PROGRESS_COUNT}"); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      sleep "${CLAUDE_FAKE_STREAM_PROGRESS_INTERVAL:-0}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"streaming progress"}]}}'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' '  {"type":"rate_limit_event","rate_limit_info":{"status":"allowed","secretField":"SECRET_RATE_LIMIT","unifiedWindows":{"five_hour":{"utilization":0.2,"note":"SECRET_WINDOW"}}},"session_id":"secret","uuid":"secret-uuid"}'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sleep "${CLAUDE_FAKE_STREAM_DELAY:-0}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' '   {"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-0","name":"Bash","input":{"command":"SECRET_WS_INPUT"}}]}}'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' '{"type":"assistant","session_id":"secret","uuid":"secret-uuid","message":{"content":[{"type":"text","text":"working","citations":"SECRET_TEXT_EXTRA"},{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"SECRET_TOOL_INPUT"}}]}}' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":"SECRET_TOOL_OUTPUT"}]},"tool_use_result":"SECRET_TOOL_OUTPUT"}' '{"type":"result","result":"TASK_BOARD_RESULT: done"}'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
else
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "${CLAUDE_FAKE_MESSAGE:-TASK_BOARD_RESULT: done}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
exit "${CLAUDE_FAKE_EXIT:-0}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  chmod +x "${bin_dir}/claude"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
make_fake_gh() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local bin_dir="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${bin_dir}/gh" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
#!/usr/bin/env bash
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
set -euo pipefail
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "${GH_FAKE_FAIL:-false}" == true ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  echo "gh api failed: token=super-secret-token" >&2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "$1 $2" == "pr view" && "$*" == *"--json headRefOid"* ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "$1 $2" == "pr view" && "$3" =~ ^https://github.com/boxp/example/pull/[0-9]+$ ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${GH_FAKE_LOCK_MTIME_LOG:-}" && -n "${GH_FAKE_LOCK_FILE:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    before="$(stat -c %Y "${GH_FAKE_LOCK_FILE}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep "${GH_FAKE_PR_VIEW_SLEEP_SECONDS:-0}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    after="$(stat -c %Y "${GH_FAKE_LOCK_FILE}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    printf '%s %s\n' "${before}" "${after}" >>"${GH_FAKE_LOCK_MTIME_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  elif [[ -n "${GH_FAKE_PR_VIEW_SLEEP_SECONDS:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep "${GH_FAKE_PR_VIEW_SLEEP_SECONDS}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pr_number="${3##*/}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  checks_var="GH_FAKE_CHECKS_${pr_number}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${GH_FAKE_CHECKS:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    checks="${GH_FAKE_CHECKS}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  elif [[ -n "${!checks_var:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    checks="${!checks_var}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  else
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    checks='[{"name":"runner test","status":"COMPLETED","conclusion":"SUCCESS"}]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  draft_var="GH_FAKE_IS_DRAFT_${pr_number}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  merge_var="GH_FAKE_MERGE_STATE_${pr_number}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state_var="GH_FAKE_PR_STATE_${pr_number}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  draft="${GH_FAKE_IS_DRAFT:-false}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  merge_state="${GH_FAKE_MERGE_STATE:-CLEAN}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pr_state="${GH_FAKE_PR_STATE:-OPEN}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${!draft_var:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    draft="${!draft_var}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${!merge_var:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    merge_state="${!merge_var}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${!state_var:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    pr_state="${!state_var}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Real GitHub returns mergeStateStatus=UNKNOWN (and a mergedAt) for merged PRs.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  merged_at="null"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ "${pr_state}" == "MERGED" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    merged_at='"2026-10-22T10:50:58Z"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    merge_state="UNKNOWN"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat <<JSON
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  "url": "${3}",
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  "state": "${pr_state}",
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  "mergedAt": ${merged_at},
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  "isDraft": ${draft},
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  "mergeStateStatus": "${merge_state}",
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  "statusCheckRollup": ${checks}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
JSON
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "$1 $2" == "pr diff" && "$3" =~ ^https://github.com/boxp/example/pull/[0-9]+$ ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pr_number="${3##*/}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  diff_var="GH_FAKE_DIFF_${pr_number}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  diff="${GH_FAKE_DIFF:-diff --git a/file b/file}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${!diff_var:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    diff="${!diff_var}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "${diff}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ "$1" == "api" && "$2" =~ ^repos/boxp/example/commits/([0-9a-f]{40})$ ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sha="${BASH_REMATCH[1]}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${GH_FAKE_API_LOG:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    printf '%s\n' "${sha}" >>"${GH_FAKE_API_LOG}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -n "${GH_FAKE_KNOWN_SHAS:-}" ]] && grep -qx "${sha}" "${GH_FAKE_KNOWN_SHAS}"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    printf '%s\n' "${sha}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    exit 0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  echo "gh: Not Found (HTTP 404)" >&2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
echo "unexpected gh invocation: $*" >&2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
exit 1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  chmod +x "${bin_dir}/gh"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
write_board() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local body="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${vault}/Boards" "${vault}/Tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${vault}/Boards/Task Board.md" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Task Board
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Ready
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## In Progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
${body}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Review
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
write_ticket() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local ticket="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local status="$3"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local assignee="$4"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local repo="${5:-}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${vault}/Tickets/${ticket}.md" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
id: ${ticket}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
type: task
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
status: ${status}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
priority: medium
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assignee: ${assignee}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
repo: ${repo}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
closed:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# ${ticket}: test ticket
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
Test ticket.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Acceptance Criteria
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] Done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Context
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
Test context.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Plan
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] Run
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Notes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
run_tick() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local state_root="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  shift 2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state_root}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_LOCK_STALE_SECONDS="${CODEX_TASK_BOARD_LOCK_STALE_SECONDS:-180}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  "$@" bb "${RUNNER}" tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_lane_retirement_contract() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log pr_message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/prompt"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pr_message=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: continue'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Gate pass and unmerged: back to Ready with the same assignee, nobody is waited for.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-501|BOXP-501: continue]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i '/^## Review$/d' "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-501 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_PROMPT_LOG="${prompt_log}" CODEX_FAKE_MESSAGE="${pr_message}" run_tick "${vault}" "${state}" env >"${tmp}/tick1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-501: continue\]\].*status::ready.*assignee::codex'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" '^assignee: codex$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" 'Ready継続: 担当 codex のまま次 run へ（自動継続 1/8）'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'the board has no Review lane'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'TASK_BOARD_RESULT: done, TASK_BOARD_RESULT: continue, or TASK_BOARD_RESULT: blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${prompt_log}" 'TASK_BOARD_RESULT: review'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '^## Review'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The next tick continues it and names the head the gates passed.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_PROMPT_LOG="${prompt_log}" CODEX_FAKE_MESSAGE=$'merged and verified\nTASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >"${tmp}/tick2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'https://github.com/boxp/example/pull/123 @ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-501.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${state}/continuation-budget.edn" 'BOXP-501'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A legacy marker from a run started before the rollout does not re-create Review.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-502|BOXP-502: legacy]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i '/^## Review$/d' "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-502 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >"${tmp}/tick3"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-502: legacy\]\].*status::ready.*assignee::codex'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '^## Review'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Boards/Task Board.md" 'status::review'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Fixable gate failure: stays with the worker in In Progress, not with a person.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-503|BOXP-503: fixable]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-503 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE="${pr_message}" run_tick "${vault}" "${state}" env >"${tmp}/tick4"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-503.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-503.md" '^assignee: codex$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The worker's own blocked: named input, resolver and next action, nothing merged.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-504|BOXP-504: scope]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-504 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >"${tmp}/tick5"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-504.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-504.md" 'needed-input=.*resolver=.*next-action='
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A run that never finishes stops at the finite limit and is resumed only explicitly.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-505|BOXP-505: loop]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-505 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local round
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for round in 1 2 3; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" CODEX_TASK_BOARD_CONTINUATION_LIMIT=2 CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/loop${round}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-505.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-505.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-505.md" 'category=continuation-limit'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-505'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Stays stopped: no candidate action while it belongs to boxp.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/loop4"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${tmp}/starts" ]] || fail 'a stopped continuation must not start again by itself'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" update BOXP-505 --vault "${vault}" --lane Blocked --assignee codex >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_CONTINUATION_LIMIT=2 CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/loop5"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-505.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A leftover Review card: with a worker it is continued, for boxp it stays visible.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-506|BOXP-506: worker]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i '/BOXP-506/d; s/^## Review$/## Review\n\n- [ ] [[Tickets\/BOXP-506|BOXP-506: worker]] #ticket status::review\n- [ ] [[Tickets\/BOXP-507|BOXP-507: owner]] #ticket status::review/' "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-506 review codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-507 review boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: continue' run_tick "${vault}" "${state}" env >"${tmp}/legacy"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-506: worker\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-507: owner\]\].*status::review'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" update BOXP-507 --vault "${vault}" --lane Blocked >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-507:.*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_parallel_codex_runs() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin log first_start second_start start_delta
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  log="${tmp}/starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-101|BOXP-101: first]] #ticket status::in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-102|BOXP-102: second]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-101 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-102 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${log}" CODEX_FAKE_SLEEP=2 run_tick "${vault}" "${state}" env >/tmp/task-board-parallel.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(wc -l <"${log}")" -eq 2 ]] || fail "expected two fake codex starts"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  first_start="$(awk 'NR == 1 {print $2}' "${log}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  second_start="$(awk 'NR == 2 {print $2}' "${log}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_delta=$((second_start - first_start))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${start_delta#-}" -le 1 ]] || fail "expected fake codex starts within 1s, got ${start_delta}s"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'status::done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-101.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-102.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_stream_json() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin last_message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-149|BOXP-149: stream]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-149 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true CLAUDE_FAKE_STREAM_DELAY=3 run_tick "${vault}" "${state}" env >/tmp/task-board-stream.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-149.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-149" -name last-message.md -print | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "unexpected stream result"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/ai-ops/subscription/claude.json" ]] || fail "missing subscription snapshot"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local observed finished
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  observed="$(bb -e '(require (quote cheshire.core)) (println (:observed_at (cheshire.core/parse-string (slurp (first *command-line-args*)) true)))' "${state}/ai-ops/subscription/claude.json")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  finished="$(stat -c %Y "$(find "${state}/runs/BOXP-149" -name events.jsonl -print -quit)")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  (( observed <= finished - 2 )) || fail "subscription observation was delayed until process exit"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_pump_drains_when_events_log_cannot_open() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${tmp}/events.jsonl"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  TEST_RUNNER="${RUNNER}" TEST_STATE="${tmp}/state" TEST_LOG_PATH="${tmp}/events.jsonl" bb -e '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (require (quote [clojure.java.io :as io]) (quote [clojure.string :as str]) (quote [cheshire.core :as json]))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (load-file (str (.getParent (io/file (System/getenv "TEST_RUNNER"))) "/ai_subscription_usage.bb"))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (def subscription-module-loaded? (atom true))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (defn root [] (System/getenv "TEST_STATE"))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (def warnings (atom []))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (defn log! [message] (swap! warnings conj message))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (defn sanitize-claude-line [line] line)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (with-open [reader (java.io.PushbackReader. (io/reader (System/getenv "TEST_RUNNER")))]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (loop []
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (let [form (read {:eof nil} reader)]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          (when form
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
            (when (and (seq? form) (= (first form) (quote defn)) (contains? (quote #{pump-claude-stream! await-claude-pump!}) (second form)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
              (eval form))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
            (when-not (resolve (quote await-claude-pump!)) (recur))))))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (let [input (java.io.ByteArrayInputStream. (.getBytes (str (apply str (repeat 10000 "{\"type\":\"assistant\"}\n")) "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\"}}\n" "{\"type\":\"result\",\"result\":\"TASK_BOARD_RESULT: done\"}\n") "UTF-8"))]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (= "TASK_BOARD_RESULT: done" (:result (pump-claude-stream! input (System/getenv "TEST_LOG_PATH")))))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (zero? (.available input)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (= "allowed" (get-in (ai-subscription-usage/snapshot (str (root) "/ai-ops/subscription/claude.json")) [:data :rate_limit_info :status])))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (= 1 (count (filter #(str/includes? % "claude events log open failed") @warnings)))))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ;; The pump attributes events to the scope fixed at process start, not to the
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ;; login at receive time.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (let [home (str (System/getenv "TEST_STATE") "-home")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          state (str (System/getenv "TEST_STATE") "-switch")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          snapshot-path (str state "/ai-ops/subscription/claude.json")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          event-line "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\"}}\n"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          pump! (fn [scope] (with-redefs [root (constantly state)]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
                              (pump-claude-stream! (java.io.ByteArrayInputStream. (.getBytes event-line "UTF-8")) (System/getenv "TEST_LOG_PATH") (atom {}) scope)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          old-home (System/getProperty "user.home")]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (babashka.fs/create-dirs home)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (spit (str home "/.claude.json") (json/generate-string {:oauthAccount {:accountUuid "account-b"}}))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (System/setProperty "user.home" home)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (try
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (pump! "scope-of-account-a")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (assert (not (babashka.fs/exists? snapshot-path)) "event of a run started under another account must not be recorded")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (pump! (ai-subscription-usage/claude-account-scope))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (assert (babashka.fs/exists? snapshot-path) "event of a run under the current account must be recorded")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (finally (System/setProperty "user.home" old-home))))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ;; The caller may stop waiting for the drain (deref timeout): the shared
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ;; summary atom must already hold the result while the stream is still open.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (let [out (java.io.PipedOutputStream.)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          in (java.io.PipedInputStream. out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          summary (atom {})
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          pump (future (pump-claude-stream! in (System/getenv "TEST_LOG_PATH") summary))]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (.write out (.getBytes "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"late\"}]}}\n{\"type\":\"result\",\"result\":\"TASK_BOARD_RESULT: blocked\"}\n" "UTF-8"))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (.flush out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (loop [n 0]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (when (and (not= "TASK_BOARD_RESULT: blocked" (:result @summary)) (< n 200))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          (Thread/sleep 25)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          (recur (inc n))))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (= "TASK_BOARD_RESULT: blocked" (:result @summary)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (= "late" (get-in @summary [:assistant :message :content 0 :text])))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (not (realized? pump)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (.close out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (= "TASK_BOARD_RESULT: blocked" (:result (deref pump 5000 nil)))))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ;; await-claude-pump!: when the drain outlives the grace period, keep
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ;; polling until the late result line arrives instead of reading the atom once.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (let [out (java.io.PipedOutputStream.)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          in (java.io.PipedInputStream. out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          summary (atom {})
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          pump (future (pump-claude-stream! in (System/getenv "TEST_LOG_PATH") summary))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          _ (.write out (.getBytes "{\"type\":\"assistant\"}\n" "UTF-8"))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          _ (.flush out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          writer (future (Thread/sleep 700)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
                         (.write out (.getBytes "{\"type\":\"result\",\"result\":\"TASK_BOARD_RESULT: review\"}\n" "UTF-8"))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
                         (.flush out))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          started (System/currentTimeMillis)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          awaited (await-claude-pump! pump summary 100 10000)]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (= "TASK_BOARD_RESULT: review" (:result awaited)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (< (- (System/currentTimeMillis) started) 9000))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (not (realized? pump)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (deref writer 5000 nil)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (.close out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (deref pump 5000 nil)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (some #(str/includes? % "final result received") @warnings)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ;; ...and gives up at max-ms when no result ever arrives, returning what it has.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (let [out (java.io.PipedOutputStream.)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          in (java.io.PipedInputStream. out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          summary (atom {})
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          pump (future (pump-claude-stream! in (System/getenv "TEST_LOG_PATH") summary))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          _ (.write out (.getBytes "{\"type\":\"assistant\"}\n" "UTF-8"))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          _ (.flush out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          started (System/currentTimeMillis)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          awaited (await-claude-pump! pump summary 100 1200)]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (nil? (:result awaited)))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (:json? awaited))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (>= (- (System/currentTimeMillis) started) 1000))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (.close out)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (deref pump 5000 nil)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (assert (some #(str/includes? % "no final result received") @warnings)))'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_result_survives_events_log_failure() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin last_message RUNNER
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${tmp}/runner"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cp "$(dirname "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb")"/*.bb "${tmp}/runner/"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  RUNNER="${tmp}/runner/task_board_runner.bb"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Make the runner create a directory at the run's events.jsonl path so every
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # log open/write fails while the agent is still streaming its result.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i '/^(defn run-agent!/,/^    (fs\/create-dirs dir)$/ s|^    (fs/create-dirs dir)$|    (fs/create-dirs dir)\n    (fs/create-dirs stdout-path)|' "${RUNNER}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep -q '(fs/create-dirs stdout-path)' "${RUNNER}" || fail "runner patch for log failure did not apply"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-144|BOXP-144: log failure]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-144 in-progress claude-sonnet
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true run_tick "${vault}" "${state}" env >/tmp/task-board-log-failure.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-144" -name last-message.md -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "result lost when events log cannot be written"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-144.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "$(dirname "${last_message}")/events.jsonl" ]] || fail "events log path was not blocked"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_stream_progress_prevents_idle_timeout_when_log_unwritable() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin last_message RUNNER
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${tmp}/runner"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cp "$(dirname "${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb")"/*.bb "${tmp}/runner/"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  RUNNER="${tmp}/runner/task_board_runner.bb"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i '/^(defn run-agent!/,/^    (fs\/create-dirs dir)$/ s|^    (fs/create-dirs dir)$|    (fs/create-dirs dir)\n    (fs/create-dirs stdout-path)|' "${RUNNER}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep -q '(fs/create-dirs stdout-path)' "${RUNNER}" || fail "runner patch for log failure did not apply"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-145|BOXP-145: streaming progress]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-145 in-progress claude-sonnet
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true CLAUDE_FAKE_STREAM_PROGRESS_COUNT=6 CLAUDE_FAKE_STREAM_PROGRESS_INTERVAL=0.5 CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 run_tick "${vault}" "${state}" env >/tmp/task-board-stream-progress-log-failure.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-145" -name last-message.md -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "result lost when streaming with an unwritable log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-145.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-145 ':idle-timeout\? false'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "$(dirname "${last_message}")/events.jsonl" ]] || fail "events log path was not blocked"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_events_log_omits_tool_payloads() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin events last_message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-148|BOXP-148: stream privacy]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-148 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true run_tick "${vault}" "${state}" env >/tmp/task-board-stream-privacy.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  events="$(find "${state}/runs/BOXP-148" -name events.jsonl -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-148" -name last-message.md -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${events}" 'SECRET_TOOL_INPUT|SECRET_TOOL_OUTPUT|SECRET_RATE_LIMIT|SECRET_WINDOW|SECRET_WS_INPUT|SECRET_TEXT_EXTRA|"secret"|secret-uuid|session_id|"uuid"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${events}" '"status":"allowed"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${events}" '"utilization":0.2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${events}" '"name":"Bash"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${events}" 'working'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${events}" 'TASK_BOARD_RESULT: done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "unexpected stream result"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/ai-ops/subscription/claude.json" ]] || fail "missing subscription snapshot"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_run_survives_subscription_snapshot_failure() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin events last_message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/ai-ops"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A regular file where the snapshot directory should be makes every
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # record-claude-rate-limit! call throw; the run itself must still finish.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  : >"${state}/ai-ops/subscription"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-145|BOXP-145: snapshot failure]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-145 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_STREAM_JSON=true run_tick "${vault}" "${state}" env >/tmp/task-board-snapshot-failure.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  events="$(find "${state}/runs/BOXP-145" -name events.jsonl -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-145" -name last-message.md -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${events}" 'TASK_BOARD_RESULT: done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(cat "${last_message}")" == 'TASK_BOARD_RESULT: done' ]] || fail "run must finish when the subscription snapshot cannot be written"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-145.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/ai-ops/subscription" ]] || fail "placeholder must stay a file"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_subscription_metrics_disabled_removes_prom() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-146|BOXP-146: metrics]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-146 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" run_tick "${vault}" "${state}" env >/tmp/task-board-metrics-on.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/ai-ops/subscription-usage.prom" ]] || fail "missing subscription metrics"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-147|BOXP-147: metrics disabled]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-147 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_SUBSCRIPTION_METRICS=false run_tick "${vault}" "${state}" env >/tmp/task-board-metrics-off.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/ai-ops/subscription-usage.prom" ]] || fail "subscription metrics still present"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_assignee_runs_via_claude() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log args_log summary last_message events
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/claude-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  args_log="${tmp}/claude-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-150|BOXP-150: fable]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-150 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_ARG_LOG="${args_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${args_log}" '.*--print --output-format stream-json --verbose.*--agent fable'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${args_log}" '--model'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${args_log}" 'BOXP-150'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: fable$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Fable routing policy'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'gpt-6-astra'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'codex-astra'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Delegate long investigation, implementation, file editing, and test execution to Codex'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-150\|BOXP-150: fable\]\].*status::done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-150.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-150" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-150" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  events="$(find "${state}/runs/BOXP-150" -name events.jsonl -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':agent "fable"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${events}" '^TASK_BOARD_RESULT: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_explicit_claude_assignees_use_fixed_models_and_pinned_binary() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state path_bin pinned_bin args_log args_dir prompt_log executable_log assignee model ticket
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  path_bin="${tmp}/path-bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pinned_bin="${tmp}/pinned-bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  args_log="${tmp}/claude-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  args_dir="${tmp}/claude-args"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/claude-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  executable_log="${tmp}/claude-executable.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${path_bin}" "${pinned_bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${path_bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${pinned_bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for assignee in claude-fable claude-opus claude-sonnet; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    case "${assignee}" in
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      claude-fable) model=claude-fable-5-1; ticket=BOXP-163 ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      claude-opus) model=claude-opus-5-5; ticket=BOXP-164 ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      claude-sonnet) model=claude-sonnet-5-5; ticket=BOXP-165 ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    esac
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: ${assignee}]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_ticket "${vault}" "${ticket}" in-progress "${assignee}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    : > "${prompt_log}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${path_bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CODEX_TASK_BOARD_CLAUDE_BIN="${pinned_bin}/claude" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CLAUDE_FAKE_ARG_LOG="${args_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CLAUDE_FAKE_ARG_LOG_DIR="${args_dir}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CLAUDE_FAKE_EXECUTABLE_LOG="${executable_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      run_tick "${vault}" "${state}" env >/tmp/task-board-"${assignee}".out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${args_dir}/${ticket}.log" "--model ${model}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_not_contains "${args_dir}/${ticket}.log" '--agent'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" "^Task Board assignee/agent: ${assignee}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" 'Claude Code routing policy'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    case "${assignee}" in
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      claude-fable|claude-opus)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        assert_file_contains "${prompt_log}" 'Delegate independent investigation, implementation, file editing, and test execution to Codex'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        assert_file_contains "${prompt_log}" 'gpt-6.1-terra'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        assert_file_contains "${prompt_log}" 'Retain final judgment and verify delegated results'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      claude-sonnet)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        assert_file_not_contains "${prompt_log}" 'Delegate independent investigation, implementation, file editing, and test execution to Codex'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        ;;
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    esac
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_not_contains "${prompt_log}" 'Fable routing policy'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" "~/.claude/skills/obsidian-task-board/bin/task-board.bb append-note ${ticket}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_run_summary_contains "${state}" "${ticket}" ":agent \"${assignee}\""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_run_summary_contains "${state}" "${ticket}" ':status :succeeded'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_run_summary_contains "${state}" "${ticket}" ':exit-code 0'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${vault}/Tickets/${ticket}.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(sort -u "${executable_log}")" == "${pinned_bin}/claude" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail 'expected explicit Claude binary to win over PATH shadow'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_model_environment_is_legacy_only() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin args_log args_dir
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  args_log="${tmp}/claude-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  args_dir="${tmp}/claude-args"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-159|BOXP-159: legacy fable]] #ticket status::in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-160|BOXP-160: fixed opus]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-159 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-160 in-progress claude-opus
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_FABLE_MODEL=legacy-fable-model \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_FABLE_AGENT=legacy-fable-agent \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_FABLE_EXTRA_ARGS='--model legacy-extra-model' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_ARG_LOG="${args_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_ARG_LOG_DIR="${args_dir}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-model-scope.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${args_dir}/BOXP-159.log" '--model legacy-fable-model'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${args_dir}/BOXP-159.log" '--agent legacy-fable-agent'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${args_dir}/BOXP-159.log" '--model legacy-extra-model'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${args_dir}/BOXP-160.log" '--model claude-opus-5-5'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${args_dir}/BOXP-160.log" '--agent'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${args_dir}/BOXP-160.log" 'legacy-fable-model'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${args_dir}/BOXP-160.log" 'legacy-extra-model'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_explicit_claude_error_and_review_markers_are_processed() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-161|BOXP-161: claude error]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-161 in-progress claude-sonnet
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_EXIT=1 run_tick "${vault}" "${state}" env >/tmp/task-board-claude-error.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-161.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-161 ':agent "claude-sonnet"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-161 ':status :blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-161 ':exit-code 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-162|BOXP-162: claude review]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-162 in-progress claude-opus
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-claude-review.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-162.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-162 ':agent "claude-opus"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-162" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" '^TASK_BOARD_RESULT: review$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-166|BOXP-166: missing marker]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-166 in-progress claude-fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_MESSAGE='completed without a task board marker' run_tick "${vault}" "${state}" env >/tmp/task-board-claude-missing-marker.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-166.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-166 ':blocker-category "pr-gate-pr-url"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-167|BOXP-167: blocked marker]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-167 in-progress claude-fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-claude-blocked-marker.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-167.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_agent_idle_timeout_retries() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-154|BOXP-154: stalled fable]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-154 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_SLEEP=2 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-timeout.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-154\|BOXP-154: stalled fable\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-154.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-154.md" 'No agent progress was logged before the idle timeout; the run was stopped and will be retried automatically'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-154" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':idle-timeout\? true'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_SLEEP=2 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-timeout-retry.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-154\|BOXP-154: stalled fable\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-154.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_idle_timeout_stops_agent_children() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin child_pid_file child_pid child_state
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  child_pid_file="${tmp}/child.pid"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-156|BOXP-156: child process]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-156 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_CHILD_PID_FILE="${child_pid_file}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_CHILD_SLEEP=30 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_CHILD_IGNORES_TERM=true \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-child-timeout.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  child_pid="$(cat "${child_pid_file}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if kill -0 "${child_pid}" 2>/dev/null; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    # The process group is stopped correctly, but its orphaned child can remain
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    # as a zombie until PID 1 reaps it. A zombie has no running agent process.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    child_state="$(ps -o stat= -p "${child_pid}" 2>/dev/null | tr -d '[:space:]' || true)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ "${child_state}" == Z* ]] || ! kill -0 "${child_pid}" 2>/dev/null \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      || fail "expected idle timeout to stop Fable child process ${child_pid} (state=${child_state:-unknown})"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_invalid_idle_timeout_does_not_start_agent() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin start_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_log="${tmp}/starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-158|BOXP-158: invalid timeout]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-158 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_START_LOG="${start_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=-1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-invalid-idle-timeout.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${start_log}" ]] || fail "expected invalid idle timeout to prevent Fable startup"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-158.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_progress_prevents_idle_timeout() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-155|BOXP-155: long fable]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-155 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_PROGRESS_FILE="${vault}/Tickets/BOXP-155.md" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_PROGRESS_COUNT=4 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_PROGRESS_INTERVAL=0.4 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_SLEEP=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-fable-progress.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-155\|BOXP-155: long fable\]\].*status::done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-155.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_codex_sol_assignee_includes_delegation_policy() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log summary last_message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/codex-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-152|BOXP-152: codex-sol]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-152 in-progress codex-sol
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-codex-sol.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: codex-sol$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'High-cost model routing policy'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'You are the codex-sol high-cost entry point'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Delegate independent investigation, implementation, and verification to lower-cost models whenever practical'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-152\|BOXP-152: codex-sol\]\].*status::done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-152.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-152" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-152" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':agent "codex-sol"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_codex_full_assignee_includes_delegation_policy() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log summary last_message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/codex-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-153|BOXP-153: codex-full]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-153 in-progress codex-full
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-codex-full.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" '^Task Board assignee/agent: codex-full$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'High-cost model routing policy'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'You are the codex-full high-cost entry point'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Delegate independent investigation, implementation, and verification to lower-cost models whenever practical'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-153\|BOXP-153: codex-full\]\].*status::done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-153.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-153" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  last_message="$(find "${state}/runs/BOXP-153" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':agent "codex-full"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_unsupported_assignee_is_ignored() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin codex_log claude_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  codex_log="${tmp}/codex-starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  claude_log="${tmp}/claude-starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-151|BOXP-151: human]] #ticket status::in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-168|BOXP-168: invalid Claude route]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-151 in-progress boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-168 in-progress claude-unknown
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_START_LOG="${codex_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_START_LOG="${claude_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-unsupported-assignee.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${codex_log}" ]] || fail "expected codex not to start for unsupported assignee"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${claude_log}" ]] || fail "expected claude not to start for unsupported assignee"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -d "${state}/runs/BOXP-151" ]] || fail "expected no run directory for unsupported assignee"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -d "${state}/runs/BOXP-168" ]] || fail "expected no run directory for invalid Claude assignee"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-151.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-168.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains /tmp/task-board-unsupported-assignee.out 'no supported-agent-assigned Task Board tickets'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_stale_lock_recovers() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin old_run
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_run="20260703T000000Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-201/${old_run}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-201|BOXP-201: stale]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-201 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-201.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-201" :run-id "${old_run}" :action :implement :lane "In Progress" :heartbeat-at "2000-01-01T00:00:00Z"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 run_tick "${vault}" "${state}" env >/tmp/task-board-stale.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-201/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-201.md" 'marked interrupted after heartbeat timeout'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-201.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/locks/BOXP-201.edn" ]] || fail "expected stale lock to be released"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_planned_shutdown_lock_recovers_immediately() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin old_run lock_snapshot replacement_run started elapsed heartbeat
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_run="20260710T000000Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  lock_snapshot="${tmp}/new-lock.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-202/${old_run}" "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-202|BOXP-202: planned restart]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-202 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/owners/old-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :pid 10 :started-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-202.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-202" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" prepare-shutdown >/tmp/task-board-prepare-shutdown.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/terminating-owners/old-pod.edn" ':instance-id "old-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  started="${SECONDS}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUN_TIMESTAMP="${old_run}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_LOCK_FILE="${state}/locks/BOXP-202.edn" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_LOCK_SNAPSHOT="${lock_snapshot}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-planned-recovery.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  elapsed=$((SECONDS - started))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  replacement_run="$(sed -n 's/.*:run-id "\([^"]*\)".*/\1/p' "${lock_snapshot}" | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${elapsed}" -lt 5 ]] || fail "expected planned shutdown recovery under 5s in simulation, got ${elapsed}s"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${replacement_run}" == "${old_run}-"* ]] || fail "expected a unique replacement run ID for the same timestamp, got ${replacement_run}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-202/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-202/${old_run}/summary.edn" ':reason "planned workspace shutdown"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-202/${replacement_run}/summary.edn" ':status :succeeded'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-202.md" 'marked interrupted after planned workspace shutdown of owner old-pod'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-202.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${lock_snapshot}" ':owner-id "new-pod"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${lock_snapshot}" ':owner-instance-id "new-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/terminating-owners/old-pod.edn" ]] || fail "expected recovered owner marker to be removed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/locks/BOXP-202.edn" ]] || fail "expected replacement run to release its lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  echo "planned shutdown recovery simulation passed in ${elapsed}s"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_cross_process_lock_guard_preserves_replacement_lock() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state old_run heartbeat signal recover_pid replacement
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_run="20260710T000050Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  signal="${tmp}/before-delete"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${state}/locks" "${state}/runs/BOXP-205/${old_run}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-205.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-205" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "2000-01-01T00:00:00Z"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_TEST_BEFORE_LOCK_DELETE_SIGNAL="${signal}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_TEST_BEFORE_LOCK_DELETE_MILLIS=1500 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" recover >/tmp/task-board-cross-process-recover.out 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  recover_pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for _attempt in $(seq 1 50); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ -e "${signal}" ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ ! -e "${signal}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    kill -KILL "${recover_pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${recover_pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected recovery process to reach guarded compare-and-delete"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  replacement="{:ticket \"BOXP-205\" :run-id \"replacement-run\" :action :implement :lane \"In Progress\" :owner-id \"replacement-pod\" :owner-instance-id \"replacement-instance\" :heartbeat-at \"${heartbeat}\"}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb -e '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    (let [[guard-path lock-path content] *command-line-args*
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          guard-file (java.io.File. guard-path)]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (.mkdirs (.getParentFile guard-file))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      (with-open [file (java.io.RandomAccessFile. guard-file "rw")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
                  channel (.getChannel file)]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        (let [_file-lock (.lock channel)]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
          (spit lock-path (str content "\n")))))' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/lock-guards/BOXP-205.lock" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/locks/BOXP-205.edn" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${replacement}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${recover_pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/locks/BOXP-205.edn" ':run-id "replacement-run"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/locks/BOXP-205.edn" ':owner-id "replacement-pod"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-205/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Start `loop` in the background with the given owner / instance and wait until
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# the lock for the ticket exists. Sets LOOP_PID (the loop must be a child of the
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# calling shell so `wait` works; do not call this inside a subshell).
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
LOOP_PID=""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
start_loop_with_lock() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="$1" state="$2" ticket="$3" output="$4" bin="$5"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  shift 5
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local attempt
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=old-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_POLL_SECONDS=60 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "$@" bb "${RUNNER}" loop >"${output}" 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  LOOP_PID=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for attempt in $(seq 1 200); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ -e "${state}/locks/${ticket}.edn" ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ ! -e "${state}/locks/${ticket}.edn" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    kill -KILL "${LOOP_PID}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${LOOP_PID}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected loop runner to lock ${ticket}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
wait_for_file() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local file="$1" attempt
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for attempt in $(seq 1 200); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ -s "${file}" ]] && return 0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fail "expected ${file} to appear"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assert_process_stopped() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pid="$1" what="$2" state
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if kill -0 "${pid}" 2>/dev/null; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    # An orphan can remain as a zombie until PID 1 reaps it; a zombie is not running.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    state="$(ps -o stat= -p "${pid}" 2>/dev/null | tr -d '[:space:]' || true)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ "${state}" == Z* ]] || fail "expected ${what} ${pid} to be stopped (state=${state:-unknown})"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_sigterm_stops_in_flight_agent_and_keeps_lock_for_next_owner() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin output child_pid_file child_pid pid started elapsed summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  output="${tmp}/runner.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  child_pid_file="${tmp}/child.pid"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-301|BOXP-301: shutdown in flight]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-301 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_loop_with_lock "${vault}" "${state}" BOXP-301 "${output}" "${bin}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    env CLAUDE_FAKE_CHILD_PID_FILE="${child_pid_file}" CLAUDE_FAKE_CHILD_SLEEP=120
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pid="${LOOP_PID}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait_for_file "${child_pid_file}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  child_pid="$(cat "${child_pid_file}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  started="$(date +%s)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  kill -TERM "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  elapsed=$(( $(date +%s) - started ))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${elapsed}" -lt 15 ]] || fail "expected SIGTERM shutdown with a cooperative agent to finish quickly, took ${elapsed}s"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The agent and its child received TERM through the process group.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_process_stopped "${child_pid}" "agent child"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${output}" 'shutdown: signalling TERM to 1 in-flight agent process group'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${output}" 'shutdown: in-flight agents stopped'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${output}" 'shutdown: in-flight card processing finalized'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${output}" 'interrupted by planned workspace shutdown; lock kept for the next owner'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${output}" 'did not exit within grace'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Marker written, lock kept, run recorded as interrupted by the terminating side.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/terminating-owners/old-pod.edn" ':instance-id "old-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${state}/locks/BOXP-301.edn" ]] || fail "expected the lock to stay for the next owner after planned shutdown"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-301" -name summary.edn -print | sort | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':reason "planned workspace shutdown"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':agent-exit-code'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # No lane / frontmatter / blocked transition from the dying runner.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: shutdown in flight\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^assignee: fable$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-301.md" 'finished with result'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-301.md" 'Blocked transition recorded'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The next owner recovers exactly once through the marker and re-runs the ticket.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-shutdown-next-owner.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':shutdown \{'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'marked interrupted after planned workspace shutdown of owner old-pod'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'marked interrupted' "${vault}/Tickets/BOXP-301.md")" == 1 ]] || fail "expected a single interrupted note"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/terminating-owners/old-pod.edn" ]] || fail "expected the recovered marker to be removed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(find "${state}/runs/BOXP-301" -mindepth 1 -maxdepth 1 -type d | wc -l)" == 2 ]] || fail "expected exactly one replacement run"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/locks/BOXP-301.edn" ]] || fail "expected the replacement run to release its lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_sigterm_kills_term_resistant_agent_within_grace() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin output child_pid_file child_pid pid started elapsed summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  output="${tmp}/runner.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  child_pid_file="${tmp}/child.pid"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-302|BOXP-302: resistant agent]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-302 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_loop_with_lock "${vault}" "${state}" BOXP-302 "${output}" "${bin}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    env CLAUDE_FAKE_IGNORES_TERM=true CLAUDE_FAKE_CHILD_IGNORES_TERM=true \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        CLAUDE_FAKE_CHILD_PID_FILE="${child_pid_file}" CLAUDE_FAKE_CHILD_SLEEP=120 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
        CODEX_TASK_BOARD_SHUTDOWN_AGENT_GRACE_SECONDS=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pid="${LOOP_PID}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait_for_file "${child_pid_file}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  child_pid="$(cat "${child_pid_file}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  started="$(date +%s)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  kill -TERM "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  elapsed=$(( $(date +%s) - started ))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${elapsed}" -ge 2 && "${elapsed}" -lt 15 ]] || fail "expected bounded shutdown wait (2s grace) then KILL, took ${elapsed}s"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_process_stopped "${child_pid}" "TERM-resistant agent child"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${output}" 'did not exit within grace; sending KILL'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${output}" 'shutdown: in-flight agents stopped'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${state}/locks/BOXP-302.edn" ]] || fail "expected the lock to stay for the next owner"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-302" -name summary.edn -print | sort | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_expired_foreign_shutdown_marker_is_retired() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state old_requested fresh_requested
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_requested="$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fresh_requested="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${state}/terminating-owners" "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/terminating-owners/gone-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "gone-pod" :instance-id "gone-instance" :host "gone-pod" :requested-at "${old_requested}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/owners/gone-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "gone-pod" :instance-id "gone-instance" :status :terminating :host "gone-pod" :shutdown-requested-at "${old_requested}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/terminating-owners/recent-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "recent-pod" :instance-id "recent-instance" :host "recent-pod" :requested-at "${fresh_requested}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-expired-marker.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/terminating-owners/gone-pod.edn" ]] || fail "expected the expired foreign marker to be retired"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/owners/gone-pod.edn" ':status :terminated'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${state}/terminating-owners/recent-pod.edn" ]] || fail "expected a recent foreign marker to remain for a later scan"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_sigterm_writes_shutdown_marker_without_prestop() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state output pid marker attempt
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  output="${tmp}/runner.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  marker="${state}/terminating-owners/old-pod.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=old-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_POLL_SECONDS=60 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for attempt in $(seq 1 50); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ -e "${state}/owners/old-pod.edn" ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ ! -e "${state}/owners/old-pod.edn" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    kill -KILL "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected loop runner to activate old-pod owner"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  kill -TERM "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${marker}" ]] || fail "expected SIGTERM shutdown hook to write owner marker"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${marker}" ':owner-id "old-pod"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${marker}" ':instance-id "old-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${output}" 'prepared shutdown for owner old-pod, instance=old-instance'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_one_shot_tick_does_not_replace_loop_owner_instance() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state output pid marker
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  output="${tmp}/runner.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  marker="${state}/terminating-owners/pod-x.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=pod-x \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=loop-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_POLL_SECONDS=60 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for _attempt in $(seq 1 50); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ -e "${state}/owners/pod-x.edn" ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ ! -e "${state}/owners/pod-x.edn" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    kill -KILL "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected loop runner to register its owner instance"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=pod-x \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=tick-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" tick >/tmp/task-board-owner-one-shot-tick.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/owners/pod-x.edn" ':instance-id "loop-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${state}/owners/pod-x.edn" ':instance-id "tick-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  kill -TERM "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${marker}" ]] || fail "expected loop shutdown to create an owner marker"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${marker}" ':instance-id "loop-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${marker}" ':instance-id "tick-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_current_owner_shutdown_marker_drains_without_recovery() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin old_run heartbeat start_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_run="20260710T000100Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_log="${tmp}/starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-203/${old_run}" "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-203|BOXP-203: draining]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-203 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/owners/current-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "current-pod" :instance-id "current-instance" :host "current-pod" :pid 10 :started-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-203.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-203" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "current-pod" :owner-instance-id "current-instance" :heartbeat-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=current-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" prepare-shutdown >/tmp/task-board-current-prepare.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=current-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=current-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_START_LOG="${start_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-current-drain.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${start_log}" ]] || fail "expected draining owner not to start a replacement run"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${state}/locks/BOXP-203.edn" ]] || fail "expected current owner lock to remain active"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains /tmp/task-board-current-drain.out 'is draining; not accepting new tickets'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-203.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_same_owner_new_instance_recovers_previous_instance() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin old_run heartbeat start_log output marker pid
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_run="20260710T000150Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_log="${tmp}/starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  output="${tmp}/runner.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  marker="${state}/terminating-owners/restarted-pod.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${bin}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/locks" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/runs/BOXP-210/${old_run}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/terminating-owners" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-210|BOXP-210: container restart]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-210 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/owners/restarted-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "restarted-pod" :instance-id "old-instance" :status :terminating :host "restarted-pod" :shutdown-requested-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${marker}" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "restarted-pod" :instance-id "old-instance" :host "restarted-pod" :requested-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-210.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-210" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "restarted-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=restarted-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_POLL_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_START_LOG="${start_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for _attempt in $(seq 1 100); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if [[ -e "${start_log}" ]] && grep -Eq '^status: done$' "${vault}/Tickets/BOXP-210.md"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ ! -e "${start_log}" ]] || ! grep -Eq '^status: done$' "${vault}/Tickets/BOXP-210.md"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    kill -KILL "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected a new runner instance with the same owner to recover and accept tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${marker}" ]] || fail "expected the previous instance marker to be consumed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/owners/restarted-pod.edn" ':instance-id "new-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/owners/restarted-pod.edn" ':status :active'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-210/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-210/${old_run}/summary.edn" ':reason "planned workspace shutdown"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  kill -TERM "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${marker}" ':instance-id "new-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_same_owner_new_instance_retires_empty_previous_marker() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin heartbeat start_log output marker pid
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_log="${tmp}/starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  output="${tmp}/runner.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  marker="${state}/terminating-owners/restarted-empty-pod.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/terminating-owners" "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-211|BOXP-211: empty container restart]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-211 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/owners/restarted-empty-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "restarted-empty-pod" :instance-id "old-instance" :status :terminating :host "restarted-empty-pod" :shutdown-requested-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${marker}" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "restarted-empty-pod" :instance-id "old-instance" :host "restarted-empty-pod" :requested-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=restarted-empty-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_POLL_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_START_LOG="${start_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" loop >"${output}" 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for _attempt in $(seq 1 100); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if [[ -e "${start_log}" ]] && grep -Eq '^status: done$' "${vault}/Tickets/BOXP-211.md"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ ! -e "${start_log}" ]] || ! grep -Eq '^status: done$' "${vault}/Tickets/BOXP-211.md"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    kill -KILL "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected a new runner instance to retire an empty previous marker and accept tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${marker}" ]] || fail "expected the empty previous instance marker to be retired"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/owners/restarted-empty-pod.edn" ':instance-id "new-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/owners/restarted-empty-pod.edn" ':status :active'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${output}" 'is draining; not accepting new tickets'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  kill -TERM "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${marker}" ':instance-id "new-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_mismatched_shutdown_marker_does_not_recover_fresh_lock() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin old_run heartbeat start_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_run="20260710T000200Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_log="${tmp}/starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-204/${old_run}" "${state}/terminating-owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-204|BOXP-204: mismatched owner]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-204 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-204.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-204" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "still-active" :heartbeat-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/terminating-owners/old-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "old-pod" :instance-id "different-instance" :host "old-pod" :requested-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_START_LOG="${start_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-mismatched-owner.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${start_log}" ]] || fail "expected mismatched marker not to start a replacement run"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${state}/locks/BOXP-204.edn" ]] || fail "expected fresh mismatched lock to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${state}/terminating-owners/old-pod.edn" ]] || fail "expected unmatched marker to remain for a later scan"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-204.md" 'marked interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-204.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_shutdown_marker_waits_for_late_matching_lock() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state old_run heartbeat marker owner_state
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old_run="20260710T000300Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  marker="${state}/terminating-owners/old-pod.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  owner_state="${state}/owners/old-pod.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${state}/locks" "${state}/runs/BOXP-206/${old_run}" "${state}/terminating-owners" "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${marker}" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :requested-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${owner_state}" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :pid 10 :started-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" recover >/tmp/task-board-marker-before-lock.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${marker}" ]] || fail "expected marker without a matching lock to survive recovery"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${owner_state}" ]] || fail "expected owner state to remain with an unmatched marker"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-206.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-206" :run-id "${old_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" recover >/tmp/task-board-marker-after-lock.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/locks/BOXP-206.edn" ]] || fail "expected late matching lock to be recovered"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${marker}" ]] || fail "expected consumed marker to be removed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${owner_state}" ]] || fail "expected recovered owner state to remain as a termination tombstone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${owner_state}" ':status :terminated'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${owner_state}" ':instance-id "old-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-206/${old_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-206/${old_run}/summary.edn" ':reason "planned workspace shutdown"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_shutdown_marker_survives_late_second_lock() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state first_run late_run heartbeat marker owner_state signal recover_pid
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  first_run="20260710T000400Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  late_run="20260710T000401Z"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  marker="${state}/terminating-owners/old-pod.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  owner_state="${state}/owners/old-pod.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  signal="${tmp}/before-marker-delete"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/locks" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/runs/BOXP-207/${first_run}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/runs/BOXP-208/${late_run}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/terminating-owners" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${marker}" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :requested-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${owner_state}" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :pid 10 :started-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-207.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-207" :run-id "${first_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_TEST_BEFORE_MARKER_DELETE_SIGNAL="${signal}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_TEST_BEFORE_MARKER_DELETE_MILLIS=1500 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" recover >/tmp/task-board-marker-late-second.out 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  recover_pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for _attempt in $(seq 1 50); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ -e "${signal}" ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ ! -e "${signal}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    kill -KILL "${recover_pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${recover_pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected recovery to pause before deleting a consumed marker"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/locks/BOXP-208.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:ticket "BOXP-208" :run-id "${late_run}" :action :implement :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${recover_pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/locks/BOXP-207.edn" ]] || fail "expected the first matching lock to be recovered"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${state}/locks/BOXP-208.edn" ]] || fail "expected the late lock to remain for the next scan"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${marker}" ]] || fail "expected a marker with a late second lock to be retained"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${owner_state}" ]] || fail "expected owner state to remain while a matching lock exists"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-207/${first_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=new-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${RUNNER}" recover >/tmp/task-board-marker-late-second-retry.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/locks/BOXP-208.edn" ]] || fail "expected the late lock to be recovered on the next scan"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${marker}" ]] || fail "expected marker removal after all matching locks were recovered"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${owner_state}" ]] || fail "expected owner termination tombstone after all matching locks were recovered"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${owner_state}" ':status :terminated'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${owner_state}" ':instance-id "old-instance"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-208/${late_run}/summary.edn" ':status :interrupted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/runs/BOXP-208/${late_run}/summary.edn" ':reason "planned workspace shutdown"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_terminated_owner_cannot_create_lock_after_marker_cleanup() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin start_log heartbeat
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_log="${tmp}/starts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  heartbeat="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/owners"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-209|BOXP-209: retired owner]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-209 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${state}/owners/old-pod.edn" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
{:owner-id "old-pod" :instance-id "old-instance" :status :terminated :host "old-pod" :terminated-at "${heartbeat}"}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=old-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=old-instance \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_START_LOG="${start_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-terminated-owner.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${start_log}" ]] || fail "expected a terminated owner not to start an agent"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/locks/BOXP-209.edn" ]] || fail "expected a terminated owner not to create a lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains /tmp/task-board-terminated-owner.out 'is draining; not accepting new tickets'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-209.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_without_pr_is_blocked() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-301|BOXP-301: review]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-301 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '## Blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: review\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'reason=PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'Blocked transition recorded: ticket=BOXP-301; run='
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'action=implement; at=.*category=pr-gate-pr-url'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-301.md" 'inspect run artifacts: .*/summary\.edn, .*/last-message\.md, .*/events\.jsonl, .*/stderr\.log'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-301\|BOXP-301: review\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_reported_blocked_is_audited() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-302|BOXP-302: fable blocked]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-302 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CLAUDE_FAKE_MESSAGE=$'TASK_BOARD_RESULT: blocked\napi_key=do-not-expose' run_tick "${vault}" "${state}" env >/tmp/task-board-fable-blocked.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-302\|BOXP-302: fable blocked\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'status::blocked.*assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" 'category=agent-reported-blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" 'reason=Agent reported blocked; inspect the referenced run artifacts'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-302.md" 'do-not-expose'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-302.md" 'inspect run artifacts:'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-302 ':status :blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocker_note_failure_keeps_current_lane() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-303|BOXP-303: notes failure]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-303 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKER_NOTE=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-blocker-note-failure.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-303\|BOXP-303: notes failure\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-303.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-303.md" 'Blocked transition recorded:'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-303 ':status :blocker-note-failed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains /tmp/task-board-blocker-note-failure.out 'blocked transition withheld'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_runner_internal_error_is_audited() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-304|BOXP-304: runner error]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-304 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FORCE_RUNNER_EXCEPTION=true run_tick "${vault}" "${state}" env >/tmp/task-board-runner-internal-error.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-304\|BOXP-304: runner error\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-304.md" 'category=runner-internal-error'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-304.md" 'reason=Runner internal error; inspect the referenced run artifacts'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-304.md" 'super-secret-token'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-304.md" 'inspect run artifacts:'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-304 ':status :blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocker_reason_redacts_github_pat_and_spaced_api_key() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-305|BOXP-305: credential redaction]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-305 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FORCE_RUNNER_EXCEPTION=true \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_TEST_RUNNER_EXCEPTION_MESSAGE='GitHub API failed: github_pat_abcdefghijklmnopqrstuvwxyz123456 API key: spaced-secret-value' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-blocker-credential-redaction.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-305.md" 'reason=Runner internal error; inspect the referenced run artifacts'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-305.md" 'abcdefghijklmnopqrstuvwxyz123456'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-305.md" 'spaced-secret-value'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocker_note_failure_restores_original_lane() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-306|BOXP-306: restore ready]] #ticket status::ready"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-306 ready codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" update BOXP-306 --vault "${vault}" --lane Ready >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKER_NOTE=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-blocker-note-restore.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-306\|BOXP-306: test ticket\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-306.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-306.md" '^assignee: codex$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocked_state_failure_records_a_single_audit_note_and_restores_lane() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin note_count
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-307|BOXP-307: state failure]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-307 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE=true CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-blocked-state-failure.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-307\|BOXP-307: state failure\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-307.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  note_count="$(grep -c 'Blocked transition recorded: ticket=BOXP-307;' "${vault}/Tickets/BOXP-307.md")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${note_count}" -eq 1 ]] || fail "expected one blocked audit note, got ${note_count}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-307 ':status :succeeded'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-307" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${summary}" ':status :blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains /tmp/task-board-blocked-state-failure.out 'blocked transition state update failed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_nonretryable_pr_gate_blocked_state_failure_keeps_summary_consistent() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-308|BOXP-308: nonretryable gate state failure]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-308 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A review result without a PR URL is a non-retryable :pr-url gate
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # failure.  The forced Blocked-state failure must restore the ticket while
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # keeping the provisional succeeded summary, rather than persisting :blocked.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE=true \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-nonretryable-gate-state-failure.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-308\|BOXP-308: nonretryable gate state failure\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-308.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-308" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':status :succeeded'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${summary}" ':status :blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains /tmp/task-board-nonretryable-gate-state-failure.out 'blocked transition state update failed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_pr_url_is_noted() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-401|BOXP-401: review pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-401 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=1 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-pr.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-401\|BOXP-401: review pr\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" '^assignee: codex$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" 'PR: https://github.com/boxp/example/pull/123'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-401.md" 'Review gates passed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_without_repo_marker_skips_pr_gates() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-402|BOXP-402: no repo review]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-402 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-none.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-402\|BOXP-402: no repo review\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-402.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A skipped gate (no PR to check) must not be counted as a pass.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["all" "skip"\] 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["pr-url" "skip"\] 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if grep -q '\["all" "pass"\]' "${state}/ai-ops/ledger-stats.edn"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "review-none gate must not be counted as pass"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_conflict_is_blocked() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-403|BOXP-403: conflict]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-403 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_MERGE_STATE=DIRTY CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-conflict.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-403\|BOXP-403: conflict\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" '^assignee: codex$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" 'Review gate failed \(conflict\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-403.md" 'Retrying with Codex instruction 1/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-403 ':gate :conflict'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-403 ':status :retrying'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_pr_gate_api_failure_is_audited() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-417|BOXP-417: pr api failure]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-417 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_FAIL=true CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-pr-api-failure.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-417\|BOXP-417: pr api failure\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-417.md" 'category=pr-gate-pr-gate'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-417.md" 'reason='
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-417.md" 'super-secret-token'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-417.md" 'inspect run artifacts:'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-417 ':gate :pr-gate'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "$(find "${state}/runs/BOXP-417" -name summary.edn -print | sort | tail -n 1)" 'super-secret-token'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_review_gate_retry_keeps_fable_assignee() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-416|BOXP-416: fable conflict]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-416 in-progress fable boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_MERGE_STATE=DIRTY CLAUDE_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-fable-review-conflict.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-416\|BOXP-416: fable conflict\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-416.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-416.md" '^assignee: fable$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-416.md" 'Retrying with Codex instruction 1/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-416 ':agent "fable"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/state.edn" ':agent "fable"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_ci_failure_is_blocked() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-404|BOXP-404: ci fail]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-404 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-ci.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-404\|BOXP-404: ci fail\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-404.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-404.md" 'Review gate failed \(ci\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-404.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-404.md" 'unit=FAILURE'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
review_severity_setup() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-405|BOXP-405: review issue]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-405 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
review_severity_tick() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >"${tmp}/tick.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assert_no_review_budget() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -f "${state}/gate-failure-budget.edn" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${state}/gate-failure-budget.edn" ':failures \{\}'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -f "${state}/state.edn" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_not_contains "${state}/state.edn" ':pr-gate-retries'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_codex_review_issue_is_blocked() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\n- missing regression test' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-405: review issue.*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Review gate failed \(codex-review\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'missing regression test'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p1_finding_retries_and_consumes_budget() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin artifact
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | src/a.clj:10 | nil deref on empty input' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Retrying with Codex instruction 1/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-findings'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'nil deref'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  artifact="$(find "${state}/runs/BOXP-405" -name codex-review-boxp__example-123-blocking.md -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${artifact}" 'nil deref on empty input'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/gate-failure-budget.edn" 'BOXP-405'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -o ':class "review-findings"' "${state}/gate-failure-budget.edn" | wc -l)" == 1 ]] || fail "expected one budget failure"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p0_finding_blocks() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P0 | x | credential leak' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Retrying with Codex instruction 1/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -o ':class "review-findings"' "${state}/gate-failure-budget.edn" | wc -l)" == 1 ]] || fail "expected one budget failure"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p2_only_passes_without_budget() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | improve wording\nCODEX_REVIEW_FINDING: P3 | x | rename\nCODEX_REVIEW_FINDING: nit | x | cleanup' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-405: review issue.*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Review gates passed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Non-blocking low-priority review findings \(P2/P3/nit\): 3'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'improve wording'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-405 ':low-priority-findings'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_mixed_findings_retry_targets_only_blocking() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin artifact
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | x | real defect\nCODEX_REVIEW_FINDING: P2 | x | optional wording' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  artifact="$(find "${state}/runs/BOXP-405" -name codex-review-boxp__example-123-blocking.md -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${artifact}" 'real defect'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${artifact}" 'optional wording'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_PROMPT_LOG="${tmp}/prompt" CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: clean' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/prompt" 'Severity policy \(BOXP-377\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/prompt" 'codex-review-boxp__example-123-blocking.md'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${tmp}/prompt" 'optional wording'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_unknown_severity_output_stops() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for message in $'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P9 | x | y' 'no marker'; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_REVIEW_MESSAGE="${message}" review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p2_with_unstructured_lines_stops() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | wording\n- unformatted real defect' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'unformatted real defect'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p1_with_unstructured_lines_stops() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | x | real defect\n- unformatted second defect' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'unformatted second defect'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_clean_with_unstructured_lines_stops() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: clean\n- unformatted real defect' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'unformatted real defect'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_finding_without_severity_stops() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2 | x | wording\nCODEX_REVIEW_FINDING: | x | real defect' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-405.md" 'real defect'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_malformed_finding_stops() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P2' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_conflicting_result_marker_stops() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_MESSAGE=$'CODEX_REVIEW_RESULT: clean\nCODEX_REVIEW_RESULT: issues' review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=codex-review-invalid-output'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_no_review_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_same_p1_retry_count_survives_p2_changes() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin count i message
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for count in 1 2 3; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    message=$'CODEX_REVIEW_RESULT: issues\nCODEX_REVIEW_FINDING: P1 | x | real defect'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    for ((i = 1; i <= count; i++)); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      message+=$'\nCODEX_REVIEW_FINDING: P2 | x | wording'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_REVIEW_MESSAGE="${message}" review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'Retrying with Codex instruction 2/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" 'category=pr-gate-retry-limit'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_pr_and_none_marker_checks_pr() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-406|BOXP-406: pr wins]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-406 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'TASK_BOARD_REVIEW_PR: none\nCreated PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-pr-wins.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-406\|BOXP-406: pr wins\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-406.md" 'Review gates passed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_multiple_pr_urls_checks_all() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-410|BOXP-410: multiple prs]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-410 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PRs:\nhttps://github.com/boxp/example/pull/123\nhttps://github.com/boxp/example/pull/456\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-multiple-prs.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-410\|BOXP-410: multiple prs\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-410.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-410.md" 'PR: https://github.com/boxp/example/pull/123, https://github.com/boxp/example/pull/456'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-410.md" 'Review gates passed\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-410.md" 'GitHub mergeStateStatus'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-410" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':checked-pr-urls \["https://github.com/boxp/example/pull/123" "https://github.com/boxp/example/pull/456"\]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${summary}" 'GitHub mergeStateStatus'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_multiple_pr_urls_blocks_on_second_failure() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-411|BOXP-411: second pr fails]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-411 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS_456='[{"name":"integration","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PRs:\nhttps://github.com/boxp/example/pull/123\nhttps://github.com/boxp/example/pull/456\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-multiple-prs-fail.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-411\|BOXP-411: second pr fails\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" 'Review gate failed \(ci\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" 'https://github.com/boxp/example/pull/456'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-411.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-411.md" 'integration=FAILURE'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_keeps_lock_heartbeat_active() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin log before after
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  log="${tmp}/lock-mtime.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-412|BOXP-412: gate heartbeat]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-412 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    GH_FAKE_LOCK_FILE="${state}/locks/BOXP-412.edn" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    GH_FAKE_LOCK_MTIME_LOG="${log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    GH_FAKE_PR_VIEW_SLEEP_SECONDS=2 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-review-gate-heartbeat.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  read -r before after <"${log}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${after}" -gt "${before}" ]] || fail "expected lock heartbeat to update during PR gate, got ${before} -> ${after}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-412\|BOXP-412: gate heartbeat\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_passes_codex_model_profile_to_review() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  log="${tmp}/codex-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-413|BOXP-413: review codex config]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-413 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_MODEL=gpt-test \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_PROFILE=review-profile \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_ARG_LOG="${log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-review-codex-config.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${log}" '--json.*codex-review-boxp__example-123\.md.*--model gpt-test.*--profile review-profile'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local usage_file
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  usage_file="$(find "${state}/runs/BOXP-413" -name codex-review-boxp__example-123-usage.jsonl -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${usage_file}" '"usage_status":"recorded"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${usage_file}" '"input_tokens":120'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${usage_file}" '"thread_id":"fake-review-thread"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${usage_file}" 'gpt-|CODEX_REVIEW'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-413\|BOXP-413: review codex config\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_missing_usage_still_passes() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin usage_file
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  review_severity_setup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_FAKE_REVIEW_NO_JSON=1 review_severity_tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-405.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  usage_file="$(find "${state}/runs/BOXP-405" -name codex-review-boxp__example-123-usage.jsonl -print -quit)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${usage_file}" '"usage_status":"unrecorded"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_empty_ci_rollup_times_out() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-407|BOXP-407: no checks yet]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-407 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=1 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-empty-ci.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-407\|BOXP-407: no checks yet\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-407.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-407.md" 'Review gate failed \(ci\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-407.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-407.md" 'No CI checks have been reported'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_empty_ci_rollup_passes_for_no_ci_repo() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-450|BOXP-450: no ci repo]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-450 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Explicit opt-in: repo listed in CODEX_TASK_BOARD_NO_CI_REPOS → empty checks + CLEAN merge passes immediately
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=10 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_TASK_BOARD_NO_CI_REPOS='boxp/example' GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-no-ci-repo.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-450\|BOXP-450: no ci repo\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-450.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-450.md" 'Review gates passed\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_empty_ci_rollup_times_out_without_no_ci_opt_in() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-451|BOXP-451: ci timeout]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-451 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Without opt-in, empty checks with CLEAN merge should time out (not auto-pass)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=3 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-ci-timeout.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-451\|BOXP-451: ci timeout\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-451.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-451.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-451.md" 'Timed out waiting for PR gates'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_no_ci_repo_requires_clean_merge_state() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-452|BOXP-452: has hooks no ci]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-452 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # NO_CI_REPOS should NOT skip CI when mergeStateStatus=HAS_HOOKS (only CLEAN is allowed)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=3 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_TASK_BOARD_NO_CI_REPOS='boxp/example' GH_FAKE_MERGE_STATE=HAS_HOOKS GH_FAKE_CHECKS='[]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-has-hooks-no-ci.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-452\|BOXP-452: has hooks no ci\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-452.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-452.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-452.md" 'Timed out waiting for PR gates'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_canonical_path_hash_symlink_isolation() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault real_dir symlink_dir lock_dir
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  real_dir="${tmp}/real-vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  symlink_dir="${tmp}/link-vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  lock_dir="/tmp/task-board-locks"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${real_dir}/Tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ln -s "${real_dir}" "${symlink_dir}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${real_dir}/Tickets/BOXP-889.md" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
id: BOXP-889
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
type: task
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
status: in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
priority: medium
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assignee: codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
repo:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
closed:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# BOXP-889: symlink test
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Notes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rm -f "${lock_dir}"/*BOXP-889* 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" append-note BOXP-889 --vault "${real_dir}" --source "test" --note "real-path-note"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" append-note BOXP-889 --vault "${symlink_dir}" --source "test" --note "symlink-path-note"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep -q "real-path-note" "${real_dir}/Tickets/BOXP-889.md" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "real-path note was not written"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep -q "symlink-path-note" "${real_dir}/Tickets/BOXP-889.md" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "symlink-path note was not written"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # With getCanonicalPath, symlink and real path resolve to the same canonical path,
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # producing only one lock file (not two distinct ones as with cross-vault).
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local lock_count
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  lock_count="$(ls "${lock_dir}" 2>/dev/null | grep -c 'BOXP-889' || echo 0)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [ "${lock_count}" -eq 1 ] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected exactly 1 lock file for symlink/real-path (got ${lock_count}): same canonical path must share a lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_draft_pr_is_retried() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/prompts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-408|BOXP-408: draft pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-408 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_IS_DRAFT=true CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-draft.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-408\|BOXP-408: draft pr\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" '^assignee: codex$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" 'Review gate failed \(mergeability\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-408.md" 'Safe diagnostic: .*/pr-gate-diagnostic\.edn \(category=mergeability; detail=The PR is not mergeable yet\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-408.md" 'still a draft'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_IS_DRAFT=true CODEX_FAKE_PROMPT_LOG="${prompt_log}" CODEX_FAKE_MESSAGE=$'TASK_BOARD_RESULT: blocked' run_tick "${vault}" "${state}" env >/tmp/task-board-review-draft-retry-prompt.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Pending PR gate retry instruction'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Target PR URL: https://github.com/boxp/example/pull/123'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Failed gate: mergeability'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Failure reason: PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Safe diagnostic: .*/pr-gate-diagnostic\.edn \(category=mergeability; detail=The PR is not mergeable yet\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Previous run summary: .*/summary.edn'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Expected completion state: update the same PR'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_behind_merge_state_times_out() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-409|BOXP-409: behind]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-409 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=1 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_MERGE_STATE=BEHIND CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-behind.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-409\|BOXP-409: behind\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-409.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-409.md" 'Review gate failed \(mergeability\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-409.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-409.md" 'mergeStateStatus=BEHIND'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_merged_pr_skips_gates() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/codex-prompts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-420|BOXP-420: merged pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-420 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Merged PRs report mergeStateStatus=UNKNOWN; without the state check the gate
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # would poll until this timeout and fail with gate=mergeability.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=30 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_FAKE_PROMPT_LOG="${prompt_log}" GH_FAKE_PR_STATE=MERGED CODEX_FAKE_MESSAGE=$'Merged PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-merged-pr.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-420\|BOXP-420: merged pr\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-420.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-420.md" 'Review gates passed\. Already-merged PR\(s\) skipped gates and codex review: https://github.com/boxp/example/pull/123\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-420" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':ok\? true'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':merged-pr-urls \["https://github.com/boxp/example/pull/123"\]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':checked-pr-urls \[\]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if [[ -f "${prompt_log}" ]] && grep -q '^CODEX_REVIEW_GATE$' "${prompt_log}"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "codex review should not run for a merged PR"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_none_marker_and_merged_pr_moves_review() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-421|BOXP-421: none plus merged]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-421 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-270 regression: the final message references already-merged PRs and
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # declares TASK_BOARD_REVIEW_PR: none. PR URLs still win over the marker, but
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # merged PRs must not stall the gate until the timeout.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=30 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 GH_FAKE_PR_STATE=MERGED CODEX_FAKE_MESSAGE=$'Deployed https://github.com/boxp/example/pull/123 and https://github.com/boxp/example/pull/456 earlier.\nTASK_BOARD_REVIEW_PR: none\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-none-merged.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-421\|BOXP-421: none plus merged\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-421.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-421.md" 'Already-merged PR\(s\) skipped gates and codex review: https://github.com/boxp/example/pull/123, https://github.com/boxp/example/pull/456\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-421.md" 'Review gate failed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-421" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':merged-pr-urls \["https://github.com/boxp/example/pull/123" "https://github.com/boxp/example/pull/456"\]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_open_and_merged_prs_gates_open_only() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/codex-prompts.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-422|BOXP-422: open and merged]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-422 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS=30 CODEX_TASK_BOARD_PR_GATE_POLL_SECONDS=1 CODEX_FAKE_PROMPT_LOG="${prompt_log}" GH_FAKE_PR_STATE_123=MERGED CODEX_FAKE_MESSAGE=$'Context: https://github.com/boxp/example/pull/123 (merged)\nCreated PR: https://github.com/boxp/example/pull/456\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-open-and-merged.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-422\|BOXP-422: open and merged\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-422.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-422.md" 'Already-merged PR\(s\) skipped gates and codex review: https://github.com/boxp/example/pull/123\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  summary="$(find "${state}/runs/BOXP-422" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':checked-pr-urls \["https://github.com/boxp/example/pull/456"\]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${summary}" ':merged-pr-urls \["https://github.com/boxp/example/pull/123"\]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" '^PR: https://github.com/boxp/example/pull/456$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${prompt_log}" '^PR: https://github.com/boxp/example/pull/123$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_retryable_pr_gate_failure_does_not_persist_raw_reason_in_notes() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin diagnostic
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-454|BOXP-454: retry note redaction]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-454 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit-token=super-secret-token","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-note-redaction.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-454\|BOXP-454: retry note redaction\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-454.md" 'PR gate failed; inspect the referenced run artifacts\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-454.md" 'category=ci-check-failure; detail=One or more required CI checks failed\.'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-454.md" 'super-secret-token'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-454.md" 'unit-token='
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-454 ':diagnostic \{:path ".*/pr-gate-diagnostic\.edn", :category "ci-check-failure"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  diagnostic="$(find "${state}/runs/BOXP-454" -name pr-gate-diagnostic.edn -print | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -n "${diagnostic}" ]] || fail "expected a safe PR gate diagnostic artifact"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${diagnostic}" ':category "ci-check-failure"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${diagnostic}" 'super-secret-token'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${diagnostic}" 'unit-token='
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_retry_limit_blocks() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin i
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-414|BOXP-414: retry limit]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-414 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in 1 2 3; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-retry-limit-"${i}".out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-414\|BOXP-414: retry limit\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" 'Review gate failed \(ci\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" 'category=pr-gate-retry-limit'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-414.md" 'inspect run artifacts:'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-414 ':retry-exhausted\? true'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_retry_limit_is_scoped_to_failure_reason() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-453|BOXP-453: retry reason scope]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-453 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Two identical failures consume their own budget. A distinct CI failure
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # must start at 1/2 instead of incorrectly blocking on the third run.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-reason-unit-1.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-reason-unit-2.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=2 GH_FAKE_CHECKS='[{"name":"integration","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-retry-reason-integration.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-453\|BOXP-453: retry reason scope\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-453.md" 'Retrying with Codex instruction 1/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-453.md" 'category=pr-gate-retry-limit'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_pass_after_retry_moves_review() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-415|BOXP-415: pass after retry]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-415 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-retry-then-pass-1.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-review-retry-then-pass-2.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-415\|BOXP-415: pass after retry\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-415.md" '^status: ready$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-415.md" 'PR: https://github.com/boxp/example/pull/123'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-415.md" 'Review gates passed'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${state}/state.edn" 'BOXP-415'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_groom_prompt_contains_investigation_steps() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/codex-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${vault}/Boards" "${vault}/Tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${vault}/Boards/Task Board.md" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Task Board
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-600|BOXP-600: groom prompt]] #ticket status::backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Ready
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## In Progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Review
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-600 backlog codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-groom-prompt.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'First investigate before writing'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Notes'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'GitHub'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'gh CLI'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Fill Context with investigation findings'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'Fill Plan with concrete implementation steps'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_implement_prompt_includes_append_note() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/codex-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-603|BOXP-603: append-note]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-603 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-append-note-codex.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'append-note BOXP-603'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'milestone'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_implement_prompt_includes_append_note() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/claude-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-604|BOXP-604: fable append-note]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-604 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-append-note-fable.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'append-note BOXP-604'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'milestone'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" '\.claude/skills/obsidian-task-board'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_groom_prompt_includes_append_note() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prompt_log="${tmp}/codex-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-605|BOXP-605: groom append-note]] #ticket status::backlog"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-605 backlog codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-groom-append-note.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'append-note BOXP-605'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${prompt_log}" 'milestone'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignee_model_routing() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_AUTONOMY_V2=false bb "${RUNNER}" test
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # I1 deliberately has no activation switch, even with a requested opt-in.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_AUTONOMY_V2=true bb "${RUNNER}" test >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignee_model_tick_routing() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin args_log assignee expected_model
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pairs=("codex:gpt-6.1-terra" "codex-sol:gpt-6.1-sol" "codex-full:gpt-6.1-sol" "codex-terra:gpt-6.1-terra" "codex-mini:gpt-5.6-luna" "codex-astra:gpt-6-astra")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for pair in "${pairs[@]}"; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assignee="${pair%%:*}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    expected_model="${pair##*:}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    args_log="${tmp}/codex-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_board "${vault}" "- [ ] [[Tickets/BOXP-500|BOXP-500: model tick]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_ticket "${vault}" BOXP-500 in-progress "${assignee}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" CODEX_FAKE_ARG_LOG="${args_log}" run_tick "${vault}" "${state}" env >"/tmp/task-board-model-tick-${assignee}.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${args_log}" "exec.*--model ${expected_model}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_not_contains "${args_log}" 'model_reasoning_effort='
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignee_reasoning_tick_routing() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin args_log assignee expected_model level
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pairs=(
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-minimal:gpt-6.1-terra:minimal"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-sol-low:gpt-6.1-sol:low"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-full-medium:gpt-6.1-sol:medium"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-sol-xhigh:gpt-6.1-sol:xhigh"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-terra-high:gpt-6.1-terra:high"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-mini-xhigh:gpt-5.6-luna:xhigh"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-astra-low:gpt-6-astra:low"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-astra-medium:gpt-6-astra:medium"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "codex-astra-high:gpt-6-astra:high"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  )
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for pair in "${pairs[@]}"; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    IFS=: read -r assignee expected_model level <<<"${pair}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    args_log="${tmp}/codex-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_board "${vault}" "- [ ] [[Tickets/BOXP-501|BOXP-501: reasoning tick]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_ticket "${vault}" BOXP-501 in-progress "${assignee}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" CODEX_FAKE_ARG_LOG="${args_log}" run_tick "${vault}" "${state}" env >"/tmp/task-board-reasoning-tick-${assignee}.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${args_log}" "exec.*--model ${expected_model}.*-c model_reasoning_effort=${level}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${vault}/Tickets/BOXP-501.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_invalid_reasoning_assignees_are_ignored() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin args_log assignee
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local assignees=("codex-terra-ultra" "unknown-high" "fable-high" "codex-astra-minimal" "codex-astra-xhigh" "codex-sol-minimal" "codex-full-minimal")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for assignee in "${assignees[@]}"; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    args_log="${tmp}/codex-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_board "${vault}" "- [ ] [[Tickets/BOXP-502|BOXP-502: invalid reasoning]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_ticket "${vault}" BOXP-502 in-progress "${assignee}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" CODEX_FAKE_ARG_LOG="${args_log}" run_tick "${vault}" "${state}" env >"/tmp/task-board-invalid-reasoning-${assignee}.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ ! -e "${args_log}" ]] || fail "expected codex not to start for invalid assignee ${assignee}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ ! -d "${state}/runs/BOXP-502" ]] || fail "expected no run directory for invalid assignee ${assignee}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_codex_astra_assignee_includes_delegation_policy() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin prompt_log args_log summary last_message assignee
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for assignee in "codex-astra" "codex-astra-low" "codex-astra-medium" "codex-astra-high"; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    prompt_log="${tmp}/codex-prompt.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    args_log="${tmp}/codex-args.log"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_board "${vault}" "- [ ] [[Tickets/BOXP-160|BOXP-160: codex-astra]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_ticket "${vault}" BOXP-160 in-progress "${assignee}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CODEX_FAKE_PROMPT_LOG="${prompt_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CODEX_FAKE_ARG_LOG="${args_log}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: done' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      run_tick "${vault}" "${state}" env >"/tmp/task-board-codex-astra-${assignee}.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" "^Task Board assignee/agent: ${assignee}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" 'Highest-capability model routing policy'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" 'You are the '"${assignee}"' top-tier entry point'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" 'gpt-6-astra'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" 'Aggressively delegate to lower-cost models'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" 'If delegation is unavailable, report blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${prompt_log}" 'Do not fall back to another API key'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${args_log}" "exec.*--model gpt-6-astra"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${vault}/Boards/Task Board.md" '\[\[Tickets/BOXP-160\|BOXP-160: codex-astra\]\].*status::done'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${vault}/Tickets/BOXP-160.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    summary="$(find "${state}/runs/BOXP-160" -name summary.edn -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    last_message="$(find "${state}/runs/BOXP-160" -name last-message.md -print | sort | tail -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${summary}" ':agent "'"${assignee}"'"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    assert_file_contains "${last_message}" '^TASK_BOARD_RESULT: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if [[ "${assignee}" == codex-astra-* ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      assert_file_contains "${args_log}" "-c model_reasoning_effort=${assignee##*-}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    rm -rf "${tmp}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_concurrent_append_note_no_lost_writes() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault ticket_file
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${vault}/Tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${vault}/Tickets/BOXP-999.md" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
id: BOXP-999
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
type: task
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
status: in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
priority: medium
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assignee: codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
repo:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
closed:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# BOXP-999: concurrent append test
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Notes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local n=5
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pids=()
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in $(seq 1 "${n}"); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${HELPER}" append-note BOXP-999 --vault "${vault}" --source "test" --note "concurrent-note-${i}" &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    pids+=("$!")
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for pid in "${pids[@]}"; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ticket_file="${vault}/Tickets/BOXP-999.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in $(seq 1 "${n}"); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    grep -q "concurrent-note-${i}" "${ticket_file}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      || fail "note ${i} was lost in concurrent append-note writes"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_cross_vault_lock_isolation() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault_a vault_b lock_dir lock_count
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault_a="${tmp}/vault-a"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault_b="${tmp}/vault-b"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  lock_dir="/tmp/task-board-locks"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${vault_a}/Tickets" "${vault_b}/Tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rm -f "${lock_dir}"/BOXP-888* 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for vault in "${vault_a}" "${vault_b}"; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    cat >"${vault}/Tickets/BOXP-888.md" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
id: BOXP-888
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
type: task
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
status: in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
priority: medium
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assignee: codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
repo:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
closed:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# BOXP-888: cross-vault test
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Notes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" append-note BOXP-888 --vault "${vault_a}" --source "test" --note "vault-a-note"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" append-note BOXP-888 --vault "${vault_b}" --source "test" --note "vault-b-note"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep -q "vault-a-note" "${vault_a}/Tickets/BOXP-888.md" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "vault-a note was not written"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep -q "vault-b-note" "${vault_b}/Tickets/BOXP-888.md" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "vault-b note was not written"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # With path-hash prefixing each vault must produce a distinct lock file.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Without path hashing both vaults would share one lock file (count == 1).
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  lock_count="$(ls "${lock_dir}" 2>/dev/null | grep -c 'BOXP-888' || echo 0)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [ "${lock_count}" -ge 2 ] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected >= 2 distinct lock files for cross-vault tickets (got ${lock_count}): separate vaults must not share a lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_concurrent_board_update_no_lost_writes() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault rounds failures i pid1 pid2 board_content found_1 found_2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${vault}/Tickets" "${vault}/Boards"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for id in BOXP-701 BOXP-702; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    title="ticket-${id}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    cat >"${vault}/Tickets/${id}.md" <<EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
id: ${id}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
type: task
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
status: backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
priority: medium
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assignee: boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
reporter: boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
project: BOXP
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
epic:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
sprint:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
repo:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
estimate:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
created: 2026-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
due:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
closed:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
tags:
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  - ticket
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
---
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# ${id}: ${title}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Notes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
initial note.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rounds=10
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  failures=0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in $(seq 1 "${rounds}"); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    # Reset board to initial state with both tickets in Backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    cat >"${vault}/Boards/Task Board.md" <<'BOARD'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Task Board
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-701|BOXP-701: ticket-BOXP-701]] #ticket status::backlog priority::medium
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-702|BOXP-702: ticket-BOXP-702]] #ticket status::backlog priority::medium
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Ready
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## In Progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Review
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
BOARD
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    # Reset tickets to backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sed -i 's/^status: .*/status: backlog/' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      "${vault}/Tickets/BOXP-701.md" "${vault}/Tickets/BOXP-702.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    # Run concurrent updates to different tickets
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${HELPER}" update BOXP-701 --vault "${vault}" --lane "In Progress" >/dev/null 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    pid1=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    bb "${HELPER}" update BOXP-702 --vault "${vault}" --lane "In Progress" >/dev/null 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    pid2=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${pid1}" || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    wait "${pid2}" || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    board_content="$(cat "${vault}/Boards/Task Board.md")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    found_1=0; found_2=0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    echo "${board_content}" | grep -q "BOXP-701.*status::in-progress" && found_1=1 || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    echo "${board_content}" | grep -q "BOXP-702.*status::in-progress" && found_2=1 || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if [ "${found_1}" -eq 0 ] || [ "${found_2}" -eq 0 ]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      failures=$((failures + 1))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [ "${failures}" -eq 0 ] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "concurrent board updates lost entries in ${failures}/${rounds} rounds"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_task_board_pbt_properties() { bb "${ROOT_DIR}/tests/codex-workspace/task_board_pbt_test.bb"; }
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
prune_git() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -c user.name=prune-test -c user.email=prune-test@example.com -c commit.gpgsign=false "$@"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
make_prune_source_repo() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local source="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git init -q -b main "${source}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_git -C "${source}" commit -q --allow-empty -m init
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" remote add origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Pretend the initial commit was fetched from GitHub.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" update-ref refs/remotes/origin/main HEAD
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
write_prune_ticket() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local ticket="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local status="$3"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local closed="$4"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" "${ticket}" "${status}" codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^closed:.*/closed: ${closed}/" "${vault}/Tickets/${ticket}.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Adds a run worktree the same way prepare-repo-worktree! does and prints its path.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
add_prune_run() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local state="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local source="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local ticket="$3"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local run="$4"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local checkout="${state}/workspaces/${ticket}/${run}/ghq/github.com/boxp/example"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "$(dirname "${checkout}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" worktree add -q -b "codex-task-board/${ticket}-${run}" "${checkout}" HEAD
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "${checkout}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Commits a file in a checkout and prints the new commit SHA.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
prune_commit() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local checkout="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local name="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "${name}" >"${checkout}/${name}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${checkout}" add "${name}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_git -C "${checkout}" commit -q -m "${name}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${checkout}" rev-parse HEAD
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
run_prune() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local state_root="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  shift 2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state_root}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${RUNNER}" prune-workspaces "$@"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_workspaces() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin source known out old recent today ws co ticket clone snapshot
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  source="${tmp}/source"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  known="${tmp}/known-shas"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="${tmp}/prune.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  recent="$(date -u +%Y%m%dT%H%M%SZ)-00000000-0000-0000-0000-000000000000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  today="$(date -u +%Y-%m-%d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ws="${state}/workspaces"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks" "${state}/runs/BOXP-301/${old}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  : >"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_prune_source_repo "${source}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" rev-parse HEAD >>"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-301: old done, clean, commit is on GitHub -> run, branch and ticket dir are deleted.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A second checkout (independent clone outside ghq/) and a loose file go with the run.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-301 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-301 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${co}" pushed >>"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${ws}/BOXP-301/${old}/scratch/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${ws}/BOXP-301/${old}/scratch/clone" remote set-url origin git@github.com:boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf 'memo\n' >"${ws}/BOXP-301/${old}/notes.txt"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '{:status :succeeded}\n' >"${state}/runs/BOXP-301/${old}/summary.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-302: done but closed today -> kept.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-302 done "${today}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-302 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-303: review with a stale closed date -> kept.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-303 review 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-303 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-304: old done but locked -> kept. The lock is written after the tick
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # below, which would otherwise recover it as stale.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-304 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-304 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-305: old done with an untracked file -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-305 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-305 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf 'wip\n' >"${co}/untracked.txt"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-306: old done with a commit that is not on GitHub -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-306 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-306 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${co}" unpushed >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-307: old done, HEAD detached at a pushed commit while the run branch
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # points to a local-only commit the worktree never had checked out -> run
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # deleted, branch kept.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-307 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-307 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${co}" checkout -q --detach
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" update-ref "refs/heads/codex-task-board/BOXP-307-${old}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "$(prune_git -C "${source}" commit-tree -m local-only -p HEAD 'HEAD^{tree}')"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-308: empty directory without a ticket file -> deleted.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${ws}/BOXP-308"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-309: non-empty directory without a ticket file -> kept.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-309 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-310: old closed date but a recent run (reopened ticket) -> kept.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-310 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-310 "${recent}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-311: old done, origin is not GitHub -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-311 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${ws}/BOXP-311/${old}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${ws}/BOXP-311/${old}/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-312: old done, independent clone with a local-only branch other than HEAD -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-312 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${ws}/BOXP-312/${old}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  clone="${ws}/BOXP-312/${old}/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${clone}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" remote set-url origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" checkout -q -b side
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${clone}" side-only >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" checkout -q main
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-315: old done, independent clone with a local-only commit that only a tag points to -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-315 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${ws}/BOXP-315/${old}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  clone="${ws}/BOXP-315/${old}/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${clone}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" remote set-url origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" checkout -q --detach
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${clone}" tag-only >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" tag local-release
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" checkout -q main
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-314: old done, HEAD is covered by a stale remote-tracking ref but the
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # commit is gone from GitHub -> held. Tracking refs alone are not proof.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-314 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-314 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" update-ref refs/remotes/origin/stale "$(prune_commit "${co}" force-pushed-away)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A one-shot tick must not prune.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" run_tick "${vault}" "${state}" env >"${tmp}/tick.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-301/${old}" ]] || fail "one-shot tick must not prune workspaces"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${tmp}/tick.out" 'prune:'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '{:ticket "BOXP-304"}\n' >"${state}/locks/BOXP-304.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Dry run reports the plan and deletes nothing.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  snapshot="$(cd "${state}" && find workspaces locks runs | sort)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" --dry-run >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces --dry-run failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(cd "${state}" && find workspaces locks runs | sort)" == "${snapshot}" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "dry run must not change workspaces, locks or runs"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-301-${old}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "dry run must not delete branches"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: delete ${ws}/BOXP-301/${old} \\(dry-run\\)$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: delete-empty ${ws}/BOXP-301 \\(dry-run\\)$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-305/${old} reason=uncommitted-changes checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-306/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=2 held=6 skipped=4 recent-runs=1 branches=1 empty-dirs=3 dry-run=true skipped-detail=locked:1,not-done:1,ticket-missing:1,within-retention:1$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" GH_FAKE_API_LOG="${tmp}/api.log" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_prune "${vault}" "${state}" >"${out}" || fail "prune-workspaces failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-301" ]] || fail "expected old done clean run and its ticket directory to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-301-${old}"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected run branch with a pushed tip to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-302/${old}" ]] || fail "expected done run inside retention to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-303/${old}" ]] || fail "expected non-done run to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-304/${old}" ]] || fail "expected locked ticket run to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${ws}/BOXP-305/${old}/ghq/github.com/boxp/example/untracked.txt" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected run with uncommitted changes to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-306/${old}" ]] || fail "expected run with a commit missing on GitHub to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-307" ]] || fail "expected run with pushed HEAD to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-307-${old}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected run branch with a local-only tip to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-308" ]] || fail "expected empty ticket directory to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-309/${old}" ]] || fail "expected run of a missing ticket to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-310/${recent}" ]] || fail "expected recent run of an old done ticket to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-311/${old}" ]] || fail "expected run with a non-GitHub origin to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-312/${old}" ]] || fail "expected clone with a local-only branch to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-315/${old}" ]] || fail "expected clone with a local-only tag to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-314/${old}" ]] || fail "expected run whose HEAD is only on a stale tracking ref to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for ticket in BOXP-301 BOXP-307; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if git -C "${source}" worktree list --porcelain | grep -q "/workspaces/${ticket}/"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      fail "expected ${ticket} worktree to be unregistered from the source repository"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" worktree list --porcelain | grep -q "/workspaces/BOXP-305/" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected held worktree to stay registered"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/runs/BOXP-301/${old}/summary.edn" ]] || fail "prune must not touch runs/"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/locks/BOXP-304.edn" ]] || fail "prune must not touch locks/"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/state.edn" ]] || fail "prune must not write state.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: delete ${ws}/BOXP-301/${old}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: delete-branch ${source}/.git codex-task-board/BOXP-301-${old}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: keep-branch ${source}/.git codex-task-board/BOXP-307-${old} reason=tip-not-on-github "
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-311/${old} reason=origin-not-github checkout=clone$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-312/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=clone$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-314/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=2 held=6 skipped=4 recent-runs=1 branches=1 empty-dirs=3 dry-run=false '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Each SHA is looked up at most once per pass.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -z "$(sort "${tmp}/api.log" | uniq -d)" ]] || fail "expected GitHub lookups to be cached per prune pass"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A second pass is idempotent and keeps reporting held runs.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "second prune-workspaces failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=0 held=6 skipped=4 recent-runs=1 branches=0 empty-dirs=0 dry-run=false '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # gh failures (auth, rate limit, network) are not treated as proof either way.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-313 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-313 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${co}" pushed-313 >>"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${bin}/gh" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
#!/usr/bin/env bash
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
echo "gh: API rate limit exceeded (HTTP 403)" >&2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
exit 1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces with failing gh failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-313/${old}" ]] || fail "expected run to remain when gh cannot verify commits"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-313/${old} reason=github-check-failed sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Adds `count` empty commits to a checkout. The message carries the checkout
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# path: commit timestamps have second resolution, so two checkouts committing
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# the same sequence on the same parent within one second would otherwise share
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# commit SHAs and leak between fixtures (flaky on fast CI runners).
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
prune_empty_commits() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local checkout="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local count="$2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local i
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for ((i = 0; i < count; i++)); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    prune_git -C "${checkout}" commit -q --allow-empty -m "empty ${i} ${checkout}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_holds_checkout_over_commit_limit() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin source known out old ws co
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  source="${tmp}/source"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  known="${tmp}/known-shas"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="${tmp}/prune.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ws="${state}/workspaces"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_prune_source_repo "${source}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The commit the worktree was created at is in the HEAD reflog, so it counts
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # towards the limit together with the unpushed commits.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-331: exactly 200 commits to verify, all on GitHub -> deleted.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-331 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-331 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_empty_commits "${co}" 199
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${co}" log -g --format=%H HEAD | sort -u >"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(wc -l <"${known}")" -eq 200 ]] || fail "expected 200 commits to verify in the fixture"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-332: 201 commits to verify -> held without asking GitHub about any of them.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-332 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-332 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_empty_commits "${co}" 200
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${co}" rev-list HEAD --not --remotes >"${tmp}/over-limit-shas"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat "${tmp}/over-limit-shas" >>"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" GH_FAKE_API_LOG="${tmp}/api.log" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_prune "${vault}" "${state}" >"${out}" || fail "prune-workspaces at the commit limit failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-331" ]] || fail "expected run with exactly 200 commits to verify to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-332/${old}" ]] || fail "expected run with 201 commits to verify to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-332/${old} reason=too-many-unpushed-commits checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=1 held=1 '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if grep -qxFf "${tmp}/over-limit-shas" "${tmp}/api.log"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected no GitHub lookups for a checkout over the commit limit"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_inspects_nested_checkouts() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin source known out old ws co nested ticket
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  source="${tmp}/source"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  known="${tmp}/known-shas"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="${tmp}/prune.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ws="${state}/workspaces"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_prune_source_repo "${source}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The parent checkout ignores vendor/, so its own git status never shows
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # what a clone placed there contains.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf 'vendor/\n' >"${source}/.gitignore"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" add .gitignore
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_git -C "${source}" commit -q -m ignore-vendor
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" update-ref refs/remotes/origin/main HEAD
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" rev-parse HEAD >"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-341: gitignored nested clone with an untracked file -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-341 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-341 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  nested="${co}/vendor/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${nested}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${nested}" remote set-url origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf 'wip\n' >"${nested}/untracked.txt"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -z "$(git -C "${co}" status --porcelain)" ]] || fail "expected the parent checkout to ignore the nested clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-342: gitignored nested clone with a commit that is not on GitHub -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-342 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-342 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  nested="${co}/vendor/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${nested}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${nested}" remote set-url origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${nested}" nested-unpushed >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-343: gitignored nested clone with a stash -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-343 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-343 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  nested="${co}/vendor/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${nested}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${nested}" remote set-url origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf 'vendor/\nstashed\n' >"${nested}/.gitignore"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_git -C "${nested}" stash -q
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-344: clean nested clone and a clean nested worktree of the source
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # repository, all on GitHub -> deleted, both worktrees unregistered.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-344 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-344 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${co}/vendor/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${co}/vendor/clone" remote set-url origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" worktree add -q --detach "${co}/vendor/worktree" HEAD
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" --dry-run >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces --dry-run with nested checkouts failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=1 held=3 '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces with nested checkouts failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${ws}/BOXP-341/${old}/ghq/github.com/boxp/example/vendor/clone/untracked.txt" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected run with uncommitted changes in a nested clone to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${ws}/BOXP-342/${old}/ghq/github.com/boxp/example/vendor/clone/nested-unpushed" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected run with an unpushed commit in a nested clone to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${ws}/BOXP-343/${old}/ghq/github.com/boxp/example/vendor/clone" rev-parse -q --verify refs/stash >/dev/null \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected run with a stash in a nested clone to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-344" ]] || fail "expected run with clean nested checkouts to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if git -C "${source}" worktree list --porcelain | grep -q "/workspaces/BOXP-344/"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected nested and parent worktrees to be unregistered from the source repository"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for ticket in BOXP-341 BOXP-342 BOXP-343; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/${ticket}-${old}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      || fail "expected the branch of held run ${ticket} to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-341/${old} reason=uncommitted-changes checkout=ghq/github.com/boxp/example/vendor/clone$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-342/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example/vendor/clone$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-343/${old} reason=stash-present checkout=ghq/github.com/boxp/example/vendor/clone$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: delete ${ws}/BOXP-344/${old}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=1 held=3 '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_checks_reflog_commits() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin source known out old ws co clone branch dropped
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  source="${tmp}/source"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  known="${tmp}/known-shas"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="${tmp}/prune.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ws="${state}/workspaces"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_prune_source_repo "${source}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" rev-parse HEAD >"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-351: independent clone whose only local commit was dropped by
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # `git reset --hard` and survives in the reflog alone -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-351 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${ws}/BOXP-351/${old}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  clone="${ws}/BOXP-351/${old}/clone"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git clone -q "${source}" "${clone}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" remote set-url origin https://github.com/boxp/example.git
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${clone}" reset-away >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${clone}" reset -q --hard HEAD~1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -z "$(git -C "${clone}" rev-list HEAD --branches --tags --not --remotes)" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected the dropped commit to be reachable from the reflog only"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-352: the same in a run worktree, whose HEAD reflog goes away with it -> held.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-352 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-352 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${co}" reset-away >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${co}" reset -q --hard HEAD~1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-353: amended in a worktree, and the commit from before the amend is
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # on GitHub as well -> run and branch deleted.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-353 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  co="$(add_prune_run "${state}" "${source}" BOXP-353 "${old}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_commit "${co}" amended >>"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  prune_git -C "${co}" commit -q --amend -m amended-again
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${co}" rev-parse HEAD >>"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-354: the worktree only ever saw pushed commits, but the run branch
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # was moved to a local-only commit and back from the source repository ->
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # run deleted, branch (and with it the branch reflog) kept.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-354 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-354 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  branch="refs/heads/codex-task-board/BOXP-354-${old}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  dropped="$(prune_git -C "${source}" commit-tree -m dropped -p HEAD 'HEAD^{tree}')"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" update-ref -m test "${branch}" "${dropped}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" update-ref -m test "${branch}" HEAD
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" log -g --format=%H "${branch}" | grep -qx "${dropped}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected the dropped commit in the run branch reflog"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" --dry-run >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces --dry-run with reflog-only commits failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=2 held=2 skipped=0 recent-runs=0 branches=1 '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces with reflog-only commits failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -n "$(git -C "${ws}/BOXP-351/${old}/clone" log -g --format=%H --grep-reflog='commit: reset-away' HEAD)" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected clone with a commit left only in the reflog to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -n "$(git -C "${ws}/BOXP-352/${old}/ghq/github.com/boxp/example" log -g --format=%H --grep-reflog='commit: reset-away' HEAD)" ]] \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected worktree with a commit left only in the reflog to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-352-${old}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected the branch of a held run to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-353" ]] || fail "expected run whose reflog commits are all on GitHub to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if git -C "${source}" show-ref --verify -q "refs/heads/codex-task-board/BOXP-353-${old}"; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "expected run branch whose reflog commits are all on GitHub to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-354" ]] || fail "expected run whose worktree only saw pushed commits to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" log -g --format=%H "${branch}" | grep -qx "${dropped}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected run branch with a local-only commit in its reflog to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-351/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=clone$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: hold ${ws}/BOXP-352/${old} reason=commit-not-on-github sha=[0-9a-f]{40} checkout=ghq/github.com/boxp/example$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: delete-branch ${source}/.git codex-task-board/BOXP-353-${old}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" "^prune: keep-branch ${source}/.git codex-task-board/BOXP-354-${old} reason=reflog-commit-not-on-github sha=${dropped}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=2 held=2 skipped=0 recent-runs=0 branches=1 '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_respects_board_lane() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin source known out old ws
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  source="${tmp}/source"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  known="${tmp}/known-shas"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="${tmp}/prune.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ws="${state}/workspaces"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${state}/locks"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_prune_source_repo "${source}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" rev-parse HEAD >"${known}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-361: frontmatter still says done, but the card was moved back to
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # In Progress and no sync has run since -> kept.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # BOXP-362: card in Done and frontmatter done -> deleted.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-361|BOXP-361: reopened]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "- [x] [[Tickets/BOXP-362|BOXP-362: finished]] #ticket status::done" >>"${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-361 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-361 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-362 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-362 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces with a reopened card failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-361/${old}" ]] || fail "expected run of a ticket whose card left Done to remain"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${ws}/BOXP-362" ]] || fail "expected run of a ticket whose card is in Done to be deleted"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=1 held=0 skipped=1 .* skipped-detail=not-done:1$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Without a readable board nothing is deleted.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-363 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-363 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rm "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_KNOWN_SHAS="${known}" run_prune "${vault}" "${state}" >"${out}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "prune-workspaces without a board failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${ws}/BOXP-363/${old}" ]] || fail "expected run to remain when the board is missing"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: summary deleted=0 held=0 skipped=2 .* skipped-detail=board-unreadable:2$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_invalid_settings_fall_back_to_defaults() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="${tmp}/prune.out"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS=soon \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_prune "${vault}" "${state}" --dry-run >"${out}" || fail "prune with invalid retention failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: warning invalid CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS="soon", using default 3$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: start retention-days=3 dry-run=true$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS=10 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_prune "${vault}" "${state}" --dry-run >"${out}" || fail "prune with custom retention failed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${out}" '^prune: start retention-days=10 dry-run=true$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${out}" 'warning'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Starts `loop` with a prunable run; the runner PID is written to ${tmp}/runner.pid.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
start_prune_loop() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp="$1"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  shift
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="${tmp}/vault" state="${tmp}/state" bin="${tmp}/bin" source="${tmp}/source"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local old="20200101T000000Z-00000000-0000-0000-0000-000000000000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_prune_source_repo "${source}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  git -C "${source}" rev-parse HEAD >"${tmp}/known-shas"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_prune_ticket "${vault}" BOXP-321 done 2020-01-01
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  add_prune_run "${state}" "${source}" BOXP-321 "${old}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    GH_FAKE_KNOWN_SHAS="${tmp}/known-shas" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_VAULT="${vault}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_OWNER_ID=prune-pod \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_POLL_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    "$@" bb "${RUNNER}" loop >"${tmp}/runner.out" 2>&1 &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' "$!" >"${tmp}/runner.pid"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
stop_prune_loop() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pid
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  pid="$(cat "$1/runner.pid")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  kill -TERM "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}" 2>/dev/null || true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_loop_prunes_in_background() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp attempt
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_prune_loop "${tmp}" env CODEX_TASK_BOARD_WORKSPACE_PRUNE_INTERVAL_SECONDS=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The interval is 2s, so a second pass proves the schedule repeats.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for attempt in $(seq 1 150); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ "$(grep -c '^prune: summary ' "${tmp}/runner.out" || true)" -ge 2 ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  stop_prune_loop "${tmp}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${tmp}/state/workspaces/BOXP-321" ]] || fail "expected loop to prune the old done run"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/runner.out" '^workspace prune enabled, retention-days=3, interval-seconds=2$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/runner.out" '^prune: summary deleted=1 held=0 skipped=0 recent-runs=0 branches=1 '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/runner.out" '^prune: summary deleted=0 held=0 skipped=0 '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_loop_prune_can_be_disabled() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp attempt
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  start_prune_loop "${tmp}" env CODEX_TASK_BOARD_WORKSPACE_PRUNE=0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for attempt in $(seq 1 150); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ "$(grep -c '^no supported-agent-assigned Task Board tickets$' "${tmp}/runner.out" || true)" -ge 3 ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  stop_prune_loop "${tmp}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -d "${tmp}/state/workspaces/BOXP-321" ]] || fail "expected disabled prune to keep the run"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/runner.out" '^workspace prune disabled by CODEX_TASK_BOARD_WORKSPACE_PRUNE$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${tmp}/runner.out" '^prune: '
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_ai_ops_ledger_records_run_lifecycle() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin ledger
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" ""
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The card starts in the Ready lane so run.started records the Ready -> ack transition.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i 's/^## Ready$/## Ready\n- [ ] [[Tickets\/BOXP-416|BOXP-416: ledger secret title]] #ticket status::ready/' "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-416 ready codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"unit","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-1.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/123\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-2.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ledger="$(ls "${state}"/ai-ops/ledger/events-*.jsonl)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # JSON key order is not fixed: select each event by its id suffix, then check fields.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:started"' "${ledger}" | grep -q '"lane_from":"ready"' || fail "expected run.started from ready"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:correction"' "${ledger}" | grep '"correction_class":"gate_defect"' | grep -q '"correction_origin":"agent-system"' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected an agent-system gate_defect correction"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:finished"' "${ledger}" | grep -q '"status":"retrying"' || fail "expected a retrying run.finished"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:finished"' "${ledger}" | grep -q '"status":"succeeded"' || fail "expected a succeeded run.finished"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:lane"' "${ledger}" | grep -q '"lane_to":"ready"' || fail "expected lane.changed to ready"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${ledger}" 'secret title'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${ledger}" 'http'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${ledger}" 'privacy_rejected'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c '"event_type":"run.started"' "${ledger}")" -eq 2 ]] || fail "expected two run.started ledger events"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:lane-start"' "${ledger}" | grep '"lane_from":"ready"' | grep -q '"lane_to":"in-progress"' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected a start lane.changed ready -> in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Start Ready -> In Progress, finish In Progress -> Ready. A retry stays In
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Progress: no lane.changed for in-progress -> in-progress.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c '"event_type":"lane.changed"' "${ledger}")" -eq 2 ]] || fail "expected two lane.changed ledger events"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:correction"' "${ledger}" | grep -q '"confidence":"high"' \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    || fail "expected a failed CI check to be a high-confidence correction"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["ci" "fail"\] 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # gate="all" is the overall denominator and must count the failure too.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["all" "fail"\] 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["all" "pass"\] 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Individual gates count their successes too, not only failures.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["ci" "pass"\] 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The CI-failed run also passed mergeability; that success must be counted.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["mergeability" "pass"\] 2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["codex-review" "pass"\] 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/ledger-stats.edn" '\["pr-url" "pass"\] 2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # One-shot `tick` (not only `loop`) must refresh metrics.prom from the stats.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/metrics.prom" 'ai_ops_review_gate_total\{gate="ci",result="fail"\} 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # One-shot `tick` waits for the SLI refresh (bb exits without awaiting futures),
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # so the attempt is finished, not left with only :last-attempt.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/ai-ops/sli-export-status.edn" ':last-success|:failures'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_ai_ops_ledger_groom_from_backlog_records_actual_lane() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin ledger
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}" "${vault}/Boards" "${vault}/Tickets"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cat >"${vault}/Boards/Task Board.md" <<'EOF'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Task Board
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-418|BOXP-418: ledger groom]] #ticket status::backlog
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Ready
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## In Progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Review
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
## Done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
EOF
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-418 backlog codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-groom.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  ledger="$(ls "${state}"/ai-ops/ledger/events-*.jsonl)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A Backlog groom run never moves the card to In Progress: no start
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # transition, and the finish transition starts from backlog.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${ledger}" ':ledger:lane-start"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${ledger}" '"lane_from":"in-progress"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:started"' "${ledger}" | grep -q '"lane_to":"backlog"' || fail "expected run.started to stay in backlog"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  grep ':ledger:lane"' "${ledger}" | grep -q '"lane_from":"backlog"' || fail "expected lane.changed from backlog"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_ai_ops_ledger_disabled_by_env() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-417|BOXP-417: ledger off]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-417 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_AI_OPS_LEDGER_ENABLED=false run_tick "${vault}" "${state}" env >/tmp/task-board-ai-ops-off.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-417.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${state}/ai-ops/ledger" ]] || fail "ledger must not be written when disabled"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/ai-ops/subscription-usage.prom" ]] || fail "subscription metrics must remain enabled"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_run_finished_records_outbox_event() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin event
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-701|BOXP-701: done]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-701 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-done.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Second ticket in a later tick: a review result without a PR is blocked by the gate.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-701|BOXP-701: done]] #ticket status::done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-702|BOXP-702: blocked]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-702 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE='TASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-blocked.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # done: lane, frontmatter and Notes are committed before the event is written.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  event="$(ls "${state}"/outbox/pending/BOXP-701-*-done.edn)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${event}" ':event-type "task-board.run-finished"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${event}" ':from-status "in-progress"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${event}" ':to-status "done"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${event}" ':source "task-board-runner"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${event}" ':status :pending'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${event}" ':revision "[0-9a-f]{12}"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # review result without PR -> blocked by the gate: the blocked transition is an event too.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  event="$(ls "${state}"/outbox/pending/BOXP-702-*-blocked.edn)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${event}" ':to-status "blocked"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-702.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The runner never needs the webhook secret or URL to record events.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${event}" 'secret'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_in_progress_retry_records_no_outbox_event() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-703|BOXP-703: idle]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-703 in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CLAUDE_FAKE_SLEEP=2 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=1 \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-idle.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-703.md" '^status: in-progress$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if ls "${state}"/outbox/pending/BOXP-703-* >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "idle-timeout retry must not wake Kohako"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_outbox_disabled_by_env() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  vault="${tmp}/vault"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-704|BOXP-704: off]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-704 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_EVENTS_ENABLED=false run_tick "${vault}" "${state}" env >/tmp/task-board-outbox-off.out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-704.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if ls "${state}"/outbox/pending/BOXP-704-* >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "outbox must stay empty when CODEX_TASK_BOARD_EVENTS_ENABLED=false"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# BOXP-369: cumulative gate-failure budget fixtures.  Each tick is a fresh
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# runner process, so every case also covers "runner restart".
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
budget_fail_tick() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # $1 vault $2 state $3 bin $4 check-name (varies the failure text) $5 PR number
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${3}:$PATH" GH_FAKE_CHECKS="[{\"name\":\"${4}\",\"status\":\"COMPLETED\",\"conclusion\":\"FAILURE\"}]" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/'"${5:-123}"$'\nTASK_BOARD_RESULT: review' run_tick "$1" "$2" env "${@:6}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
budget_set_lane() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Simulate the owner (or another assignee) putting the card back to work.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local vault="$1" ticket="$2" title="$3" assignee="$4"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: ${title}]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i -e 's/^status: .*/status: in-progress/' -e "s/^assignee: .*/assignee: ${assignee}/" "${vault}/Tickets/${ticket}.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
budget_run_count() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  find "$1/runs/$2" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_boundary_9_10_11() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin i assignee
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-369|BOXP-369: budget]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-369 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A distinct failure text every run keeps the short-term fingerprint limit
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # at 1/2 (the BOXP-360 pattern); assignees alternate (担当交代).  An env
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # budget above 10 must not loosen the initial limit.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in 1 2 3 4 5 6 7 8 9; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if (( i % 2 )); then assignee=codex; else assignee=codex-sol; fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sed -i "s/^assignee: .*/assignee: ${assignee}/" "${vault}/Tickets/BOXP-369.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    budget_fail_tick "${vault}" "${state}" "${bin}" "unit-${i}-token=super-secret-token" 123 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=50
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-369: budget\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-369.md" 'gate-failure-budget-exhausted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" "unit-10-token=super-secret-token" 123 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=50
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-369: budget\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'category=gate-failure-budget-exhausted'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'ゲート累積失敗上限に到達したため自動再試行を停止しました'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'ticket BOXP-369 10/10, PR boxp/example#123 10/10'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" '分類=ci-failure \(gate=ci; failure-kind=check-failure\)'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" '未解決=ci-check-failure'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'gate-budget-grant BOXP-369'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Every exhausted scope gets its own resume command (ticket and PR).
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-369.md" 'gate-budget-grant boxp/example#123 --amount N'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-369.md" 'super-secret-token'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${state}/gate-failure-budget.edn" 'super-secret-token'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-369)" == 10 ]] || fail "expected exactly 10 runs"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # 11th: moving the card / assignee back without a grant starts no run.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_set_lane "${vault}" BOXP-369 budget codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" "unit-11" 123
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-369)" == 10 ]] || fail "11th automatic attempt must not start"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A new PR for the same ticket cannot escape the ticket budget either.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" "unit-11" 777
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-369)" == 10 ]] || fail "a new PR must not reopen the ticket budget"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_multiple_prs_and_shared_pr() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-461|BOXP-461: multi pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-461 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Ticket budget aggregates every PR: 3 different PRs exhaust budget 3.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" a 201 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" b 202 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-461: multi pr\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" c 203 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-461: multi pr\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-461.md" 'ticket BOXP-461 3/3'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # PR budget aggregates tickets: a second ticket on PR 201 inherits its count.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-462|BOXP-462: same pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-462 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" d 201 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-462: same pr\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-462.md" 'PR boxp/example#201 2/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Only the PR scope is spent for BOXP-462, so only its grant is suggested.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-462.md" 'gate-budget-grant boxp/example#201 --amount N'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-462.md" 'gate-budget-grant BOXP-462'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Re-assigning the exhausted PR to a brand-new ticket must not start an
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # automatic run: the PR referenced in the ticket text is checked up front.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-468|BOXP-468: moved pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-468 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' '- 2026-10-30: continue https://github.com/boxp/example/pull/201/files' >> "${vault}/Tickets/BOXP-468.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" e 201 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-468)" == 0 ]] || fail "a new ticket on an exhausted PR must not start"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A new ticket referencing an unexhausted PR still runs normally.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-469|BOXP-469: fresh pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-469 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' '- see https://github.com/boxp/example/pull/209' >> "${vault}/Tickets/BOXP-469.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" f 209 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-469)" == 1 ]] || fail "an unexhausted PR reference must not block"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # URL spelling (host case, no scheme) must not bypass the up-front check.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-470|BOXP-470: upper pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-470 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' '- continue https://GitHub.com/BOXP/Example/pull/201' >> "${vault}/Tickets/BOXP-470.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" g 201 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-470)" == 0 ]] || fail "an upper-case PR URL must not bypass the PR budget"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-471|BOXP-471: bare pr]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-471 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '%s\n' '- continue github.com/boxp/example/pull/201' >> "${vault}/Tickets/BOXP-471.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" h 201 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-471)" == 0 ]] || fail "a scheme-less PR URL must not bypass the PR budget"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_concurrent_start_on_shared_pr_is_serialized() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin t
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # PR 601 has 1 of 2 failures left.  Two tickets referencing it start in
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # separate runner processes at the same time: only one may run, otherwise
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # both would fail and the PR would overshoot its budget.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-472|BOXP-472: seed]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-472 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" seed 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-473|BOXP-473: race a]] #ticket status::in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-474|BOXP-474: race b]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for t in BOXP-473 BOXP-474; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_ticket "${vault}" "${t}" in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    printf '%s\n' '- continue https://github.com/boxp/example/pull/601' >> "${vault}/Tickets/${t}.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for t in BOXP-473 BOXP-474; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"r","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_SLEEP=3 CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/601\nTASK_BOARD_RESULT: review' CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket "${t}" >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(( $(budget_run_count "${state}" BOXP-473) + $(budget_run_count "${state}" BOXP-474) ))" == 1 ]] || fail "concurrent starts on one PR must be serialized"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -o ':pr "boxp/example#601"' "${state}/gate-failure-budget.edn" | wc -l)" == 2 ]] || fail "PR 601 must stop at 2/2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The loser stays untouched and, now that the PR is spent, never starts.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for t in BOXP-473 BOXP-474; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket "${t}" >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(( $(budget_run_count "${state}" BOXP-473) + $(budget_run_count "${state}" BOXP-474) ))" == 1 ]] || fail "no run may start on the spent PR"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_grant_resume_and_no_reset_on_success() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-463|BOXP-463: grant]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-463 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" a 301 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" b 301 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-463: grant\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Invalid grants are rejected and change nothing.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-463 --amount 0 --by boxp >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "grant with amount 0 must fail"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Ticket grant alone does not reopen while the PR budget is still spent.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-463 --amount 1 --by boxp >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_set_lane "${vault}" BOXP-463 grant codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" c 301 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-463)" == 2 ]] || fail "PR budget must still hold"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The refused start is a formal stop again: Blocked + boxp with a report
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # that names only the still-exhausted PR scope.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-463: grant\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-463.md" 'run=none; transition-id=BOXP-463/gate-budget-stop-'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-463.md")" == 1 ]] || fail "exactly one stop note expected"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-463.md" 'ticket BOXP-463 2/3, PR boxp/example#301 2/2。'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant boxp/example#301 --amount 1 --by boxp >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_set_lane "${vault}" BOXP-463 grant codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Now one more run is allowed; it passes, and success does not reset counts.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/301\nTASK_BOARD_RESULT: review' run_tick "${vault}" "${state}" env CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-463: grant\]\].*status::ready'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="$(CODEX_TASK_BOARD_ROOT="${state}" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 bb "${RUNNER}" gate-budget-status BOXP-463)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${out}" == *':used 2, :limit 3'* ]] || fail "success must not reset the budget: ${out}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Granted budget is consumed by the next failure, which blocks again at 3/3.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_set_lane "${vault}" BOXP-463 grant codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" d 301 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-463: grant\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-463.md" 'ticket BOXP-463 3/3, PR boxp/example#301 3/3'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_completes_after_interrupted_transition() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-465|BOXP-465: interrupted]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-465 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" a 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" b 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The 3rd (last) failure is recorded in the budget, but the Blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # transition fails after the record (runner death / state write failure):
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # the card is restored to its prior lane.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" c 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3 CODEX_TASK_BOARD_TEST_FAIL_BLOCKED_STATE_UPDATE=true
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-465: interrupted\]\].*status::in-progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" '^assignee: codex$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -o ':class "ci-failure"' "${state}/gate-failure-budget.edn" | wc -l)" == 3 ]] || fail "3rd failure must be recorded"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-465)" == 3 ]] || fail "expected exactly 3 runs"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The next tick must not start a run; it completes the formal stop instead.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" d 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-465)" == 3 ]] || fail "no run may start on the exhausted ticket"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-465: interrupted\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'run=none; transition-id=BOXP-465/gate-budget-stop-'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'run を開始せず停止状態へ戻しました'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'ticket BOXP-465 3/3, PR boxp/example#501 3/3'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'gate-budget-grant BOXP-465 --amount N'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-465.md" 'gate-budget-grant boxp/example#501 --amount N'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-465.md")" == 1 ]] || fail "exactly one stop note expected"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if ! ls "${state}"/outbox/pending/BOXP-465-*-blocked.edn >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "the formal stop must record a blocked event"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if ls "${state}"/locks/BOXP-465.edn >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "the stop must release the ticket lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Blocked + boxp has no automatic action: a further tick changes nothing.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" e 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-465)" == 3 ]] || fail "still no run after the stop"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-465.md")" == 1 ]] || fail "stop note must not repeat"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Only a grant for both exhausted scopes reopens one run.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-465 --amount 1 --by boxp >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant boxp/example#501 --amount 1 --by boxp >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_set_lane "${vault}" BOXP-465 interrupted codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" f 501 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-465)" == 4 ]] || fail "a grant for both scopes must allow one run"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_reports_when_blocked_card_is_reassigned() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-466|BOXP-466: reassigned]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-466 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" a 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" b 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-466)" == 2 ]] || fail "expected exactly 2 runs"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local stops_before
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  stops_before="$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-466.md" || true)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${stops_before}" == 0 ]] || fail "no run=none stop expected before the reassignment"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The Owner hands the card back to an agent but leaves it in Blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # (candidate :blocked-retry) without a grant: no run may start, and the
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # refusal must not stay silent -- report + assignee boxp, card stays Blocked.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^assignee: .*/assignee: codex/" "${vault}/Tickets/BOXP-466.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i 's/\(BOXP-466: reassigned\]\].*\)assignee::boxp/\1assignee::codex/' "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" c 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-466)" == 2 ]] || fail "no run may start on the reassigned Blocked card"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-466: reassigned\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-466: reassigned\]\].*assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'run=none; transition-id=BOXP-466/gate-budget-stop-'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'action=blocked-retry'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'ticket BOXP-466 2/2, PR boxp/example#601 2/2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-466.md" 'gate-budget-grant BOXP-466 --amount N'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-466.md")" == 1 ]] || fail "exactly one stop note expected"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if ls "${state}"/locks/BOXP-466.edn >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "the stop must release the ticket lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Blocked + boxp again: a further tick is silent.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" d 601 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-466)" == 2 ]] || fail "still no run after the stop"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-466.md")" == 1 ]] || fail "stop note must not repeat"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_is_written_once_under_concurrent_ticks() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-468|BOXP-468: race stop]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-468 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" a 801 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" b 801 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-468.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^assignee: .*/assignee: codex/" "${vault}/Tickets/BOXP-468.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i 's/\(BOXP-468: race stop\]\].*\)assignee::boxp/\1assignee::codex/' "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Two ticks both read the reassigned card before either takes the ticket
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # lock (the hold widens that window deterministically); the second must
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # re-read the card under the lock and not write a second stop report.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_TEST_GATE_BUDGET_STOP_HOLD_MILLIS=1500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-468 >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_TEST_GATE_BUDGET_STOP_HOLD_MILLIS=1500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-468 >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-468)" == 2 ]] || fail "no run may start on the reassigned Blocked card"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-468.md")" == 1 ]] || fail "exactly one stop note expected under concurrent ticks"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-468.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-468.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-468: race stop\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-468: race stop\]\].*assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if ls "${state}"/locks/BOXP-468.edn >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "the stop must release the ticket lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_is_serialized_with_grant() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin i
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-469|BOXP-469: grant race]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-469 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" a 901 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" b 901 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-469.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^assignee: .*/assignee: codex/" "${vault}/Tickets/BOXP-469.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i 's/\(BOXP-469: grant race\]\].*\)assignee::boxp/\1assignee::codex/' "${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The stop re-reads the budget, then (test hook) holds the budget lock
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # before the Blocked transition.  An Owner grant issued in that window must
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # wait for the transition instead of landing between the re-read and the
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Blocked move; otherwise the card would be stopped as "exhausted" while
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # the budget file already shows remaining budget.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The hold lasts until the release file is written (30s cap), so the
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # check below does not depend on process start-up time.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2 CODEX_TASK_BOARD_TEST_GATE_BUDGET_STOP_HOLD_AFTER_READ_MILLIS=30000 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-469 >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tick_pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in $(seq 1 300); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    [[ -f "${state}/test-gate-budget-stop-holding" ]] && break
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -f "${state}/test-gate-budget-stop-holding" ]] || fail "the stop never reached the hold window"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-469 --amount 1 --by boxp >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local grant_pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Wait until the grant process has opened the budget lock file (it is then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # inside the lock attempt) or has already finished (zombie / gone).  While
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # the stop still holds the lock, the grant must not have been recorded.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in $(seq 1 300); do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if ! grep -q 'State:[[:space:]]*[RSD]' "/proc/${grant_pid}/status" 2>/dev/null; then break; fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if ls -l "/proc/${grant_pid}/fd" 2>/dev/null | grep -q 'gate-failure-budget.lock'; then break; fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    sleep 0.1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sleep 0.5
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${state}/gate-failure-budget.edn" ':scope :ticket, :key "BOXP-469", :amount 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_not_contains "${vault}/Tickets/BOXP-469.md" 'gate-budget-stop-'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  : > "${state}/test-gate-budget-stop-release"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${grant_pid}" || fail "grant must succeed after the stop"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The grant returned: the stop must already have completed (the grant was
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # serialized behind the transition), and the card must not still be in the
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # pre-stop state with the grant recorded underneath it.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-469.md" '^status: blocked$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-469.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-469.md" 'run=none; transition-id=BOXP-469/gate-budget-stop-'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${tick_pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-469)" == 2 ]] || fail "no run may start on the reassigned Blocked card"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-469.md")" == 1 ]] || fail "exactly one stop note expected"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${state}/gate-failure-budget.edn" ':scope :ticket, :key "BOXP-469", :amount 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if ls "${state}"/locks/BOXP-469.edn >/dev/null 2>&1; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail "the stop must release the ticket lock"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A grant that lands before the re-read is honoured: with both scopes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # granted, the Owner's lane move starts exactly one run and no stop is
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # written.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant boxp/example#901 --amount 1 --by boxp >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_set_lane "${vault}" BOXP-469 "grant race" codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" c 901 CODEX_TASK_BOARD_GATE_FAILURE_BUDGET=2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(budget_run_count "${state}" BOXP-469)" == 3 ]] || fail "a grant for both scopes must allow one run"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -c 'gate-budget-stop-' "${vault}/Tickets/BOXP-469.md")" == 1 ]] || fail "a granted card must not be stopped again"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stricter_short_term_limit_still_applies() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-464|BOXP-464: short]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-464 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" same 401 CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  budget_fail_tick "${vault}" "${state}" "${bin}" same 401 CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT=1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'BOXP-464: short\]\].*status::blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-464.md" 'category=pr-gate-retry-limit'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_concurrent_updates_do_not_lose_counts() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp state i out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; state="${tmp}/state"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Concurrent processes append grants under the FileLock; none may be lost.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for i in 1 2 3 4 5 6 7 8; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-grant BOXP-465 --amount 1 --by boxp >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  out="$(CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" gate-budget-status BOXP-465)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "${out}" == *':used 0, :limit 18'* ]] || fail "concurrent grants lost: ${out}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_concurrent_ticks_do_not_lose_counts() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"; make_fake_codex "${bin}"; make_fake_gh "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-466|BOXP-466: race a]] #ticket status::in-progress
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
- [ ] [[Tickets/BOXP-467|BOXP-467: race b]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-466 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-467 in-progress codex boxp/example
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Both tickets fail on the same PR in separate processes while the budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # writer holds the lock; the shared PR must count 2.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"x","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/501\nTASK_BOARD_RESULT: review' CODEX_TASK_BOARD_TEST_GATE_BUDGET_HOLD_MILLIS=500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-466 >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" GH_FAKE_CHECKS='[{"name":"y","status":"COMPLETED","conclusion":"FAILURE"}]' CODEX_FAKE_MESSAGE=$'Created PR: https://github.com/boxp/example/pull/501\nTASK_BOARD_RESULT: review' CODEX_TASK_BOARD_TEST_GATE_BUDGET_HOLD_MILLIS=500 CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" bb "${RUNNER}" tick --ticket BOXP-467 >/dev/null &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -o ':pr "boxp/example#501"' "${state}/gate-failure-budget.edn" | wc -l)" == 2 ]] || fail "concurrent gate failures lost a count"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# Focused local runs: TASK_BOARD_TEST_ONLY="test_a test_b" runs only those.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
if [[ -n "${TASK_BOARD_TEST_ONLY:-}" ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for t in ${TASK_BOARD_TEST_ONLY}; do "${t}"; done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  echo "selected task-board-runner tests passed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  exit 0
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_parallel_codex_runs
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_delegation_gate_end_to_end() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin mode ticket summary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for mode in success failed missing; do
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    mkdir -p "${bin}" "${tmp}/codex-home/sessions"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    make_fake_claude "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    cat >"${bin}/codex" <<'FAKE'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
#!/usr/bin/env python3
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
import json, os, pathlib, sys
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
pathlib.Path(os.environ['TEST_CHILD_ARGS']).write_text(json.dumps(sys.argv))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
ident = '11111111-1111-4111-8111-111111111111'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
model = sys.argv[sys.argv.index('--model') + 1]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
path = pathlib.Path(os.environ['CODEX_HOME']) / 'sessions' / ('rollout-' + ident + '.jsonl')
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
events = [{'type':'session_meta','payload':{'id':ident}}, {'type':'turn_context','payload':{'model':model}}, {'type':'event_msg','payload':{'type':'task_complete'}}]
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
path.write_text(''.join(json.dumps(x) + '\n' for x in events))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
print(json.dumps({'type':'thread.started','thread_id':ident}))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
print(json.dumps({'type':'turn.completed'}))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
sys.exit(1 if os.environ['TEST_CHILD_FAILURE'] == 'true' else 0)
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
FAKE
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    chmod +x "${bin}/codex"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    ticket=BOXP-999
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_board "${vault}" "- [ ] [[Tickets/${ticket}|${ticket}: delegation]] #ticket status::in-progress"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    write_ticket "${vault}" "${ticket}" in-progress fable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    PATH="${bin}:$PATH" CODEX_HOME="${tmp}/codex-home" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CODEX_TASK_BOARD_BYPASS_APPROVALS=false CLAUDE_FAKE_ARG_LOG="${tmp}/parent-args" TEST_CHILD_ARGS="${tmp}/child-args" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      TEST_DELEGATION_MODE="$(if [[ "${mode}" == missing ]]; then echo missing; else echo run; fi)" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      TEST_CHILD_FAILURE="$(if [[ "${mode}" == failed ]]; then echo true; else echo false; fi)" \
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      CLAUDE_FAKE_MESSAGE='TASK_BOARD_RESULT: done' run_tick "${vault}" "${state}" env >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    summary="$(find "${state}/runs/${ticket}" -name summary.edn -print | head -n 1)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    if [[ "${mode}" == success ]]; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      assert_file_contains "${summary}" ':status :succeeded'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      assert_file_contains "${tmp}/parent-args" "--add-dir $(dirname "${summary}")"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      python3 - "${tmp}/child-args" "${vault}" <<'CHECK'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
import json, sys
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
args = json.load(open(sys.argv[1]))
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
assert sys.argv[2] in [args[i + 1] for i, arg in enumerate(args) if arg == '--add-dir']
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
CHECK
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    else
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      assert_file_contains "${summary}" ':status :blocked'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      assert_file_contains "${summary}" ':exit-code 1'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
      assert_file_not_contains "${vault}/Tickets/${ticket}.md" '^status: done$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_helper_update_keeps_notes_copy() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault board copy
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; board="${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  copy='- [ ] [[Tickets/BOXP-993|BOXP-993: test]] #ticket status::in-progress assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "${copy}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-993 in-progress boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '\n## Notes\n%s\nnote about BOXP-993\n' "${copy}" >>"${board}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" update BOXP-993 --vault "${vault}" --lane Ready --json >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$(grep -Fc '[[Tickets/BOXP-993|' "${board}")" == 2 ]] || fail 'expected two BOXP-993 copies'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -n '/^## Notes/,/^## /p' "${board}" | grep -Fxq -- "${copy}" || fail 'Notes copy missing'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${board}" '^note about BOXP-993$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -n '/^## Ready/,/^## In Progress/p' "${board}" | grep -Fq '[[Tickets/BOXP-993|' || fail 'Ready card missing'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  if sed -n '/^## In Progress/,/^## Blocked/p' "${board}" | grep -Fq '[[Tickets/BOXP-993|'; then
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
    fail 'In Progress card remains'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  fi
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rm -rf "${tmp}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignment_revisions() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin rev result code
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" '- [ ] [[Tickets/BOXP-990|BOXP-990: test]] #ticket status::in-progress assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-990 review boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  result="$(bb "${HELPER}" update BOXP-990 --vault "${vault}" --lane Ready --assignee codex --note 'assignment note' --json)"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rev="$(printf '%s' "${result}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["rev"])')"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-990.md" "^board_rev: ${rev}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-990.md" 'assignment note'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" "rev::${rev}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" show BOXP-990 --vault "${vault}" --json | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["consistency"]["rev-match"] and x["consistency"]["assignee-match"]'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" verify-dispatch BOXP-990 --vault "${vault}" --expected-rev "${rev}" --assignee codex --json | python3 -c 'import json,sys; assert json.load(sys.stdin)["state"] == "awaiting-pickup"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^board_rev: .*/board_rev: old/; s/^assignee: .*/assignee: boxp/; s/^status: .*/status: review/" "${vault}/Tickets/BOXP-990.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cp "${vault}/Tickets/BOXP-990.md" "${tmp}/before"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  set +e
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" verify-dispatch BOXP-990 --vault "${vault}" --expected-rev "${rev}" --json >"${tmp}/verify"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  code=$?
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  set -e
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ "$code" == 5 ]] || fail 'expected pending-sync exit 5'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/tick"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cmp "${tmp}/before" "${vault}/Tickets/BOXP-990.md" || fail 'mismatch rewrote ticket'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${tmp}/starts" ]] || fail 'mismatch started agent'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^board_rev: .*/board_rev: ${rev}/; s/^assignee: .*/assignee: codex/; s/^status: .*/status: ready/" "${vault}/Tickets/BOXP-990.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/tick2"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/starts" BOXP-990
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" verify-dispatch BOXP-990 --vault "${vault}" --expected-rev "${rev}" --json | python3 -c 'import json,sys; assert json.load(sys.stdin)["state"] == "started"'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -n '/\[\[Tickets\/BOXP-990|/p' "${vault}/Boards/Task Board.md" >>"${vault}/Boards/Task Board.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" show BOXP-990 --vault "${vault}" --json | python3 -c 'import json,sys; assert json.load(sys.stdin)["consistency"]["duplicate-cards"] == 2'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignment_superseded() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" '- [ ] [[Tickets/BOXP-991|BOXP-991: test]] #ticket status::in-progress assignee::codex'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-991 in-progress codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A superseded run's done is discarded, so it must not reset the continuation budget.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${state}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  printf '{"BOXP-991" {:count 3}}\n' >"${state}/continuation-budget.edn"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" update BOXP-991 --vault "${vault}" --lane Ready --assignee codex >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" CODEX_FAKE_SLEEP=4 run_tick "${vault}" "${state}" env >"${tmp}/tick" &
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local pid=$!
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  for _ in $(seq 1 100); do [[ -e "${tmp}/starts" ]] && break; sleep 0.1; done
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -e "${tmp}/starts" ]] || fail 'agent did not start'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  bb "${HELPER}" update BOXP-991 --vault "${vault}" --lane Ready --assignee boxp --note 'new assignment' >/dev/null
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  wait "${pid}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-991.md" '^assignee: boxp$'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-991.md" 'newer assignment \(board_rev'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" 'status::ready.*assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_run_summary_contains "${state}" BOXP-991 ':superseded-by'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignment_repairs() {
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  local tmp vault state bin old new rev1 rev2
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  mkdir -p "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  make_fake_codex "${bin}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  old="rs-0000"; new="pnhdlqrk-0000"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A newer ticket is a complete helper write whose card update was lost: the card is repaired and dispatched.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-992|BOXP-992: test]] #ticket status::in-progress assignee::boxp rev::${old}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-992 ready codex
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^type: task$/type: task\nboard_rev: ${new}/" "${vault}/Tickets/BOXP-992.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cp "${vault}/Boards/Task Board.md" "${tmp}/board-before"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env >"${tmp}/tick0" 2>&1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  cmp "${tmp}/board-before" "${vault}/Boards/Task Board.md" || fail 'card repaired inside the warn window'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ ! -e "${tmp}/starts" ]] || fail 'stale card dispatched inside the warn window'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env CODEX_TASK_BOARD_REV_MISMATCH_WARN_SECONDS=0 >"${tmp}/tick" 2>&1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/tick" 'the card write was lost, repairing the card from ticket rev=.* for BOXP-992|BOXP-992; the card write was lost'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/starts" BOXP-992
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" "BOXP-992.*rev::${new}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # A newer card whose ticket never arrives: after the warn window the ticket frontmatter is repaired from the card.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rm -rf "${vault}" "${state}" "${tmp}/starts"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" "- [ ] [[Tickets/BOXP-993|BOXP-993: test]] #ticket status::in-progress assignee::codex rev::${new}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-993 review boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  sed -i "s/^type: task$/type: task\nboard_rev: ${old}/" "${vault}/Tickets/BOXP-993.md"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  PATH="${bin}:$PATH" CODEX_FAKE_START_LOG="${tmp}/starts" run_tick "${vault}" "${state}" env CODEX_TASK_BOARD_REV_MISMATCH_WARN_SECONDS=0 >"${tmp}/tick" 2>&1
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/tick" 'WARN: assignment revision mismatch persisted for BOXP-993'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Tickets/BOXP-993.md" "^board_rev: ${new}$"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # The repaired ticket carries the card's assignee, so the same tick dispatches it.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/tick" 'processing BOXP-993 from In Progress'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${tmp}/starts" BOXP-993
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  # Notes and text edits keep the revision; only a lane or assignee change issues a new one.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rm -rf "${vault}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_board "${vault}" '- [ ] [[Tickets/BOXP-994|BOXP-994: test]] #ticket status::in-progress assignee::boxp'
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  write_ticket "${vault}" BOXP-994 in-progress boxp
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rev1="$(bb "${HELPER}" update BOXP-994 --vault "${vault}" --lane Ready --assignee codex --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["rev"])')"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  rev2="$(bb "${HELPER}" update BOXP-994 --vault "${vault}" --note 'progress only' --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["rev"])')"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  [[ -n "${rev1}" && "${rev1}" == "${rev2}" ]] || fail "note-only update changed revision ${rev1} -> ${rev2}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
  assert_file_contains "${vault}/Boards/Task Board.md" "rev::${rev1}"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
}
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignment_revisions
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignment_superseded
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignment_repairs
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_delegation_gate_end_to_end
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_stream_json
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_pump_drains_when_events_log_cannot_open
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_result_survives_events_log_failure
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_stream_progress_prevents_idle_timeout_when_log_unwritable
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_events_log_omits_tool_payloads
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_claude_run_survives_subscription_snapshot_failure
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_subscription_metrics_disabled_removes_prom
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_assignee_runs_via_claude
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_explicit_claude_assignees_use_fixed_models_and_pinned_binary
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_model_environment_is_legacy_only
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_explicit_claude_error_and_review_markers_are_processed
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_agent_idle_timeout_retries
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_idle_timeout_stops_agent_children
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_invalid_idle_timeout_does_not_start_agent
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_progress_prevents_idle_timeout
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_codex_sol_assignee_includes_delegation_policy
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_codex_full_assignee_includes_delegation_policy
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_unsupported_assignee_is_ignored
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_stale_lock_recovers
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_planned_shutdown_lock_recovers_immediately
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_cross_process_lock_guard_preserves_replacement_lock
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_sigterm_writes_shutdown_marker_without_prestop
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_sigterm_stops_in_flight_agent_and_keeps_lock_for_next_owner
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_sigterm_kills_term_resistant_agent_within_grace
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_expired_foreign_shutdown_marker_is_retired
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_one_shot_tick_does_not_replace_loop_owner_instance
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_current_owner_shutdown_marker_drains_without_recovery
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_same_owner_new_instance_recovers_previous_instance
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_same_owner_new_instance_retires_empty_previous_marker
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_mismatched_shutdown_marker_does_not_recover_fresh_lock
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_shutdown_marker_waits_for_late_matching_lock
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_shutdown_marker_survives_late_second_lock
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_terminated_owner_cannot_create_lock_after_marker_cleanup
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_without_pr_is_blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_reported_blocked_is_audited
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocker_note_failure_keeps_current_lane
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_runner_internal_error_is_audited
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocker_reason_redacts_github_pat_and_spaced_api_key
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocker_note_failure_restores_original_lane
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_blocked_state_failure_records_a_single_audit_note_and_restores_lane
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_nonretryable_pr_gate_blocked_state_failure_keeps_summary_consistent
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_pr_url_is_noted
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_without_repo_marker_skips_pr_gates
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_conflict_is_blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_pr_gate_api_failure_is_audited
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_review_gate_retry_keeps_fable_assignee
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_ci_failure_is_blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_codex_review_issue_is_blocked
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p1_finding_retries_and_consumes_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p0_finding_blocks
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p2_only_passes_without_budget
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_mixed_findings_retry_targets_only_blocking
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_unknown_severity_output_stops
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p2_with_unstructured_lines_stops
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_p1_with_unstructured_lines_stops
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_clean_with_unstructured_lines_stops
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_finding_without_severity_stops
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_malformed_finding_stops
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_conflicting_result_marker_stops
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_same_p1_retry_count_survives_p2_changes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_pr_and_none_marker_checks_pr
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_multiple_pr_urls_checks_all
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_multiple_pr_urls_blocks_on_second_failure
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_keeps_lock_heartbeat_active
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_passes_codex_model_profile_to_review
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_missing_usage_still_passes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_empty_ci_rollup_times_out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_empty_ci_rollup_passes_for_no_ci_repo
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_empty_ci_rollup_times_out_without_no_ci_opt_in
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_no_ci_repo_requires_clean_merge_state
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_canonical_path_hash_symlink_isolation
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_draft_pr_is_retried
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_behind_merge_state_times_out
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_merged_pr_skips_gates
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_none_marker_and_merged_pr_moves_review
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_with_open_and_merged_prs_gates_open_only
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_retryable_pr_gate_failure_does_not_persist_raw_reason_in_notes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_retry_limit_blocks
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_retry_limit_is_scoped_to_failure_reason
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_gate_pass_after_retry_moves_review
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_boundary_9_10_11
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_multiple_prs_and_shared_pr
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_grant_resume_and_no_reset_on_success
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stricter_short_term_limit_still_applies
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_completes_after_interrupted_transition
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_reports_when_blocked_card_is_reassigned
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_is_written_once_under_concurrent_ticks
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_stop_is_serialized_with_grant
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_concurrent_updates_do_not_lose_counts
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_concurrent_ticks_do_not_lose_counts
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_gate_failure_budget_concurrent_start_on_shared_pr_is_serialized
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_groom_prompt_contains_investigation_steps
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_implement_prompt_includes_append_note
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_fable_implement_prompt_includes_append_note
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_groom_prompt_includes_append_note
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignee_model_routing
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignee_model_tick_routing
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_assignee_reasoning_tick_routing
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_invalid_reasoning_assignees_are_ignored
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_codex_astra_assignee_includes_delegation_policy
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_concurrent_append_note_no_lost_writes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_cross_vault_lock_isolation
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_concurrent_board_update_no_lost_writes
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_workspaces
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_holds_checkout_over_commit_limit
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_inspects_nested_checkouts
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_checks_reflog_commits
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_respects_board_lane
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_prune_invalid_settings_fall_back_to_defaults
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_loop_prunes_in_background
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_loop_prune_can_be_disabled
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_run_finished_records_outbox_event
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_in_progress_retry_records_no_outbox_event
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_outbox_disabled_by_env
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_ai_ops_ledger_records_run_lifecycle
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_ai_ops_ledger_disabled_by_env
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_ai_ops_ledger_groom_from_backlog_records_actual_lane
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_helper_update_keeps_notes_copy
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_task_board_pbt_properties
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
echo "task-board-runner tests passed"
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'

  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
# BOXP-344: isolated shared-GPU evaluation state machine; no model/network.
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
python3 -B -m unittest discover -s "${ROOT_DIR}/tests/qwen-eval" -v
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
test_review_lane_retirement_contract
  assert_file_contains "${state}/continuation-budget.edn" 'BOXP-991'
