#!/usr/bin/env bash
# BOXP-766: 家の人形の表（bff/src/dolls.ts の roles・designs）を、モデルカタログと runner の codex 表と突き合わせる。
# - 担当名の実行モデルが表と食い違う → 失敗（家のカードに古いモデル名が出るため。表を直す）。
# - 表に無い担当名・絵の無い系列 → 一覧に出すだけで失敗にしない（家は無地の人形で出し、モデルの導入を止めない）。
set -euo pipefail
root=$(cd "$(dirname "$0")/../../../.." && pwd)
dolls="$root/apps/kohako-studio/bff/src/dolls.ts"
catalog="$root/docker/codex-workspace/model-catalog.edn"
runner="$root/docker/codex-workspace/task-board/task_board_runner.bb"
pairs() {
  # カタログ: "role" {:family "x" :model "m" ...}
  sed -nE 's/^ *"([a-z0-9-]+)" \{:family "[a-z0-9-]+" :model "([a-z0-9.-]+)".*/\1 \2/p' "$catalog"
  # runner: (def assignee->model ... {"codex" "gpt-..." ...})
  awk '/^\(def assignee->model/{on=1;next} on&&/^\(/{exit} on' "$runner" |
    sed -nE 's/.*"([a-z0-9-]+)" +"([a-z0-9.-]+)".*/\1 \2/p'
}
home_model() { sed -nE "s/^ *'?$1'?: \\{ model: '([a-z0-9.-]+)'.*/\\1/p" "$dolls" | head -1; }
designs=$(sed -nE "s/^  ([a-z]+): \\{ name: '.*', version: [0-9]+ \\},?$/\\1/p" "$dolls")
status=0
while read -r role model; do
  [[ -n $role ]] || continue
  have=$(home_model "$role")
  family=$(sed -nE 's/^claude-([a-z]+)-[0-9].*/\1/p; s/^gpt-[0-9.]+-([a-z]+)$/\1/p; s/^gemini-[0-9.]+-([a-z]+).*/\1/p' <<<"$model")
  if [[ -z $have ]]; then
    printf '家の表に無い担当名（無地の人形で出ます）: %s → %s\n' "$role" "$model"
  elif [[ $have != "$model" ]]; then
    printf '家の表の実行モデルが古い: %s は %s（家の表 %s）\n' "$role" "$model" "$have" >&2
    status=1
  fi
  if [[ -z $family ]] || ! grep -qx "$family" <<<"$designs"; then
    printf '絵の無い系列（無地の人形で出ます・絵は BOXP-760 の手順で用意）: %s（%s）\n' "${family:-不明}" "$model"
  fi
done < <(pairs)
[[ $(pairs | wc -l) -ge 9 ]] || {
  echo 'カタログか runner の表を読めませんでした' >&2
  status=1
}
exit "$status"
