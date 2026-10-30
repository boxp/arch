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

# --- codex-review 指摘の回帰 (2) ---
t3="$tmp/t3"; mkdir -p "$t3"
# BOXP-907: gate 失敗 -> review-fix (gate 失敗) -> review-fix 成功、最後に後続 run 未開始の gate 失敗
ROOT=$t3 run BOXP-907 20261008T000000Z retrying implement review codex-review
ROOT=$t3 run BOXP-907 20261008T010000Z retrying review-fix review codex-review
ROOT=$t3 run BOXP-907 20261008T020000Z succeeded review-fix review
ROOT=$t3 run BOXP-907 20261008T030000Z retrying review-fix review codex-review
# BOXP-908: 上限と同じ秒に開始した run (run ID に suffix 付き) と、次の秒の run
ROOT=$t3 run BOXP-908 20261009T000000Z-aaaa succeeded implement review
ROOT=$t3 run BOXP-908 20261009T000001Z-bbbb retrying implement review ci
bb ai_ops_insight.bb report "$t3" 20261009T000000Z >"$t3/r.edn"
check "gate 失敗の後の review-fix は gate_rework (遷移集計 = total - pending で一致)" \
  '(let [g (:gate-rework r)] (and (= 3 (:total g)) (= 1 (:pending g)) (= 2 (:followed g)) (= (- (:total g) (:pending g)) (get-in r [:transitions :v1 "gate_rework"])) (= 1 (get-in r [:transitions :v1 "review_fix"])) (= 2 (get-in r [:transitions :v0->v1 ["correction" "gate_rework"]]))))' "$t3/r.edn"
check "時刻だけの上限では同じ秒の run を含め、次の秒の run は除外" \
  '(and (= 5 (get-in r [:snapshot :runs])) (nil? (get-in r [:gate-rework :by-gate "ci"])))' "$t3/r.edn"
bb ai_ops_insight.bb report "$t3" 20261009T000000Z-aaaa >"$t3/r2.edn"
check "完全な run ID の上限は従来どおり辞書順で比較" '(= 5 (get-in r [:snapshot :runs]))' "$t3/r2.edn"

t4="$tmp/t4"; mkdir -p "$t4"
# BOXP-909: gate 失敗の直後の review-fix だけで Review に到達 (遷移は gate_rework、Owner 可視の review-fix task としても数える)
ROOT=$t4 run BOXP-909 20261010T000000Z retrying implement review codex-review
ROOT=$t4 run BOXP-909 20261010T010000Z succeeded review-fix review
bb ai_ops_insight.bb report "$t4" >"$t4/r.edn"
check "gate 失敗直後の review-fix は遷移では gate_rework、Owner 可視 (review-fix) task にも計上" \
  '(and (= 1 (get-in r [:transitions :v1 "gate_rework"])) (nil? (get-in r [:transitions :v1 "review_fix"])) (= 1 (get-in r [:task-rates :denominator-reached-review])) (= 1 (get-in r [:task-rates :v1-owner-visible-tasks :n])) (= 1 (get-in r [:task-rates :v1-owner-visible-agent-system-tasks :n])) (= 1 (get-in r [:task-rates :v1-agent-system-tasks :n])))' "$t4/r.edn"

t5="$tmp/t5"; mkdir -p "$t5"
# BOXP-910: Review 到達済み task で review-fix が gate 失敗のまま (Owner に届いていない) -> Owner 可視には数えない
ROOT=$t5 run BOXP-910 20261011T000000Z succeeded implement review
ROOT=$t5 run BOXP-910 20261011T010000Z retrying review-fix review codex-review
bb ai_ops_insight.bb report "$t5" >"$t5/r.edn"
check "gate 失敗した review-fix は Owner 可視の是正 task に数えない" \
  '(and (= 1 (get-in r [:task-rates :denominator-reached-review])) (= 0 (get-in r [:task-rates :v1-owner-visible-tasks :n])) (= 0 (get-in r [:task-rates :v1-owner-visible-agent-system-tasks :n])) (= 1 (get-in r [:task-rates :v1-agent-system-tasks :n])))' "$t5/r.edn"

