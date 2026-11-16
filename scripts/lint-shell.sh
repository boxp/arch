#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Paths excluded from shell lint, with the reason for each:
# - harness-eval-tasks/*/{base,solution}: fixed inputs and reference answers of the
#   harness evaluation tasks. The base scripts deliberately contain the defects an
#   agent must fix (e.g. T02 is an unquoted-variable task), and changing them would
#   break comparisons with earlier evaluation results. The accept.sh scripts are
#   linted.
excludes=(
  ':(exclude,glob)docker/codex-workspace/task-board/harness-eval-tasks/*/base/**'
  ':(exclude,glob)docker/codex-workspace/task-board/harness-eval-tasks/*/solution/**'
)

# Select tracked shell files, optionally restricted by Git pathspec arguments.
if (($# == 0)); then
  set -- .
fi
mapfile -d '' -t files < <(git ls-files -z -- "$@" "${excludes[@]}")
targets=()
for file in "${files[@]}"; do
  [[ -f "$file" ]] || continue
  case "$file" in
    *.sh | *.bash) targets+=("$file") ;;
    *)
      name=${file##*/}
      [[ "$name" != *.* ]] || continue
      IFS= read -r first_line <"$file" || true
      if [[ "$first_line" =~ ^#![[:space:]]*(/[^[:space:]]*/)?(sh|bash|dash|ksh)([[:space:]]|$) ]] ||
        [[ "$first_line" =~ ^#![[:space:]]*/usr/bin/env[[:space:]]+(sh|bash|dash|ksh)([[:space:]]|$) ]]; then
        targets+=("$file")
      fi
      ;;
  esac
done

if ((${#targets[@]} == 0)); then
  echo 'Shell lint: no tracked shell scripts selected.'
  exit 0
fi

format_status=0
check_status=0
# Pass the style explicitly (mirrors .editorconfig) so extensionless scripts,
# which .editorconfig globs cannot match, are formatted the same way.
"${SHFMT:-shfmt}" -i 2 -ci -d "${targets[@]}" || format_status=$?
"${SHELLCHECK:-shellcheck}" "${targets[@]}" || check_status=$?
printf 'Shell lint: %d script(s), shfmt exit %d, ShellCheck exit %d\n' "${#targets[@]}" "$format_status" "$check_status"
((format_status == 0 && check_status == 0))
