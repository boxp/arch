#!/usr/bin/env bash
# BOXP-561 長時間評価（TD-02）: 固定の時間上限で打ち切らず、pi の session を保存して中断後に --continue で再開する。
# 1 job = 1 モデル x 1 課題（n1 合成小説 / n2 実バース小説 / t1 Task Board）。job の状態は $BOXP561_TMP/long-MODEL-KIND/ に残る。
# usage: long_run.sh MODEL KIND PORT   (BOXP561_TMP と BOXP561_OBS_DIR が必要。session.sh の L:KIND から呼ぶ)
#        long_run.sh MODEL KIND finalize  最後の segment の meta.json から状態判定と後段判定だけをやり直す（GPU 不要）
# 1 回の呼び出し = 1 segment。終わり方:
#   exit   pi が自分で終了した → job 完了（成果の有無・品質は後段の check/verify で判定）
#   abort  ABORT（閉鎖期限・メモリ・GPU 異常）や workspace 停止 → 未完のまま次の区間で再開
#   nonconvergent  実行中に下記の反復閾値を超えた → 止めて nonconvergent
#   idle   events.jsonl が BOXP561_IDLE_SEC（既定 1800 秒）伸びない → 停止。2 回で stalled（進捗のない停止）
# job 全体の tool 呼び出しが 600 を超えるか、同じ tool 呼び出し（名前+引数）が 15 回を超えたら nonconvergent（反復）として止める。
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=docs/project_docs/BOXP-561/tools/common.sh
source "$here/common.sh"
require_tmp
BASE=d95b7cdc1209b5bc8d79f170fe656b2cda468628
ARCH=$(git -C "$here" rev-parse --show-toplevel)
model=${1:-} kind=${2:-} port=${3:-}
[[ $model =~ ^(qwen3-coder-next|qwen38-flash-next|qwen38-27b)$ && $kind =~ ^(n1|n2|t1)$ && $port =~ ^([0-9]+|finalize)$ ]] || {
  echo "usage: long_run.sh MODEL n1|n2|t1 PORT|finalize" >&2
  exit 2
}
IDLE=${BOXP561_IDLE_SEC:-1800}
J=$BOXP561_TMP/long-$model-$kind
log() { echo "$(date -u +%FT%TZ) [$model/$kind] $*" | tee -a "$J/job.log"; }
# 状態判定と後段判定。segment の meta.json だけを見るので、finalize からも同じ処理になる
finalize() {
  local seg=$1 reason code wall jtools rep idles new
  reason=$(jq -r .end "$seg/meta.json")
  code=$(jq -r '."exit-code"' "$seg/meta.json")
  wall=$(jq -r '."wall-seconds"' "$seg/meta.json")
  jtools=$(jq '."job-tool-calls"' "$seg/meta.json")
  rep=$(jq '."max-repeat"' "$seg/meta.json")
  idles=$(cat "$J"/seg-*/meta.json | jq -s 'map(select(.end == "idle")) | length')
  # 閾値超過は exit 0 でも completed にしない（反復の末に終わった run を完了扱いにしない）
  if [[ $reason == nonconvergent ]] || ((jtools > 600 || rep > 15)); then
    new=nonconvergent
  elif [[ $reason == exit && $code == 0 ]]; then
    new=completed
  elif ((idles >= 2)); then
    new=stalled
  else
    new=running
  fi
  echo "$new" >"$J/state"
  log "segment $(basename "$seg") end=$reason rc=$code wall=${wall}s -> state=$new"
  [[ $new == running ]] && return 0
  # 終了した job の後段判定（成果の有無と品質の機械判定。本文は出さない）
  case $kind in
    n1 | n2)
      "$here/novel_check.bb" "$J/root" >"$J/check.json"
      log "check saved"
      ;;
    t1)
      {
        git -C "$J/arch" diff --binary "$BASE"
        git -C "$J/arch" ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
          drc=0
          (cd "$J/arch" && git diff --no-index --binary -- /dev/null "$f") || drc=$?
          ((drc <= 1)) || exit 1
        done
      } >"$J/out/patch.diff"
      "$here/t1_verify.sh" "$J/out/patch.diff" >"$J/out/verify.json" 2>>"$J/job.log" || true
      log "verify $(cat "$J/out/verify.json")"
      # t1_finish.bb は最後の assistant message の marker を見る。全 segment の events を連結して渡す
      cat "$J"/seg-*/events.jsonl >"$J/out/events.jsonl"
      cat "$J"/seg-*/meta.json | jq -s --arg m "$model" --argjson c "$code" '{model:$m, "exit-code":$c, "wall-seconds":(map(."wall-seconds")|add)}' >"$J/out/meta.json"
      bb "$here/t1_finish.bb" "$J" >>"$J/job.log" 2>&1 || log "finish rc=$?"
      ;;
  esac
}
if [[ $port == finalize ]]; then
  last=$(find "$J" -maxdepth 1 -name 'seg-*' -type d | sort | tail -1)
  [[ -f $last/meta.json ]] || {
    echo "no segment meta in $J" >&2
    exit 1
  }
  finalize "$last"
  exit 0
