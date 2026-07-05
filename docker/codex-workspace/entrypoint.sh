#!/usr/bin/env bash
set -euo pipefail

install -d -m 0755 /run/sshd
install -d -o boxp -g boxp -m 0755 /home/boxp
/usr/sbin/runuser -u boxp -- install -d -m 0700 /home/boxp/.ssh
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex/skills
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex-cron
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex-task-board
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.pi/agent/extensions
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.local/bin
/usr/sbin/runuser -u boxp -- install -d -m 0755 "/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron"
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/ghq

export EDITOR="${EDITOR:-vim}"
export VISUAL="${VISUAL:-vim}"

configure_codex() {
  local config=/home/boxp/.codex/config.toml
  local tmp="${config}.tmp"

  /usr/sbin/runuser -u boxp -- touch "${config}"
  {
    printf 'check_for_update_on_startup = false\n'
    sed -E '/^[[:space:]]*check_for_update_on_startup[[:space:]]*=/d' "${config}"
  } >"${tmp}"
  mv "${tmp}" "${config}"
  chown boxp:boxp "${config}"
  chmod 0600 "${config}"
}

move_pi_extension_entry() {
  local entry="$1"
  local name dest i

  name="$(basename "${entry}")"
  dest="/home/boxp/.pi/agent/extensions/${name}"
  i=1
  while [[ -e "${dest}" ]]; do
    dest="/home/boxp/.pi/agent/extensions/${name}.legacy-${i}"
    i=$((i + 1))
  done
  mv "${entry}" "${dest}"
}

configure_pi_agent() {
  local entry name lower

  if [[ -d /home/boxp/.pi/agent/hooks ]]; then
    while IFS= read -r -d '' entry; do
      move_pi_extension_entry "${entry}"
    done < <(find /home/boxp/.pi/agent/hooks -mindepth 1 -maxdepth 1 -print0)
    rmdir /home/boxp/.pi/agent/hooks 2>/dev/null || true
  fi

  if [[ -d /home/boxp/.pi/agent/tools ]]; then
    while IFS= read -r -d '' entry; do
      name="$(basename "${entry}")"
      lower="${name,,}"
      case "${lower}" in
        fd|rg|fd.exe|rg.exe|.*)
          continue
          ;;
      esac
      move_pi_extension_entry "${entry}"
    done < <(find /home/boxp/.pi/agent/tools -mindepth 1 -maxdepth 1 -print0)
    rmdir /home/boxp/.pi/agent/tools 2>/dev/null || true
  fi

  chown -R boxp:boxp /home/boxp/.pi/agent
}

if [[ -d /opt/codex-workspace/skills ]]; then
  /usr/sbin/runuser -u boxp -- cp -R --no-preserve=mode,ownership \
    /opt/codex-workspace/skills/. /home/boxp/.codex/skills/
fi

configure_codex
configure_pi_agent

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
    EDITOR \
    VISUAL \
    ANTHROPIC_API_KEY \
    ANTHROPIC_AUTH_TOKEN \
    ANTHROPIC_BASE_URL \
    CLAUDE_CODE_OAUTH_TOKEN \
    CLAUDE_CODE_USE_BEDROCK \
    CLAUDE_CODE_USE_VERTEX \
    CLAUDE_CODE_USE_FOUNDRY \
    GRAFANA_URL \
    GRAFANA_SERVICE_ACCOUNT_TOKEN \
    GEMINI_API_KEY \
    KUBECONFIG; do
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

cd /home/boxp

token_args=()
if [[ -n "${EVEN_TERMINAL_TOKEN:-}" ]]; then
  token_args=(--token "${EVEN_TERMINAL_TOKEN}")
fi

exec /usr/sbin/runuser -u boxp \
  --whitelist-environment=DOCKER_HOST,DOCKER_BUILDKIT,EDITOR,VISUAL,ANTHROPIC_API_KEY,ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL,CLAUDE_CODE_OAUTH_TOKEN,CLAUDE_CODE_USE_BEDROCK,CLAUDE_CODE_USE_VERTEX,CLAUDE_CODE_USE_FOUNDRY,GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN,GEMINI_API_KEY,KUBECONFIG \
  -- env HOME=/home/boxp even-terminal \
  --port "${EVEN_TERMINAL_PORT:-3456}" \
  --cwd "${EVEN_TERMINAL_CWD:-/home/boxp}" \
  --provider "${EVEN_TERMINAL_PROVIDER:-codex}" \
  --name "${EVEN_TERMINAL_NAME:-lolice-codex-workspace}" \
  "${token_args[@]}"
