#!/usr/bin/env bash
# Regression tests for judge-renovate-plan-results.sh (BOXP-651).
# Usage: .github/scripts/test-judge-renovate-plan-results.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
judge="${script_dir}/judge-renovate-plan-results.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0

t1='terraform/cloudflare/b0xp.io/video-rotator'
t2='terraform/aws/users'
targets_one="[{\"target\":\"${t1}\",\"job_type\":\"terraform\"}]"
targets_two="[{\"target\":\"${t1}\",\"job_type\":\"terraform\"},{\"target\":\"${t2}\",\"job_type\":\"terraform\"}]"

# put_result DIR TARGET OUTCOME EXITCODE
put_result() {
  local dir="$1" target="$2" outcome="$3" exitcode="$4"
  local slug="${target//\//__}"
  jq -n --arg target "$target" --arg outcome "$outcome" --arg exitcode "$exitcode" \
    '{target: $target, outcome: $outcome, detailed_exitcode: $exitcode}' \
    >"${dir}/${slug}.json"
}

new_dir() {
  mktemp -d "${work}/case.XXXXXX"
}

# expect NAME EXPECTED_DECISION TARGETS_JSON DIR [UPSTREAM_OK]
expect() {
  local name="$1" expected="$2" targets="$3" dir="$4" upstream="${5-true}"
  local out_file="${dir}.github_output" stdout actual
  : >"$out_file"
  if ! stdout="$(UPSTREAM_OK="$upstream" PLAN_TARGETS_JSON="$targets" PLAN_RESULTS_DIR="$dir" GITHUB_OUTPUT="$out_file" bash "$judge" 2>&1)"; then
    echo "FAIL: ${name}: judge exited non-zero"
    printf '    %s\n' "$stdout"
    failures=$((failures + 1))
    return
  fi
  actual="$(sed -n 's/^decision=//p' "$out_file")"
  if [[ "$actual" == "$expected" ]]; then
    echo "ok: ${name} -> ${actual}"
  else
    echo "FAIL: ${name}: expected ${expected}, got ${actual:-<none>}"
    printf '    %s\n' "$stdout"
    failures=$((failures + 1))
  fi
}

# No changes: auto-merge may be enabled (normal Renovate path keeps working).
d="$(new_dir)"
put_result "$d" "$t1" success 0
expect "single target, no changes" enable "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" success 0
put_result "$d" "$t2" success 0
expect "two targets, no changes" enable "$targets_two" "$d"

# No terraform target at all (e.g. a docs or app only Renovate PR).
d="$(new_dir)"
expect "no targets" enable "[]" "$d"

# Changes: must block (the #15336 / #15443 regression).
d="$(new_dir)"
put_result "$d" "$t1" success 2
expect "single target, plan has changes" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" success 0
put_result "$d" "$t2" success 2
expect "one of two targets has changes" block "$targets_two" "$d"

# Plan failed / undetermined / missing: must block (fail safe).
d="$(new_dir)"
put_result "$d" "$t1" failure 1
expect "plan failed" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" success ""
expect "plan succeeded without detailed_exitcode" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" skipped ""
expect "plan step skipped" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" cancelled ""
expect "plan step cancelled" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" success 0
expect "second target result missing" block "$targets_two" "$d"

d="$(new_dir)"
expect "result artifacts not downloaded" block "$targets_one" "$d"

d="$(new_dir)"
echo 'not json' >"${d}/${t1//\//__}.json"
expect "result file is broken" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t2" success 0
mv "${d}/${t2//\//__}.json" "${d}/${t1//\//__}.json"
expect "result belongs to another target" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" success 0
expect "targets output is empty" block "" "$d"

d="$(new_dir)"
put_result "$d" "$t1" success 0
expect "targets output is malformed" block "not-json" "$d"

# Re-run order: a later attempt overwrites the result artifact with the same
# name, so the judge sees only the latest plan result.
d="$(new_dir)"
put_result "$d" "$t1" failure 1
put_result "$d" "$t1" success 2
expect "re-run: failure then changes" block "$targets_one" "$d"

d="$(new_dir)"
put_result "$d" "$t1" failure 1
put_result "$d" "$t1" success 0
expect "re-run: failure then no changes" enable "$targets_one" "$d"

# test or status-check failed (the judge job now runs in that case too, so it
# must keep auto-merge disabled even if a plan result says "no changes").
d="$(new_dir)"
put_result "$d" "$t1" success 0
expect "test job failed, plan had no changes" block "$targets_one" "$d" false

d="$(new_dir)"
expect "test job failed, no targets" block "[]" "$d" false

d="$(new_dir)"
put_result "$d" "$t1" success 0
expect "upstream state unknown" block "$targets_one" "$d" ""

if [[ "$failures" -ne 0 ]]; then
  echo "${failures} test(s) failed"
  exit 1
fi
echo "all tests passed"
