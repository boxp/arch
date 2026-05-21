#!/usr/bin/env bash
set -euo pipefail

install -d -m 0755 /run/sshd
install -d -o boxp -g boxp -m 0755 /home/boxp
install -d -o boxp -g boxp -m 0700 /home/boxp/.ssh
install -d -o boxp -g boxp -m 0755 /home/boxp/ghq

if [[ -f /tmp/authorized_keys/authorized_keys ]]; then
  install -o boxp -g boxp -m 0600 /tmp/authorized_keys/authorized_keys /home/boxp/.ssh/authorized_keys
fi

ssh-keygen -A
/usr/sbin/sshd -D -e &

token_args=()
if [[ -n "${EVEN_TERMINAL_TOKEN:-}" ]]; then
  token_args=(--token "${EVEN_TERMINAL_TOKEN}")
fi

exec runuser -u boxp -- even-terminal \
  --port "${EVEN_TERMINAL_PORT:-3456}" \
  --cwd "${EVEN_TERMINAL_CWD:-/home/boxp}" \
  --provider "${EVEN_TERMINAL_PROVIDER:-codex}" \
  --name "${EVEN_TERMINAL_NAME:-lolice-codex-workspace}" \
  "${token_args[@]}"
