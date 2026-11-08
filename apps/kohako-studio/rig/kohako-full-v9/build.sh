#!/usr/bin/env bash
set -euo pipefail
: "${OUT:?set OUT}" "${SOURCE:?set SOURCE}" "${P2L:?set P2L}" "${GRADLE_CACHE:?set GRADLE_CACHE}"
case "$OUT" in ''|/) echo 'unsafe OUT' >&2; exit 1;; esac
[ "$(sha256sum "$SOURCE" | cut -d' ' -f1)" = 4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84 ] || { echo 'source SHA mismatch' >&2; exit 1; }
[ "$(git -C "$P2L" rev-parse HEAD)" = 6fe868a20c7bf12586fa8ce0a05982f099faa865 ] || exit 1
mkdir -p "$OUT" "$GRADLE_CACHE"
OUT=$(realpath "$OUT"); [ "$OUT" != / ] || { echo "unsafe OUT" >&2; exit 1; }; SOURCE=$(realpath "$SOURCE"); P2L=$(realpath "$P2L"); GRADLE_CACHE=$(realpath "$GRADLE_CACHE")
RIG=$(cd "$(dirname "$0")" && pwd)
PY=python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54
JDK=eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a
ID=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n'); SERVER=boxp441-full9-$ID; VOL=boxp441-full9-vol-$ID; TRANSFER=boxp441-full9-transfer-$ID
exec 9>"${TMPDIR:-/tmp}/boxp441-mcp18767.lock"; flock 9
cleanup() { docker cp "$TRANSFER:/tmp/full9/layout/." "$OUT/layout" >/dev/null 2>&1 || true; docker cp "$TRANSFER:/tmp/full9/out/." "$OUT/out" >/dev/null 2>&1 || true; docker rm -f "$SERVER" "$TRANSFER" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; }; trap cleanup EXIT
rm -rf -- "$OUT/layout" "$OUT/out"; mkdir -p "$OUT/layout" "$OUT/out"
docker volume create "$VOL" >/dev/null
docker create --name "$TRANSFER" -v "$VOL:/tmp/full9" "$PY" true >/dev/null
docker cp "$P2L" "$TRANSFER:/tmp/full9/psd2live"
docker cp "$GRADLE_CACHE" "$TRANSFER:/tmp/full9/gradle-cache"
docker cp "$RIG" "$TRANSFER:/tmp/full9/rig"
docker cp "$SOURCE" "$TRANSFER:/tmp/full9/source.jpg"
docker run --rm -v "$VOL:/tmp/full9" -e SOURCE=/tmp/full9/source.jpg -e OUT=/tmp/full9/layout "$PY" sh -ec 'pip -q install numpy==2.5.4 pillow==13.0.0 opencv-python-headless==5.0.0.93; python /tmp/full9/rig/create_parts.py; python /tmp/full9/rig/upscale.py'
TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
docker run -d --log-driver none --name "$SERVER" --network host -v "$VOL:/tmp/full9" -w /tmp/full9/psd2live -e GRADLE_USER_HOME=/tmp/full9/gradle-cache "$JDK" ./gradlew -Ppsd2live.prebuiltRuntime=false run --args="mcp --port 18767 --token $TOKEN --store /tmp/full9/mcp-store --profile full" >/dev/null
docker run --rm --network host -v "$VOL:/tmp/full9" -e OUT=/tmp/full9/out -e P2L=/tmp/full9/psd2live -e PSD2LIVE_MCP_TOKEN="$TOKEN" "$PY" python /tmp/full9/rig/build.py
docker stop "$SERVER" >/dev/null
docker run --rm -v "$VOL:/tmp/full9" -w /tmp/full9/psd2live -e GRADLE_USER_HOME=/tmp/full9/gradle-cache "$JDK" ./gradlew -q -Ppsd2live.prebuiltRuntime=false run --args="export /tmp/full9/out/kohako-full-v9.psd2live --target p2lrt --output /tmp/full9/out --name kohako-full-v9"
docker cp "$TRANSFER:/tmp/full9/layout/." "$OUT/layout"
docker cp "$TRANSFER:/tmp/full9/out/." "$OUT/out"
sha256sum "$OUT/out/kohako-full-v9.p2lrt"
