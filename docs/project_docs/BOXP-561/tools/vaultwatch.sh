#!/usr/bin/env bash
# 長時間評価の補助監視: 対象モデルの job が本番 vault を変更しうる tool 呼び出しをしたら ABORT を作る（内容は出力しない）
# usage: vaultwatch.sh TOKEN MODEL
L=${BOXP561_TMP:?BOXP561_TMP required}
S=$L/sess-${1:?TOKEN}
M=${2:?MODEL}
q='def strip: gsub("[0-9]*>>?\\s*/dev/null"; "") | gsub("[0-9]*>&[0-9]"; "");
select(.type=="tool_execution_start") |
select(((.toolName=="write" or .toolName=="edit") and ((.args.path // .args.file_path // "")|test("obsidian-headless")))
  or (.toolName=="bash" and ((.args.command // "")|test("obsidian-headless")) and ((.args.command // "")|strip|test("(>|\\btee\\b|\\bmv\\b|\\brm\\b|sed -i|\\btouch\\b|\\bmkdir\\b|\\bln\\b)")))) | .toolName'
# 起動前から存在する segment は過去セッションで判定済み（検出済みの記録が残っていても再開を妨げない）ので、今回のセッションで作られた segment だけを見る
declare -A seen=()
for f in "$L"/long-"$M"-*/seg-*/events.jsonl; do
  [[ -f $f ]] && seen[$f]=1
done
until [[ -f $S/session.log ]] && grep -q 'session end' "$S/session.log"; do
  for f in "$L"/long-"$M"-*/seg-*/events.jsonl; do
    [[ -f $f ]] || continue
    [[ -n ${seen[$f]:-} ]] && continue
    hit=$(jq -r "$q" "$f" 2>/dev/null | head -1)
    if [[ -n $hit ]]; then
      echo "$(date -u +%FT%TZ) vault write-like tool call ($hit) in ${f#"$L"/}" | tee -a "$S/obs/ABORT"
      exit 0
    fi
  done
  sleep 3
done
