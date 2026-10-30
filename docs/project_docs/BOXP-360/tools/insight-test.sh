#!/usr/bin/env bash
# BOXP-360 correction-rules/v1 回帰 eval: 本票自身の実例 (gate 失敗の連続 retrying = レビュー反復ループ、
# groom→implement の誤計上、中断からの再開、Review 後の再開) を本文なしの summary.edn だけで再現する。
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

run() { # ticket run-id status action result [gate]
  local root=${ROOT:-$tmp}
  mkdir -p "$root/runs/$1/$2"
  local gate=""; [ -n "${6:-}" ] && gate=":review-gate {:gate :$6 :diagnostic {:category \"codex-review-findings\"}}"
  echo "{:ticket \"$1\" :run-id \"$2\" :status :$3 :action :$4 :result \"$5\" :agent \"claude-opus\" :finished-at \"$(echo "$2" | sed -E 's/^(....)(..)(..)T(..)(..)(..)Z.*/\1-\2-\3T\4:\5:\6Z/')\" $gate}" >"$root/runs/$1/$2/summary.edn"
}
# BOXP-901: groom -> implement (是正ではない) -> gate 失敗 12 連続 -> pass -> Review 後に Owner 起点の再開
run BOXP-901 20261001T000000Z groom groom review
for i in $(seq 10 21); do run BOXP-901 20261001T${i}0000Z retrying implement review codex-review; done
run BOXP-901 20261001T220000Z succeeded implement review
run BOXP-901 20261002T010000Z succeeded implement review
# BOXP-902: 中断 -> 再開 (是正ではない), blocked -> 再開 (是正ではない), review-fix (agent-system)
run BOXP-902 20261003T000000Z interrupted implement review
run BOXP-902 20261003T010000Z blocked implement blocked
run BOXP-902 20261003T020000Z succeeded implement review
run BOXP-902 20261003T030000Z succeeded review-fix review
# snapshot の上限より後の run は無視される
run BOXP-902 20261009T000000Z retrying implement review ci
# groom の status は succeeded に直す
sed -i 's/:status :groom :action :groom/:status :succeeded :action :groom/' "$tmp/runs/BOXP-901/20261001T000000Z/summary.edn"

bb ai_ops_insight.bb report "$tmp" 20261005T000000Z >"$tmp/r.edn"

check() { # 説明 clojure-expr(r に report)  [report file]
  local f=${3:-$tmp/r.edn}
  if bb -e "(let [r (clojure.edn/read-string (slurp \"$f\"))] (when-not $2 (System/exit 1)))"; then
    echo "ok - $1"
  else
    echo "not ok - $1"; bb -e "(clojure.pprint/pprint (clojure.edn/read-string (slurp \"$f\")))"; exit 1
  fi
}
check "groom->implement は v0 では reopen、v1 では是正に数えない" \
  '(and (= 1 (get-in r [:transitions :v0->v1 ["reopen" "groom_to_implement"]])) (= 1 (get-in r [:non-correction :by-kind "groom_to_implement"])))'
check "gate 失敗の retrying は v0 では是正に出ず、v1 で gate_rework 12 件" \
  '(and (= 12 (get-in r [:gate-rework :total])) (= 12 (get-in r [:transitions :v0->v1 [nil "gate_rework"]])))'
check "連続 12 回の gate 失敗をレビュー反復ループとして 10 回目で検出" \
  '(let [[d & more] (get-in r [:review-loops :detected])] (and (nil? more) (= "BOXP-901" (:ticket d)) (= 12 (:length d)) (= "20261001T190000Z" (:hit-run-id d)) (false? (:ongoing d))))'
check "中断/blocked からの再開は是正に数えない" \
  '(and (= 1 (get-in r [:non-correction :by-kind "resume_interrupted"])) (= 1 (get-in r [:non-correction :by-kind "resume_after_block"])))'
check "review-fix は agent-system、Review 後の implement 再開は原因 unknown のまま" \
  '(and (= 1 (get-in r [:transitions :v1 "review_fix"])) (= 1 (get-in r [:reopen-after-review :total])))'
