#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Select tracked shell files, optionally restricted by Git pathspec arguments.
mapfile -d '' -t files < <(git ls-files -z -- "$@")
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
"${SHFMT:-shfmt}" -d "${targets[@]}" || format_status=$?
"${SHELLCHECK:-shellcheck}" "${targets[@]}" || check_status=$?
printf 'Shell lint: %d script(s), shfmt exit %d, ShellCheck exit %d\n' "${#targets[@]}" "$format_status" "$check_status"
((format_status == 0 && check_status == 0))
