#!/usr/bin/env bash
# usage: deploy.sh SITE_DIR REV [--force]
# 取り出した配布物 SITE_DIR を Cloudflare Pages（boxp-hitohako-gbc-play）へ配備する。
#   1. 配備の前に、置き場の全部の入口が Access の内側にあることを確かめる（外なら配備しない）。
#      初回だけは入口がまだ無いので、中身の無い仮のページを先に置いてから確かめる
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
  # 横スクロールアクション 1 面試作のページ（/action/、BOXP-704）。Access は置き場の全部の道に掛かっているので、
  # 配布物に action/ がまだ無い時も、未ログインではログインへ転送される（中身の有無に関わらず確かめられる）。
  "https://$domain/action/"
  "https://$domain/action/version.json"
  "https://$domain/action/rom/hitohako_action.gbc"
  "https://$project.pages.dev/action/"
  "https://$project.pages.dev/action/rom/hitohako_action.gbc"
  "https://main.$project.pages.dev/action/rom/hitohako_action.gbc"
  # 人物の絵の候補のページ（/action-next/、BOXP-740）。無い時も未ログインではログインへ転送されることを確かめる。
  "https://$domain/action-next/"
  "https://$domain/action-next/version.json"
  "https://$domain/action-next/rom/hitohako_action.gbc"
  "https://$project.pages.dev/action-next/rom/hitohako_action.gbc"
)

project_json=$(api "")
jq -e --arg d "$domain" '.domains | index($d)' <<<"$project_json" >/dev/null || {
  echo "project $project does not own $domain" >&2
  exit 1
}

# まだ 1 度も配備していない project は、pages.dev の入口がそもそも無く、Access の転送ではなく 404 などが返る。
# そのままでは下の確認で止まって初回の配備ができないので、初回だけ、中身の無い仮のページ（ROM もページも
# 含まない）を先に置いて入口を作り、その入口が Access の内側にあることを確かめてから本物を配備する。
# 仮のページを置いた後に確認が通らなければ、本物は配備しない。
if [ "$(jq -r '.canonical_deployment.id // empty' <<<"$project_json")" = "" ]; then
  echo "== first deploy: put an empty placeholder first, so that the entrances exist"
  placeholder=$(mktemp -d)
  printf '<!doctype html><meta charset="utf-8"><title>preparing</title>\n' >"$placeholder/index.html"
  (cd "$app_dir" && npx wrangler pages deploy "$placeholder" --project-name "$project" --branch main \
    --commit-hash 0000000000000000000000000000000000000000 --commit-message "placeholder" --commit-dirty=true)
  rm -rf "$placeholder"
  # 新しい入口が引けるようになるまで少しかかるので、初回だけ待ちながら確かめる。
  checked=false
  for _ in $(seq 1 18); do
    if "$app_dir/scripts/access-check.sh" "${entrances[@]}"; then
      checked=true
      break
    fi
    sleep 10
  done
  [ "$checked" = true ] || {
    echo "the entrances are not behind Access after the placeholder deploy; the bundle is not deployed" >&2
    exit 1
  }
else
  echo "== before deploy: every entrance must be behind Access"
  "$app_dir/scripts/access-check.sh" "${entrances[@]}"
fi

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
"$app_dir/scripts/access-check.sh" "${entrances[@]}" "$(jq -r .url <<<"$after")/" "$(jq -r .url <<<"$after")/rom/hitohako_gbc.gbc" \
  "$(jq -r .url <<<"$after")/action/" "$(jq -r .url <<<"$after")/action/rom/hitohako_action.gbc" \
  "$(jq -r .url <<<"$after")/action-next/rom/hitohako_action.gbc"
echo "live: bundle $rev (deployment $(jq -r .id <<<"$after"))"
echo "deployed=true" >>"$output"
