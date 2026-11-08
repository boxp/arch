#!/usr/bin/env bash
set -eu
T=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
trap 'docker rm -f boxp441-i-mcp >/dev/null 2>&1 || true' EXIT
docker run -d --log-driver none --name boxp441-i-mcp --network host -v boxp441-i:/work -w /work/psd2live -e GRADLE_USER_HOME=/work/gradle-cache -e P2L_BACKHAIR_ANCHOR=1 -e P2L_BACKHAIR_FX=15 -e P2L_BACKHAIR_FY=-6 -e P2L_BACKHAIR_SHOULDER_Y=455 eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a ./gradlew -Ppsd2live.prebuiltRuntime=false run --args="mcp --port 18767 --token $T --store /work/mcp-store --profile full" >/dev/null
docker run --rm --log-driver none --network host -v boxp441-i:/work -e PSD2LIVE_MCP_TOKEN="$T" python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54 python /work/repair.py
docker rm -f boxp441-i-mcp >/dev/null
docker run --rm --log-driver none -v boxp441-i:/work -w /work/psd2live -e GRADLE_USER_HOME=/work/gradle-cache -e P2L_BACKHAIR_ANCHOR=1 -e P2L_BACKHAIR_FX=15 -e P2L_BACKHAIR_FY=-6 -e P2L_BACKHAIR_SHOULDER_Y=455 eclipse-temurin:21@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a ./gradlew -q -Ppsd2live.prebuiltRuntime=false run --args="export /work/kohako-full-v10i.psd2live --target p2lrt --output /work --name candidate"
