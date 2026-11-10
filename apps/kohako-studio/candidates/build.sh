#!/bin/sh
# Docker の candidates ステージで実行する。src/<id>/web を /kohako/candidates/<id>/ 用に個別ビルドし、
# 候補であることを示す帯を studio.html と live2d.html に入れる。index.json は一覧画面が読む。
# usage: build.sh <candidates dir> <web dir with node_modules> <out dir>
set -eu
C=$1; DEPS=$2; OUT=$3
mkdir -p "$OUT"
for dir in "$C"/src/*/web; do
  [ -d "$dir" ] || continue
  id=$(basename "$(dirname "$dir")")
  cmp -s "$dir/package-lock.json" "$DEPS/package-lock.json" || { echo "$id: package-lock differs" >&2; exit 1; }
  ln -s "$DEPS/node_modules" "$dir/node_modules"
  (cd "$dir" && npx vite build --base "/kohako/candidates/$id/" --outDir "$OUT/$id" --emptyOutDir --logLevel warn)
  rm "$dir/node_modules"
done
node "$C/index.mjs" "$C/candidates.json" "$OUT" "${REQUIRE_CANDIDATES:-0}"