# --- Review 停止からの再開契機 (Notes 見出しの時刻/source のみ) ---
t6="$tmp/t6"; mkdir -p "$t6/vault/Tickets"
# BOXP-911: review 終了 -> supervisor 催促 2 回 -> 再開 (同じ停止への催促の繰返し)
ROOT=$t6 run BOXP-911 20261012T000000Z succeeded implement review
ROOT=$t6 run BOXP-911 20261012T060000Z succeeded implement review
# BOXP-912: review 終了 -> Owner 経由指示 -> 再開、もう一度 review 終了後は note なしで再開
ROOT=$t6 run BOXP-912 20261013T000000Z succeeded implement review
ROOT=$t6 run BOXP-912 20261013T020000Z succeeded implement review
ROOT=$t6 run BOXP-912 20261013T040000Z succeeded implement review
# BOXP-913: review 終了後に supervisor 催促があるが未再開 (停止中)
ROOT=$t6 run BOXP-913 20261014T000000Z succeeded implement review
cat >"$t6/vault/Tickets/BOXP-911.md" <<'MD'
## Notes
- 2026-10-12 00:30:00 UTC [kohako-event]: secret-body-should-not-appear handled
- 2026-10-12 03:00:00 UTC [kohako-supervisor]: secret-body-should-not-appear
- 2026-10-12 05:58:00 UTC [kohako-supervisor]: secret-body-should-not-appear
- 2026-10-12 05:59:00 UTC [claude-opus]: agent log
MD
cat >"$t6/vault/Tickets/BOXP-912.md" <<'MD'
## Notes
- 2026-10-13 01:00:00 UTC [hermes-agent]: secret-body-should-not-appear
- 2026-10-13 01:30:00 UTC [kohako-supervisor]: before-run-start-but-earlier
- 2026-10-13 01:50:00 UTC [hermes-agent]: last trigger
MD
cat >"$t6/vault/Tickets/BOXP-913.md" <<'MD'
## Notes
- 2026-10-14 01:00:00 UTC [kohako-supervisor]: secret-body-should-not-appear
MD
bb ai_ops_insight.bb report "$t6" 20261015T000000Z "$t6/vault" >"$t6/r.edn"
check "再開契機を最後の契機 note で分類し、note がなければ none-observed" \
  '(let [b (get-in r [:review-resume :by-trigger])] (and (= 3 (get-in r [:review-resume :followed])) (= 1 (get-in b ["supervisor" :n])) (= 1 (get-in b ["owner-relay" :n])) (= 1 (get-in b ["none-observed" :n]))))' "$t6/r.edn"
check "契機 note -> 次 run 開始を ack 遅延 (分) とする" \
  '(and (= 2.0 (get-in r [:review-resume :by-trigger "supervisor" :ack-p50-min])) (= 10.0 (get-in r [:review-resume :by-trigger "owner-relay" :ack-p50-min])))' "$t6/r.edn"
check "同じ停止への催促 2 回を繰返しとして数え、未再開の停止中催促も別掲 (kohako-event は契機に含めない)" \
  '(and (= 1 (get-in r [:review-resume :supervisor-nudged :repeated-nudge-stalls])) (= 3 (get-in r [:review-resume :supervisor-nudged :stalls])) (= 1 (get-in r [:review-resume :open-stalls :with-supervisor-nudge])))' "$t6/r.edn"
if grep -q "secret-body\|last trigger\|agent log" "$t6/r.edn"; then echo "not ok - Notes 本文が出力に含まれる"; exit 1; else echo "ok - Notes 本文は出力しない"; fi
bb ai_ops_insight.bb report "$t6" 20261015T000000Z >"$t6/r2.edn"
check "vault 未指定なら再開契機は unknown (0 にしない)" '(= "unknown" (get-in r [:review-resume :status]))' "$t6/r2.edn"

