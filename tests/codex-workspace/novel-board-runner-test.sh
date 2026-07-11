#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/novel-board/novel_board_runner.bb"

fail() {
  echo "error: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local value="$2"
  grep -Fq -- "${value}" "${file}" || fail "expected ${file} to contain: ${value}"
}

assert_not_contains() {
  local file="$1"
  local value="$2"
  if grep -Fq -- "${value}" "${file}"; then
    fail "expected ${file} not to contain: ${value}"
  fi
}

write_board() {
  local vault="$1"
  local backlog="${2:-}"
  local draft="${3:-}"
  local progress="${4:-}"
  local review="${5:-}"
  local done="${6:-}"
  mkdir -p "${vault}/Boards" "${vault}/Novels" "${vault}/Templates"
  cp "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Templates/Novel Management.md" \
    "${vault}/Templates/Novel Management.md"
  cat >"${vault}/Boards/Novel Board.md" <<EOF
# Novel Board

## Backlog
${backlog}

## Draft
${draft}

## In Progress
${progress}

## Review
${review}

## Done
${done}
EOF
}

write_note() {
  local vault="$1"
  local id="$2"
  local status="$3"
  local assignee="$4"
  local title="$5"
  local root="$6"
  mkdir -p "${vault}/Novels" "${root}/work/${id}"
  cat >"${vault}/Novels/${id}.md" <<EOF
---
id: ${id}
type: novel
status: ${status}
title: ${title}
assignee: ${assignee}
nsfw: false
work-dir: ${root}/work/${id}
manuscript: ${root}/work/${id}/manuscript.md
published-path:
published-at:
---

# ${title}

## Requirements

- Title: ${title}
- Synopsis: test

## Outline

- scene one

## Review Instructions

## Change History

## Run History
EOF
}

make_fake_agents() {
  local bin="$1"
  mkdir -p "${bin}"
  cat >"${bin}/bash" <<'EOF'
#!/bin/bash
set -euo pipefail
if [[ "${FAKE_SIGNAL_FAILURE:-}" == "1" && "${1:-}" == "-c" && "${2:-}" == *'kill -s '* ]]; then
  printf 'simulated signal failure\n' >&2
  exit 99
fi
exec /bin/bash "$@"
EOF
  chmod +x "${bin}/bash"

  cat >"${bin}/codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ -n "${FAKE_ARG_LOG:-}" ]] && printf 'codex %s\n' "$*" >>"${FAKE_ARG_LOG}"
last=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-last-message) last="$2"; shift 2 ;;
    *) shift ;;
  esac
done
prompt="$(cat)"
[[ -n "${FAKE_START_LOG:-}" ]] && printf 'codex\n' >>"${FAKE_START_LOG}"
[[ -n "${FAKE_PROMPT_LOG:-}" ]] && printf '%s\n' "${prompt}" >>"${FAKE_PROMPT_LOG}"
note="$(printf '%s\n' "${prompt}" | sed -n 's/^Management note: //p' | head -n 1)"
manuscript="$(printf '%s\n' "${prompt}" | sed -n 's/^Manuscript path: //p' | head -n 1)"
if printf '%s\n' "${prompt}" | grep -q '^Groom requirements only'; then
  printf '\n- fake groom completed\n' >>"${note}"
else
  mkdir -p "$(dirname "${manuscript}")"
  if [[ -f "${manuscript}" ]]; then
    printf '\n改稿済み。\n' >>"${manuscript}"
  else
    printf '# 初稿\n\n本文です。\n' >"${manuscript}"
  fi
fi
mkdir -p "$(dirname "${last}")"
sleep "${FAKE_SLEEP:-0}"
printf '%s\n' "${FAKE_RESULT:-NOVEL_BOARD_RESULT: review}" >"${last}"
exit "${FAKE_EXIT:-0}"
EOF
  chmod +x "${bin}/codex"

  cat >"${bin}/claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ -n "${FAKE_ARG_LOG:-}" ]] && printf 'claude %s\n' "$*" >>"${FAKE_ARG_LOG}"
prompt="$(cat)"
manuscript="$(printf '%s\n' "${prompt}" | sed -n 's/^Manuscript path: //p' | head -n 1)"
mkdir -p "$(dirname "${manuscript}")"
printf '# Claude 初稿\n\n本文です。\n' >"${manuscript}"
printf '%s\n' "${FAKE_RESULT:-NOVEL_BOARD_RESULT: review}"
exit "${FAKE_EXIT:-0}"
EOF
  chmod +x "${bin}/claude"

  cat >"${bin}/pi" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ -n "${FAKE_ARG_LOG:-}" ]] && printf 'pi %s\n' "$*" >>"${FAKE_ARG_LOG}"
prompt="${!#}"
manuscript="$(printf '%s\n' "${prompt}" | sed -n 's/^Manuscript path: //p' | head -n 1)"
mkdir -p "$(dirname "${manuscript}")"
printf '\nPi 改稿済み。\n' >>"${manuscript}"
[[ -n "${FAKE_AGENT_PID_FILE:-}" ]] && printf '%s\n' "$$" >"${FAKE_AGENT_PID_FILE}"
if [[ -n "${FAKE_TERM_FORK_CHILD_MARKER:-}" ]]; then
  trap '(
    trap "" TERM
    printf "started\\n" >"${FAKE_TERM_FORK_CHILD_MARKER}.started"
    sleep "${FAKE_TERM_FORK_CHILD_SLEEP:-2}"
    printf "survived timeout\\n" >"${FAKE_TERM_FORK_CHILD_MARKER}"
  ) &
  exit 143' TERM
  while :; do sleep 10; done
fi
sleep "${FAKE_SLEEP:-0}"
printf '%s\n' "${FAKE_RESULT:-NOVEL_BOARD_RESULT: review}"
exit "${FAKE_EXIT:-0}"
EOF
  chmod +x "${bin}/pi"
}

run_tick() {
  local vault="$1"
  local root="$2"
  local bin="$3"
  shift 3
  PATH="${bin}:$PATH" \
    CODEX_NOVEL_BOARD_VAULT="${vault}" \
    CODEX_NOVEL_BOARD_ROOT="${root}" \
    CODEX_NOVEL_BOARD_OWNER_ID="test-owner" \
    CODEX_NOVEL_BOARD_LOCK_STALE_SECONDS="1" \
    CODEX_NOVEL_BOARD_HEARTBEAT_SECONDS="1" \
    "$@" bb "${RUNNER}" tick
}

