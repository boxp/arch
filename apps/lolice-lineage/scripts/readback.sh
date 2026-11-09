#!/usr/bin/env bash
# Confirms through the Cloudflare API that the route exists and the Worker has no
# alternate hostname, then runs verify-live.sh. Needs the deploy credentials.
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
app_dir=$(cd "$(dirname "$0")/.." && pwd)
script=lolice-lineage
host=lolice-lineage.b0xp.io
account="accounts/$CLOUDFLARE_ACCOUNT_ID"
failures=0

api() {
  local out
  out=$(curl -sS -m 30 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/$1")
  if [ "$(jq -r .success <<<"$out")" != true ]; then
    echo "API refused: $2: $(jq -c '[.errors[]?|{code,message}]' <<<"$out")" >&2
    return 1
  fi
  printf '%s' "$out"
}

check() {
  if [ "$2" = "$3" ]; then echo "PASS $1 ($2)"; else echo "FAIL $1 ($2, expected $3)"; failures=$((failures + 1)); fi
}

flags=$(api "$account/workers/scripts/$script/subdomain" "script subdomain flags")
check "workers.dev disabled" "$(jq -r .result.enabled <<<"$flags")" false
check "preview URLs disabled" "$(jq -r .result.previews_enabled <<<"$flags")" false

zone=$(api "zones?name=b0xp.io" "zone lookup" | jq -r '.result[0].id')
routes=$(api "zones/$zone/workers/routes" "zone routes")
check "route points at the Worker" \
  "$(jq -r --arg p "$host/*" '.result[]|select(.pattern==$p)|.script' <<<"$routes")" "$script"

subdomain=$(api "$account/workers/subdomain" "account subdomain" | jq -r .result.subdomain)
echo "::add-mask::$subdomain"
version=$(api "$account/workers/scripts/$script/versions" "script versions" | jq -r '.result.items[0].id')
echo "latest version: $version"

VERSION_PREFIX=${version%%-*} "$app_dir/scripts/verify-live.sh" "$host" "$subdomain" || failures=$((failures + 1))
[ "$failures" = 0 ]
