#!/bin/bash
# archive-board.sh - Archive Done/Rejected tasks from board.md
#
# Extracts Done and Rejected sections from board.md, writes them to
# archived/YYYYMMDD.md (JST date), then removes those entries from
# board.md to keep the active board lightweight.
#
# Usage:
#   archive-board.sh [BOARD_PATH]
#
# Environment:
#   BOARD_PATH  - Path to board.md (default: $HOME/.openclaw/workspace/tasks/board.md)
#   TZ          - Timezone for date stamp (default: Asia/Tokyo)
#
# Designed to run daily at JST 24:00 (15:00 UTC) via OpenClaw cron.

set -euo pipefail

export TZ="${TZ:-Asia/Tokyo}"

BOARD_PATH="${1:-${BOARD_PATH:-$HOME/.openclaw/workspace/tasks/board.md}}"
BOARD_DIR="$(dirname "$BOARD_PATH")"
ARCHIVE_DIR="${BOARD_DIR}/archived"

if [ ! -f "$BOARD_PATH" ]; then
  echo "ERROR: board.md not found at $BOARD_PATH" >&2
  exit 1
fi

DATE_STAMP="$(date +%Y%m%d)"
ARCHIVE_FILE="${ARCHIVE_DIR}/${DATE_STAMP}.md"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"

extract_section() {
  local file="$1"
  local header="$2"
  local in_section=0
  local content=""

  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^##\  ]]; then
      if [ "$in_section" -eq 1 ]; then
        break
      fi
      if [[ "$line" == "## ${header}" || "$line" == "## ${header} ("* ]]; then
        in_section=1
        continue
      fi
    elif [ "$in_section" -eq 1 ]; then
      content+="${line}"$'\n'
    fi
  done < "$file"

  printf '%s' "$content"
}

count_tasks() {
  local text="$1"
  printf '%s' "$text" | grep -c '^\- \[T-' || true
}

done_section="$(extract_section "$BOARD_PATH" "Done")"
rejected_section="$(extract_section "$BOARD_PATH" "Rejected")"

done_count="$(count_tasks "$done_section")"
rejected_count="$(count_tasks "$rejected_section")"
total_count=$((done_count + rejected_count))

if [ "$total_count" -eq 0 ]; then
  echo "No Done/Rejected tasks to archive. Skipping."
  exit 0
fi

mkdir -p "$ARCHIVE_DIR"

archive_content() {
  echo "# Board Archive - ${DATE_STAMP}"
  echo ""
  echo "---"
  echo "archived_at: ${TIMESTAMP}"
  echo "source: $(basename "$BOARD_PATH")"
  echo "done_count: ${done_count}"
  echo "rejected_count: ${rejected_count}"
  echo "total_archived: ${total_count}"
  echo "archive_file: ${DATE_STAMP}.md"
  echo "---"
  echo ""

  if [ "$done_count" -gt 0 ]; then
    echo "## Done"
    echo ""
    printf '%s' "$done_section"
    echo ""
  fi

  if [ "$rejected_count" -gt 0 ]; then
    echo "## Rejected"
    echo ""
    printf '%s' "$rejected_section"
    echo ""
  fi
}

if [ -f "$ARCHIVE_FILE" ]; then
  {
    echo ""
    echo "---"
    echo ""
    archive_content
  } >> "$ARCHIVE_FILE"
else
  archive_content > "$ARCHIVE_FILE"
fi

TEMP_BOARD="$(mktemp "${BOARD_DIR}/.board.tmp.XXXXXX")"
trap 'rm -f "$TEMP_BOARD"' EXIT

{
  skip_section=0

  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^##\  ]]; then
      if [[ "$line" == "## Done" || "$line" == "## Done ("* ]]; then
        skip_section=1
        echo "$line"
        echo ""
        echo "- (archived to archived/${DATE_STAMP}.md)"
        echo ""
        continue
      elif [[ "$line" == "## Rejected" || "$line" == "## Rejected ("* ]]; then
        skip_section=1
        echo "$line"
        echo ""
        echo "- (archived to archived/${DATE_STAMP}.md)"
        echo ""
        continue
      else
        skip_section=0
      fi
    fi

    if [ "$skip_section" -eq 1 ]; then
      continue
    fi

    echo "$line"
  done < "$BOARD_PATH"
} > "$TEMP_BOARD"

mv "$TEMP_BOARD" "$BOARD_PATH"
trap - EXIT

sed -i "s/^Last Updated:.*/Last Updated: $(date +%Y-%m-%d)/" "$BOARD_PATH"

echo "Archived ${total_count} tasks (${done_count} done, ${rejected_count} rejected) to ${ARCHIVE_FILE}"
echo "board.md updated."