test_seed_and_entrypoint() {
  local tmp home vault custom_vault task_vault seed entrypoint role_entrypoint role_id role_log role_runner role_runuser role_runuser_log
  tmp="$(mktemp -d)"
  home="${tmp}/home"
  vault="${home}/Documents/obsidian-headless/BOXP"
  mkdir -p "${home}" "${vault}/Boards"
  cp "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "${vault}/Boards/existing.md"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "kanban-plugin: board"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "%% kanban:settings"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "## Backlog"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "## Draft"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "## In Progress"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "## Review"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "## Done"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" 'Backlog` に `- [ ] タイトル`'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md" "Templates/Novel Management.md"
  [[ "$(grep -c '#novel-rule' "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Boards/Novel Board.md")" -eq 5 ]] || fail "each Novel Board lane must contain one rule card"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Templates/Novel Management.md" "## Workflow"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Templates/Novel Management.md" '`Review Instructions`'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed/Novels/README.md" "## レーン運用"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" "install_novel_board_seed"
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" 'local vault="${CODEX_NOVEL_BOARD_VAULT:-${task_board_vault}}"'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" 'dest="${vault}/${rel}"'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" 'install -d -o boxp -g boxp -m 0755 /home/boxp'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" 'install -d -o boxp -g boxp -m 0700 "${novel_board_root}"'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" 'install -d -o boxp -g boxp -m 0700 "${CODEX_NOVEL_BOARD_ROOT:-/home/boxp/.novel-board}"'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" 'exec /usr/sbin/runuser -u boxp -- env HOME=/home/boxp'
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" 'exec env HOME=/home/boxp'

  role_log="${tmp}/role.log"
  role_runuser_log="${tmp}/role-runuser.log"
  role_runner="${tmp}/role-runner"
  role_runuser="${tmp}/runuser"
  role_id="${tmp}/id"
  role_entrypoint="${tmp}/entrypoint.sh"
  cat >"${role_runner}" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"${ROLE_LOG}"
EOF
  cat >"${role_runuser}" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${ROLE_RUNUSER_LOG}"
[[ "$1" == "-u" && "$2" == "boxp" && "$3" == "--" ]] || exit 64
shift 3
exec "$@"
EOF
  cat >"${role_id}" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "-u") printf '%s\n' "${ROLE_CURRENT_UID}" ;;
  "-u boxp") printf '1000\n' ;;
  *) exec /usr/bin/id "$@" ;;
esac
EOF
  sed \
    -e "s#/usr/sbin/runuser#${role_runuser}#g" \
    -e "s#/home/boxp#${home}#g" \
    -e 's/-o boxp -g boxp //g' \
    "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" >"${role_entrypoint}"
  chmod 0755 "${role_runner}" "${role_runuser}" "${role_id}" "${role_entrypoint}"
  PATH="${tmp}:$PATH" \
    CODEX_WORKSPACE_ROLE=novel-board-runner \
    CODEX_NOVEL_BOARD_RUNNER="${role_runner}" \
    ROLE_CURRENT_UID=0 \
    ROLE_LOG="${role_log}" \
    ROLE_RUNUSER_LOG="${role_runuser_log}" \
    bash "${role_entrypoint}"
  [[ "$(cat "${role_log}")" == "loop" ]] || fail "root Novel Board role did not start the runner loop"
  assert_contains "${role_runuser_log}" "-u boxp -- env HOME=${home} ${role_runner} loop"
  [[ "$(stat -c %a "${home}/.novel-board")" == "700" ]] || fail "Novel Board private root is not mode 0700"

  rm -rf "${home}/.novel-board"
  : >"${role_log}"
  : >"${role_runuser_log}"
  PATH="${tmp}:$PATH" \
    CODEX_WORKSPACE_ROLE=novel-board-runner \
    CODEX_NOVEL_BOARD_RUNNER="${role_runner}" \
    ROLE_CURRENT_UID=1000 \
    ROLE_LOG="${role_log}" \
    ROLE_RUNUSER_LOG="${role_runuser_log}" \
    bash "${role_entrypoint}"
  [[ "$(cat "${role_log}")" == "loop" ]] || fail "boxp Novel Board role did not start the runner loop"
  [[ ! -s "${role_runuser_log}" ]] || fail "boxp Novel Board role unnecessarily invoked runuser"
  [[ "$(stat -c %a "${home}/.novel-board")" == "700" ]] || fail "boxp Novel Board private root is not mode 0700"

  custom_vault="${tmp}/novel-vault"
  task_vault="${tmp}/task-vault"
  seed="${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed"
  entrypoint="${ROOT_DIR}/docker/codex-workspace/entrypoint.sh"
  CODEX_NOVEL_BOARD_VAULT="${custom_vault}" \
    CODEX_NOVEL_BOARD_SEED="${seed}" \
    TASK_BOARD_VAULT="${task_vault}" \
    ENTRYPOINT="${entrypoint}" \
    bash -c '
      set -euo pipefail
      task_board_vault="${TASK_BOARD_VAULT}"
      install() {
        local args=()
        while [[ $# -gt 0 ]]; do
          case "$1" in
            -o|-g) shift 2 ;;
            *) args+=("$1"); shift ;;
          esac
        done
        command install "${args[@]}"
      }
      source <(awk '\''/^install_novel_board_seed\(\)/ {copy=1} copy {print} copy && /^}/ {exit}'\'' "${ENTRYPOINT}")
      install_novel_board_seed
    '
  [[ -f "${custom_vault}/Boards/Novel Board.md" ]] || fail "Novel seed was not installed in CODEX_NOVEL_BOARD_VAULT"
  [[ -f "${custom_vault}/Templates/Novel Management.md" ]] || fail "Novel management template was not installed"
  [[ -f "${custom_vault}/Novels/README.md" ]] || fail "Novel operations README was not installed"
  [[ ! -e "${task_vault}/Boards/Novel Board.md" ]] || fail "Novel seed leaked into CODEX_TASK_BOARD_VAULT"
}

