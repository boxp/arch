#!/usr/bin/env bash
# usage: access-aud.sh HOST
# Prints the AUD of the Access application in front of HOST. Fails when an anonymous
# request is not sent to the Access login, so a deploy cannot go out unprotected.
set -euo pipefail

host=${1:?usage: access-aud.sh HOST}
location=$(curl -sS -m 20 -o /dev/null -w '%{redirect_url}' "https://$host/")
case "$location" in
  https://boxp.cloudflareaccess.com/*) ;;
  *) echo "$host does not redirect to Access; refusing to deploy" >&2; exit 1 ;;
esac
# The login redirect carries the application AUD as kid.
aud=$(sed -n 's/.*[?&]kid=\([0-9a-f]\{64\}\)\(&.*\)\{0,1\}$/\1/p' <<<"$location")
[ -n "$aud" ] || { echo "no AUD in the Access redirect for $host" >&2; exit 1; }
printf '%s\n' "$aud"
