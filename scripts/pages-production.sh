#!/usr/bin/env bash
# BOXP-539: Cloudflare Pages の本番へ配備するときの戻し先の記録、実 URL の照合、自動 rollback。
#
#   pages-production.sh record PROJECT DOMAIN
#     配信中の本番 deployment を確かめ、GITHUB_OUTPUT に previous_id と branch を書く。
#   pages-production.sh verify PROJECT URL DIST PREVIOUS_ID
#     URL の HTML が DIST/index.html と一致するまで待つ。一致しなければ PREVIOUS_ID へ戻して失敗する。
#
# CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID を環境変数で受け取る。
set -euo pipefail

api() {
  local method="$1" path="$2"
  local base="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}"
  local out
  if [ "$method" = POST ]; then
    out="$(curl --fail-with-body -sS -X POST -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H 'Content-Type: application/json' -d '{}' "${base}${path}")"
  else
    out="$(curl --fail-with-body -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" "${base}${path}")"
  fi
  [ "$(jq -r '.success' <<<"$out")" = true ] || { echo "Cloudflare API error: $(jq -c '.errors' <<<"$out")" >&2; return 1; }
  jq '.result' <<<"$out"
}

summary() { [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; }

cmd="${1:?usage}"
PROJECT="${2:?project}"

case "$cmd" in
  record)
    domain="${3:?domain}"
    project="$(api GET '')"
    jq -e --arg d "$domain" '.domains | index($d)' <<<"$project" >/dev/null \
      || { echo "project ${PROJECT} does not own ${domain}" >&2; exit 1; }
    current="$(jq '{production_branch, deployment_id: .canonical_deployment.id, url: .canonical_deployment.url,
      environment: .canonical_deployment.environment, status: .canonical_deployment.latest_stage.status,
      commit: .canonical_deployment.deployment_trigger.metadata.commit_hash}' <<<"$project")"
    echo "$current"
    # 戻し先は成功している本番の deployment に限る。無ければ初回として空のまま進む。
    previous=""
    if [ "$(jq -r '.environment' <<<"$current")" = production ] && [ "$(jq -r '.status' <<<"$current")" = success ]; then
      previous="$(jq -r '.deployment_id' <<<"$current")"
    fi
    summary '## Production before deploy' '```json' "$current" '```'
    {
      echo "previous_id=${previous}"
      echo "branch=$(jq -r '.production_branch' <<<"$current")"
    } >> "${GITHUB_OUTPUT:-/dev/stdout}"
    ;;
  verify)
    url="${3:?url}" dist="${4:?dist}" previous="${5:-}"
    want="$(sha256sum "${dist}/index.html" | cut -d' ' -f1)"
    got=""
    for _ in $(seq 1 30); do
      got="$(curl -fsSL --max-time 20 -H 'Cache-Control: no-cache' "${url}?v=${GITHUB_SHA:-0}-$RANDOM" | sha256sum | cut -d' ' -f1 || true)"
      if [ "$got" = "$want" ]; then
        echo "production ${url} serves the new build (index.html sha256 ${want})"
        summary "## Production verified" "${url} index.html sha256 \`${want}\`"
        exit 0
      fi
      sleep 10
    done
    echo "production ${url} does not serve the new build (want ${want}, got ${got})" >&2
    if [ -n "$previous" ]; then
      api POST "/deployments/${previous}/rollback" | jq '{id, url}'
      echo "rolled back to ${previous}" >&2
      summary "## Rolled back" "verification failed; restored deployment \`${previous}\`"
    else
      echo "no previous production deployment to restore" >&2
    fi
    exit 1
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