test_manual_title_scaffold() {
  local tmp vault state bin note_count card_count
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" $'- [ ] Backlog の説明 #novel-rule\n- [ ] 手入力の物語\n- [ ] 夜の手入力 #nsfw'
  write_note "${vault}" NOVEL-7 backlog boxp "既存作品" "${state}"
  printf '\n## Custom Template Marker\n\ntitle: 本文中のカスタム行は保持する。\n' >>"${vault}/Templates/Novel Management.md"

  run_tick "${vault}" "${state}" "${bin}" env

  assert_contains "${vault}/Boards/Novel Board.md" '[[Novels/NOVEL-8|NOVEL-8: 手入力の物語]] #novel status::backlog assignee::boxp'
  assert_contains "${vault}/Boards/Novel Board.md" '[[Novels/NOVEL-9|NOVEL-9: 夜の手入力]] #novel #nsfw status::backlog assignee::boxp'
  assert_not_contains "${vault}/Boards/Novel Board.md" '- [ ] 手入力の物語'
  assert_contains "${vault}/Boards/Novel Board.md" '- [ ] Backlog の説明 #novel-rule'
  assert_not_contains "${vault}/Boards/Novel Board.md" 'NOVEL-10'
  assert_contains "${vault}/Novels/NOVEL-8.md" 'id: "NOVEL-8"'
  assert_contains "${vault}/Novels/NOVEL-8.md" 'title: "手入力の物語"'
  assert_contains "${vault}/Novels/NOVEL-8.md" '# 手入力の物語'
  assert_contains "${vault}/Novels/NOVEL-8.md" "## Custom Template Marker"
  assert_contains "${vault}/Novels/NOVEL-8.md" "title: 本文中のカスタム行は保持する。"
  assert_contains "${vault}/Novels/NOVEL-9.md" 'nsfw: true'
  [[ ! -d "${state}/runs/NOVEL-8" && ! -d "${state}/runs/NOVEL-9" ]] || fail "default human assignee started an agent after scaffold"

  run_tick "${vault}" "${state}" "${bin}" env
  note_count="$(find "${vault}/Novels" -maxdepth 1 -type f -name 'NOVEL-*.md' | wc -l)"
  card_count="$(grep -c '\[\[Novels/NOVEL-[89]|' "${vault}/Boards/Novel Board.md")"
  [[ "${note_count}" -eq 3 ]] || fail "Novel scaffold duplicated a management note"
  [[ "${card_count}" -eq 2 ]] || fail "Novel scaffold duplicated a Board card"
}

test_groom_and_human_stop() {
  local tmp vault state bin prompt
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; prompt="${tmp}/prompt.log"
  make_fake_agents "${bin}"
  write_board "${vault}" "- [ ] [[Novels/NOVEL-1|NOVEL-1: 星の話]] #novel status::wrong assignee::codex"
  FAKE_PROMPT_LOG="${prompt}" run_tick "${vault}" "${state}" "${bin}" env

  assert_contains "${vault}/Boards/Novel Board.md" "## Draft"
  assert_contains "${vault}/Boards/Novel Board.md" "status::draft assignee::boxp"
  assert_contains "${vault}/Novels/NOVEL-1.md" 'status: "draft"'
  assert_contains "${vault}/Novels/NOVEL-1.md" "fake groom completed"
  assert_contains "$(find "${state}/runs/NOVEL-1" -name summary.edn -print -quit)" ":status :succeeded"
  assert_contains "$(find "${state}/runs/NOVEL-1" -name summary.edn -print -quit)" ":exit-code 0"
  [[ ! -f "${state}/work/NOVEL-1/manuscript.md" ]] || fail "groom must not create manuscript"
  assert_contains "${prompt}" "Do not write any novel prose"

  local before
  before="$(find "${state}/runs/NOVEL-1" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ "$(find "${state}/runs/NOVEL-1" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq "${before}" ]] || fail "Draft human review point started unexpectedly"
}

test_write_review_and_pi_revision() {
  local tmp vault state bin args image markdown_image outside prompt_log
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; args="${tmp}/args.log"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "- [ ] [[Novels/NOVEL-2|NOVEL-2: 夏の話]] #novel status::draft assignee::codex-sol-xhigh"
  write_note "${vault}" NOVEL-2 draft codex-sol-xhigh "夏の話" "${state}"
  FAKE_ARG_LOG="${args}" run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Boards/Novel Board.md" "status::review assignee::boxp"
  assert_contains "${state}/work/NOVEL-2/manuscript.md" "本文です"
  [[ "$(stat -c %a "${state}/work/NOVEL-2/manuscript.md")" == "600" ]] || fail "working manuscript must be private"
  assert_contains "${args}" "--model gpt-5.6-sol"
  assert_contains "${args}" "model_reasoning_effort=xhigh"
  assert_contains "${args}" "--sandbox workspace-write --add-dir ${vault}"
  assert_not_contains "${args}" "--dangerously-bypass-approvals-and-sandbox"

  sed -i 's/status::review assignee::boxp/status::review assignee::pi/' "${vault}/Boards/Novel Board.md"
  sed -i '/^## Review Instructions$/a\\\n- 余韻を追加する。' "${vault}/Novels/NOVEL-2.md"
  image="${vault}/Attachments/character reference.png"
  markdown_image="${vault}/Attachments/setting.webp"
  outside="${tmp}/outside.png"
  mkdir -p "$(dirname "${image}")"
  printf 'fake image\n' >"${image}"
  printf 'fake webp\n' >"${markdown_image}"
  printf 'outside image\n' >"${outside}"
  sed -i "/^- Synopsis:/a\\- Vision reference: ![[Attachments/character reference.png]]\\n- Setting reference: ![setting](Attachments/setting.webp)\\n- Rejected external image: ![[${outside}]]" "${vault}/Novels/NOVEL-2.md"
  FAKE_ARG_LOG="${args}" CODEX_NOVEL_BOARD_PI_MODEL="llama.cpp/gemma4-26b-vision" run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${state}/work/NOVEL-2/manuscript.md" "Pi 改稿済み"
  assert_contains "${args}" "pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files --print --approve --mode text --session-dir"
  assert_contains "${args}" "--model llama.cpp/gemma4-26b-vision"
  assert_contains "${args}" "@${image}"
  assert_contains "${args}" "@${markdown_image}"
  assert_not_contains "${args}" "@${outside}"
  prompt_log="$(grep -l -F 'Reference images attached to the agent:' "${state}/runs/NOVEL-2"/*/prompt.md | head -n 1)"
  assert_contains "${prompt_log}" "Reference images attached to the agent:"
  assert_contains "${vault}/Boards/Novel Board.md" "status::review assignee::boxp"
}

