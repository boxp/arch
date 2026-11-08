#!/usr/bin/env bash
set -euo pipefail
: "${DIST:?set DIST}" "${OUT:?set OUT}" "${NODE_MODULES:?set NODE_MODULES}"
RIG=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"; OUT=$(realpath "$OUT")
name=boxp441-v10f-browser-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" mcr.microsoft.com/playwright:v1.56.1-noble sleep 1800 >/dev/null
docker cp "$NODE_MODULES" "$name:/tmp/node_modules"
docker cp "$DIST" "$name:/tmp/dist"
for f in browser natural thinking; do docker cp "$RIG/$f.cjs" "$name:/tmp/$f.cjs"; docker exec "$name" node "/tmp/$f.cjs"; done
for f in results natural-upper natural-full thinking-upper; do docker cp "$name:/tmp/$f.json" "$OUT/$f.json"; done
docker cp "$name:/tmp/captures" "$OUT/captures"
