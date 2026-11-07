#!/usr/bin/env bash
set -euo pipefail
WORK=${WORK:?set WORK to the rebuild-exp work dir (needs v17/, psd2live/, gradle-cache/, bust29.png, v28/aligned.png)}; O=${OUT:?set OUT to the same OUTDIR given to mask.py (reads $OUT/v29-mask.png)}
# v36 の採用値（README 参照）。環境変数で上書きして比較案を作れる。
export P2L_BACKHAIR_ANCHOR=${P2L_BACKHAIR_ANCHOR-1} P2L_BACKHAIR_FX=${P2L_BACKHAIR_FX-15} P2L_BACKHAIR_FY=${P2L_BACKHAIR_FY--6} P2L_BACKHAIR_G=${P2L_BACKHAIR_G-1} P2L_BACKHAIR_SHOULDER_Y=${P2L_BACKHAIR_SHOULDER_Y-425} P2L_BACKHAIR_ROWS=${P2L_BACKHAIR_ROWS-8}
export V36_TUNING=${V36_TUNING-'{"backHairSway":7,"backHairTurn":0}'} V36_PHYS_BACK=${V36_PHYS_BACK-'{"config":{"outputs":[{"parameter":"ParamHairBack","vertex":1,"scale":1.2}]}}'}
RIG=$(cd "$(dirname "$0")/.." && pwd)
PY=python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54
JDK=eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a
VOL=boxp441-v36; TR=boxp441-v36-tr; SV=boxp441-v36-mcp
docker rm -f $SV $TR >/dev/null 2>&1 || true; docker volume rm $VOL >/dev/null 2>&1 || true
docker volume create $VOL >/dev/null
docker create --name $TR -v $VOL:/tmp/boxp441 $PY true >/dev/null
docker cp "$RIG" $TR:/tmp/boxp441/rig
docker cp "$WORK/psd2live" $TR:/tmp/boxp441/psd2live
docker cp "$WORK/gradle-cache" $TR:/tmp/boxp441/gradle-cache
docker cp "$WORK/v17" $TR:/tmp/boxp441/v17
docker run --rm -v $VOL:/tmp/boxp441 $PY mkdir -p /tmp/boxp441/kohako /tmp/boxp441/v6/out /tmp/boxp441/v6/psd2live
docker cp "$WORK/bust29.png" $TR:/tmp/boxp441/kohako/bust-smile.png
docker cp "$WORK/v28/aligned.png" $TR:/tmp/boxp441/aligned-v28.png
docker cp "$O/v29-mask.png" $TR:/tmp/boxp441/v29-mask.png
docker run --rm -v $VOL:/tmp/boxp441 $PY sh -ec 'pip -q install --target /tmp/boxp441/python-deps numpy==2.5.4 pillow==13.0.0 opencv-python-headless==5.0.0.93; cp /tmp/boxp441/psd2live/mcp_proxy.py /tmp/boxp441/v6/psd2live/; cp /tmp/boxp441/rig/kohako-v6/pose_extra.py /tmp/boxp441/v6/; python /tmp/boxp441/rig/kohako-v36/patch_psd2live.py /tmp/boxp441/psd2live /tmp/boxp441/rig/kohako-v36/backhair-anchor.patch'
TOKEN=$(od -An -N16 -tx1 /dev/urandom | tr -d " \n")
docker run -d --log-driver none --name $SV --network host -v $VOL:/tmp/boxp441 -w /tmp/boxp441/psd2live -e GRADLE_USER_HOME=/tmp/boxp441/gradle-cache -e P2L_BACKHAIR_ANCHOR -e P2L_BACKHAIR_FX -e P2L_BACKHAIR_FY -e P2L_BACKHAIR_G -e P2L_BACKHAIR_SHOULDER_Y -e P2L_BACKHAIR_ROWS $JDK ./gradlew -Ppsd2live.prebuiltRuntime=false run --args="mcp --port 18767 --token $TOKEN --store /tmp/boxp441/mcp-store --profile full" >/dev/null
docker run --rm --network host -v $VOL:/tmp/boxp441 -e PYTHONPATH=/tmp/boxp441/python-deps -e PSD2LIVE_MCP_TOKEN="$TOKEN" -e V24_EYE_EPS=0.15 -e V36_TUNING -e V36_PHYS_BACK $PY sh -ec '
 for i in $(seq 1 90); do python -c "import urllib.request;urllib.request.urlopen(\"http://127.0.0.1:18767/\",timeout=2)" 2>/dev/null && break; python - <<P 2>/dev/null && break || sleep 3
import socket;s=socket.create_connection(("127.0.0.1",18767),2)
P
 done
 python /tmp/boxp441/rig/kohako-v26/create_parts.py
 python /tmp/boxp441/rig/kohako-v29/probe.py
 python /tmp/boxp441/rig/kohako-v30/fix_body.py
 python /tmp/boxp441/rig/kohako-v35/fix_gaps.py
 python /tmp/boxp441/rig/kohako-v36/build.py
 python /tmp/boxp441/rig/kohako-v25/eyes.py
 python /tmp/boxp441/rig/kohako-v25/mouth.py
 python /tmp/boxp441/rig/kohako-v6/finalize.py
 python /tmp/boxp441/rig/kohako-v25/capture.py v36'
docker stop $SV >/dev/null
docker run --rm -v $VOL:/tmp/boxp441 -w /tmp/boxp441/psd2live -e GRADLE_USER_HOME=/tmp/boxp441/gradle-cache -e P2L_BACKHAIR_ANCHOR -e P2L_BACKHAIR_FX -e P2L_BACKHAIR_FY -e P2L_BACKHAIR_G -e P2L_BACKHAIR_SHOULDER_Y -e P2L_BACKHAIR_ROWS $JDK ./gradlew -q -Ppsd2live.prebuiltRuntime=false run --args='export /tmp/boxp441/v6/out/kohako-v6.psd2live --target p2lrt --output /tmp/boxp441/v6/out --name kohako-v36'
case "$O" in ""|/) echo "refusing unsafe OUT: '$O'" >&2; exit 1;; esac
rm -rf -- "$O/v36"; mkdir -p -- "$O/v36"; docker cp "$TR:/tmp/boxp441/v6/out" "$O/v36/out"; docker cp "$TR:/tmp/boxp441/v6/layout" "$O/v36/layout"
sha256sum "$O/v36/out/kohako-v36.p2lrt"