fi
obs=${BOXP561_OBS_DIR:?BOXP561_OBS_DIR required}
[[ -d $obs && ! -e $obs/ABORT ]] || {
  echo "observer missing or aborted" >&2
  exit 1
}
st=$(cat "$J/state" 2>/dev/null || echo new)
case $st in
  completed | stalled | nonconvergent)
    echo "job $model/$kind already $st"
    exit 0
    ;;
esac
home=$J/home
if [[ $st == new ]]; then
  mkdir -p "$J" "$home/.pi/agent" "$J/pi-sessions"
  case $kind in
    n1) "$here/novel_prepare.bb" synth "$J/root" ;;
    n2) "$here/novel_prepare.bb" real "$J/root" ;;
    t1)
      mkdir -p "$J/vault/Tickets" "$J/vault/Boards" "$J/runner-root" "$J/out"
      cp "$here/fixtures/EVAL561-T1.md" "$J/vault/Tickets/EVAL561-T1.md"
      printf '## In Progress\n\n- [ ] [[Tickets/EVAL561-T1|EVAL561-T1: eval]] #ticket status::in-progress priority::medium repo::boxp/arch assignee::localllm-coder\n\n## Done\n' >"$J/vault/Boards/Task Board.md"
      git -C "$ARCH" worktree prune
      git -C "$ARCH" worktree add -q -b "eval561-long-$model" "$J/arch" "$BASE"
      CODEX_TASK_BOARD_VAULT=$J/vault CODEX_TASK_BOARD_ROOT=$J/runner-root bb "$here/t1_prompt.bb" EVAL561-T1 "$J" "$J/arch" "$J/out/prompt.md" >/dev/null
      ;;
  esac
  bb "$here/pi_models.bb" "$port" "$home/.pi/agent/models.json"
  printf '{"defaultProvider":"llama.cpp","defaultModel":"%s"}' "$model" >"$home/.pi/agent/settings.json"
  printf '{}' >"$home/.pi/agent/auth.json"
  echo running >"$J/state"
  log "job created"
else
  # tunnel の port は区間ごとに同じだが、念のため毎回作り直す
  bb "$here/pi_models.bb" "$port" "$home/.pi/agent/models.json"
fi
if [[ $kind == t1 ]]; then cwd=$J/arch prompt=$J/out/prompt.md; else cwd=$J/root prompt=$J/root/prompt.md; fi
n=$(find "$J" -maxdepth 1 -name 'seg-*' -type d | wc -l)
seg=$J/$(printf 'seg-%03d' $((n + 1)))
mkdir -p "$seg"
if compgen -G "$J/pi-sessions/*.jsonl" >/dev/null; then
  # 再開: session を引き継ぎ、中断の事実だけを伝える（指示の追加・ヒントは与えない）
  printf '（評価ハーネスより）前回の実行は外部要因（評価環境の停止）で中断されました。これまでの作業内容はそのまま残っています。最初の指示に従って作業を続け、完了させてください。\n' >"$seg/input.md"
  cont=(--continue)
else
  cp "$prompt" "$seg/input.md"
  cont=()
