#!/bin/bash
# Parse Ansible JSON callback output and generate structured data for github-comment
# Usage: parse-ansible-json.sh <node_name> <json_file1> [json_file2 ...] -- <full_output_file1> [full_output_file2 ...]
#
# Example:
#   parse-ansible-json.sh shanghai-1 control-plane.json node-specific.json -- control-plane.txt node-specific.txt

set -euo pipefail

NODE_NAME="${1:?Node name required}"
shift

# Parse arguments: JSON files before --, text files after --
JSON_FILES=()
TEXT_FILES=()
FOUND_SEPARATOR=false

for arg in "$@"; do
  if [ "$arg" = "--" ]; then
    FOUND_SEPARATOR=true
    continue
  fi
  if [ "$FOUND_SEPARATOR" = false ]; then
    JSON_FILES+=("$arg")
  else
    TEXT_FILES+=("$arg")
  fi
done

if [ ${#JSON_FILES[@]} -eq 0 ]; then
  echo "Error: At least one JSON file required" >&2
  exit 1
fi

if [ ${#TEXT_FILES[@]} -eq 0 ]; then
  echo "Error: At least one text output file required" >&2
  exit 1
fi

# Extract stats from JSON output and accumulate
extract_and_sum_stats() {
  local total_ok=0
  local total_changed=0
  local total_skipped=0
  local total_failures=0
  local total_unreachable=0

  for json_file in "${JSON_FILES[@]}"; do
    if [ ! -f "$json_file" ]; then
      echo "Warning: JSON file not found: $json_file" >&2
      continue
    fi

    # Extract stats for the node
    local stats
    stats=$(jq -r --arg node "$NODE_NAME" '
      .stats[$node] // .stats[keys[0]] // {ok: 0, changed: 0, skipped: 0, failures: 0, unreachable: 0}
    ' "$json_file" 2>/dev/null || echo '{"ok":0,"changed":0,"skipped":0,"failures":0,"unreachable":0}')

    local ok changed skipped failures unreachable
    ok=$(echo "$stats" | jq -r '.ok // 0')
    changed=$(echo "$stats" | jq -r '.changed // 0')
    skipped=$(echo "$stats" | jq -r '.skipped // 0')
    failures=$(echo "$stats" | jq -r '.failures // 0')
    unreachable=$(echo "$stats" | jq -r '.unreachable // 0')

    total_ok=$((total_ok + ok))
    total_changed=$((total_changed + changed))
    total_skipped=$((total_skipped + skipped))
    total_failures=$((total_failures + failures))
    total_unreachable=$((total_unreachable + unreachable))
  done

  echo "{\"ok\":$total_ok,\"changed\":$total_changed,\"skipped\":$total_skipped,\"failures\":$total_failures,\"unreachable\":$total_unreachable}"
}

# Extract changed tasks from all JSON files
extract_changed_tasks() {
  local all_tasks="[]"

  for json_file in "${JSON_FILES[@]}"; do
    if [ ! -f "$json_file" ]; then
      continue
    fi

    local tasks
    tasks=$(jq -r '
      [.plays[]?.tasks[]? | select(.hosts != null) |
        .hosts | to_entries[] |
        select(.value.changed == true) |
        {
          task: .value.task // "unknown",
          action: .value.action // "unknown"
        }
      ]
    ' "$json_file" 2>/dev/null || echo '[]')

    all_tasks=$(echo "$all_tasks" | jq --argjson new "$tasks" '. + $new | unique')
  done

  echo "$all_tasks"
}

# Extract diff content from all JSON files
extract_diffs() {
  local all_diffs=""

  for json_file in "${JSON_FILES[@]}"; do
    if [ ! -f "$json_file" ]; then
      continue
    fi

    local diff
    diff=$(jq -r '
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
    ' "$json_file" 2>/dev/null || echo '')

    if [ -n "$diff" ]; then
      if [ -n "$all_diffs" ]; then
        all_diffs="${all_diffs}\n\n${diff}"
      else
        all_diffs="$diff"
      fi
    fi
  done

  echo "$all_diffs"
}

# Read and combine all text outputs to a temp file (to avoid arg list too long)
write_full_output_to_file() {
  local output_file="$1"

  # Combine all text files and write as JSON string to temp file
  {
    for i in "${!TEXT_FILES[@]}"; do
      text_file="${TEXT_FILES[$i]}"
      if [ ! -f "$text_file" ]; then
        continue
      fi

      if [ "$i" -gt 0 ]; then
        printf '\n\n--- Next Playbook ---\n\n'
      fi
      cat "$text_file"
    done
  } | jq -Rs '.' > "$output_file"
}

# Main processing
STATS=$(extract_and_sum_stats)
CHANGED_TASKS=$(extract_changed_tasks)
DIFFS=$(extract_diffs)

# Write full output to temp file to avoid "Argument list too long" error
FULL_OUTPUT_FILE=$(mktemp)
trap "rm -f '$FULL_OUTPUT_FILE'" EXIT
write_full_output_to_file "$FULL_OUTPUT_FILE"

# Get individual stat values
OK=$(echo "$STATS" | jq -r '.ok // 0')
CHANGED=$(echo "$STATS" | jq -r '.changed // 0')
SKIPPED=$(echo "$STATS" | jq -r '.skipped // 0')
FAILED=$(echo "$STATS" | jq -r '.failures // 0')
UNREACHABLE=$(echo "$STATS" | jq -r '.unreachable // 0')

# Calculate total failed (failures + unreachable)
TOTAL_FAILED=$((FAILED + UNREACHABLE))

# Output JSON structure for github-comment
# Use --slurpfile to read full_output from file (avoids arg list too long)
jq -n \
  --arg name "$NODE_NAME" \
  --argjson ok "$OK" \
  --argjson changed "$CHANGED" \
  --argjson skipped "$SKIPPED" \
  --argjson failed "$TOTAL_FAILED" \
  --argjson changed_tasks "$CHANGED_TASKS" \
  --arg diff "$DIFFS" \
  --slurpfile full_output "$FULL_OUTPUT_FILE" \
  '{
    name: $name,
    ok: $ok,
    changed: $changed,
    skipped: $skipped,
    failed: $failed,
    changed_tasks: $changed_tasks,
    diff: $diff,
    full_output: $full_output[0]
  }'
