#!/usr/bin/env bash
# usage: access-check.sh URL...
# 認証なしで各 URL を取りに行き、中身が返らず Cloudflare Access のログインへ転送されることを確かめる。
# 1 つでも中身が返る（または Access 以外へ転送される）なら失敗する。配備の前と後の両方で使う。
set -euo pipefail

[ $# -gt 0 ] || {
  echo "usage: access-check.sh URL..." >&2
  exit 2
}
failures=0
for url in "$@"; do
  result=""
  for _ in 1 2 3; do
    result=$(curl -sS -o /dev/null -m 20 -w '%{http_code} %{redirect_url}' "$url" || true)
    [ -n "$result" ] && [ "${result%% *}" != 000 ] && break
    sleep 5
  done
  code=${result%% *}
  location=${result#* }
  if [ "$code" = 302 ] && [[ "$location" =~ ^https://[a-z0-9-]+\.cloudflareaccess\.com/ ]]; then
    echo "PASS $url (302 to the Access login)"
  else
    echo "FAIL $url (HTTP $code; not redirected to the Access login)"
    failures=$((failures + 1))
  fi
done
[ "$failures" = 0 ]
