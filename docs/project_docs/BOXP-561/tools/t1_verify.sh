#!/usr/bin/env bash
# BOXP-561 T1 固定検証（開始前に固定）。usage: t1_verify.sh PATCH
set -uo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P); source "$here/common.sh"; require_tmp || exit 2
BASE=d95b7cdc1209b5bc8d79f170fe656b2cda468628
ARCH=$(git -C "$here" rev-parse --show-toplevel)   # この run の arch worktree（run ごとに変わるので固定しない）
S=.github/scripts/ansible-apply-targets.sh; T=.github/scripts/ansible-apply-targets.test.sh
patch=$(realpath -e "${1:?usage: t1_verify.sh PATCH}") || exit 2
w=$(mktemp -d "$BOXP561_TMP/t1v.XXXX"); git -C "$ARCH" worktree add -q --detach "$w/a" "$BASE"; cd "$w/a"
res() { bash "$T" 2>&1 | tail -1 | grep -oE '^[0-9]+/[0-9]+'; }
before=$(res); bchecks=$(grep -c '^check ' "$T"); grep '^check ' "$T" > "$w/orig-checks"
applies=false; git apply --whitespace=nowarn "$patch" 2>"$w/apply.err" && applies=true
files=$(git status --porcelain | awk '{print $2}' | sort | tr '\n' ' ')
only=false; [[ $applies == true && "$files" == "$S $T " ]] && only=true
achecks=$(grep -c '^check ' "$T"); grep '^check ' "$T" > "$w/new-checks"
# 既存 check 行が順序どおりすべて残っているか（部分列判定）
kept=$(awk 'NR==FNR{o[++n]=$0;next} {if(i<n && $0==o[i+1])i++} END{print (i==n)?"true":"false"}' "$w/orig-checks" "$w/new-checks")
after=$(res)
# 新テストが修正前の script で落ちるか（test だけ適用した状態）
cp "$S" "$w/patched.sh"; git show "$BASE:$S" > "$S"; testonly=$(res); cp "$w/patched.sh" "$S"
yaml_cases=$(grep -cE '^check .*\.yaml' "$T")
ap=${after%/*}; at=${after#*/}; tp=${testonly%/*}; tt=${testonly#*/}
allpass=false; [[ -n $after && $ap == "$at" ]] && allpass=true
newfail=false; [[ -n $testonly && $((tt - tp)) -ge 3 ]] && newfail=true
accepted=false; [[ $applies == true && $only == true && $kept == true && $allpass == true && $newfail == true && $achecks -eq $((bchecks+3)) && $at -eq $((${before#*/}+3)) && $yaml_cases -ge 3 ]] && accepted=true
cd /; git -C "$ARCH" worktree remove --force "$w/a"; rm -rf "$w"
printf '{"applies":%s,"files_changed":"%s","only_expected_files":%s,"checks_before":%s,"checks_after":%s,"existing_checks_kept_in_order":%s,"yaml_check_lines":%s,"tests_before":"%s","tests_test_only_on_old_script":"%s","tests_after":"%s","new_tests_fail_before":%s,"all_pass_after":%s,"accepted":%s}\n' \
  "$applies" "${files% }" "$only" "$bchecks" "$achecks" "$kept" "$yaml_cases" "$before" "$testonly" "$after" "$newfail" "$allpass" "$accepted"
