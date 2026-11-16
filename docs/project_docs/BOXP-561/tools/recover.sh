#!/usr/bin/env bash
# BOXP-561: workspace 停止などで session.sh の cleanup が中断したときの復旧。各 run の開始時に必ず実行する。
# gate が closed:BOXP-561-* のままなら tunnel 経由で restore し、残った tunnel/relay を片付け、guard verify を行う。
# usage: recover.sh [GUARD_EDN]
set -uo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=docs/project_docs/BOXP-561/tools/common.sh
source "$here/common.sh"
require_tmp
PORT=18561
L=$BOXP561_TMP/recover.log
g=$(kubectl -n local-llm get cm llama-server-admission -o jsonpath='{.data.state}')
echo "$(date -u +%FT%TZ) gate=$g" | tee -a "$L"
"$here/tunnel.sh" down $PORT >>"$L" 2>&1
if [[ $g =~ ^closed:BOXP-561-([A-Za-z0-9-]+)$ ]]; then
  tok=${BASH_REMATCH[1]}
  "$here/tunnel.sh" up $PORT >>"$L" 2>&1 </dev/null
  "$here/ops.sh" restore "$tok" $PORT >>"$L" 2>&1
  rc=$?
  "$here/tunnel.sh" down $PORT >>"$L" 2>&1
  tail -3 "$L"
  ((rc == 0)) || {
    echo "RESTORE FAILED: 手動確認が必要" | tee -a "$L"
    exit 1
  }
fi
# 中断で残った T1 の scratch worktree/branch を片付ける
git -C "$here" worktree prune
for b in $(git -C "$here" branch --list "eval561-t1-*" --format="%(refname:short)"); do
  wt=$(git -C "$here" worktree list --porcelain | awk -v b="refs/heads/$b" "/^worktree /{w=\$2} \$0==\"branch \"b{print w}")
  [[ -n $wt ]] && git -C "$here" worktree remove --force "$wt"
  git -C "$here" branch -D "$b" >>"$L" 2>&1
done
# gate が閉じていなければ残った dead-man も止める（発火しても条件付き PATCH で 422 になるだけだが片付ける）
[[ $(kubectl -n local-llm get cm llama-server-admission -o jsonpath="{.data.state}") == open:* ]] && { "$here/deadman.sh" disarm >>"$L" 2>&1 || true; }
if [[ -n ${1:-} ]]; then
  "$here/guard.sh" verify "$1" >"$BOXP561_TMP/recover-guard.out" 2>&1
  grc=$?
  tail -1 "$BOXP561_TMP/recover-guard.out" | tee -a "$L"
  ((grc == 0)) || {
    echo "GUARD MISMATCH: 保護対象の変更を検出、次の run を止める" | tee -a "$L"
    exit 1
  }
fi
exit 0