# Notes 節以外 (別節・code block) の同形式の行は契機に数えない
t7="$tmp/t7"; mkdir -p "$t7/vault/Tickets"
ROOT=$t7 run BOXP-914 20261016T000000Z succeeded implement review
ROOT=$t7 run BOXP-914 20261016T060000Z succeeded implement review
cat >"$t7/vault/Tickets/BOXP-914.md" <<'MD'
## Summary
- 2026-10-16 01:00:00 UTC [kohako-supervisor]: outside notes
## Notes
```
- 2026-10-16 02:00:00 UTC [hermes-agent]: inside code block
```
## Plan
- 2026-10-16 03:00:00 UTC [kohako-supervisor]: after notes
MD
bb ai_ops_insight.bb report "$t7" 20261017T000000Z "$t7/vault" >"$t7/r.edn"
check "Notes 節外・code block 内の行は契機に数えない" \
  '(and (= 1 (get-in r [:review-resume :by-trigger "none-observed" :n])) (= 0 (get-in r [:review-resume :supervisor-nudged :stalls])))' "$t7/r.edn"

# ticket file が無い/読めない場合は none-observed ではなく unknown-unreadable
t8="$tmp/t8"; mkdir -p "$t8/vault/Tickets"
ROOT=$t8 run BOXP-915 20261016T000000Z succeeded implement review
ROOT=$t8 run BOXP-915 20261016T060000Z succeeded implement review
ROOT=$t8 run BOXP-916 20261016T000000Z succeeded implement review
ROOT=$t8 run BOXP-916 20261016T060000Z succeeded implement review
printf '## Notes\n' >"$t8/vault/Tickets/BOXP-916.md"; chmod 000 "$t8/vault/Tickets/BOXP-916.md"
bb ai_ops_insight.bb report "$t8" 20261017T000000Z "$t8/vault" >"$t8/r.edn"
chmod 600 "$t8/vault/Tickets/BOXP-916.md"
check "無い/読めない ticket は unknown-unreadable として別掲し none-observed にしない" \
  '(and (= 2 (get-in r [:review-resume :unreadable-tickets])) (= 2 (get-in r [:review-resume :by-trigger "unknown-unreadable" :n])) (nil? (get-in r [:review-resume :by-trigger "none-observed"])))' "$t8/r.edn"
check "読めない ticket の停止は催促件数を 0 にせず判定不能として別掲" \
  '(and (= 4 (get-in r [:review-resume :supervisor-nudged :unknown-nudge-stalls])) (= 2 (get-in r [:review-resume :open-stalls :nudge-unknown])) (= 0 (get-in r [:review-resume :open-stalls :with-supervisor-nudge])))' "$t8/r.edn"
if bb ai_ops_insight.bb report "$t8" 20261017T000000Z "$t8/no-such-vault" >/dev/null 2>&1; then echo "not ok - 存在しない vault で成功した"; exit 1; else echo "ok - 存在しない vault は exit 非0"; fi

# Notes 内の code block にある `## ` 行で節を終えない (閉じフェンス以降の契機 note も読む)
t9="$tmp/t9"; mkdir -p "$t9/vault/Tickets"
ROOT=$t9 run BOXP-917 20261016T000000Z succeeded implement review
ROOT=$t9 run BOXP-917 20261016T060000Z succeeded implement review
cat >"$t9/vault/Tickets/BOXP-917.md" <<'MD'
## Notes
```
## Plan
```
- 2026-10-16 05:00:00 UTC [kohako-supervisor]: after code block
## Plan
- 2026-10-16 05:30:00 UTC [hermes-agent]: outside notes
MD
bb ai_ops_insight.bb report "$t9" 20261017T000000Z "$t9/vault" >"$t9/r.edn"
check "Notes 内 code block の見出しで節を終えず、閉じフェンス後の契機を読む" \
  '(and (= 1 (get-in r [:review-resume :by-trigger "supervisor" :n])) (nil? (get-in r [:review-resume :by-trigger "owner-relay"])) (nil? (get-in r [:review-resume :by-trigger "none-observed"])))' "$t9/r.edn"

