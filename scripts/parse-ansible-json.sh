#!/bin/bash
# Parse Ansible JSON callback output and generate structured data for github-comment
# Usage: parse-ansible-json.sh <node_name> <json_file> <full_output_file>

set -euo pipefail

NODE_NAME="${1:?Node name required}"
JSON_FILE="${2:?JSON file required}"
FULL_OUTPUT_FILE="${3:?Full output file required}"

# Check if files exist
if [ ! -f "$JSON_FILE" ]; then
  echo "Error: JSON file not found: $JSON_FILE" >&2
  exit 1
fi

if [ ! -f "$FULL_OUTPUT_FILE" ]; then
  echo "Error: Full output file not found: $FULL_OUTPUT_FILE" >&2
  exit 1
fi

# Extract stats from JSON output
# Ansible JSON callback puts stats at the end of the output
extract_stats() {
  local json_file="$1"
  local node="$2"

  # The JSON callback output has a "stats" object with host-level stats
  jq -r --arg node "$node" '
    .stats[$node] // .stats[keys[0]] // {ok: 0, changed: 0, skipped: 0, failures: 0, unreachable: 0}
  ' "$json_file" 2>/dev/null || echo '{"ok":0,"changed":0,"skipped":0,"failures":0,"unreachable":0}'
}

# Extract changed tasks from JSON output
extract_changed_tasks() {
  local json_file="$1"

  # Get all plays and tasks that have changed=true
  jq -r '
    [.plays[]?.tasks[]? | select(.hosts != null) |
      .hosts | to_entries[] |
      select(.value.changed == true) |
      {
        task: .value.task // "unknown",
        action: .value.action // "unknown"
      }
    ] | unique
  ' "$json_file" 2>/dev/null || echo '[]'
}

# Extract diff content from JSON output
extract_diffs() {
  local json_file="$1"

  # Get diff content from tasks that have diff
  jq -r '
    [.plays[]?.tasks[]? | select(.hosts != null) |
      .hosts | to_entries[] |
      select(.value.diff != null and .value.diff != {}) |
      .value.diff
    ] |
    if length > 0 then
      map(
        if type == "object" then
          if .before != null and .after != null then
            "--- before\n+++ after\n" +
            (if .before | type == "string" then .before else (.before | tostring) end | split("\n") | map("- " + .) | join("\n")) + "\n" +
            (if .after | type == "string" then .after else (.after | tostring) end | split("\n") | map("+ " + .) | join("\n"))
          elif .prepared != null then
            .prepared
          else
            (. | tostring)
          end
        else
          (. | tostring)
        end
      ) | join("\n\n")
    else
      ""
    end
  ' "$json_file" 2>/dev/null || echo ''
}

# Read full output and escape for JSON
read_full_output() {
  local file="$1"
  # Read file and escape special characters for JSON
  cat "$file" | jq -Rs '.'
}

# Main processing
STATS=$(extract_stats "$JSON_FILE" "$NODE_NAME")
CHANGED_TASKS=$(extract_changed_tasks "$JSON_FILE")
DIFFS=$(extract_diffs "$JSON_FILE")
FULL_OUTPUT=$(read_full_output "$FULL_OUTPUT_FILE")

# Get individual stat values
OK=$(echo "$STATS" | jq -r '.ok // 0')
CHANGED=$(echo "$STATS" | jq -r '.changed // 0')
SKIPPED=$(echo "$STATS" | jq -r '.skipped // 0')
FAILED=$(echo "$STATS" | jq -r '.failures // 0')
UNREACHABLE=$(echo "$STATS" | jq -r '.unreachable // 0')

# Calculate total failed (failures + unreachable)
TOTAL_FAILED=$((FAILED + UNREACHABLE))

# Output JSON structure for github-comment
jq -n \
  --arg name "$NODE_NAME" \
  --argjson ok "$OK" \
  --argjson changed "$CHANGED" \
  --argjson skipped "$SKIPPED" \
  --argjson failed "$TOTAL_FAILED" \
  --argjson changed_tasks "$CHANGED_TASKS" \
  --arg diff "$DIFFS" \
  --argjson full_output "$FULL_OUTPUT" \
  '{
    name: $name,
    ok: $ok,
    changed: $changed,
    skipped: $skipped,
    failed: $failed,
    changed_tasks: $changed_tasks,
    diff: $diff,
    full_output: $full_output
  }'
