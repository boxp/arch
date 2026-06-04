#!/usr/bin/env bash
set -euo pipefail

install -d -m 0755 /run/sshd
install -d -o boxp -g boxp -m 0755 /home/boxp
/usr/sbin/runuser -u boxp -- install -d -m 0700 /home/boxp/.ssh
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex/skills
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex-cron
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/ghq

if [[ -d /opt/codex-workspace/skills ]]; then
  /usr/sbin/runuser -u boxp -- cp -R --no-preserve=mode,ownership \
    /opt/codex-workspace/skills/. /home/boxp/.codex/skills/
fi

if [[ -f /tmp/authorized_keys/authorized_keys ]]; then
  /usr/sbin/runuser -u boxp -- install -m 0600 \
    /tmp/authorized_keys/authorized_keys /home/boxp/.ssh/authorized_keys
fi

start_cloudflare_warp() {
  if [[ "${CLOUDFLARE_WARP_ENABLED:-false}" != "true" ]]; then
    return 0
  fi

  local required="${CLOUDFLARE_WARP_REQUIRED:-false}"
  local missing=()
  for name in CLOUDFLARE_WARP_AUTH_CLIENT_ID CLOUDFLARE_WARP_AUTH_CLIENT_SECRET CLOUDFLARE_WARP_ORGANIZATION; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done

  if ((${#missing[@]} > 0)); then
    echo "cloudflare-warp: missing required env: ${missing[*]}" >&2
    [[ "$required" == "true" ]] && return 1
    return 0
  fi

  install -d -m 0700 /var/lib/cloudflare-warp
  xml_escape() {
    sed \
      -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&apos;/g"
  }

  local auth_client_id auth_client_secret organization
  auth_client_id="$(printf '%s' "${CLOUDFLARE_WARP_AUTH_CLIENT_ID}" | xml_escape)"
  auth_client_secret="$(printf '%s' "${CLOUDFLARE_WARP_AUTH_CLIENT_SECRET}" | xml_escape)"
  organization="$(printf '%s' "${CLOUDFLARE_WARP_ORGANIZATION}" | xml_escape)"

  cat > /var/lib/cloudflare-warp/mdm.xml <<EOF
<dict>
    <key>auth_client_id</key>
    <string>${auth_client_id}</string>
    <key>auth_client_secret</key>
    <string>${auth_client_secret}</string>
    <key>auto_connect</key>
    <integer>1</integer>
    <key>onboarding</key>
    <false/>
    <key>organization</key>
    <string>${organization}</string>
    <key>service_mode</key>
    <string>warp</string>
</dict>
EOF
  chmod 0600 /var/lib/cloudflare-warp/mdm.xml

  warp-svc >/var/log/cloudflare-warp.log 2>&1 &

  local ready=false
  for _ in {1..30}; do
    if warp-cli --accept-tos status >/tmp/cloudflare-warp-status 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done

  if [[ "$ready" != "true" ]]; then
    echo "cloudflare-warp: warp-cli did not become ready" >&2
    [[ -f /tmp/cloudflare-warp-status ]] && cat /tmp/cloudflare-warp-status >&2
    [[ "$required" == "true" ]] && return 1
    return 0
  fi

  if ! warp-cli --accept-tos connect >/tmp/cloudflare-warp-connect 2>&1; then
    echo "cloudflare-warp: connect failed" >&2
    cat /tmp/cloudflare-warp-connect >&2
    [[ "$required" == "true" ]] && return 1
  fi
}

start_cloudflare_warp

ssh-keygen -A
/usr/sbin/sshd -D -e -p "${SSHD_PORT:-2222}" &

cd /home/boxp

token_args=()
if [[ -n "${EVEN_TERMINAL_TOKEN:-}" ]]; then
  token_args=(--token "${EVEN_TERMINAL_TOKEN}")
fi

exec /usr/sbin/runuser -u boxp -- env HOME=/home/boxp even-terminal \
  --port "${EVEN_TERMINAL_PORT:-3456}" \
  --cwd "${EVEN_TERMINAL_CWD:-/home/boxp}" \
  --provider "${EVEN_TERMINAL_PROVIDER:-codex}" \
  --name "${EVEN_TERMINAL_NAME:-lolice-codex-workspace}" \
  "${token_args[@]}"
