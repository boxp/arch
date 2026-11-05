#!/usr/bin/env bash
# usage: [MARKER=text] [VERSION_PREFIX=hex] verify-live.sh HOST [WORKERS_SUBDOMAIN]
# Read-only checks without credentials. Response bodies are never printed.
set -uo pipefail

host=${1:?usage: verify-live.sh HOST [WORKERS_SUBDOMAIN]}
subdomain=${2:-}
marker=${MARKER:-}
failures=0
body=$(mktemp)
headers=$(mktemp)
trap 'rm -f "$body" "$headers"' EXIT

report() {
  if [ "$1" = 0 ]; then echo "PASS $2"; else echo "FAIL $2"; failures=$((failures + 1)); fi
}

# args: label, curl arguments...
check_refused() {
  local label=$1 code location ok=1
  shift
  code=$(curl -sS -m 20 -o "$body" -D "$headers" -w '%{http_code}' "$@" || echo 000)
  location=$(grep -i '^location:' "$headers" | tr -d '\r' || true)
  case "$code" in
    403) ok=0 ;;
    301|302|303|307|308) case "$location" in *boxp.cloudflareaccess.com*) ok=0 ;; esac ;;
  esac
  if [ -n "$marker" ] && grep -qF -- "$marker" "$body"; then ok=1; fi
  if grep -qi '^cf-cache-status: *hit' "$headers"; then ok=1; fi
  report "$ok" "$label (status $code)"
}

for path in / /sha256 /lolice-architecture.html /data/ /owner-summary.md /index.html; do
  check_refused "GET $path" "https://$host$path"
done
check_refused "POST /" -X POST "https://$host/"
check_refused "forged JWT header" -H 'Cf-Access-Jwt-Assertion: garbage' "https://$host/"

if [ -n "$subdomain" ]; then
  code=$(curl -sS -m 20 -o "$body" -w '%{http_code}' "https://lolice-architecture.$subdomain.workers.dev/" || echo 000)
  case "$code" in 200) report 1 "workers.dev is closed (status $code)" ;; *) report 0 "workers.dev is closed (status $code)" ;; esac
  if [ -n "$marker" ] && grep -qF -- "$marker" "$body"; then report 1 "workers.dev body has no marker"; fi
  if [ -n "${VERSION_PREFIX:-}" ]; then
    code=$(curl -sS -m 20 -o "$body" -w '%{http_code}' "https://$VERSION_PREFIX-lolice-architecture.$subdomain.workers.dev/" || echo 000)
    case "$code" in 200) report 1 "version preview URL is closed (status $code)" ;; *) report 0 "version preview URL is closed (status $code)" ;; esac
  fi
fi

[ "$failures" = 0 ]
