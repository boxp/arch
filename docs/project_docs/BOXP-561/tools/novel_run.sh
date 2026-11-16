#!/usr/bin/env bash
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P)
usage() {
  echo 'usage: novel_run.sh MODEL ROOT OUTDIR PORT' >&2
  exit 2
}
[[ $# = 4 ]] || usage
model=$1 root=$2 out=$3 port=$4
[[ $model = qwen3-coder-next || $model = qwen38-flash-next || $model = qwen38-27b ]] || usage
if ! [[ $port =~ ^[0-9]+$ ]] || ! ((10#$port > 0 && 10#$port <= 65535)); then
  usage
fi
# shellcheck source=docs/project_docs/BOXP-561/tools/common.sh
source "$here/common.sh"
require_tmp
under_tmp "$root" && under_tmp "$out" && [[ -f $root/prompt.md && -f $root/manifest.before && ! -e $out ]] || usage
mkdir -p "$out/coder-home/.pi/agent"
out=$(realpath -e "$out")
root=$(realpath -e "$root")
home=$out/coder-home
"$here/pi_models.bb" "$port" "$home/.pi/agent/models.json"
bb -e '(require (quote [cheshire.core :as json])) (spit (first *command-line-args*) (json/generate-string {"defaultProvider" "llama.cpp" "defaultModel" (second *command-line-args*)}))' "$home/.pi/agent/settings.json" "$model"
printf '{}' >"$home/.pi/agent/auth.json"
envargs=("HOME=$home" PI_OFFLINE=1 "CODEX_HOME=$home/.codex" "CLAUDE_CONFIG_DIR=$home/.claude")
for key in PATH LANG LC_ALL LC_CTYPE TERM TZ USER LOGNAME SHELL TMPDIR; do [[ ! -v $key ]] || envargs+=("$key=${!key}"); done
start=$(date -u +%FT%TZ)
start_sec=$(date +%s)
# The observer's directory is supplied explicitly, so runs do not silently ignore aborts.
obs=${BOXP561_OBS_DIR:?BOXP561_OBS_DIR must name the active observation directory}
under_tmp "$obs" && [[ -d $obs && ! -e $obs/ABORT ]] || {
  echo 'observer missing or aborted' >&2
  exit 1
}
(
  cd "$root"
  exec env -i "${envargs[@]}" setsid timeout --signal=TERM --kill-after=10s 60m pi -p --mode json --provider llama.cpp --model "$model" --no-session --no-extensions --no-skills --no-mcp --no-prompt-templates --thinking off <"$root/prompt.md" >"$out/events.jsonl" 2>"$out/stderr.log"
) &
pid=$!
while kill -0 "$pid" 2>/dev/null; do
  if [[ -e $obs/ABORT ]]; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || :
    break
  fi
  sleep 2
done
set +e
wait "$pid"
code=$?
set -e
end=$(date -u +%FT%TZ)
wall=$(($(date +%s) - start_sec))
bb -e '(require (quote [cheshire.core :as j]) (quote [clojure.string :as s])) (let [[events out start end wall code] *command-line-args* es (keep #(try (j/parse-string % true) (catch Exception _ nil)) (s/split-lines (slurp events)))] (spit out (j/generate-string {:start-utc start :end-utc end :wall-seconds (parse-long wall) :exit-code (parse-long code) :tool-calls (count (filter #(= "tool_execution_start" (:type %)) es)) :assistant-turns (count (filter #(and (= "message_end" (:type %)) (= "assistant" (get-in % [:message :role]))) es))})))' "$out/events.jsonl" "$out/meta.json" "$start" "$end" "$wall" "$code"
"$here/novel_check.bb" "$root" >"$out/check.json"
exit "$code"
