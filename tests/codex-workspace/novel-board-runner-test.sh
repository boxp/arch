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
  mkdir -p "${vault}/Boards" "${vault}/Novels"
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
  local tmp home vault
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
  assert_contains "${ROOT_DIR}/docker/codex-workspace/entrypoint.sh" "install_novel_board_seed"
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
  [[ ! -f "${state}/work/NOVEL-1/manuscript.md" ]] || fail "groom must not create manuscript"
  assert_contains "${prompt}" "Do not write any novel prose"

  local before
  before="$(find "${state}/runs/NOVEL-1" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  run_tick "${vault}" "${state}" "${bin}" env
  [[ "$(find "${state}/runs/NOVEL-1" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq "${before}" ]] || fail "Draft human review point started unexpectedly"
}

test_write_review_and_pi_revision() {
  local tmp vault state bin args
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

  sed -i 's/status::review assignee::boxp/status::review assignee::pi/' "${vault}/Boards/Novel Board.md"
  printf '\n- 余韻を追加する。\n' >>"${vault}/Novels/NOVEL-2.md"
  FAKE_ARG_LOG="${args}" run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${state}/work/NOVEL-2/manuscript.md" "Pi 改稿済み"
  assert_contains "${args}" "pi --print --approve --mode text --session-dir"
  assert_contains "${vault}/Boards/Novel Board.md" "status::review assignee::boxp"
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

  sed -i 's/status::review assignee::boxp/status::review assignee::codex-mini/' "${vault}/Boards/Novel Board.md"
  FAKE_EXIT=42 FAKE_ARG_LOG="${args}" run_tick "${vault}" "${state}" "${bin}" env
  assert_contains "${vault}/Boards/Novel Board.md" "status::review assignee::boxp"
  assert_contains "${vault}/Novels/NOVEL-3.md" "agent exited 42"
  assert_contains "${args}" "--model gpt-5.6-luna"
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
  assert_contains "${state}/work/NOVEL-L/manuscript.md" "本文です"
  assert_contains "${vault}/Novels/NOVEL-L.md" "recovered after planned owner shutdown"
  assert_contains "${state}/runs/NOVEL-L/active/summary.edn" ":status :interrupted"

  sed -i 's/status::review assignee::boxp/status::in-progress assignee::codex/' "${vault}/Boards/Novel Board.md"
  old="$(date -u -d '10 seconds ago' +%FT%TZ)"
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
test_groom_and_human_stop
test_write_review_and_pi_revision
test_human_lane_move_during_agent_is_preserved
test_fable_and_failure_return_to_review
test_all_task_board_routes_and_unknown_skip
test_publish_routing_and_idempotency
test_collision_and_missing_manuscript_stay_done
test_publish_reservation_repairs_link
test_active_and_stale_lock
test_double_start_is_locked
test_parallel_cards_preserve_board_updates
test_yaml_safe_title
test_task_board_and_cron_untouched

echo "All Novel Board runner tests passed."
