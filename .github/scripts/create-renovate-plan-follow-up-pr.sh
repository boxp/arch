#!/usr/bin/env bash
set -euo pipefail

target="${TFACTION_TARGET:?TFACTION_TARGET is required}"
target="${target%/}"
pr_number="${PR_NUMBER:?PR_NUMBER is required}"
base_ref="${BASE_REF:-main}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
server_url="${GITHUB_SERVER_URL:-https://github.com}"
pr_url="${server_url}/${repo}/pull/${pr_number}"
target_slug="${target//\//-}"
branch="tfaction/renovate-plan-follow-up/pr-${pr_number}-${target_slug}"

plan_file="${target}/tfplan.binary"
if [[ ! -f "$plan_file" ]] || ! terraform show -json "$plan_file" | jq -e 'any(.resource_changes[]?; .address == "time_rotating.token_rotation" and any(.change.actions[]?; . != "no-op"))' > /dev/null; then
  echo "No token rotation change was found in ${plan_file}. Skip creating a Renovate plan follow-up PR."
  exit 0
fi

if [[ "$(gh pr list --repo "$repo" --head "$branch" --state open --json number --jq 'length')" != "0" ]]; then
  echo "Renovate plan follow-up PR already exists for ${pr_url} (${branch})"
  exit 0
fi

git config user.name "boxp-tfaction[bot]"
git config user.email "162872338+boxp-tfaction[bot]@users.noreply.github.com"
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${repo}.git"
git fetch origin "$base_ref"
git switch -C "$branch" "origin/${base_ref}"

failed_prs_file="${target}/.tfaction/failed-prs"
mkdir -p "$(dirname "$failed_prs_file")"
if [[ ! -f "$failed_prs_file" ]]; then
  {
    echo "# This file is created and updated by tfaction for follow up pull requests."
    echo "# You can remove this file safely."
  } > "$failed_prs_file"
fi

if ! grep -Fxq "$pr_url" "$failed_prs_file"; then
  echo "$pr_url" >> "$failed_prs_file"
fi

git add "$failed_prs_file"
if git diff --cached --quiet; then
  echo "No follow-up change was needed for ${pr_url}"
  exit 0
fi

git commit -m "chore(${target}): follow up Renovate plan drift #${pr_number}"
git push --force-with-lease origin "$branch"

gh pr create \
  --repo "$repo" \
  --base "$base_ref" \
  --head "$branch" \
  --title "chore(${target}): follow up Renovate plan drift #${pr_number}" \
  --body "This PR was created because Renovate PR #${pr_number} detected Terraform token rotation drift for \`${target}\` before merge.

Review the Terraform plan for this PR. If the plan only contains expected token rotation, merge this PR first, then rerun or rebase the Renovate PR so it can get a fresh no-change plan."
