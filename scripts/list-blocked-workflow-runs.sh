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
#   1  GitHub API の照会に失敗した、または LIMIT が不正
#   2  最新の完了 run が未実行の workflow がある（承認が必要）
set -euo pipefail

REPO="${REPO:-boxp/arch}"
LIMIT="${LIMIT:-30}"

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || [ "$LIMIT" -lt 1 ] || [ "$LIMIT" -gt 100 ]; then
  echo "LIMIT must be an integer between 1 and 100: ${LIMIT}" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  set -- apply.yaml test.yaml
fi

needs_approval=0

for workflow in "$@"; do
  latest_state=""
  blocked_count=0

  # 照会に失敗したら「未実行なし」と誤認しないよう、ここで異常終了させる。
  # status=completed を API に渡すと古い run だけが返ったことがあるため、完了の絞り込みは jq で行う。
  # 実行中の run を除くと LIMIT 件に足りないことがあるので、足りるまで次のページを読む。
  runs=""
  for page in 1 2 3 4 5; do
    page_runs="$(
      gh api "repos/${REPO}/actions/workflows/${workflow}/runs?per_page=100&page=${page}" \
        --jq '.workflow_runs[] | [.status, .id, .created_at, .conclusion, .head_sha, .html_url] | @tsv'
    )"
    [ -n "$page_runs" ] || break
    runs+="$(awk -F'\t' -v OFS='\t' '$1 == "completed" { print $2, $3, $4, $5, $6 }' <<< "$page_runs")"$'\n'
    [ "$(awk 'NF { c++ } END { print c + 0 }' <<< "$runs")" -lt "$LIMIT" ] || break
  done
  runs="$(awk -v n="$LIMIT" 'NF && c < n { print; c++ }' <<< "$runs")"

  while IFS=$'\t' read -r id created conclusion sha url; do
    [ -n "$id" ] || continue
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
  done <<< "$runs"

  echo "# ${workflow}: latest=${latest_state:-none} blocked=${blocked_count} (直近 ${LIMIT} 件)" >&2
  if [ "$latest_state" = "blocked" ]; then
    needs_approval=1
  fi
done

if [ "$needs_approval" -eq 1 ]; then
  exit 2
fi
