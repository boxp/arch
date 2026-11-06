#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then echo "usage: $0 VAULT WORK_DIR" >&2; exit 2; fi
VAULT=$(realpath "$1"); mkdir -p "$2"; WORK=$(realpath "$2")
RIG=$(cd "$(dirname "$0")" && pwd)
SRC="$VAULT/attachments/kohako-exe-navigation-ai-character-sheet-final.png"
GEN="$VAULT/Projects/kohako-openamika-ui/live2d/gen"
PIN=6fe868a20c7bf12586fa8ce0a05982f099faa865
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }
verify() {
  local actual
  [ -f "$1" ] || { echo "missing $1" >&2; exit 1; }
  actual=$(sha256sum "$1"); actual=${actual%% *}
  [ "$actual" = "$2" ] || { echo "SHA-256 mismatch: $1" >&2; exit 1; }
}
verify "$SRC" 5427a014be21bfe2c938376c2882a1dbd6b64f669a44eebd4df2384df40021de
verify "$GEN/codex-head-base-v1.png" 07e876d99e88c17370f3f05876285284bd389fbcc51e55c15a84ac872d9a6a5f
verify "$GEN/codex-hair_back-v1.png" f3eab172173c36537673f59df259a1b90f355bd606507244177542040a958a7d
verify "$GEN/codex-outfit-local-v5-1.png" c7e6299979df5c9e1a831432b5b85372b12bd5ec0763900e0bbe0779a5bec23f
verify "$GEN/codex-outfit-local-v5-2.png" ff82009004b5488cacb5a528918ebb56f26ebf4a75297fc5c346b4c91302178f
if [ ! -d "$WORK/psd2live/.git" ]; then git clone https://github.com/tsunehimatoi/psd2live "$WORK/psd2live"; fi
git -C "$WORK/psd2live" checkout --detach "$PIN"
VOL="boxp441-rig-$$"; TRANSFER="boxp441-transfer-$$"; SERVER="boxp441-mcp-$$"
cleanup() {
  docker logs "$SERVER" > "$WORK/mcp.log" 2>&1 || true
  docker stop "$SERVER" >/dev/null 2>&1 || true
  if [ ! -d "$WORK/gradle-cache" ]; then docker cp "$TRANSFER:/tmp/boxp441/gradle-cache" "$WORK/" 2>/dev/null || true; fi
  for d in kohako v1 v2 v3 v5b v6 v13 v14 v14b; do docker cp "$TRANSFER:/tmp/boxp441/$d" "$WORK/" 2>/dev/null || true; done
  docker rm -f "$SERVER" "$TRANSFER" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$VOL" >/dev/null
docker create --name "$TRANSFER" -v "$VOL:/tmp/boxp441" python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54 true >/dev/null
docker cp "$RIG" "$TRANSFER:/tmp/boxp441/rig"
docker cp "$WORK/psd2live" "$TRANSFER:/tmp/boxp441/psd2live"
if [ -d "$WORK/gradle-cache" ]; then docker cp "$WORK/gradle-cache" "$TRANSFER:/tmp/boxp441/gradle-cache"; fi
docker run --rm -v "$VOL:/tmp/boxp441" python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54 sh -c 'mkdir -p /tmp/boxp441/kohako /tmp/boxp441/gen /tmp/boxp441/v5b'
# POSIX sh does not expand braces.
docker run --rm -v "$VOL:/tmp/boxp441" python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54 mkdir -p /tmp/boxp441/v5/gen /tmp/boxp441/v5/ref /tmp/boxp441/v6/out /tmp/boxp441/v6/psd2live
docker cp "$SRC" "$TRANSFER:/tmp/boxp441/kohako/source.png"
for f in codex-head-base-v1.png codex-hair_back-v1.png; do docker cp "$GEN/$f" "$TRANSFER:/tmp/boxp441/gen/$f"; done
for f in codex-outfit-local-v5-1.png codex-outfit-local-v5-2.png; do docker cp "$GEN/$f" "$TRANSFER:/tmp/boxp441/v5/gen/$f"; done
docker cp "$RIG/outfit-defect-approx.png" "$TRANSFER:/tmp/boxp441/v5/ref/outfit-defect.png"
docker run --rm -v "$VOL:/tmp/boxp441" -e PYTHONPATH=/tmp/boxp441/python-deps python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54 sh -ec '
 pip install --target /tmp/boxp441/python-deps numpy==2.5.4 pillow==13.0.0 opencv-python-headless==5.0.0.93
 python -c "from PIL import Image; Image.open(\"/tmp/boxp441/kohako/source.png\").crop((300,60,980,710)).save(\"/tmp/boxp441/kohako/bust-smile.png\")"
 cp /tmp/boxp441/psd2live/mcp_proxy.py /tmp/boxp441/v6/psd2live/
 cp /tmp/boxp441/rig/kohako-v6/pose_extra.py /tmp/boxp441/v6/
 for v in min v1 v2 v3 v5 v6; do python /tmp/boxp441/rig/kohako-$v/create_parts.py; done'
TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d " \n")
# Headless MCP and client share the Docker daemon host network.
docker run -d --name "$SERVER" --network host -v "$VOL:/tmp/boxp441" -w /tmp/boxp441/psd2live -e GRADLE_USER_HOME=/tmp/boxp441/gradle-cache eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a ./gradlew -Ppsd2live.prebuiltRuntime=false run --args="mcp --port 18767 --token $TOKEN --store /tmp/boxp441/mcp-store --profile full" >/dev/null
docker run --rm --network host -v "$VOL:/tmp/boxp441" -e PYTHONPATH=/tmp/boxp441/python-deps -e PSD2LIVE_MCP_TOKEN="$TOKEN" python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54 sh -ec '
 for step in build opacity iris mid mouth mouth_open finalize; do python /tmp/boxp441/rig/kohako-v6/$step.py; done
 python /tmp/boxp441/rig/kohako-v13/capture.py
 mkdir -p /tmp/boxp441/v13
 cp -a /tmp/boxp441/v6/out /tmp/boxp441/v13/baseline-out
 cp -a /tmp/boxp441/v6/layout /tmp/boxp441/v13/baseline-layout
 python /tmp/boxp441/rig/kohako-v13/create_parts.py
 for step in build opacity iris mid mouth mouth_open finalize; do python /tmp/boxp441/rig/kohako-v6/$step.py; done
 python /tmp/boxp441/rig/kohako-v13/capture.py
 python /tmp/boxp441/rig/kohako-v14/capture.py
 cp -a /tmp/boxp441/v6/out /tmp/boxp441/v13/out
 cp -a /tmp/boxp441/v6/layout /tmp/boxp441/v13/layout
 python /tmp/boxp441/rig/kohako-v14/create_parts.py
 for step in build opacity iris mid mouth mouth_open finalize; do python /tmp/boxp441/rig/kohako-v6/$step.py; done
 python /tmp/boxp441/rig/kohako-v14/capture.py
 mkdir -p /tmp/boxp441/v14
 cp -a /tmp/boxp441/v6/out /tmp/boxp441/v14/out
 cp -a /tmp/boxp441/v6/layout /tmp/boxp441/v14/layout
 python /tmp/boxp441/rig/kohako-v14b/create_parts.py
 for step in build opacity iris mid mouth mouth_open finalize; do python /tmp/boxp441/rig/kohako-v6/$step.py; done
 python /tmp/boxp441/rig/kohako-v14/capture.py
 mkdir -p /tmp/boxp441/v14b
 cp -a /tmp/boxp441/v6/out /tmp/boxp441/v14b/out
 cp -a /tmp/boxp441/v6/layout /tmp/boxp441/v14b/layout
 rm -rf /tmp/boxp441/v6/out /tmp/boxp441/v6/layout
 cp -a /tmp/boxp441/v13/baseline-out /tmp/boxp441/v6/out
 cp -a /tmp/boxp441/v13/baseline-layout /tmp/boxp441/v6/layout'