test_agent_timeout_returns_to_human_review() {
  local tmp vault state bin summary stderr escaped_child_marker
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "- [ ] [[Novels/NOVEL-T|NOVEL-T: Timeout]] #novel status::backlog assignee::pi"

  escaped_child_marker="${tmp}/term-handler-child-survived"
  FAKE_TERM_FORK_CHILD_MARKER="${escaped_child_marker}" \
    FAKE_TERM_FORK_CHILD_SLEEP=2 \
    CODEX_NOVEL_BOARD_AGENT_TIMEOUT_SECONDS=1 \
    CODEX_NOVEL_BOARD_AGENT_SHUTDOWN_GRACE_SECONDS=1 \
    run_tick "${vault}" "${state}" "${bin}" env

  # The parent forks this TERM-ignoring child only from its TERM handler. A
  # timeout-time process tree snapshot cannot see it; process-group KILL must.
  sleep 3

  assert_contains "${vault}/Boards/Novel Board.md" "status::draft assignee::boxp"
  assert_contains "${vault}/Novels/NOVEL-T.md" "agent timed out after 1 seconds"
  summary="$(find "${state}/runs/NOVEL-T" -name summary.edn -print -quit)"
  stderr="$(find "${state}/runs/NOVEL-T" -name stderr.log -print -quit)"
  assert_contains "${summary}" ":exit-code 124"
  assert_contains "${summary}" ":timed-out true"
  assert_contains "${stderr}" "terminated the agent after 1 seconds"
  [[ -e "${escaped_child_marker}.started" ]] || fail "TERM handler did not fork the regression-test child"
  [[ ! -e "${escaped_child_marker}" ]] || fail "TERM-handler descendant survived timeout cleanup"
}

test_agent_timeout_falls_back_when_group_signal_fails() {
  local tmp vault state bin summary stderr agent_pid_file agent_pid
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "- [ ] [[Novels/NOVEL-TC|NOVEL-TC: Cleanup Timeout]] #novel status::backlog assignee::pi"
  agent_pid_file="${tmp}/agent.pid"

  # Reproduce process-group signal failures while direct PID signals remain
  # available. The observed process tree must still be fully collected.
  FAKE_SIGNAL_FAILURE=1 \
    FAKE_AGENT_PID_FILE="${agent_pid_file}" \
    FAKE_SLEEP=30 \
    CODEX_NOVEL_BOARD_AGENT_TIMEOUT_SECONDS=1 \
    CODEX_NOVEL_BOARD_AGENT_SHUTDOWN_GRACE_SECONDS=1 \
    run_tick "${vault}" "${state}" "${bin}" env

  agent_pid="$(cat "${agent_pid_file}")"
  if ps -eo pgid=,stat= | awk -v pgid="${agent_pid}" \
    '$1 == pgid && $2 !~ /^Z/ { found = 1 } END { exit found ? 0 : 1 }'; then
    kill -KILL -- "-${agent_pid}" 2>/dev/null || kill -KILL "${agent_pid}" 2>/dev/null || true
    fail "direct PID fallback left an active fake agent process running"
  fi

  assert_contains "${vault}/Boards/Novel Board.md" "status::draft assignee::boxp"
  assert_contains "${vault}/Novels/NOVEL-TC.md" "agent timed out after 1 seconds"
  assert_not_contains "${vault}/Novels/NOVEL-TC.md" "cleanup was incomplete"
  summary="$(find "${state}/runs/NOVEL-TC" -name summary.edn -print -quit)"
  stderr="$(find "${state}/runs/NOVEL-TC" -name stderr.log -print -quit)"
  assert_contains "${summary}" ":exit-code 124"
  assert_contains "${summary}" ":timed-out true"
  assert_not_contains "${summary}" ":cleanup-error"
  assert_contains "${stderr}" "terminated the agent after 1 seconds"
  assert_not_contains "${stderr}" "Agent timeout cleanup was incomplete"
}

test_review_without_instructions_stops() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "- [ ] [[Novels/NOVEL-RI|NOVEL-RI: 指示待ち]] #novel status::review assignee::codex"
  write_note "${vault}" NOVEL-RI review codex "指示待ち" "${state}"

  run_tick "${vault}" "${state}" "${bin}" env

  assert_contains "${vault}/Boards/Novel Board.md" "status::review assignee::codex"
  assert_contains "${vault}/Novels/NOVEL-RI.md" "Review Instructions are empty"
  [[ ! -d "${state}/runs/NOVEL-RI" ]] || fail "Review without instructions must not start an agent"
}

test_human_lane_move_during_agent_is_preserved() {
  local tmp vault state bin starts runner_pid i card
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; starts="${tmp}/starts.log"
  make_fake_agents "${bin}"
  card='- [ ] [[Novels/NOVEL-H|NOVEL-H: Human Move]] #novel status::draft assignee::codex'
  write_board "${vault}" "" "${card}"
  write_note "${vault}" NOVEL-H draft codex "Human Move" "${state}"

  FAKE_START_LOG="${starts}" FAKE_SLEEP=2 run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/runner.log" 2>&1 &
  runner_pid=$!
  for i in $(seq 1 50); do
    [[ -s "${starts}" ]] && break
    sleep 0.05
  done
  [[ -s "${starts}" ]] || fail "agent did not start before human lane move"
  card="$(grep 'Novels/NOVEL-H' "${vault}/Boards/Novel Board.md")"
  write_board "${vault}" "" "" "" "" "${card/status::in-progress/status::done}"
  wait "${runner_pid}"

  assert_contains "${vault}/Boards/Novel Board.md" "status::done assignee::codex"
  assert_not_contains "${vault}/Boards/Novel Board.md" "status::review assignee::boxp"
  assert_contains "${vault}/Novels/NOVEL-H.md" 'status: "done"'
  assert_contains "${vault}/Novels/NOVEL-H.md" "preserved the current lane instead of moving it to review"
}

test_fable_and_failure_return_to_review() {
  local tmp vault state bin args
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; args="${tmp}/args.log"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "- [ ] [[Novels/NOVEL-3|NOVEL-3: Claude 話]] #novel status::draft assignee::fable"
  write_note "${vault}" NOVEL-3 draft fable "Claude 話" "${state}"
  FAKE_ARG_LOG="${args}" run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${state}/work/NOVEL-3/manuscript.md" "Claude 初稿"
  assert_contains "${args}" "claude --print"
  assert_not_contains "${args}" "--dangerously-skip-permissions"

  sed -i 's/status::review assignee::boxp/status::review assignee::codex-mini/' "${vault}/Boards/Novel Board.md"
  sed -i '/^## Review Instructions$/a\\\n- 語尾を整える。' "${vault}/Novels/NOVEL-3.md"
  FAKE_EXIT=42 FAKE_ARG_LOG="${args}" run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Boards/Novel Board.md" "status::review assignee::boxp"
  assert_contains "${vault}/Novels/NOVEL-3.md" "agent exited 42"
  assert_contains "${args}" "--model gpt-5.6-luna"
}

test_explicit_approval_bypass() {
  local tmp vault state bin args
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; args="${tmp}/args.log"
  make_fake_agents "${bin}"
  write_board "${vault}" "- [ ] [[Novels/NOVEL-BP|NOVEL-BP: Bypass]] #novel status::backlog assignee::codex"

  FAKE_ARG_LOG="${args}" run_tick "${vault}" "${state}" "${bin}" env CODEX_NOVEL_BOARD_BYPASS_APPROVALS=true

  assert_contains "${args}" "--dangerously-bypass-approvals-and-sandbox"
  assert_not_contains "${args}" "--sandbox"
}

