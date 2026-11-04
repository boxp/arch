#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
fail=0
bash -n count_lines.sh || fail=1
tmp=$(mktemp -d)
printf 'a\nb\nc\n' > "$tmp/plain.txt"
printf 'a\nb\n' > "$tmp/with space.txt"
out=$(bash count_lines.sh "$tmp/plain.txt" 2>/dev/null); [ "$out" = "lines=3" ] || { echo "FAIL plain: $out"; fail=1; }
out=$(bash count_lines.sh "$tmp/with space.txt" 2>/dev/null); [ "$out" = "lines=2" ] || { echo "FAIL space: $out"; fail=1; }
rm -rf "$tmp"
[ "$fail" -eq 0 ] && echo "PASS"
exit "$fail"