docker stop "$SERVER" >/dev/null
docker run --rm -v "$VOL:/tmp/boxp441" -w /tmp/boxp441/psd2live -e GRADLE_USER_HOME=/tmp/boxp441/gradle-cache eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a ./gradlew -Ppsd2live.prebuiltRuntime=false run --args='export /tmp/boxp441/v6/out/kohako-v6.psd2live --target p2lrt --output /tmp/boxp441/v6/out --name kohako-v6'
docker run --rm -v "$VOL:/tmp/boxp441" -w /tmp/boxp441/psd2live -e GRADLE_USER_HOME=/tmp/boxp441/gradle-cache eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a ./gradlew -Ppsd2live.prebuiltRuntime=false run --args='export /tmp/boxp441/v13/out/kohako-v6.psd2live --target p2lrt --output /tmp/boxp441/v13/out --name kohako-v13'
docker run --rm -v "$VOL:/tmp/boxp441" -w /tmp/boxp441/psd2live -e GRADLE_USER_HOME=/tmp/boxp441/gradle-cache eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a ./gradlew -Ppsd2live.prebuiltRuntime=false run --args='export /tmp/boxp441/v14/out/kohako-v6.psd2live --target p2lrt --output /tmp/boxp441/v14/out --name kohako-v14'
docker run --rm -v "$VOL:/tmp/boxp441" -w /tmp/boxp441/psd2live -e GRADLE_USER_HOME=/tmp/boxp441/gradle-cache eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a ./gradlew -Ppsd2live.prebuiltRuntime=false run --args='export /tmp/boxp441/v14b/out/kohako-v6.psd2live --target p2lrt --output /tmp/boxp441/v14b/out --name kohako-v14b'
for d in kohako v1 v2 v3 v5b v6 v13 v14 v14b; do docker cp "$TRANSFER:/tmp/boxp441/$d" "$WORK/"; done
sha256sum "$WORK/v6/out/kohako-v6.p2lrt"

sha256sum "$WORK/v13/out/kohako-v13.p2lrt"

sha256sum "$WORK/v14/out/kohako-v14.p2lrt"
sha256sum "$WORK/v14b/out/kohako-v14b.p2lrt"
