#!/usr/bin/env bash
# BOXP-561 T1: scratch vault + 固定 base の arch worktree で、runner の localllm-coder と同じ prompt/pi 引数/env で 1 回実行する。
# usage: t1_run.sh MODEL RUNDIR PORT   (BOXP561_TMP と BOXP561_OBS_DIR が必要)
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P); source "$here/common.sh"; require_tmp
BASE=d95b7cdc1209b5bc8d79f170fe656b2cda468628   # origin/main 2026-11-16、BOXP-382 の不具合が残っていることを確認済み
ARCH=$(git -C "$here" rev-parse --show-toplevel)   # この run の arch worktree（run ごとに変わるので固定しない）
model=${1:-} run=${2:-} port=${3:-}
[[ $model =~ ^(qwen3-coder-next|qwen38-flash-next|qwen38-27b)$ && $port =~ ^[0-9]+$ && -n $run ]] && under_tmp "$run" && [[ ! -e $run ]] || { echo "usage: t1_run.sh MODEL NEW_RUNDIR PORT" >&2; exit 2; }
obs=${BOXP561_OBS_DIR:?BOXP561_OBS_DIR required}; [[ -d $obs && ! -e $obs/ABORT ]] || { echo "observer missing or aborted" >&2; exit 1; }
mkdir -p "$run/vault/Tickets" "$run/vault/Boards" "$run/root" "$run/out/coder-home/.pi/agent"; run=$(realpath -e "$run")
cp "$here/fixtures/EVAL561-T1.md" "$run/vault/Tickets/EVAL561-T1.md"
printf '## In Progress\n\n- [ ] [[Tickets/EVAL561-T1|EVAL561-T1: eval]] #ticket status::in-progress priority::medium repo::boxp/arch assignee::localllm-coder\n' > "$run/vault/Boards/Task Board.md"
br="eval561-t1-$(basename "$(dirname "$run")")-$(basename "$run")"; git -C "$ARCH" worktree prune; git -C "$ARCH" worktree add -q -b "$br" "$run/arch" "$BASE"
CODEX_TASK_BOARD_VAULT=$run/vault CODEX_TASK_BOARD_ROOT=$run/root bb "$here/t1_prompt.bb" EVAL561-T1 "$run" "$run/arch" "$run/out/prompt.md" >/dev/null
home=$run/out/coder-home
bb "$here/pi_models.bb" "$port" "$home/.pi/agent/models.json"
printf '{"defaultProvider":"llama.cpp","defaultModel":"%s"}' "$model" > "$home/.pi/agent/settings.json"; printf '{}' > "$home/.pi/agent/auth.json"
envargs=("HOME=$home" PI_OFFLINE=1 "CODEX_HOME=$home/.codex" "CLAUDE_CONFIG_DIR=$home/.claude")
for key in PATH LANG LC_ALL LC_CTYPE TERM TZ USER LOGNAME SHELL TMPDIR; do [[ ! -v $key ]] || envargs+=("$key=${!key}"); done
start=$(date -u +%FT%TZ); s0=$(date +%s)
(cd "$run/arch"; exec env -i "${envargs[@]}" setsid timeout --signal=TERM --kill-after=10s 30m pi -p --mode json --provider llama.cpp --model "$model" --no-session --no-extensions --no-skills --no-mcp --no-prompt-templates --thinking off < "$run/out/prompt.md" > "$run/out/events.jsonl" 2> "$run/out/stderr.log") &
pid=$!
while kill -0 "$pid" 2>/dev/null; do [[ -e $obs/ABORT ]] && { kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || :; break; }; sleep 2; done
set +e; wait "$pid"; code=$?; set -e
wall=$(( $(date +%s) - s0 ))
# runner の localllm-coder-diff! と同じく base からの diff + untracked を patch にする
{ git -C "$run/arch" diff --binary "$BASE"; git -C "$run/arch" ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do git -C "$run/arch" diff --no-index --binary -- /dev/null "$f" || true; done; } > "$run/out/patch.diff"
bb -e '(require (quote [cheshire.core :as j]) (quote [clojure.string :as s]))
 (let [[ev out start wall code model] *command-line-args*
       es (keep #(try (j/parse-string % true) (catch Exception _ nil)) (s/split-lines (slurp ev)))
       ends (filter #(and (= "message_end" (:type %)) (= "assistant" (get-in % [:message :role]))) es)
       last (s/join "\n" (keep #(when (= "text" (:type %)) (:text %)) (:content (:message (last ends)))))
       marker (second (re-find #"TASK_BOARD_RESULT:\s*(\w+)" last))
       seen (vec (distinct (keep #(get-in % [:message :model]) ends)))]
   (spit (s/replace out #"meta\.json$" "last-message.md") last)
   (spit out (j/generate-string {:model model :start-utc start :wall-seconds (parse-long wall) :exit-code (parse-long code)
     :tool-calls (count (filter #(= "tool_execution_start" (:type %)) es)) :assistant-turns (count ends)
     :models-seen seen :fallback (or (empty? seen) (boolean (some #(not= model %) seen))) :marker marker} {:pretty true})))' \
  "$run/out/events.jsonl" "$run/out/meta.json" "$start" "$wall" "$code" "$model"
git -C "$ARCH" worktree remove --force "$run/arch"; git -C "$ARCH" branch -D "$br" >/dev/null
cat "$run/out/meta.json"
