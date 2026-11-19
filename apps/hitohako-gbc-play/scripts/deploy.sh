#!/usr/bin/env bash
# usage: deploy.sh SITE_DIR REV [--force]
# 取り出した配布物 SITE_DIR を Cloudflare Pages（boxp-hitohako-gbc-play）へ配備する。
#   1. 配備の前に、置き場の全部の入口が Access の内側にあることを確かめる（外なら配備しない）
#   2. 配信中の物が同じ REV なら何もしない（--force で配備し直す）
#   3. 配備し、Cloudflare API で配信中の物が REV になったことと、配備ごとの URL も Access の内側にあることを確かめる
# GITHUB_OUTPUT に deployed (true/false) を書く。
set -euo pipefail

site=${1:?usage: deploy.sh SITE_DIR REV [--force]}
rev=${2:?usage: deploy.sh SITE_DIR REV [--force]}
force=${3:-}
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
app_dir=$(cd "$(dirname "$0")/.." && pwd)
project=boxp-hitohako-gbc-play
domain=hitohako-gbc.b0xp.io
output=${GITHUB_OUTPUT:-/dev/stdout}
[[ "$rev" =~ ^[0-9a-f]{40}$ ]] || {
  echo "REV must be a commit hash" >&2
  exit 2
}

api() {
  local out
  out=$(curl -sS -m 30 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project$1")
  if [ "$(jq -r .success <<<"$out")" != true ]; then
    echo "Cloudflare API refused: $(jq -c '[.errors[]?|{code,message}]' <<<"$out")" >&2
    return 1
  fi
  jq .result <<<"$out"
}
live() {
  api "" | jq '{id: .canonical_deployment.id, url: .canonical_deployment.url,
    environment: .canonical_deployment.environment, status: .canonical_deployment.latest_stage.status,
    commit: .canonical_deployment.deployment_trigger.metadata.commit_hash}'
}
entrances=(
  "https://$domain/"
  "https://$domain/version.json"
  "https://$domain/rom/hitohako_gbc.gbc"
  "https://$project.pages.dev/"
  "https://$project.pages.dev/rom/hitohako_gbc.gbc"
  "https://main.$project.pages.dev/rom/hitohako_gbc.gbc"
)

project_json=$(api "")
jq -e --arg d "$domain" '.domains | index($d)' <<<"$project_json" >/dev/null || {
  echo "project $project does not own $domain" >&2
  exit 1
}

echo "== before deploy: every entrance must be behind Access"
"$app_dir/scripts/access-check.sh" "${entrances[@]}"

before=$(live)
if [ "$(jq -r .commit <<<"$before")" = "$rev" ] && [ "$(jq -r .status <<<"$before")" = success ] && [ "$force" != --force ]; then
  echo "bundle $rev is already live; nothing to deploy"
  echo "deployed=false" >>"$output"
  exit 0
fi

cd "$app_dir"
npx wrangler pages deploy "$site" --project-name "$project" --branch main \
  --commit-hash "$rev" --commit-message "play site" --commit-dirty=true

after=""
for _ in $(seq 1 12); do
  after=$(live)
  [ "$(jq -r .commit <<<"$after")" = "$rev" ] && [ "$(jq -r .status <<<"$after")" = success ] && break
  sleep 5
done
[ "$(jq -r .commit <<<"$after")" = "$rev" ] && [ "$(jq -r .status <<<"$after")" = success ] &&
  [ "$(jq -r .environment <<<"$after")" = production ] || {
  echo "the live deployment is not bundle $rev: $(jq -c '{environment, status, commit}' <<<"$after")" >&2
  exit 1
}

echo "== after deploy: every entrance, and this deployment's own URL, must be behind Access"
"$app_dir/scripts/access-check.sh" "${entrances[@]}" "$(jq -r .url <<<"$after")/" "$(jq -r .url <<<"$after")/rom/hitohako_gbc.gbc"
echo "live: bundle $rev (deployment $(jq -r .id <<<"$after"))"
echo "deployed=true" >>"$output"
