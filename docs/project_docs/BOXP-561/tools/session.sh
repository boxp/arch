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
# close 前に中断しても restore が期限切れ扱いにならないよう、仮の期限を置く
deadline=$(($(date +%s) + 90 * 60))
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
    # 復帰確認も閉鎖期限内に収める（ops.sh restore は BOXP561_DEADLINE を超えて待たない）
    if BOXP561_DEADLINE=$deadline "$here/ops.sh" restore "$tok" $PORT >>"$L" 2>&1; then
      "$here/deadman.sh" disarm >>"$L" 2>&1 || true
    else
      log "RESTORE FAILED: 手動確認が必要 (dead-man は残す)"
      ((rc != 0)) || rc=4
    fi
    "$here/tunnel.sh" down $PORT >>"$L" 2>&1 || true
  fi
  if ! "$here/guard.sh" verify "$S/guard.edn" >>"$L" 2>&1; then
    log "GUARD MISMATCH: 本番 vault に評価外の変更、次の区間に進まず確認すること"
    ((rc != 0)) || rc=3
  fi
  log "session end"
  exit $rc
}
"$here/ops.sh" preflight >>"$L" 2>&1 || {
  log "preflight NG"
  exit 1
}
"$here/guard.sh" snapshot "$S/guard.edn" >>"$L" 2>&1
trap cleanup EXIT INT TERM
# gate が実際に自分の token で閉じた場合だけ cleanup で restore する。
# close が gate 変更前に失敗した(他の利用者の状態が残る)場合は開け戻さない。
# 閉鎖期限は close 開始前から数える（503 反映待ちも 90 分に含める）
deadline=$(($(date +%s) + 90 * 60))
close_rc=0
"$here/ops.sh" close "$tok" >>"$L" 2>&1 || close_rc=$?
g=$("$here/ops.sh" gate 2>>"$L" || echo unknown)
if [[ $g == "closed:BOXP-561-$tok" ]]; then
  closed=1
elif [[ $g == unknown ]]; then
  log "gate 状態を取得できない: 自動 restore はしない、手動確認が必要"
fi
((close_rc == 0)) || {
  log "close NG rc=$close_rc gate=$g"
  exit 1
}
# dead-man: ops.sh close が gate 変更直後に張る。ここで張り直す。workspace ごと止まって cleanup が走らなくても、node 側で最長 10 分後に gate を開け戻す（5 分ごとに延長、閉鎖期限を超えない）
"$here/deadman.sh" arm "$tok" 600 >>"$L" 2>&1
(while sleep 300; do
  s=$((deadline - $(date +%s)))
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
  sleep $((deadline - 180 - $(date +%s))) # restore の確認時間を期限内に残す
  echo "$(date -u +%FT%TZ) closure deadline" >>"$BOXP561_OBS_DIR/ABORT"
) &
wd=$!
# ready 待ち（600 秒）: 1 token 要求でモデルを読み込ませる
t0=$(date +%s)
# 読み込み中も ABORT（MemAvailable 低下・GPU HANG・閉鎖期限）を 5 秒ごとに確認し、検出したら要求を止める
rm -f "$S/load.json"
curl -s -m 600 -o "$S/load.json" http://127.0.0.1:$PORT/v1/chat/completions -H content-type:application/json -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}],\"max_tokens\":1}" &
lp=$!
while kill -0 $lp 2>/dev/null; do
  if [[ -e $BOXP561_OBS_DIR/ABORT ]]; then
    kill $lp 2>/dev/null || true
    log "load 中に ABORT 検出、試験を開始しない: $(tr '\n' ' ' <"$BOXP561_OBS_DIR/ABORT")"
    exit 1
  fi
  sleep 5
done
wait $lp || true
r=$(jq -r '.model // empty' "$S/load.json" 2>/dev/null || true)
log "load $model -> ${r:-NG $(jq -r '.error.message // empty' "$S/load.json" 2>/dev/null | head -c 200)} in $(($(date +%s) - t0))s"
# 応答の model が要求したモデルと一致した時だけ成功（error.message 等は失敗）
[[ $r == "$model" ]] || exit 1
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
      # runner の結果処理を当て、受入へ回る結果かつ固定検証合格の時だけ scratch 票を Done へ動かす
      bb "$here/t1_finish.bb" "$S/$st" >>"$L" 2>&1 || log "$st finish rc=$?"
      ;;
    *) log "unknown step $st" ;;
  esac
  log "step $st end"
done
