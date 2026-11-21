#!/usr/bin/env bash
# Decide whether the enable-auto-merge job may enable auto-merge for a
# Renovate pull request, based on the tfaction plan results of the same
# workflow run (BOXP-651).
#
# tfaction disables auto-merge when `terraform plan` has changes in a Renovate
# PR. The enable-auto-merge job runs after the plan, so it must not enable
# auto-merge again in that case. Only "every target planned successfully with
# no changes" allows auto-merge. Changes, plan failures, missing or unreadable
# results are all treated as "block" (fail safe).
#
# Inputs (environment variables):
#   PLAN_TARGETS_JSON  JSON array of tfaction targets (output of wc-setup).
#                      Each element is an object with a `target` field.
#   PLAN_RESULTS_DIR   Directory containing downloaded plan result artifacts:
#                      ${PLAN_RESULTS_DIR}/tfaction-plan-result-<slug>/result.json
#                      where <slug> is the target with "/" replaced by "__".
#   GITHUB_OUTPUT      Optional. `decision=enable|block` is appended to it.
#
# Output: prints the reasons and `decision=enable|block` to stdout.
# Exit status: 0 when a decision was made (including block), 2 on usage error.
set -euo pipefail

results_dir="${PLAN_RESULTS_DIR:?PLAN_RESULTS_DIR is required}"
targets_json="${PLAN_TARGETS_JSON-}"

decision=enable
reasons=()

block() {
  decision=block
  reasons+=("$1")
}

if [[ -z "$targets_json" ]] || ! jq -e 'type == "array" and all(.[]; type == "object" and (.target | type) == "string" and .target != "")' <<<"$targets_json" > /dev/null 2>&1; then
  block "plan targets are unknown or malformed: ${targets_json:-<empty>}"
  targets=()
else
  mapfile -t targets < <(jq -r '.[].target' <<<"$targets_json")
fi

if [[ "$decision" == enable && ${#targets[@]} -eq 0 ]]; then
  reasons+=("no terraform targets in this pull request")
fi

for target in "${targets[@]}"; do
  slug="${target//\//__}"
  result_file="${results_dir}/tfaction-plan-result-${slug}/result.json"
  if [[ ! -f "$result_file" ]]; then
    block "${target}: plan result is missing (plan did not finish or the result could not be downloaded)"
    continue
  fi
  if ! jq -e 'type == "object"' "$result_file" > /dev/null 2>&1; then
    block "${target}: plan result is unreadable"
    continue
  fi
  recorded_target="$(jq -r '.target // ""' "$result_file")"
  outcome="$(jq -r '.outcome // ""' "$result_file")"
  exitcode="$(jq -r '.detailed_exitcode // "" | tostring' "$result_file")"
  if [[ "$recorded_target" != "$target" ]]; then
    block "${target}: plan result belongs to another target (${recorded_target})"
    continue
  fi
  if [[ "$outcome" != success ]]; then
    block "${target}: plan step outcome is ${outcome}"
    continue
  fi
  case "$exitcode" in
    0) reasons+=("${target}: no changes") ;;
    2) block "${target}: terraform plan has changes" ;;
    *) block "${target}: plan result is undetermined (detailed_exitcode=${exitcode:-<empty>})" ;;
  esac
done

for reason in "${reasons[@]}"; do
  echo "$reason"
done
echo "decision=${decision}"
if [[ -n "${GITHUB_OUTPUT-}" ]]; then
  echo "decision=${decision}" >> "$GITHUB_OUTPUT"
fi