test_all_task_board_routes_and_unknown_skip() {
  local assignee expected tmp vault state bin args
  while read -r assignee expected; do
    tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; args="${tmp}/args.log"
    make_fake_agents "${bin}"
    write_board "${vault}" "- [ ] [[Novels/NOVEL-R|NOVEL-R: Route]] #novel status::backlog assignee::${assignee}"
    FAKE_ARG_LOG="${args}" run_tick "${vault}" "${state}" "${bin}" env
    assert_contains "${args}" "--model ${expected}"
  done <<'EOF'
codex gpt-5.6-terra
codex-terra gpt-5.6-terra
codex-sol gpt-5.6-sol
codex-full gpt-5.6-sol
codex-mini gpt-5.6-luna
EOF

  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "- [ ] [[Novels/NOVEL-U|NOVEL-U: Unknown]] #novel status::backlog assignee::mystery"
  run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Boards/Novel Board.md" "status::backlog assignee::mystery"
  assert_contains "${vault}/Novels/NOVEL-U.md" "Runner skipped unsupported or human assignee 'mystery'"
  [[ ! -d "${state}/runs/NOVEL-U" ]] || fail "unknown assignee must not start"
}

test_publish_routing_and_idempotency() {
  local tmp vault state bin sfw_count nsfw_count
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-S|NOVEL-S: 光の話]] #novel status::done assignee::boxp
- [x] [[Novels/NOVEL-N|NOVEL-N: 夜の話]] #novel #nsfw status::done assignee::boxp"
  write_note "${vault}" NOVEL-S done boxp "光の話" "${state}"
  write_note "${vault}" NOVEL-N done boxp "夜の話" "${state}"
  printf '# 光の話\n\n完成。\n' >"${state}/work/NOVEL-S/manuscript.md"
  printf '# 夜の話\n\n完成。\n' >"${state}/work/NOVEL-N/manuscript.md"
  run_tick "${vault}" "${state}" "${bin}" env

  sfw_count="$(find "${vault}/小説草案/AI執筆" -maxdepth 1 -type f -name '*_光の話.md' | wc -l)"
  nsfw_count="$(find "${vault}/NSFW/小説/AI執筆" -maxdepth 1 -type f -name '*_夜の話.md' | wc -l)"
  [[ "${sfw_count}" -eq 1 && "${nsfw_count}" -eq 1 ]] || fail "SFW/NSFW publication routing failed"
  [[ "$(find "${vault}/NSFW/小説/AI執筆" -maxdepth 1 -type f -name '*_光の話.md' | wc -l)" -eq 0 ]] || fail "SFW copied to NSFW"
  [[ "$(find "${vault}/小説草案/AI執筆" -maxdepth 1 -type f -name '*_夜の話.md' | wc -l)" -eq 0 ]] || fail "NSFW copied to SFW"
  assert_contains "${vault}/Novels/NOVEL-S.md" "published-path:"
  assert_contains "${vault}/Novels/NOVEL-S.md" "[[小説草案/AI執筆/"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ "$(find "${vault}/小説草案/AI執筆" -maxdepth 1 -type f -name '*_光の話.md' | wc -l)" -eq 1 ]] || fail "Done rescan duplicated SFW publication"
  [[ "$(find "${vault}/NSFW/小説/AI執筆" -maxdepth 1 -type f -name '*_夜の話.md' | wc -l)" -eq 1 ]] || fail "Done rescan duplicated NSFW publication"
}

test_publish_heartbeat_keeps_card_lock_fresh() {
  local tmp vault state bin manuscript checksum dest canonical_dest guard_key guard ready holder_pid runner_pid initial_heartbeat current_heartbeat published i
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-HB|NOVEL-HB: 長時間公開]] #novel status::done assignee::boxp"
  write_note "${vault}" NOVEL-HB done boxp "長時間公開" "${state}"
  manuscript="${state}/work/NOVEL-HB/manuscript.md"
  printf 'AB' >"${manuscript}"
  checksum="$(sha256sum "${manuscript}" | cut -d ' ' -f 1)"
  dest="${vault}/小説草案/AI執筆/2026-07-11-12-38_長時間公開.md"
  canonical_dest="$(realpath -m "${dest}")"
  guard_key="$(printf '%s' "${canonical_dest}" | sha256sum | cut -d ' ' -f 1)"
  guard="${state}/publication-locks/${guard_key}.lock"
  ready="${tmp}/publication-lock-ready"
  mkdir -p "$(dirname "${dest}")" "${state}/published" "${state}/publication-locks"
  printf '{:novel-id "NOVEL-HB", :path "%s", :sha256 "%s", :published-at "2026-07-11T03:38:00Z", :nsfw false, :status :reserved}\n' "${dest}" "${checksum}" >"${state}/published/NOVEL-HB.edn"

  PUBLICATION_GUARD="${guard}" PUBLICATION_READY="${ready}" bb -e '
    (import (java.io RandomAccessFile))
    (with-open [file (RandomAccessFile. (System/getenv "PUBLICATION_GUARD") "rw")
                channel (.getChannel file)]
      (let [_lock (.lock channel)]
        (spit (System/getenv "PUBLICATION_READY") "ready")
        (Thread/sleep 4000)))' &
  holder_pid=$!
  for i in $(seq 1 50); do
    [[ -f "${ready}" ]] && break
    sleep 0.05
  done
  [[ -f "${ready}" ]] || fail "test process did not acquire the publication destination lock"

  run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/runner.log" 2>&1 &
  runner_pid=$!

  for i in $(seq 1 50); do
    [[ -f "${state}/locks/NOVEL-HB.edn" ]] && break
    sleep 0.05
  done
  [[ -f "${state}/locks/NOVEL-HB.edn" ]] || fail "publish did not acquire the card lock"
  initial_heartbeat="$(sed -n 's/.*:heartbeat-at \"\([^\"]*\)\".*/\1/p' "${state}/locks/NOVEL-HB.edn")"

  current_heartbeat="${initial_heartbeat}"
  for i in $(seq 1 50); do
    sleep 0.1
    current_heartbeat="$(sed -n 's/.*:heartbeat-at \"\([^\"]*\)\".*/\1/p' "${state}/locks/NOVEL-HB.edn")"
    [[ -n "${current_heartbeat}" && "${current_heartbeat}" != "${initial_heartbeat}" ]] && break
  done
  [[ -n "${current_heartbeat}" && "${current_heartbeat}" != "${initial_heartbeat}" ]] || fail "publish did not refresh the card lock heartbeat"

  wait "${runner_pid}"
  wait "${holder_pid}"
  published="$(find "${vault}/小説草案/AI執筆" -maxdepth 1 -type f -name '*_長時間公開.md' -print -quit)"
  [[ -n "${published}" ]] || fail "slow publication did not create the completed manuscript"
  [[ "$(cat "${published}")" == "AB" ]] || fail "slow publication produced incomplete content"
  assert_contains "${state}/published/NOVEL-HB.edn" ":status :published"
}

