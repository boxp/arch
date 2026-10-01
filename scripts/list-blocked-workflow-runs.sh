#!/usr/bin/env bash
# GitHub の保護機能で実行されなかった workflow run を一覧する（read-only）。
#
# 「実行されなかった run」は次の2通りで記録される。どちらも jobs は 0 件。
#   - conclusion=action_required
#   - conclusion=failure かつ jobs 0 件
# 承認や rerun は行わない。対応手順は docs/project_docs/BOXP-207/runbook.md を参照。
#
# Usage:
#   scripts/list-blocked-workflow-runs.sh [workflow file ...]
#
# Environment:
#   REPO   対象リポジトリ（既定: boxp/arch）
#   LIMIT  workflow ごとに調べる直近 run 数（既定: 30、最大 100）
#
# Exit status:
#   0  どの workflow も最新の完了 run は実行されている
#   2  最新の完了 run が未実行の workflow がある（承認が必要）
set -euo pipefail

REPO="${REPO:-boxp/arch}"
LIMIT="${LIMIT:-30}"

if [ "$#" -eq 0 ]; then
  set -- apply.yaml test.yaml
fi

needs_approval=0

for workflow in "$@"; do
  latest_state=""
  blocked_count=0

  while IFS=$'\t' read -r id created conclusion sha url; do
    state="ran"
    case "$conclusion" in
      action_required)
        state="blocked"
        ;;
      failure)
        jobs="$(gh api "repos/${REPO}/actions/runs/${id}/jobs?per_page=1" --jq '.total_count')"
        if [ "$jobs" -eq 0 ]; then
          state="blocked"
        fi
        ;;
    esac

    if [ -z "$latest_state" ]; then
      latest_state="$state"
    fi
    if [ "$state" = "blocked" ]; then
      blocked_count=$((blocked_count + 1))
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$workflow" "$id" "$created" "$conclusion" "${sha:0:9}" "$url"
    fi
  done < <(
    gh api "repos/${REPO}/actions/workflows/${workflow}/runs?per_page=${LIMIT}&status=completed" \
      --jq '.workflow_runs[] | [.id, .created_at, .conclusion, .head_sha, .html_url] | @tsv'
  )

  echo "# ${workflow}: latest=${latest_state:-none} blocked=${blocked_count} (直近 ${LIMIT} 件)" >&2
  if [ "$latest_state" = "blocked" ]; then
    needs_approval=1
  fi
done

if [ "$needs_approval" -eq 1 ]; then
  exit 2
fi