check "Owner に見える是正 task と agent-system task を分ける (分母は Review 到達 2 task)" \
  '(and (= 2 (get-in r [:task-rates :denominator-reached-review])) (= 2 (get-in r [:task-rates :v1-owner-visible-tasks :n])) (= 2 (get-in r [:task-rates :v1-agent-system-tasks :n])) (= 1 (get-in r [:task-rates :v1-owner-visible-agent-system-tasks :n])))'
check "snapshot 上限より後の run を除外" \
  '(and (= 19 (get-in r [:snapshot :runs])) (nil? (get-in r [:gate-rework :by-gate "ci"])))'
check "Review 終了から次 run までの待ちを next 種別ごとに出す" \
  '(and (= 3 (get-in r [:review-wait :followed])) (= 3.0 (get-in r [:review-wait :by-next "reopen_after_review" :p50-h])))'

# --- codex-review 指摘の回帰 (別 snapshot) ---
t2="$tmp/t2"; mkdir -p "$t2"
# BOXP-903: 履歴の先頭が review-fix。gate 失敗 5 回 -> gate 情報なし retry -> gate 失敗 5 回 -> pass
ROOT=$t2 run BOXP-903 20261004T000000Z succeeded review-fix review
for i in 10 11 12 13 14; do ROOT=$t2 run BOXP-903 20261004T${i}0000Z retrying implement review codex-review; done
ROOT=$t2 run BOXP-903 20261004T150000Z retrying implement review
for i in 16 17 18 19 20; do ROOT=$t2 run BOXP-903 20261004T${i}0000Z retrying implement review codex-review; done
ROOT=$t2 run BOXP-903 20261004T210000Z succeeded implement review
# BOXP-904: gate 情報なし retry が 10 連続 (レビュー反復ではない)
for i in 10 11 12 13 14 15 16 17 18 19; do ROOT=$t2 run BOXP-904 20261005T${i}0000Z retrying implement review; done
ROOT=$t2 run BOXP-904 20261005T200000Z succeeded implement review
# BOXP-905: 最新 run が gate 失敗で後続 run 未開始
ROOT=$t2 run BOXP-905 20261006T000000Z succeeded implement review
ROOT=$t2 run BOXP-905 20261006T010000Z retrying implement review codex-review
bb ai_ops_insight.bb report "$t2" >"$t2/r.edn"
check "gate 情報なし retry はレビュー反復ループに数えず、gate 失敗の系列を区切る" \
  '(and (empty? (get-in r [:review-loops :detected])) (= 5 (get-in r [:gate-rework :longest-streak 0 1])))' "$t2/r.edn"
check "先頭 run の review-fix も v1 で review_fix (agent-system・Owner 可視)" \
  '(and (= 1 (get-in r [:transitions :v1 "review_fix"])) (= 1 (get-in r [:transitions :v0->v1 ["correction" "review_fix"]])) (= 1 (get-in r [:task-rates :v1-owner-visible-agent-system-tasks :n])))' "$t2/r.edn"
check "後続 run 未開始の最新 gate 失敗も内部再作業と agent-system task 率に入る (pending 別掲)" \
  '(and (= 11 (get-in r [:gate-rework :total])) (= 1 (get-in r [:gate-rework :pending])) (= 1 (get-in r [:gate-rework :top-tasks 1 1])) (= 2 (get-in r [:task-rates :v1-agent-system-tasks :n])) (= 3 (get-in r [:task-rates :denominator-reached-review])))' "$t2/r.edn"
# BOXP-906: gate 失敗 (retrying, :result "review") だけで Review に未到達
ROOT=$t2 run BOXP-906 20261007T000000Z retrying implement review codex-review
ROOT=$t2 run BOXP-906 20261007T010000Z retrying implement review codex-review
bb ai_ops_insight.bb report "$t2" >"$t2/r2.edn"
check "gate 失敗の retrying だけの task は Review 到達の分母に入れない (gate_rework には計上)" \
  '(and (= 3 (get-in r [:task-rates :denominator-reached-review])) (= 2 (get-in r [:task-rates :v1-agent-system-tasks :n])) (= 13 (get-in r [:gate-rework :total])))' "$t2/r2.edn"
