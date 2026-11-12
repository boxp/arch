#!/bin/sh
# Docker の candidates ステージで実行する。src/<id>/web を /kohako/candidates/<id>/ 用に個別ビルドし、
# 現 web と同じ lock は共有依存を使い、異なる lock は候補自身の依存を lock ごとにインストールする。
# 候補であることを示す帯を studio.html と live2d.html に入れる。index.json は一覧画面が読む。
# usage: build.sh <candidates dir> <web dir with node_modules> <out dir>
set -eu
C=$1; DEPS=$2; OUT=$3
mkdir -p "$OUT"
for dir in "$C"/src/*/web; do
  [ -d "$dir" ] || continue
  id=$(basename "$(dirname "$dir")")
  if cmp -s "$dir/package-lock.json" "$DEPS/package-lock.json"; then
    modules=$DEPS/node_modules
  else
    hash=$(sha256sum "$dir/package-lock.json")
    hash=${hash%% *}
    cache=/tmp/cand-deps/$hash
    if [ ! -d "$cache/node_modules" ]; then
      echo "$id: installing candidate dependencies ($hash)"
      mkdir -p "$cache"
      cp "$dir/package.json" "$dir/package-lock.json" "$cache/"
      (cd "$cache" && npm ci)
    fi
    modules=$cache/node_modules
    echo "$id: using candidate dependencies ($hash)"
  fi
  ln -s "$modules" "$dir/node_modules"
  (cd "$dir" && npx vite build --base "/kohako/candidates/$id/" --outDir "$OUT/$id" --emptyOutDir --logLevel warn)
  rm "$dir/node_modules"
done
node "$C/index.mjs" "$C/candidates.json" "$OUT" "${REQUIRE_CANDIDATES:-0}"
