#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
status=0
for script in ./*.mjs; do
  name=${script##*/}
  [[ $name == verify.mjs ]] && continue
  if [[ ! -f docs/${name%.mjs}.md ]]; then
    printf '説明がありません: %s\n' "$name" >&2
    status=1
  fi
done
for doc in docs/*.md; do
  [[ -e $doc ]] || continue
  name=${doc##*/}
  if [[ ! -f ${name%.md}.mjs || ${name%.md} == verify ]]; then
    printf '対応するスクリプトがありません: %s\n' "$doc" >&2
    status=1
  fi
done
if (( $(wc -l < README.md) > 40 )); then
  printf 'README.md が 40 行を超えています\n' >&2
  status=1
fi
exit "$status"
