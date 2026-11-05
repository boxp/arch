#!/usr/bin/env bash
# usage: deploy.sh [--dry-run] --placeholder
#        deploy.sh [--dry-run] --html PATH --expect-sha256 HEX
# public/ holds exactly one file and is never tracked by git.
set -euo pipefail

app_dir=$(cd "$(dirname "$0")/.." && pwd)
mode="" html="" expected="" dry_run=false
while [ $# -gt 0 ]; do
  case "$1" in
    --placeholder) mode=placeholder; shift ;;
    --html) mode=html; html=${2:?--html needs a path}; shift 2 ;;
    --expect-sha256) expected=${2:?--expect-sha256 needs a hash}; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$mode" ] || { echo "choose --placeholder or --html" >&2; exit 2; }

target="$app_dir/public/lolice-lineage.html"
rm -rf "$app_dir/public"
mkdir -p "$app_dir/public"
if [ "$mode" = placeholder ]; then
  printf '<!doctype html><meta charset="utf-8"><title>lolice-lineage placeholder</title><p>placeholder\n' > "$target"
else
  [ -n "$expected" ] || { echo "--html requires --expect-sha256" >&2; exit 2; }
  actual=$(sha256sum "$html" | cut -d' ' -f1)
  [ "$actual" = "$expected" ] || { echo "sha256 mismatch: $actual" >&2; exit 1; }
  cp "$html" "$target"
fi

cd "$app_dir"
if [ "$dry_run" = true ]; then
  outdir=$(mktemp -d)
  trap 'rm -rf "$outdir"' EXIT
  npx wrangler deploy --dry-run --outdir "$outdir"
else
  : "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
  : "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
  npx wrangler deploy
fi
