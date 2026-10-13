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
XDG_PATH="${CODEX_WORKSPACE_SMOKE_XDG_CONFIG_HOME:-}"

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
env_args=()
if [[ -n "${XDG_PATH}" ]]; then
  env_args=(-e "XDG_CONFIG_HOME=${XDG_PATH}")
fi
docker run -d --name "${container}" --network "${network}" \
  -e EVEN_TERMINAL_TOKEN="${token}" "${env_args[@]}" \
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

# Check the real entrypoint child; docker exec's inherited environment alone
# can hide a runuser/login regression. Only print the nonsecret XDG variable.
docker exec -i "${container}" bash -s -- "${XDG_PATH}" <<'EOF'
set -euo pipefail
expected="$1"
pid=""
for comm_file in /proc/[0-9]*/comm; do
  IFS= read -r comm <"${comm_file}" || continue
  if [[ "${comm}" == even-terminal && "$(stat -c %U "${comm_file}")" == boxp ]]; then
    pid="${comm_file%/comm}"
    break
  fi
done
[[ -n "${pid}" ]]
actual="$(tr '\0' '\n' <"${pid}/environ" | sed -n 's/^XDG_CONFIG_HOME=//p')"
[[ "${actual}" == "${expected}" ]]
args=()
if [[ -n "${expected}" ]]; then
  args=("XDG_CONFIG_HOME=${actual}")
  # SSH login shells read the startup environment through this profile.
  login_xdg="$(runuser -l boxp -c 'printf "%s" "${XDG_CONFIG_HOME:-}"')"
  [[ "${login_xdg}" == "${expected}" ]]
fi
fixture="$(runuser -u boxp -- mktemp -d)"
runuser -u boxp -- git init -q "${fixture}"
runuser -u boxp -- env -u XDG_CONFIG_HOME HOME=/home/boxp "${args[@]}" \
  git -C "${fixture}" -c remote.fixture.url=https://github.com/boxp/fixture.git remote get-url fixture \
  | grep -Fxq ssh://git@github.com/boxp/fixture.git
EOF

sleep 5
container_running || fail "container exited after even-terminal started"

echo "ok: even-terminal answers on ${base_url} ($(docker exec "${container}" even-terminal --version))"
