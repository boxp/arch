#!/usr/bin/env bash
# usage: fetch-bundle.sh OUT_DIR
# 配布物だけを置く非公開リポジトリ boxp/hitohako-gbc-play を、読取り専用の deploy key で OUT_DIR へ取り出す。
# ログは公開されるので、出すのは配布物のコミットと ROM の sha256 と大きさだけ。中身や commit message は出さない。
# GITHUB_OUTPUT に ready (true/false)、rev、rom_sha256 を書く。
set -euo pipefail

out=${1:?usage: fetch-bundle.sh OUT_DIR}
: "${HITOHAKO_GBC_PLAY_DEPLOY_KEY:?HITOHAKO_GBC_PLAY_DEPLOY_KEY is required}"
repo=${PLAY_SITE_REPO:-git@github.com:boxp/hitohako-gbc-play.git}
output=${GITHUB_OUTPUT:-/dev/stdout}

# 配布物に入ってよいファイル。これ以外があれば配備しない（ソースや原画が紛れ込んだ時に止める）。
allowed='
NOTICE.txt
_headers
index.html
play.css
play.js
robots.txt
rom/hitohako_gbc.gbc
save.js
vendor/binjgb/LICENSE
vendor/binjgb/LICENSE.gbstudio
vendor/binjgb/binjgb.js
vendor/binjgb/binjgb.wasm
version.json
'

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(
  umask 077
  printf '%s\n' "$HITOHAKO_GBC_PLAY_DEPLOY_KEY" >"$tmp/key"
)
# GitHub が公開しているホスト鍵（https://api.github.com/meta の ssh_keys）
echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" >"$tmp/known_hosts"
export GIT_SSH_COMMAND="ssh -i $tmp/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$tmp/known_hosts -o StrictHostKeyChecking=yes"

rm -rf "$out"
git clone -q --depth 1 --branch main "$repo" "$out"
rev=$(git -C "$out" rev-parse HEAD)
rm -rf "$out/.git"

if [ ! -f "$out/index.html" ]; then
  echo "the bundle repository has no site yet (rev $rev)"
  echo "ready=false" >>"$output"
  exit 0
fi

unexpected=$(cd "$out" && find . -type f -o -type l | sed 's|^\./||' | LC_ALL=C sort | grep -vxF -f <(printf '%s' "$allowed" | sed '/^$/d') || true)
if [ -n "$unexpected" ]; then
  echo "the bundle has $(wc -l <<<"$unexpected") file(s) outside the allowlist; refusing to deploy" >&2
  exit 1
fi
if [ -n "$(find "$out" -type l)" ]; then
  echo "the bundle has a symlink; refusing to deploy" >&2
  exit 1
fi
for f in index.html version.json rom/hitohako_gbc.gbc NOTICE.txt _headers; do
  [ -f "$out/$f" ] || {
    echo "the bundle lacks $f" >&2
    exit 1
  }
done
grep -q 'X-Robots-Tag: noindex' "$out/_headers" || {
  echo "the bundle's _headers lacks noindex" >&2
  exit 1
}
want=$(jq -r '.rom_sha256' "$out/version.json")
got=$(sha256sum "$out/rom/hitohako_gbc.gbc" | cut -d' ' -f1)
[[ "$want" =~ ^[0-9a-f]{64}$ ]] && [ "$want" = "$got" ] || {
  echo "version.json does not match the ROM" >&2
  exit 1
}
size=$(du -sb "$out" | cut -f1)
[ "$size" -lt 8000000 ] || {
  echo "the bundle is unexpectedly large ($size bytes)" >&2
  exit 1
}

echo "bundle rev $rev, ROM sha256 $got, $size bytes"
{
  echo "ready=true"
  echo "rev=$rev"
  echo "rom_sha256=$got"
} >>"$output"
