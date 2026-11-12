#!/usr/bin/env bash
# CI で Docker build の前に実行する。candidates.json の各候補を固定タグから取り出し、
# web/ のうち候補ごとに異なる部分だけを candidates/src/<id>/web へ置く。
# モデル(v11r)・runtime・静止表情は候補側の全ファイルが現在の版に同じ blob で存在することを検証し、配信では共用する。
# (現在の版で静止表情などを追加するのは可。既存ファイルの変更・削除は候補の見え方が変わるため不可)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
W=apps/kohako-studio/web
C=apps/kohako-studio/candidates
P=$W/public/kohako
rm -rf "$C/src"
mkdir -p "$C/src"
shared() { git ls-tree -r "$1" -- "$P/live2d/kohako/kohako-full-v11r.p2lrt" "$P/live2d/sample" "$P/studio" | sort; }
base=$(shared HEAD)
jq -r '.candidates[] | [.id, .commit] | @tsv' "$C/candidates.json" | while IFS=$'\t' read -r id commit; do
  [[ "$id" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || { echo "invalid candidate id: $id" >&2; exit 1; }
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid commit for $id" >&2; exit 1; }
  ref="refs/tags/kohako-studio-candidate/$id"
  git fetch --no-tags --depth=1 origin "+$ref:$ref"
  got=$(git rev-parse "$ref^{commit}")
  [ "$got" = "$commit" ] || { echo "$ref is $got, expected $commit" >&2; exit 1; }
  missing=$(comm -23 <(shared "$commit") <(printf "%s\n" "$base"))
  [ -z "$missing" ] || { echo "$id: model/runtime differ from the current version:" >&2; printf "%s\n" "$missing" >&2; exit 1; }
  mkdir -p "$C/src/$id"
  git archive "$commit" -- "$W" ":(exclude)$P/live2d/compare" ":(exclude)$P/live2d/kohako" ":(exclude)$P/live2d/sample" ":(exclude)$P/studio" \
    | tar -x --strip-components=2 -C "$C/src/$id"
  echo "candidate $id @ $commit"
done
