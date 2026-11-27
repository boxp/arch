#!/usr/bin/env bash
# usage: fetch-bundle.sh OUT_DIR
# 配布物だけを置く非公開リポジトリ boxp/hitohako-gbc-play を、読取り専用の deploy key で OUT_DIR へ取り出す。
# ログは公開されるので、出すのは配布物のコミットと ROM の sha256 と大きさだけ。中身や commit message は出さない。
# GITHUB_OUTPUT に ready (true/false)、rev、rom_sha256、action_rom_sha256（アクションのページが無ければ none）を書く。
set -euo pipefail

out=${1:?usage: fetch-bundle.sh OUT_DIR}
: "${HITOHAKO_GBC_PLAY_DEPLOY_KEY:?HITOHAKO_GBC_PLAY_DEPLOY_KEY is required}"
repo=${PLAY_SITE_REPO:-git@github.com:boxp/hitohako-gbc-play.git}
output=${GITHUB_OUTPUT:-/dev/stdout}

# 配布物のファイルの一覧。これ以外があれば配備しない（ソースや原画が紛れ込んだ時に止める）。
# 1 つでも欠けていても配備しない（欠けた配布物で、動いているページを壊さない）。
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
# 横スクロールアクション 1 面試作のページ（/action/、BOXP-704）。boxp/hitohako-gbc の CI が足すまでは無い。
# 1 つも無ければ今までどおり（SRPG のページだけ）配備し、1 つでもあれば 5 つ全部がそろっていることを求める。
action_files='
action/NOTICE.txt
action/index.html
action/play.js
action/rom/hitohako_action.gbc
action/version.json
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

unexpected=$(cd "$out" && find . -type f -o -type l | sed 's|^\./||' | LC_ALL=C sort | grep -vxF -f <(printf '%s%s' "$allowed" "$action_files" | sed '/^$/d') || true)
if [ -n "$unexpected" ]; then
  echo "the bundle has $(wc -l <<<"$unexpected") file(s) outside the allowlist; refusing to deploy" >&2
  exit 1
fi
if [ -n "$(find "$out" -type l)" ]; then
  echo "the bundle has a symlink; refusing to deploy" >&2
  exit 1
fi
# 一覧の物は全部そろっていて、空でないこと。ページは 1 つでも欠けると起動しないので、
# 欠けた配布物で配信中の正常なページを上書きしない。
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$out/$f" ] && [ -s "$out/$f" ] || {
    echo "the bundle lacks $f (or it is empty)" >&2
    exit 1
  }
done <<<"$allowed"
# ページが読む物が、ページから実際に参照されていること（名前だけ合って中身が別物、を減らす）。
for ref in play.css save.js play.js; do
  grep -qF "$ref" "$out/index.html" || {
    echo "the bundle's index.html does not refer to $ref" >&2
    exit 1
  }
done
[ "$(head -c 4 "$out/vendor/binjgb/binjgb.wasm" | od -An -tx1 | tr -d ' \n')" = "0061736d" ] || {
  echo "the bundle's emulator is not a wasm module" >&2
  exit 1
}
jq -e 'type == "object"' "$out/version.json" >/dev/null || {
  echo "the bundle's version.json is not a JSON object" >&2
  exit 1
}
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
# アクションのページ: 5 つのうち 1 つでもあれば、全部そろって空でなく、ページが自分の物を参照し、version.json と ROM が合うこと。
action_sha256=""
if [ -e "$out/action" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ -f "$out/$f" ] && [ -s "$out/$f" ] || {
      echo "the bundle lacks $f (or it is empty)" >&2
      exit 1
    }
  done <<<"$action_files"
  for ref in ../play.css ../vendor/binjgb/binjgb.js play.js; do
    grep -qF "\"$ref\"" "$out/action/index.html" || {
      echo "the bundle's action/index.html does not refer to $ref" >&2
      exit 1
    }
  done
  jq -e 'type == "object"' "$out/action/version.json" >/dev/null || {
    echo "the bundle's action/version.json is not a JSON object" >&2
    exit 1
  }
  want=$(jq -r '.rom_sha256' "$out/action/version.json")
  action_sha256=$(sha256sum "$out/action/rom/hitohako_action.gbc" | cut -d' ' -f1)
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] && [ "$want" = "$action_sha256" ] || {
    echo "action/version.json does not match the action ROM" >&2
    exit 1
  }
fi
size=$(du -sb "$out" | cut -f1)
[ "$size" -lt 8000000 ] || {
  echo "the bundle is unexpectedly large ($size bytes)" >&2
  exit 1
}

echo "bundle rev $rev, ROM sha256 $got, action ROM sha256 ${action_sha256:-none}, $size bytes"
{
  echo "ready=true"
  echo "rev=$rev"
  echo "rom_sha256=$got"
  echo "action_rom_sha256=${action_sha256:-none}"
} >>"$output"
