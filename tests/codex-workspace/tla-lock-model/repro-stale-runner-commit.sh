#!/usr/bin/env bash
# BOXP-732: TLC の反例 (impl-commit: CommitOnlyByHolder) を実装で再現する観察用スクリプト。
# CI の case には入れない (現状の挙動を「正しい」と固定しないため)。
#
# 手順: 一時ディレクトリの vault/root で runner の tick を 1 回動かす。偽の codex が
# 作業している間に、lock ファイルを (ticket guard を取ったうえで) 別 owner の新しい lock に
# 置き換える (= 旧 Runner が止まっている間に期限切れになり、Runner B が取り直した状態)。
# その後の旧 Runner の終了処理を見る。
#   observed: unfenced  旧 Runner が所有を失ったまま lane/Notes/summary を書いた (TLC の反例どおり)
#   observed: fenced    旧 Runner は所有喪失を見て終了処理をしなかった (カードは In Progress のまま)
#   inconclusive        runner が失敗した・どちらとも言えない (終了コード 1)
# 本物の root・vault・lock には触れない。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb"
for v in $(env | sed -n 's/^\(CODEX_TASK_BOARD_TEST_[A-Z_]*\)=.*/\1/p'); do
  echo "refusing to run with ${v} set" >&2
  exit 2
done

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
vault="${tmp}/vault"
state="${tmp}/state"
bin="${tmp}/bin"
mkdir -p "${vault}/Boards" "${vault}/Tickets" "${bin}" "${state}"

cat >"${vault}/Boards/Task Board.md" <<'MD'
# Task Board

## Backlog

## Ready

## In Progress
- [ ] [[Tickets/BOXP-9001|BOXP-9001: stale runner]] #ticket status::in-progress

## Blocked

## Done
MD
cat >"${vault}/Tickets/BOXP-9001.md" <<'MD'
---
id: BOXP-9001
type: task
status: in-progress
priority: medium
assignee: codex
repo:
closed:
---

# BOXP-9001: stale runner

## Summary

Repro.

## Acceptance Criteria

- [ ] Done

## Notes
MD

# 偽の codex: 作業中に「Runner B の取り直し」が起きるのを待ってから done を返す。
cat >"${bin}/codex" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
last=""
while [[ $# -gt 0 ]]; do
  case "$1" in --output-last-message) last="$2"; shift 2 ;; *) shift ;; esac
done
cat >/dev/null
: >"${REPRO_AGENT_STARTED}"
for _ in $(seq 1 100); do [[ -e "${REPRO_TAKEOVER_DONE}" ]] && break; sleep 0.1; done
mkdir -p "$(dirname "${last}")"
printf '%s\n' 'TASK_BOARD_RESULT: done' >"${last}"
SH
chmod +x "${bin}/codex"

started="${tmp}/agent-started"
takeover="${tmp}/takeover-done"
PATH="${bin}:$PATH" \
  REPRO_AGENT_STARTED="${started}" REPRO_TAKEOVER_DONE="${takeover}" \
  CODEX_TASK_BOARD_VAULT="${vault}" CODEX_TASK_BOARD_ROOT="${state}" \
  CODEX_TASK_BOARD_OWNER_ID=runner-a CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=runner-a-1 \
  bb "${RUNNER}" tick >"${tmp}/tick.out" 2>&1 &
tick_pid=$!

for _ in $(seq 1 300); do
  [[ -e "${started}" ]] && break
  sleep 0.1
done
[[ -e "${started}" ]] || {
  cat "${tmp}/tick.out" >&2
  echo "agent did not start" >&2
  exit 1
}
lock="${state}/locks/BOXP-9001.edn"
[[ -e "${lock}" ]] || {
  echo "runner A did not create the lock" >&2
  exit 1
}

# Runner B の取り直し: 実装と同じ ticket guard (FileLock) を取ってから lock を書き換える。
b_lock="{:ticket \"BOXP-9001\" :run-id \"runner-b-run\" :action :implement :lane \"In Progress\" :owner-id \"runner-b\" :owner-instance-id \"runner-b-1\" :heartbeat-at \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
bb -e '
  (let [[guard lock content] *command-line-args*
        f (java.io.File. guard)]
    (.mkdirs (.getParentFile f))
    (with-open [raf (java.io.RandomAccessFile. f "rw") ch (.getChannel raf)]
      (let [_l (.lock ch)] (spit lock (str content "\n")))))' \
  "${state}/lock-guards/BOXP-9001.lock" "${lock}" "${b_lock}"
: >"${takeover}"

tick_rc=0
wait "${tick_pid}" || tick_rc=$?
if [[ "${tick_rc}" -ne 0 ]]; then
  cat "${tmp}/tick.out" >&2
  echo "inconclusive: runner tick exited with ${tick_rc}" >&2
  exit 1
fi

summary="$(find "${state}/runs/BOXP-9001" -name summary.edn -print -quit)"
echo "--- lock after tick"
cat "${lock}" 2>/dev/null || echo "(none)"
echo "--- runner A summary"
grep -o ':status [^ ]*\|:result "[^"]*"' "${summary}" || true
echo "--- board line"
grep 'BOXP-9001' "${vault}/Boards/Task Board.md"
echo "--- ticket status"
grep '^status:' "${vault}/Tickets/BOXP-9001.md"
echo "--- Notes (runner A)"
sed -n '/^## Notes/,$p' "${vault}/Tickets/BOXP-9001.md" | tail -n +2
echo "--- runner log (lock)"
grep -i 'lock' "${tmp}/tick.out" || true

b_kept=false
a_committed=false
a_held=false
grep -q "runner-b" "${lock}" 2>/dev/null && b_kept=true
if [[ -n "${summary}" ]] && grep -q ":status :succeeded" "${summary}" &&
  ! grep -q "status::in-progress" "${vault}/Boards/Task Board.md"; then
  a_committed=true
fi
if grep -q "status::in-progress" "${vault}/Boards/Task Board.md" &&
  grep -q "^status: in-progress$" "${vault}/Tickets/BOXP-9001.md"; then
  a_held=true
fi
if ${b_kept} && ${a_committed}; then
  echo "observed: unfenced"
elif ${b_kept} && ${a_held}; then
  echo "observed: fenced"
else
  echo "inconclusive: lock_b=${b_kept} a_committed=${a_committed} a_held=${a_held}" >&2
  exit 1
fi