# 別節の code block 内にある `## Notes` 行を Notes 節の開始とみなさない (実際の Notes 節を読む)
t10="$tmp/t10"; mkdir -p "$t10/vault/Tickets"
ROOT=$t10 run BOXP-918 20261016T000000Z succeeded implement review
ROOT=$t10 run BOXP-918 20261016T060000Z succeeded implement review
cat >"$t10/vault/Tickets/BOXP-918.md" <<'MD'
## Summary
```
## Notes
- 2026-10-16 05:00:00 UTC [hermes-agent]: fake note in code block
```
## Notes
- 2026-10-16 05:30:00 UTC [kohako-supervisor]: real note
MD
bb ai_ops_insight.bb report "$t10" 20261017T000000Z "$t10/vault" >"$t10/r.edn"
check "code block 内の ## Notes を節開始とせず、実際の Notes 節を読む" \
  '(and (= 1 (get-in r [:review-resume :by-trigger "supervisor" :n])) (nil? (get-in r [:review-resume :by-trigger "owner-relay"])) (nil? (get-in r [:review-resume :by-trigger "none-observed"])))' "$t10/r.edn"

# 種類の異なる fence (~~~ block 内の ```) で block を閉じたとみなさない
t11="$tmp/t11"; mkdir -p "$t11/vault/Tickets"
ROOT=$t11 run BOXP-919 20261016T000000Z succeeded implement review
ROOT=$t11 run BOXP-919 20261016T060000Z succeeded implement review
cat >"$t11/vault/Tickets/BOXP-919.md" <<'MD'
## Notes
~~~
```
- 2026-10-16 04:00:00 UTC [hermes-agent]: fake note in tilde block
## Plan
~~~
- 2026-10-16 05:30:00 UTC [kohako-supervisor]: real note
MD
bb ai_ops_insight.bb report "$t11" 20261017T000000Z "$t11/vault" >"$t11/r.edn"
check "~~~ block 内の \`\`\` で閉じず、対応する閉じフェンス後の契機を読む" \
  '(and (= 1 (get-in r [:review-resume :by-trigger "supervisor" :n])) (nil? (get-in r [:review-resume :by-trigger "owner-relay"])) (nil? (get-in r [:review-resume :by-trigger "none-observed"])))' "$t11/r.edn"

# Review 終了と同じ秒の契機 note は前後不明 (ambiguous-same-second) として別掲し、none-observed にしない
t12="$tmp/t12"; mkdir -p "$t12/vault/Tickets"
ROOT=$t12 run BOXP-920 20261016T000000Z succeeded implement review
ROOT=$t12 run BOXP-920 20261016T060000Z succeeded implement review
ROOT=$t12 run BOXP-921 20261016T000000Z succeeded implement review
ROOT=$t12 run BOXP-921 20261016T060000Z succeeded implement review
sec="2026-10-16 00:00:00" # run() の finished-at は run-id と同じ秒
cat >"$t12/vault/Tickets/BOXP-920.md" <<MD
## Notes
- $sec UTC [kohako-supervisor]: same second
MD
cat >"$t12/vault/Tickets/BOXP-921.md" <<MD
## Notes
- $sec UTC [hermes-agent]: same second
- 2026-10-16 05:00:00 UTC [kohako-supervisor]: definitely after
MD
bb ai_ops_insight.bb report "$t12" 20261017T000000Z "$t12/vault" >"$t12/r.edn"
check "同秒の契機のみは ambiguous-same-second、後に確実な契機があればそちらで分類" \
  '(let [rr (:review-resume r)] (and (= 1 (get-in rr [:by-trigger "ambiguous-same-second" :n])) (= 1 (get-in rr [:by-trigger "supervisor" :n])) (nil? (get-in rr [:by-trigger "none-observed"])) (= 2 (:same-second-boundary rr))))' "$t12/r.edn"

# 次 run 開始と同じ秒の契機 note も前後不明。確定区間に入れず、ack 遅延・催促回数を確定しない
t13="$tmp/t13"; mkdir -p "$t13/vault/Tickets"
for t in BOXP-930 BOXP-931 BOXP-932; do
  ROOT=$t13 run $t 20261016T000000Z succeeded implement review
  ROOT=$t13 run $t 20261016T060000Z succeeded implement review
done
st="2026-10-16 06:00:00" # 次 run の開始 (run-id) と同じ秒。run() の finished-at も同秒のため後続停止の終了境界にも当たる
cat >"$t13/vault/Tickets/BOXP-930.md" <<MD
## Notes
- $st UTC [kohako-supervisor]: start same second only
MD
cat >"$t13/vault/Tickets/BOXP-931.md" <<MD
## Notes
- 2026-10-16 03:00:00 UTC [hermes-agent]: definite owner relay
- $st UTC [kohako-supervisor]: start same second, different kind
MD
cat >"$t13/vault/Tickets/BOXP-932.md" <<MD
## Notes
- 2026-10-16 03:00:00 UTC [kohako-supervisor]: definite nudge
- $st UTC [kohako-supervisor]: start same second, same kind
MD
bb ai_ops_insight.bb report "$t13" 20261017T000000Z "$t13/vault" >"$t13/r.edn"
check "開始同秒の note は確定せず、種別が異なれば ambiguous、ack は unknown、催促は確定分のみ" \
  '(let [rr (:review-resume r)] (and (= 2 (get-in rr [:by-trigger "ambiguous-same-second" :n])) (= 1 (get-in rr [:by-trigger "supervisor" :n])) (nil? (get-in rr [:by-trigger "supervisor" :ack-p50-min])) (nil? (get-in rr [:by-trigger "none-observed"])) (= 6 (:same-second-boundary rr)) (= 1 (get-in rr [:supervisor-nudged :stalls])) (= 0 (get-in rr [:supervisor-nudged :repeated-nudge-stalls])) (= 6 (get-in rr [:supervisor-nudged :ambiguous-nudge-stalls]))))' "$t13/r.edn"

# 停止区間内の最後の秒に種別の異なる契機 note が複数あれば、記載順で確定せず ambiguous-same-second
t14="$tmp/t14"; mkdir -p "$t14/vault/Tickets"
for t in BOXP-940 BOXP-941; do
  ROOT=$t14 run $t 20261016T000000Z succeeded implement review
  ROOT=$t14 run $t 20261016T060000Z succeeded implement review
done
cat >"$t14/vault/Tickets/BOXP-940.md" <<MD
## Notes
- 2026-10-16 03:00:00 UTC [kohako-supervisor]: nudge
- 2026-10-16 03:00:00 UTC [hermes-agent]: relay in same second
MD
cat >"$t14/vault/Tickets/BOXP-941.md" <<MD
## Notes
- 2026-10-16 02:00:00 UTC [hermes-agent]: earlier relay
- 2026-10-16 03:00:00 UTC [kohako-supervisor]: nudge a
- 2026-10-16 03:00:00 UTC [kohako-supervisor]: nudge b
MD
bb ai_ops_insight.bb report "$t14" 20261017T000000Z "$t14/vault" >"$t14/r.edn"
check "最後の秒に種別の異なる契機があれば ambiguous、同種のみなら確定" \
  '(let [rr (:review-resume r)] (and (= 1 (get-in rr [:by-trigger "ambiguous-same-second" :n])) (= 1 (get-in rr [:by-trigger "supervisor" :n])) (nil? (get-in rr [:by-trigger "owner-relay"])) (= 1 (:same-second-boundary rr))))' "$t14/r.edn"

# 存在するが読めない Tickets ディレクトリは exit 2
chmod 000 "$t9/vault/Tickets"
if [ -r "$t9/vault/Tickets" ]; then
  echo "ok - (skip) 権限で読めなくできない環境"
else
  set +e; bb ai_ops_insight.bb report "$t9" 20261017T000000Z "$t9/vault" >/dev/null 2>&1; rc=$?; set -e
  chmod 700 "$t9/vault/Tickets"
  if [ "$rc" = 2 ]; then echo "ok - 読めない Tickets ディレクトリは exit 2"; else echo "not ok - 読めない Tickets ディレクトリで exit $rc"; exit 1; fi
fi
chmod 700 "$t9/vault/Tickets"
