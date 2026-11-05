#!/usr/bin/env bash
# usage: [EXPECTED_SHA256=hex] [VERSION_PREFIX=hex] verify-live.sh HOST [WORKERS_SUBDOMAIN]
# Read-only anonymous checks: the page opens, nothing else does.
set -uo pipefail

host=${1:?usage: verify-live.sh HOST [WORKERS_SUBDOMAIN]}
subdomain=${2:-}
expected=${EXPECTED_SHA256:-}
failures=0
body=$(mktemp)
trap 'rm -f "$body"' EXIT

report() {
  if [ "$1" = 0 ]; then echo "PASS $2"; else echo "FAIL $2"; failures=$((failures + 1)); fi
}

# args: label, expected status, curl arguments...
check_status() {
  local label=$1 want=$2 code
  shift 2
  code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$@" || echo 000)
  [ "$code" = "$want" ]
  report $? "$label (status $code)"
}

# A new version takes a few seconds to reach every edge.
served=""
for _ in $(seq 1 12); do
  served=$(curl -sS -m 20 "https://$host/sha256" || true)
  if [ -z "$expected" ] || [ "$served" = "$expected" ]; then break; fi
  sleep 5
done
if [ -n "$expected" ]; then
  [ "$served" = "$expected" ]
  report $? "/sha256 matches the expected hash ($served)"
fi

code=$(curl -sS -m 30 -o "$body" -w '%{http_code}' "https://$host/" || echo 000)
[ "$code" = 200 ]
report $? "anonymous GET / (status $code)"
actual=$(sha256sum "$body" | cut -d' ' -f1)
[ "$actual" = "$served" ]
report $? "the body hash equals /sha256 ($actual)"

check_status "HEAD /" 200 -I "https://$host/"
for path in /lolice-lineage.html /data/ /owner-summary.md /request.md /index.html; do
  check_status "GET $path is closed" 404 "https://$host$path"
done
check_status "POST / is refused" 405 -X POST "https://$host/"

if [ -n "$subdomain" ]; then
  code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "https://lolice-lineage.$subdomain.workers.dev/" || echo 000)
  [ "$code" != 200 ]
  report $? "workers.dev is closed (status $code)"
  if [ -n "${VERSION_PREFIX:-}" ]; then
    code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "https://$VERSION_PREFIX-lolice-lineage.$subdomain.workers.dev/" || echo 000)
    [ "$code" != 200 ]
    report $? "version preview URL is closed (status $code)"
  fi
fi

[ "$failures" = 0 ]
