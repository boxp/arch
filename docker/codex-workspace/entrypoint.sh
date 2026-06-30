#!/usr/bin/env bash
set -euo pipefail

install -d -m 0755 /run/sshd
install -d -o boxp -g boxp -m 0755 /home/boxp
/usr/sbin/runuser -u boxp -- install -d -m 0700 /home/boxp/.ssh
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex/skills
/usr/sbin/runuser -u boxp -- install -d -m 0755 "/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron"
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/ghq

start_moshi_hook() {
  if [[ "${MOSHI_HOOK_ENABLED:-1}" == "0" ]]; then
    return
  fi

  if ! command -v moshi-hook >/dev/null 2>&1; then
    echo "moshi-hook is not installed; skipping Moshi hook setup" >&2
    return
  fi

  if [[ -n "${MOSHI_PAIRING_TOKEN:-}" ]]; then
    /usr/sbin/runuser -u boxp -- env HOME=/home/boxp PATH="${PATH}" \
      moshi-hook pair --token "${MOSHI_PAIRING_TOKEN}" --store file \
      || echo "moshi-hook pair failed; continuing workspace startup" >&2
  fi

  /usr/sbin/runuser -u boxp -- env HOME=/home/boxp PATH="${PATH}" \
    moshi-hook install \
    || echo "moshi-hook install failed; continuing workspace startup" >&2

  /usr/sbin/runuser -u boxp -- env HOME=/home/boxp PATH="${PATH}" \
    moshi-hook serve &
}

if [[ -d /opt/codex-workspace/skills ]]; then
  /usr/sbin/runuser -u boxp -- cp -R --no-preserve=mode,ownership \
    /opt/codex-workspace/skills/. /home/boxp/.codex/skills/
fi

if [[ -f /tmp/authorized_keys/authorized_keys ]]; then
  /usr/sbin/runuser -u boxp -- install -m 0600 \
    /tmp/authorized_keys/authorized_keys /home/boxp/.ssh/authorized_keys
fi

write_session_env() {
  local env_dir=/run/codex-workspace
  local env_file="${env_dir}/session-env"
  local env_tmp="${env_file}.tmp"
  local profile_file=/etc/profile.d/codex-workspace-env.sh
  local name

  install -d -o boxp -g boxp -m 0700 "${env_dir}"
  : >"${env_tmp}"
  chmod 0600 "${env_tmp}"

  for name in \
    DOCKER_HOST \
    DOCKER_BUILDKIT \
    GRAFANA_URL \
    GRAFANA_SERVICE_ACCOUNT_TOKEN \
    GEMINI_API_KEY; do
    if [[ -n "${!name:-}" ]]; then
      printf 'export %s=%q\n' "${name}" "${!name}" >>"${env_tmp}"
    fi
  done

  chown boxp:boxp "${env_tmp}"
  mv "${env_tmp}" "${env_file}"

  cat >"${profile_file}" <<'EOF'
if [ -r /run/codex-workspace/session-env ]; then
  . /run/codex-workspace/session-env
fi
EOF
  chmod 0644 "${profile_file}"
}

write_session_env

ssh-keygen -A
/usr/sbin/sshd -D -e -p "${SSHD_PORT:-2222}" &
start_moshi_hook

cd /home/boxp

token_args=()
if [[ -n "${EVEN_TERMINAL_TOKEN:-}" ]]; then
  token_args=(--token "${EVEN_TERMINAL_TOKEN}")
fi

exec /usr/sbin/runuser -u boxp \
  --whitelist-environment=DOCKER_HOST,DOCKER_BUILDKIT,GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN,GEMINI_API_KEY \
  -- env HOME=/home/boxp even-terminal \
  --port "${EVEN_TERMINAL_PORT:-3456}" \
  --cwd "${EVEN_TERMINAL_CWD:-/home/boxp}" \
  --provider "${EVEN_TERMINAL_PROVIDER:-codex}" \
  --name "${EVEN_TERMINAL_NAME:-lolice-codex-workspace}" \
  "${token_args[@]}"
