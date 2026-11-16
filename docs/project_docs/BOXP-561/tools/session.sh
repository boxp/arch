#!/usr/bin/env bash
# BOXP-561 GPU 区間の runbook。1 区間 = 1 モデル。閉鎖は 90 分以内。
# usage: session.sh MODEL TOKEN PLAN    PLAN は "n1,n1s,n2,t1a,t1b" のようなカンマ区切り
# 途中のエラー・INT・TERM でも tunnel down → restore → guard verify を必ず通る。
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=docs/project_docs/BOXP-561/tools/common.sh
source "$here/common.sh"
require_tmp
model=${1:-} tok=${2:-} plan=${3:-}
PORT=18561
[[ $model =~ ^(qwen3-coder-next|qwen38-flash-next|qwen38-27b)$ && $tok =~ ^[A-Za-z0-9-]+$ && -n $plan ]] || {
  echo "usage: session.sh MODEL TOKEN PLAN" >&2
  exit 2
}
S=$BOXP561_TMP/sess-$tok
mkdir -p "$S"
L=$S/session.log
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$L"; }
export BOXP561_OBS_DIR=$S/obs
closed=0
deadline=0
cleanup() {
  rc=$?
  trap - EXIT INT TERM
  log "cleanup rc=$rc"
  [[ -n ${wd:-} ]] && kill "$wd" 2>/dev/null || true
  [[ -n ${hb:-} ]] && kill "$hb" 2>/dev/null || true
  "$here/obs.sh" stop "$BOXP561_OBS_DIR" >>"$L" 2>&1 || true
  "$here/tunnel.sh" down $PORT >>"$L" 2>&1 || true
  if ((closed)); then
    "$here/tunnel.sh" up $PORT >>"$L" 2>&1 || true
    if "$here/ops.sh" restore "$tok" $PORT >>"$L" 2>&1; then
      "$here/deadman.sh" disarm >>"$L" 2>&1 || true
    else
      log "RESTORE FAILED: 手動確認が必要 (dead-man は残す)"
    fi
    "$here/tunnel.sh" down $PORT >>"$L" 2>&1 || true
  fi
  "$here/guard.sh" verify "$S/guard.edn" >>"$L" 2>&1 || log "GUARD MISMATCH"
  log "session end"
  exit $rc
}
"$here/ops.sh" preflight >>"$L" 2>&1 || {
  log "preflight NG"
  exit 1
}
"$here/guard.sh" snapshot "$S/guard.edn" >>"$L" 2>&1
trap cleanup EXIT INT TERM
"$here/ops.sh" close "$tok" >>"$L" 2>&1
closed=1
deadline=$(($(date +%s) + 90 * 60))
# dead-man: workspace ごと止まって cleanup が走らなくても、node 側で最長 10 分後に gate を開け戻す（5 分ごとに延長、閉鎖上限を超えない）
"$here/deadman.sh" arm "$tok" 600 >>"$L" 2>&1
(while sleep 300; do
  s=$((deadline + 300 - $(date +%s)))
  ((s > 600)) && s=600
  ((s > 0)) || break
  "$here/deadman.sh" arm "$tok" $s >>"$L" 2>&1 || true
done) &
hb=$!
# Keep each command's log redirection separate.
# shellcheck disable=SC2129
"$here/ops.sh" drain >>"$L" 2>&1
"$here/tunnel.sh" up $PORT >>"$L" 2>&1
"$here/obs.sh" start "$BOXP561_OBS_DIR" >>"$L" 2>&1
# 閉鎖 90 分の上限: 期限で ABORT を作り、実行中の run を止める
(
  sleep $((deadline - $(date +%s)))
  echo "$(date -u +%FT%TZ) closure deadline" >>"$BOXP561_OBS_DIR/ABORT"
) &
wd=$!
# ready 待ち（600 秒）: 1 token 要求でモデルを読み込ませる
t0=$(date +%s)
r=$(curl -s -m 600 http://127.0.0.1:$PORT/v1/chat/completions -H content-type:application/json -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}],\"max_tokens\":1}" | jq -r '.model // .error.message // "ERR"')
log "load $model -> $r in $(($(date +%s) - t0))s"
[[ $r != ERR ]]
IFS=, read -ra steps <<<"$plan"
for st in "${steps[@]}"; do
  left=$((deadline - $(date +%s)))
  [[ -e $BOXP561_OBS_DIR/ABORT ]] && {
    log "ABORT 検出、残りを中止"
    break
  }
  ((left > 300)) || {
    log "閉鎖残り ${left}s のため $st 以降を中止"
    break
  }
  log "step $st start (closure left ${left}s)"
  case $st in
    n1)
      "$here/novel_prepare.bb" synth "$S/n1-root" >>"$L"
      "$here/novel_run.sh" "$model" "$S/n1-root" "$S/n1-out" $PORT >>"$L" 2>&1 || log "n1 rc=$?"
      ;;
    n1s)
      "$here/novel_prepare.bb" synth "$S/n1s-root" >>"$L"
      "$here/novel_singleshot.bb" "$model" "$S/n1s-root" "$S/n1s-out" $PORT >>"$L" 2>&1 || log "n1s rc=$?"
      ;;
    n2)
      "$here/novel_prepare.bb" real "$S/n2-root" >>"$L"
      "$here/novel_run.sh" "$model" "$S/n2-root" "$S/n2-out" $PORT >>"$L" 2>&1 || log "n2 rc=$?"
      ;;
    t1*)
      "$here/t1_run.sh" "$model" "$S/$st" $PORT >>"$L" 2>&1 || log "$st rc=$?"
      "$here/t1_verify.sh" "$S/$st/out/patch.diff" >"$S/$st/out/verify.json" 2>>"$L" || true
      log "$st verify $(cat "$S/$st/out/verify.json")"
      ;;
    *) log "unknown step $st" ;;
  esac
  log "step $st end"
done
