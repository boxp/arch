#!/usr/bin/env bash
set -euo pipefail
: "${INPUT_LAYOUT:?set INPUT_LAYOUT}" "${OUT:?set OUT}" "${SOURCE:?set SOURCE}" "${P2L:?set P2L}" "${GRADLE_CACHE:?set GRADLE_CACHE}"
case "$OUT" in ''|/) echo 'unsafe OUT' >&2; exit 1;; esac
[ "$(sha256sum "$SOURCE" | cut -d' ' -f1)" = 4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84 ] || { echo 'source SHA mismatch' >&2; exit 1; }
[ "$(git -C "$P2L" rev-parse HEAD)" = 6fe868a20c7bf12586fa8ce0a05982f099faa865 ] || exit 1
mkdir -p "$OUT" "$GRADLE_CACHE"
OUT=$(realpath "$OUT"); [ "$OUT" != / ] || { echo "unsafe OUT" >&2; exit 1; }; SOURCE=$(realpath "$SOURCE"); P2L=$(realpath "$P2L"); GRADLE_CACHE=$(realpath "$GRADLE_CACHE")
RIG=$(cd "$(dirname "$0")" && pwd)
PATCH=$(realpath -e "$RIG/../kohako-full-v10k/anchor.patch")
# rm -rf "$OUT/layout" "$OUT/out" の前に、入力と出力先の重なりを拒否する(入力の消失防止)。
INPUT_LAYOUT=$(realpath -e "$INPUT_LAYOUT"); LAYOUT_OUT=$(realpath -m "$OUT/layout"); OUT_OUT=$(realpath -m "$OUT/out")
inside() { case "$1/" in "$2"/*) return 0;; *) return 1;; esac; }
for target in "$LAYOUT_OUT" "$OUT_OUT"; do
  for input in "$INPUT_LAYOUT" "$SOURCE" "$P2L" "$GRADLE_CACHE" "$RIG" "$PATCH"; do
    if inside "$input" "$target"; then echo "input $input overlaps output $target" >&2; exit 1; fi
  done
  if inside "$target" "$INPUT_LAYOUT"; then echo "output $target is inside INPUT_LAYOUT $INPUT_LAYOUT" >&2; exit 1; fi
done
# anchor.patch は v10g の後ろ髪パッチも含むため、未適用の v10g ツリーでは v10j を出力しない。
git -C "$P2L" apply --reverse --check "$PATCH" || { echo "braid anchor patch (includes v10g back hair anchor) is not applied" >&2; exit 1; }
PY=python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54
JDK=eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a
ID=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n'); SERVER=boxp441-v11h-$ID; VOL=boxp441-v11h-vol-$ID; TRANSFER=boxp441-v11h-transfer-$ID
exec 9>"${TMPDIR:-/tmp}/boxp441-mcp18767.lock"; flock 9
cleanup() { docker cp "$TRANSFER:/tmp/full8/layout/." "$OUT/layout" >/dev/null 2>&1 || true; docker cp "$TRANSFER:/tmp/full8/out/." "$OUT/out" >/dev/null 2>&1 || true; docker rm -f "$SERVER" "$TRANSFER" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; }; trap cleanup EXIT
rm -rf -- "$OUT/layout" "$OUT/out"; mkdir -p "$OUT/layout" "$OUT/out"
docker volume create "$VOL" >/dev/null
docker create --name "$TRANSFER" -v "$VOL:/tmp/full8" "$PY" true >/dev/null
docker cp "$P2L" "$TRANSFER:/tmp/full8/psd2live"
docker cp "$GRADLE_CACHE" "$TRANSFER:/tmp/full8/gradle-cache"
docker cp "$RIG" "$TRANSFER:/tmp/full8/rig"
docker cp "$SOURCE" "$TRANSFER:/tmp/full8/source.jpg"
docker cp "$INPUT_LAYOUT/." "$TRANSFER:/tmp/full8/layout"
TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
docker run -d --log-driver none --name "$SERVER" --network host -v "$VOL:/tmp/full8" -w /tmp/full8/psd2live -e GRADLE_USER_HOME=/tmp/full8/gradle-cache -e P2L_SHARED_BRAID_BACK=1 -e P2L_BRAID_ANCHOR=1 -e P2L_BACKHAIR_ANCHOR=1 -e P2L_BACKHAIR_FX=15 -e P2L_BACKHAIR_FY=-6 -e P2L_BACKHAIR_SHOULDER_Y=455 "$JDK" ./gradlew -Ppsd2live.prebuiltRuntime=false run --args="mcp --port 18767 --token $TOKEN --store /tmp/full8/mcp-store --profile full" >/dev/null
docker run --rm --network host -v "$VOL:/tmp/full8" -e OUT=/tmp/full8/out -e P2L=/tmp/full8/psd2live -e PSD2LIVE_MCP_TOKEN="$TOKEN" "$PY" python /tmp/full8/rig/build.py
docker stop "$SERVER" >/dev/null
docker run --rm -v "$VOL:/tmp/full8" -w /tmp/full8/psd2live -e GRADLE_USER_HOME=/tmp/full8/gradle-cache -e P2L_SHARED_BRAID_BACK=1 -e P2L_BRAID_ANCHOR=1 -e P2L_BACKHAIR_ANCHOR=1 -e P2L_BACKHAIR_FX=15 -e P2L_BACKHAIR_FY=-6 -e P2L_BACKHAIR_SHOULDER_Y=455 "$JDK" ./gradlew -q -Ppsd2live.prebuiltRuntime=false run --args="export /tmp/full8/out/kohako-full-v11h.psd2live --target p2lrt --output /tmp/full8/out --name kohako-full-v11h"
docker cp "$TRANSFER:/tmp/full8/layout/." "$OUT/layout"
docker cp "$TRANSFER:/tmp/full8/out/." "$OUT/out"
sha256sum "$OUT/out/kohako-full-v11h.p2lrt"