test_untrusted_management_published_path_is_not_reused() {
  local tmp vault state bin untrusted published
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-UP|NOVEL-UP: 信頼境界]] #novel #nsfw status::done assignee::boxp"
  write_note "${vault}" NOVEL-UP done boxp "信頼境界" "${state}"
  printf '# 承認済み原稿\n' >"${state}/work/NOVEL-UP/manuscript.md"
  untrusted="${vault}/小説草案/AI執筆/existing.md"
  mkdir -p "$(dirname "${untrusted}")"
  printf '# unrelated existing file\n' >"${untrusted}"
  sed -i "s|^published-path:.*|published-path: \"${untrusted}\"|" "${vault}/Novels/NOVEL-UP.md"

  run_tick "${vault}" "${state}" "${bin}" env

  [[ "$(cat "${untrusted}")" == '# unrelated existing file' ]] || fail "untrusted management published-path was overwritten"
  published="$(find "${vault}/NSFW/小説/AI執筆" -maxdepth 1 -type f -name '*_信頼境界.md' -print -quit)"
  [[ -n "${published}" ]] || fail "NSFW manuscript was not published to its designated directory"
  cmp "${state}/work/NOVEL-UP/manuscript.md" "${published}" || fail "designated publication does not match the approved manuscript"
  assert_contains "${state}/published/NOVEL-UP.edn" ":path \"${published}\""
  assert_contains "${state}/published/NOVEL-UP.edn" ":status :published"
  assert_contains "${vault}/Novels/NOVEL-UP.md" "published-path: \"${published}\""
  assert_not_contains "${vault}/Novels/NOVEL-UP.md" "published-path: \"${untrusted}\""
}

test_collision_and_missing_manuscript_stay_done() {
  local tmp vault state bin stamp
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-C|NOVEL-C: 衝突]] #novel status::done assignee::boxp
- [x] [[Novels/NOVEL-M|NOVEL-M: 欠落]] #novel status::done assignee::boxp"
  write_note "${vault}" NOVEL-C done boxp "衝突" "${state}"
  write_note "${vault}" NOVEL-M done boxp "欠落" "${state}"
  printf '# 衝突\n' >"${state}/work/NOVEL-C/manuscript.md"
  stamp="$(TZ=Asia/Tokyo date +%Y-%m-%d-%H-%M)"
  mkdir -p "${vault}/小説草案/AI執筆"
  printf 'existing\n' >"${vault}/小説草案/AI執筆/${stamp}_衝突.md"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ "$(cat "${vault}/小説草案/AI執筆/${stamp}_衝突.md")" == "existing" ]] || fail "collision overwrote existing file"
  assert_contains "${vault}/Novels/NOVEL-C.md" "destination already exists and was not overwritten"
  assert_contains "${vault}/Novels/NOVEL-M.md" "manuscript is missing"
  assert_contains "${vault}/Boards/Novel Board.md" "status::done"
}

test_parallel_processes_do_not_overwrite_same_destination() {
  local tmp vault state bin dest checksum_a checksum_b pid_a pid_b published_count winner loser
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-PA|NOVEL-PA: 同時公開]] #novel status::done assignee::boxp
- [x] [[Novels/NOVEL-PB|NOVEL-PB: 同時公開]] #novel status::done assignee::boxp"
  write_note "${vault}" NOVEL-PA done boxp "同時公開" "${state}"
  write_note "${vault}" NOVEL-PB done boxp "同時公開" "${state}"
  head -c $((16 * 1024 * 1024)) /dev/zero | tr '\0' 'A' >"${state}/work/NOVEL-PA/manuscript.md"
  head -c $((16 * 1024 * 1024)) /dev/zero | tr '\0' 'B' >"${state}/work/NOVEL-PB/manuscript.md"
  checksum_a="$(sha256sum "${state}/work/NOVEL-PA/manuscript.md" | cut -d ' ' -f 1)"
  checksum_b="$(sha256sum "${state}/work/NOVEL-PB/manuscript.md" | cut -d ' ' -f 1)"
  dest="${vault}/小説草案/AI執筆/2026-07-11-12-37_同時公開.md"
  mkdir -p "${state}/published"
  printf '{:novel-id "NOVEL-PA", :path "%s", :sha256 "%s", :published-at "2026-07-11T03:37:00Z", :nsfw false, :status :reserved}\n' "${dest}" "${checksum_a}" >"${state}/published/NOVEL-PA.edn"
  printf '{:novel-id "NOVEL-PB", :path "%s", :sha256 "%s", :published-at "2026-07-11T03:37:00Z", :nsfw false, :status :reserved}\n' "${dest}" "${checksum_b}" >"${state}/published/NOVEL-PB.edn"

  run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/runner-a.log" 2>&1 &
  pid_a=$!
  run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/runner-b.log" 2>&1 &
  pid_b=$!
  wait "${pid_a}"
  wait "${pid_b}"

  published_count="$(grep -l ':status :published' "${state}/published/NOVEL-PA.edn" "${state}/published/NOVEL-PB.edn" | wc -l)"
  [[ "${published_count}" -eq 1 ]] || fail "same destination was published by ${published_count} cards"
  [[ "$(find "${state}/publication-locks" -maxdepth 1 -type f -name '*.edn' | wc -l)" -eq 1 ]] || fail "same destination did not share one persistent reservation"
  if grep -Fq ':status :published' "${state}/published/NOVEL-PA.edn"; then
    winner="NOVEL-PA"; loser="NOVEL-PB"
  else
    winner="NOVEL-PB"; loser="NOVEL-PA"
  fi
  cmp "${state}/work/${winner}/manuscript.md" "${dest}" || fail "published destination does not match its reservation owner"
  assert_contains "${state}/published/${loser}.edn" ":status :reserved"
  assert_not_contains "${vault}/Novels/${loser}.md" "published-path: \"${dest}\""
  assert_contains "${vault}/Novels/${loser}.md" "destination is reserved by another novel and was not overwritten"
}

