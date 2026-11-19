#!/usr/bin/env bash
# BOXP-634: the built image serves the auth gateway with its vendored xterm.js,
# answers /healthz, and denies everything else when Access settings are missing.
set -euo pipefail

image="${1:?usage: auth-gateway-smoke-test.sh IMAGE}"
name="auth-gateway-smoke-$$"

cleanup() { docker rm -f "${name}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for f in xterm.js xterm.css addon-fit.js; do
  docker run --rm --entrypoint /usr/bin/test "${image}" \
    -s "/opt/codex-workspace/auth-gateway/static/vendor/${f}"
done

docker run -d --name "${name}" --user 1000:1000 -e HOME=/tmp \
  -e CODEX_AUTH_GATEWAY_BIND=127.0.0.1 \
  --entrypoint /opt/codex-workspace/auth-gateway/auth_gateway.bb "${image}" >/dev/null

code() { docker exec "${name}" curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8095$1"; }

for _ in $(seq 1 30); do
  if [[ "$(code /healthz)" == "200" ]]; then break; fi
  sleep 1
done
test "$(code /healthz)" = "200"
# No team domain / AUD / Owner: fail closed.
test "$(code /)" = "503"
test "$(code /api/status)" = "503"
echo "auth-gateway smoke test: ok"