fi
envargs=("HOME=$home" PI_OFFLINE=1 "CODEX_HOME=$home/.codex" "CLAUDE_CONFIG_DIR=$home/.claude")
for key in PATH LANG LC_ALL LC_CTYPE TERM TZ USER LOGNAME SHELL TMPDIR; do [[ ! -v $key ]] || envargs+=("$key=${!key}"); done
log "segment $(basename "$seg") start resume=${#cont[@]}"
s0=$(date +%s)
(
  cd "$cwd"
  exec env -i "${envargs[@]}" setsid pi -p --mode json --provider llama.cpp --model "$model" --session-dir "$J/pi-sessions" "${cont[@]}" --no-extensions -e "$here/vaultguard.ts" --no-skills --no-mcp --no-prompt-templates --thinking off <"$seg/input.md" >"$seg/events.jsonl" 2>"$seg/stderr.log"
) &
pid=$!
reason='exit'
last=$s0
lsize=0
tick=0
# 実行中の反復検出: job 全体（全 segment）の tool 呼び出し数と同一呼び出し（名前+引数）の最大回数を約 60 秒ごとに数える
loopcheck() {
  local sigs total top
  sigs=$(cat "$J"/seg-*/events.jsonl 2>/dev/null | jq -R -c 'fromjson? | select(.type == "tool_execution_start") | [.toolName, .args]' 2>/dev/null || true)
  [[ -n $sigs ]] || return 1
  total=$(wc -l <<<"$sigs")
  top=$(sort <<<"$sigs" | uniq -c | sort -rn | awk 'NR == 1 {print $1}')
  ((total > 600 || top > 15)) || return 1
  log "nonconvergent during run: tool-calls=$total max-repeat=$top"
}
while kill -0 "$pid" 2>/dev/null; do
  tick=$((tick + 1))
  if ((tick % 12 == 0)) && loopcheck; then
    reason=nonconvergent
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || :
    break
  fi
  if [[ -e $obs/ABORT ]]; then
    reason=abort
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || :
    break
  fi
  sz=$(stat -c %s "$seg/events.jsonl" 2>/dev/null || echo 0)
  if ((sz != lsize)); then
    lsize=$sz
    last=$(date +%s)
  elif (($(date +%s) - last > IDLE)); then
    # 再開直後の長い prompt 再処理は events を出さない。llama-server の slot が処理中なら idle にしない
    if [[ $(curl -s -m 10 "http://127.0.0.1:$port/slots?model=$model" | jq -r '.[0].is_processing' 2>/dev/null) == true ]]; then
      last=$(date +%s)
      continue
    fi
    reason=idle
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || :
    break
  fi
  sleep 5
done
set +e
wait "$pid"
code=$?
set -e
wall=$(($(date +%s) - s0))
# job 全体の集計（全 segment の events）と反復の検出
bb -e '(require (quote [cheshire.core :as j]) (quote [clojure.string :as s]) (quote [babashka.fs :as fs]))
 (let [[jdir seg reason code wall] *command-line-args*
       segs (sort (map str (fs/glob jdir "seg-*/events.jsonl")))
       evs (fn [f] (keep #(try (j/parse-string % true) (catch Exception _ nil)) (s/split-lines (slurp f))))
       all (mapcat evs segs) mine (evs (str seg "/events.jsonl"))
       tools (fn [es] (filter #(= "tool_execution_start" (:type %)) es))
       turns (fn [es] (filter #(and (= "message_end" (:type %)) (= "assistant" (get-in % [:message :role]))) es))
       sig (frequencies (map #(str (:toolName %) " " (j/generate-string (:args %))) (tools all)))
       [top topn] (first (sort-by (comp - val) sig))
       m {:segment (fs/file-name seg) :end reason :exit-code (parse-long code) :wall-seconds (parse-long wall)
          :tool-calls (count (tools mine)) :assistant-turns (count (turns mine))
          :models-seen (vec (distinct (keep #(get-in % [:message :model]) (turns mine))))
          :job-segments (count segs) :job-tool-calls (count (tools all))
          :job-tool-counts (frequencies (map :toolName (tools all)))
          :max-repeat (or topn 0) :max-repeat-call (some-> top (subs 0 (min 200 (count top))))}]
   (spit (str seg "/meta.json") (j/generate-string m {:pretty true}))
   (println (j/generate-string (dissoc m :max-repeat-call))))' "$J" "$seg" "$reason" "$code" "$wall" | tee -a "$J/job.log"
finalize "$seg"