test_publish_reservation_repairs_link() {
  local tmp vault state bin dest
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-P|NOVEL-P: 復旧]] #novel status::done assignee::boxp"
  write_note "${vault}" NOVEL-P done boxp "復旧" "${state}"
  printf '# 復旧\n' >"${state}/work/NOVEL-P/manuscript.md"
  dest="${vault}/小説草案/AI執筆/2026-07-11-12-34_復旧.md"
  mkdir -p "$(dirname "${dest}")" "${state}/published"
  printf '# 復旧\n' >"${dest}"
  printf '{:novel-id "NOVEL-P", :path "%s", :published-at "2026-07-11T03:34:00Z", :nsfw false, :status :reserved}\n' "${dest}" >"${state}/published/NOVEL-P.edn"

  run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Novels/NOVEL-P.md" "published-path: \"${dest}\""
  assert_contains "${vault}/Novels/NOVEL-P.md" "[[小説草案/AI執筆/2026-07-11-12-34_復旧]]"
  assert_contains "${state}/published/NOVEL-P.edn" ":status :published"
  [[ "$(find "${vault}/小説草案/AI執筆" -maxdepth 1 -type f | wc -l)" -eq 1 ]] || fail "reservation recovery duplicated publication"
}

test_interrupted_publish_recovers_partial_destination() {
  local tmp vault state bin dest manuscript checksum temp
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-I|NOVEL-I: 中断復旧]] #novel status::done assignee::boxp"
  write_note "${vault}" NOVEL-I done boxp "中断復旧" "${state}"
  manuscript="${state}/work/NOVEL-I/manuscript.md"
  printf '# 中断復旧\n\nこれは完全な完成原稿です。\n' >"${manuscript}"
  checksum="$(sha256sum "${manuscript}" | cut -d ' ' -f 1)"
  dest="${vault}/小説草案/AI執筆/2026-07-11-12-35_中断復旧.md"
  temp="$(dirname "${dest}")/.$(basename "${dest}").NOVEL-I.publishing"
  mkdir -p "$(dirname "${dest}")" "${state}/published"
  printf '# 中断' >"${dest}"
  printf '# 中' >"${temp}"
  printf '{:novel-id "NOVEL-I", :path "%s", :sha256 "%s", :published-at "2026-07-11T03:35:00Z", :nsfw false, :status :reserved}\n' "${dest}" "${checksum}" >"${state}/published/NOVEL-I.edn"

  run_tick "${vault}" "${state}" "${bin}" env
  cmp "${manuscript}" "${dest}" || fail "interrupted publication was not restored from the complete manuscript"
  [[ ! -e "${temp}" ]] || fail "publication staging file remained after recovery"
  assert_contains "${state}/published/NOVEL-I.edn" ":sha256 \"${checksum}\""
  assert_contains "${state}/published/NOVEL-I.edn" ":status :published"
  assert_contains "${vault}/Novels/NOVEL-I.md" "published-path: \"${dest}\""

  printf '# 公開後に破損' >"${dest}"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ "$(cat "${dest}")" == '# 公開後に破損' ]] || fail "completed publication checksum mismatch was overwritten"
  assert_contains "${vault}/Novels/NOVEL-I.md" "published file checksum differs from its completed state and was not overwritten"
}

test_reserved_completed_destination_rejects_changed_manuscript() {
  local tmp vault state bin dest manuscript reserved_checksum
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "" "" "- [x] [[Novels/NOVEL-RC|NOVEL-RC: 予約後変更]] #novel status::done assignee::boxp"
  write_note "${vault}" NOVEL-RC done boxp "予約後変更" "${state}"
  manuscript="${state}/work/NOVEL-RC/manuscript.md"
  dest="${vault}/小説草案/AI執筆/2026-07-11-12-36_予約後変更.md"
  mkdir -p "$(dirname "${dest}")" "${state}/published"
  printf '# 予約時の完成原稿\n' >"${dest}"
  reserved_checksum="$(sha256sum "${dest}" | cut -d ' ' -f 1)"
  printf '# 予約後に編集された原稿\n' >"${manuscript}"
  printf '{:novel-id "NOVEL-RC", :path "%s", :sha256 "%s", :published-at "2026-07-11T03:36:00Z", :nsfw false, :status :reserved}\n' "${dest}" "${reserved_checksum}" >"${state}/published/NOVEL-RC.edn"

  run_tick "${vault}" "${state}" "${bin}" env

  [[ "$(cat "${dest}")" == '# 予約時の完成原稿' ]] || fail "changed private manuscript overwrote the reserved completed destination"
  assert_contains "${state}/published/NOVEL-RC.edn" ":status :reserved"
  assert_not_contains "${vault}/Novels/NOVEL-RC.md" "published-path: \""
  assert_contains "${vault}/Novels/NOVEL-RC.md" "private manuscript changed after its publication path was reserved"
}

test_active_and_stale_lock() {
  local tmp vault state bin old
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "- [ ] [[Novels/NOVEL-L|NOVEL-L: Lock]] #novel status::in-progress assignee::codex"
  write_note "${vault}" NOVEL-L in-progress codex "Lock" "${state}"
  mkdir -p "${state}/locks"
  printf '{:novel-id "NOVEL-L", :run-id "active", :owner-id "other", :runner-instance-id "other", :heartbeat-at "%s"}\n' "$(date -u +%FT%TZ)" >"${state}/locks/NOVEL-L.edn"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ ! -d "${state}/runs/NOVEL-L" ]] || fail "fresh active lock allowed a second run"

  mkdir -p "${state}/terminating-owners"
  printf '{:owner-id "other", :runner-instance-id "other", :created-at "%s"}\n' "$(date -u +%FT%TZ)" >"${state}/terminating-owners/other.edn"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ -f "${state}/locks/NOVEL-L.edn" ]] || fail "planned shutdown marker recovered a fresh lock"
  [[ -f "${state}/terminating-owners/other.edn" ]] || fail "planned shutdown marker was removed while its lock remained active"
  [[ ! -d "${state}/runs/NOVEL-L" ]] || fail "planned shutdown marker allowed a second run before heartbeat became stale"

  old="$(date -u -d '10 seconds ago' +%FT%TZ)"
  printf '{:novel-id "NOVEL-L", :run-id "active", :owner-id "other", :runner-instance-id "other", :heartbeat-at "%s"}\n' "${old}" >"${state}/locks/NOVEL-L.edn"
  run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${state}/work/NOVEL-L/manuscript.md" "本文です"
  assert_contains "${vault}/Novels/NOVEL-L.md" "recovered after planned owner shutdown with stale heartbeat"
  assert_contains "${state}/runs/NOVEL-L/active/summary.edn" ":status :interrupted"
  [[ ! -f "${state}/terminating-owners/other.edn" ]] || fail "planned shutdown marker remained after its last lock was recovered"

  sed -i 's/status::review assignee::boxp/status::in-progress assignee::codex/' "${vault}/Boards/Novel Board.md"
  printf '{:novel-id "NOVEL-L", :run-id "stale", :owner-id "old", :runner-instance-id "old", :heartbeat-at "%s"}\n' "${old}" >"${state}/locks/NOVEL-L.edn"
  run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${state}/work/NOVEL-L/manuscript.md" "本文です"
  assert_contains "${vault}/Novels/NOVEL-L.md" "recovered after stale heartbeat"
  assert_contains "${state}/runs/NOVEL-L/stale/summary.edn" ":status :interrupted"
}

