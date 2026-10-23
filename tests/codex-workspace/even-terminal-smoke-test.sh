#!/usr/bin/env bash
set -euo pipefail

# Starts a built codex-workspace image the way the Pod does (no TTY, empty
# HOME, fixed token) and checks that even-terminal comes up and answers on the
# container's eth0 address. The network uses a non-RFC1918 subnet on purpose:
# Pod IPs are outside the private ranges, where even-terminal >= 0.10 would
# otherwise listen on 127.0.0.1 only.

IMAGE="${1:-}"
SUBNET="${EVEN_TERMINAL_SMOKE_SUBNET:-203.0.113.0/24}"
TIMEOUT_SECONDS="${EVEN_TERMINAL_SMOKE_TIMEOUT_SECONDS:-90}"
PORT=3456

if [[ -z "${IMAGE}" ]]; then
  echo "usage: $0 <image>" >&2
  exit 2
fi

suffix="$$-${RANDOM}"
network="codex-workspace-smoke-${suffix}"
container="codex-workspace-smoke-${suffix}"
token="smoke-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "error: $*" >&2
  echo "--- container logs ---" >&2
  docker logs "${container}" 2>&1 | tail -n 100 >&2 || true
  exit 1
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "${container}" 2>/dev/null)" == "true" ]]
}

# Prints the HTTP status of GET <url> from inside the container (000 when the
# connection fails). Extra arguments are passed to curl.
http_status() {
  local url="$1"
  shift
  docker exec "${container}" \
    curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" "${url}" || true
}

docker network create --subnet "${SUBNET}" "${network}" >/dev/null
docker run -d --name "${container}" --network "${network}" \
  -e EVEN_TERMINAL_TOKEN="${token}" \
  "${IMAGE}" >/dev/null

address="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${container}")"
[[ -n "${address}" ]] || fail "container has no IPv4 address"
base_url="http://${address}:${PORT}"

deadline=$((SECONDS + TIMEOUT_SECONDS))
status=000
while ((SECONDS < deadline)); do
  container_running || fail "container exited before even-terminal answered (exit code $(docker inspect -f '{{.State.ExitCode}}' "${container}"))"
  status="$(http_status "${base_url}/api/metrics")"
  if [[ "${status}" == "401" ]]; then
    break
  fi
  sleep 2
done
[[ "${status}" == "401" ]] || fail "expected 401 without token on ${base_url}/api/metrics, got ${status}"

status="$(http_status "${base_url}/api/metrics" -H "Authorization: Bearer ${token}")"
[[ "${status}" == "200" ]] || fail "expected 200 with token on ${base_url}/api/metrics, got ${status}"

config_stat="$(docker exec "${container}" stat -c '%U:%G %a' /home/boxp/.even-terminal/config.json)"
[[ "${config_stat}" == "boxp:boxp 600" ]] || fail "unexpected config.json owner/mode: ${config_stat}"

sleep 5
container_running || fail "container exited after even-terminal started"

echo "ok: even-terminal answers on ${base_url} ($(docker exec "${container}" even-terminal --version))"
