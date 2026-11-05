#!/usr/bin/env bash
# BOXP-408 manual canary (not part of CI): run a REAL Claude or Codex worker through
# the runner against a throwaway vault and add a required TODO while it is running.
# The real vault, state root and board are never touched. It costs one small agent run.
#
#   tests/codex-workspace/todo-real-worker-canary.sh claude-sonnet
#   tests/codex-workspace/todo-real-worker-canary.sh codex
set -euo pipefail

ASSIGNEE="${1:?usage: todo-real-worker-canary.sh <assignee>}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb"
TODOS="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_todos.bb"
TMP="$(mktemp -d)"
VAULT="${TMP}/vault"
STATE="${TMP}/state"
WORK="${TMP}/work"
TICKET=BOXP-9408
mkdir -p "${VAULT}/Boards" "${VAULT}/Tickets" "${WORK}"

cat >"${VAULT}/Boards/Task Board.md" <<EOF
# Task Board

## Backlog

## Ready
- [ ] [[Tickets/${TICKET}|${TICKET}: canary]] #ticket status::ready assignee::${ASSIGNEE}

## In Progress

## Blocked

## Done
EOF

cat >"${VAULT}/Tickets/${TICKET}.md" <<EOF
---
id: ${TICKET}
type: task
status: ready
priority: medium
assignee: ${ASSIGNEE}
repo:
closed:
---

# ${TICKET}: dynamic TODO canary

## Summary

Throwaway canary. Do not delegate; record the exemption with reason small-task if a Delegation contract is shown.
Use one shell call for each step, in order, and do nothing else:
1. Run: touch ${WORK}/step1
2. Run: for i in \$(seq 1 90); do test -e ${WORK}/go && break; sleep 1; done; echo waited
3. Run: touch ${WORK}/step3
Follow every TODO instruction the runner gives you, including any that arrives while you work. Then finish.

## Acceptance Criteria

- [ ] step3 exists

## Context

## Plan

## Notes

EOF

add_todo() {
  bb "${TODOS}" add "${TICKET}" --vault "${VAULT}" --required \
    --text "Run: touch ${WORK}/extra" --source canary
  touch "${WORK}/go"
}

(
  until [[ -e "${WORK}/step1" ]]; do sleep 1; done
  add_todo
) >"${TMP}/add.log" 2>&1 &
ADDER=$!

for attempt in 1 2 3; do
  CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    bb "${RUNNER}" tick --ticket "${TICKET}" >>"${TMP}/tick.log" 2>&1 || true
  status="$(sed -n 's/^status: //p' "${VAULT}/Tickets/${TICKET}.md" | head -1)"
  echo "attempt ${attempt}: status=${status}"
  [[ "${status}" == ready ]] || break
done
kill "${ADDER}" 2>/dev/null || true

echo "--- evidence (tmp kept: ${TMP})"
sed -n '/^---$/,/^---$/p' "${VAULT}/Tickets/${TICKET}.md" | grep -E '^(status|assignee|todo_)' || true
sed -n '/^## Plan$/,/^## Notes$/p' "${VAULT}/Tickets/${TICKET}.md"
ls "${WORK}"
for summary in "${STATE}/runs/${TICKET}"/*/summary.edn; do
  echo "${summary}"; grep -oE ':result "[a-z-]+"|:gate "[a-z]+"' "${summary}" | tr '\n' ' '; echo
done
for delivery in "${STATE}/runs/${TICKET}"/*/todo-delivery.edn; do
  [[ -e "${delivery}" ]] && { echo "${delivery}"; cat "${delivery}"; echo; }
done

[[ "${status}" == done && -e "${WORK}/extra" && -e "${WORK}/step3" ]] \
  && echo "CANARY PASS ${ASSIGNEE}" || { echo "CANARY FAIL ${ASSIGNEE}"; exit 1; }