test_double_start_is_locked() {
  local tmp vault state bin starts first_pid i
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; starts="${tmp}/starts.log"
  make_fake_agents "${bin}"
  write_board "${vault}" "" "" "- [ ] [[Novels/NOVEL-D|NOVEL-D: Double]] #novel status::in-progress assignee::codex"
  write_note "${vault}" NOVEL-D in-progress codex "Double" "${state}"

  FAKE_START_LOG="${starts}" FAKE_SLEEP=2 run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/first.log" 2>&1 &
  first_pid=$!
  for i in $(seq 1 50); do
    [[ -f "${state}/locks/NOVEL-D.edn" ]] && break
    sleep 0.05
  done
  [[ -f "${state}/locks/NOVEL-D.edn" ]] || fail "first run did not acquire lock"
  FAKE_START_LOG="${starts}" run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/second.log" 2>&1
  wait "${first_pid}"

  [[ "$(wc -l <"${starts}")" -eq 1 ]] || fail "same card launched more than once"
  [[ "$(find "${state}/runs/NOVEL-D" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 1 ]] || fail "double start created duplicate run directories"
}

test_parallel_cards_preserve_board_updates() {
  local tmp vault state bin starts first_pid i
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"; starts="${tmp}/starts.log"
  make_fake_agents "${bin}"
  write_board "${vault}" $'- [ ] [[Novels/NOVEL-A|NOVEL-A: Alpha]] #novel status::backlog assignee::codex\n- [ ] [[Novels/NOVEL-B|NOVEL-B: Beta]] #novel status::backlog assignee::codex'

  FAKE_START_LOG="${starts}" FAKE_SLEEP=2 run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/first.log" 2>&1 &
  first_pid=$!
  for i in $(seq 1 50); do
    [[ -f "${state}/locks/NOVEL-A.edn" ]] && break
    sleep 0.05
  done
  [[ -f "${state}/locks/NOVEL-A.edn" ]] || fail "first parallel run did not acquire NOVEL-A"
  FAKE_START_LOG="${starts}" run_tick "${vault}" "${state}" "${bin}" env >"${tmp}/second.log" 2>&1
  wait "${first_pid}"

  [[ "$(wc -l <"${starts}")" -eq 2 ]] || fail "parallel ticks relaunched a completed card"
  [[ "$(grep -c 'status::draft assignee::boxp' "${vault}/Boards/Novel Board.md")" -eq 2 ]] || fail "parallel Board updates were lost"
  assert_contains "${vault}/Novels/NOVEL-A.md" 'status: "draft"'
  assert_contains "${vault}/Novels/NOVEL-B.md" 'status: "draft"'
}

test_yaml_safe_title() {
  local tmp vault state bin
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  write_board "${vault}" '- [ ] [[Novels/NOVEL-Y|NOVEL-Y: 第1章: はじまり #1 "引用"]] #novel status::backlog assignee::mystery'

  run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Novels/NOVEL-Y.md" 'title: "第1章: はじまり #1 \"引用\""'
  assert_contains "${vault}/Novels/NOVEL-Y.md" 'assignee: "mystery"'

  sed -i 's/ assignee::mystery//' "${vault}/Boards/Novel Board.md"
  run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Boards/Novel Board.md" 'assignee::mystery'

  sed -i "s/assignee: \"mystery\"/assignee: 'codex'/" "${vault}/Novels/NOVEL-Y.md"
  sed -i 's/ assignee::mystery//' "${vault}/Boards/Novel Board.md"
  run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Boards/Novel Board.md" 'status::draft assignee::boxp'
  assert_contains "${vault}/Novels/NOVEL-Y.md" 'status: "draft"'
}

test_task_board_and_cron_untouched() {
  local tmp vault state bin task_before cron_before
  tmp="$(mktemp -d)"; vault="${tmp}/vault"; state="${tmp}/state"; bin="${tmp}/bin"
  make_fake_agents "${bin}"
  mkdir -p "${vault}/Boards" "${vault}/Infrastructure/Codex Cron/prompts"
  printf '# Task Board\n\n## Backlog\n- existing\n' >"${vault}/Boards/Task Board.md"
  printf 'daily prompt\n' >"${vault}/Infrastructure/Codex Cron/prompts/daily.md"
  task_before="$(sha256sum "${vault}/Boards/Task Board.md" | cut -d' ' -f1)"
  cron_before="$(sha256sum "${vault}/Infrastructure/Codex Cron/prompts/daily.md" | cut -d' ' -f1)"
  write_board "${vault}"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ "$(sha256sum "${vault}/Boards/Task Board.md" | cut -d' ' -f1)" == "${task_before}" ]] || fail "Task Board changed"
  [[ "$(sha256sum "${vault}/Infrastructure/Codex Cron/prompts/daily.md" | cut -d' ' -f1)" == "${cron_before}" ]] || fail "daily cron changed"
}

test_seed_and_entrypoint
test_manual_title_scaffold
test_groom_and_human_stop
test_write_review_and_pi_revision
test_agent_timeout_returns_to_human_review
test_agent_timeout_falls_back_when_group_signal_fails
test_review_without_instructions_stops
test_human_lane_move_during_agent_is_preserved
test_fable_and_failure_return_to_review
test_explicit_approval_bypass
test_all_task_board_routes_and_unknown_skip
test_publish_routing_and_idempotency
test_publish_heartbeat_keeps_card_lock_fresh
test_untrusted_management_published_path_is_not_reused
test_collision_and_missing_manuscript_stay_done
test_parallel_processes_do_not_overwrite_same_destination
test_publish_reservation_repairs_link
test_interrupted_publish_recovers_partial_destination
test_reserved_completed_destination_rejects_changed_manuscript
test_active_and_stale_lock
test_double_start_is_locked
test_parallel_cards_preserve_board_updates
test_yaml_safe_title
test_task_board_and_cron_untouched

echo "All Novel Board runner tests passed."
