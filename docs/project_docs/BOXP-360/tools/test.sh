#!/usr/bin/env bash
# BOXP-360 合成 E2E: drop なし / collector 停止 (bounded buffer drop) の 2 シナリオを検証する
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

bb ai_ops_sli.bb emit-sim fixtures/synthetic-events.jsonl 64 2>"$tmp/ok.stats" >"$tmp/ok.jsonl"
cat >>"$tmp/ok.jsonl" <<'EOF'
{"event_id":"cov-acceptance-12345678","event_type":"coverage.connected","coverage_target":"acceptance-history"}
{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/ok.jsonl" >"$tmp/ok.edn"
bb ai_ops_sli.bb emit-sim fixtures/synthetic-events.jsonl 4 10 20 2>"$tmp/down.stats" >"$tmp/down.jsonl"
bb ai_ops_sli.bb prom "$tmp/ok.jsonl" >"$tmp/ok.prom"

mkdir -p "$tmp/root/runs/BOXP-999/20261020T010000Z-abcd" "$tmp/root/outbox" "$tmp/vault/Tickets"
cat >"$tmp/vault/Tickets/BOXP-999.md" <<'EOF'
---
created: 2026-10-20
status: done
closed: 2026-10-21
---
EOF
cat >"$tmp/root/runs/BOXP-999/20261020T010000Z-abcd/summary.edn" <<'EOF'
{:ticket "BOXP-999" :run-id "20261020T010000Z-abcd" :agent "codex" :status :succeeded :result "Bearer fake-secret" :blocker-category "sk-abcdef" :finished-at "2026-10-20T02:00:00Z"}
EOF
bb ai_ops_sli.bb extract "$tmp/root" "$tmp/vault" >"$tmp/extract.jsonl" 2>"$tmp/extract.stats"
bb ai_ops_sli.bb aggregate "$tmp/extract.jsonl" >"$tmp/extract.edn"
bb ai_ops_sli.bb prom "$tmp/extract.jsonl" >"$tmp/extract.prom"
cat >"$tmp/timing.jsonl" <<'EOF'
{"synthetic":true,"event_id":"a1","task_id":"S1","event_type":"task.accepted","occurred_at":"2026-10-20T02:00:00Z"}
{"synthetic":true,"event_id":"a2","task_id":"S1","event_type":"correction","correction_origin":"agent-system","occurred_at":"2026-10-20T03:00:00Z"}
{"synthetic":true,"event_id":"b1","task_id":"S2","event_type":"task.accepted","occurred_at":"2026-10-20T02:00:00Z"}
{"synthetic":true,"event_id":"b2","task_id":"S2","event_type":"correction","correction_origin":"non-agent","occurred_at":"2026-10-20T01:00:00Z"}
EOF
cat >>"$tmp/timing.jsonl" <<'EOF'
{"event_id":"cov-one-12345678","event_type":"coverage.connected","coverage_target":"acceptance-history"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/timing.jsonl" >"$tmp/timing.edn"
cat >"$tmp/coverage.jsonl" <<'EOF'
{"event_id":"cov-one-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
{"event_id":"cov-two-12345678","event_type":"coverage.connected","coverage_target":"critical-safety-events"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/coverage.jsonl" >"$tmp/coverage.edn"
cat >"$tmp/vault/Tickets/BOXP-998.md" <<'EOF'
---
created: 2026-10-20
status: backlog
closed:
---
EOF
cat >"$tmp/vault/Tickets/BOXP-997.md" <<'EOF'
---
created: 2026-10-20
status: ready
closed: 2026-10-21
---
EOF
bb ai_ops_sli.bb extract "$tmp/root" "$tmp/vault" >"$tmp/backlog.jsonl" 2>"$tmp/backlog.stats"
bb ai_ops_sli.bb aggregate "$tmp/backlog.jsonl" >"$tmp/backlog.edn"
cat >"$tmp/regression.jsonl" <<'EOF'
{"event_id":"BOXP-1:requested","task_id":"BOXP-1","request_id":"req:BOXP-1","event_type":"request.received","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-1:accepted","task_id":"BOXP-1","event_type":"task.accepted","occurred_at":"2026-10-21T00:00:00Z"}
{"event_id":"BOXP-1:reopened","task_id":"BOXP-1","event_type":"task.reopened","occurred_at":"2026-10-22T00:00:00Z"}
{"event_id":"BOXP-1:effect","task_id":"BOXP-1","event_type":"effect.applied","effect_key":"op:shared"}
{"event_id":"BOXP-2:requested","task_id":"BOXP-2","request_id":"req:BOXP-2","event_type":"request.received"}
{"event_id":"BOXP-2:effect","task_id":"BOXP-2","event_type":"effect.applied","effect_key":"op:shared"}
{"event_id":"BOXP-1:approval","task_id":"BOXP-1","event_type":"approval.requested","approval_key":"op:shared"}
{"event_id":"BOXP-2:approval","task_id":"BOXP-2","event_type":"approval.requested","approval_key":"op:shared"}
{"event_id":"BOXP-1:rescue","task_id":"BOXP-1","event_type":"owner.rescue"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/regression.jsonl" >"$tmp/unconnected.edn"
cat >>"$tmp/regression.jsonl" <<'EOF'
{"event_id":"BOXP-1:coverage","event_type":"coverage.connected","coverage_target":"acceptance-history"}
{"event_id":"BOXP-2:coverage","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/regression.jsonl" >"$tmp/connected.edn"
cat >"$tmp/secrets.jsonl" <<'EOF'
{"event_id":"BOXP-1:a","result":"ghp_abcdefgh1234567890"}
{"event_id":"BOXP-1:b","status":"github_pat_abcdefgh1234567890"}
{"event_id":"BOXP-1:c","effect_key":"xoxb-abcdefgh1234567890"}
{"event_id":"BOXP-1:d","effect_key":"AKIA1234567890ABCDEF"}
{"event_id":"BOXP-1:e","effect_key":"aB3dE5fG7hJ9kL2mN4pQ6rS8tU1vW3xY5zA7bC9d"}
EOF
bb ai_ops_sli.bb emit-sim "$tmp/secrets.jsonl" 10 >"$tmp/secrets.out" 2>"$tmp/secrets.stats"
bb -e '
(load-file "ai_ops_sli.bb")
(let [es (map #(cheshire.core/parse-string % true) (clojure.string/split-lines (slurp (first *command-line-args*))))
      gated (map ai-ops-sli/privacy-gate es)]
  (assert (= 5 (reduce + (map :redacted-values gated))))
  (assert (every? #(some #{"redacted"} (vals (:event %))) gated)))' "$tmp/secrets.jsonl"
cat >"$tmp/reopen.jsonl" <<'EOF'
{"event_id":"BOXP-1:request","task_id":"BOXP-1","event_type":"request.received"}
{"event_id":"BOXP-1:run","task_id":"BOXP-1","event_type":"run.started"}
{"event_id":"BOXP-1:accepted","task_id":"BOXP-1","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-1:state","task_id":"BOXP-1","event_type":"task.state","status":"ready","occurred_at":"2026-10-21T00:00:00Z"}
{"event_id":"BOXP-2:request","task_id":"BOXP-2","event_type":"request.received"}
{"event_id":"BOXP-2:run","task_id":"BOXP-2","event_type":"run.started"}
{"event_id":"BOXP-2:accepted","task_id":"BOXP-2","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-2:state","task_id":"BOXP-2","event_type":"task.state","status":"review"}
{"event_id":"BOXP-3:request","task_id":"BOXP-3","event_type":"request.received"}
{"event_id":"BOXP-3:run","task_id":"BOXP-3","event_type":"run.started"}
{"event_id":"BOXP-3:accepted","task_id":"BOXP-3","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-3:state","task_id":"BOXP-3","event_type":"task.state","status":"blocked"}
{"event_id":"invalid one","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
{"event_id":"invalid two","event_type":"coverage.connected","coverage_target":"critical-safety-events"}
{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
{"event_id":"cov-safety-12345678","event_type":"coverage.connected","coverage_target":"critical-safety-events"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/reopen.jsonl" >"$tmp/reopen.edn"
bb -e '
(let [r (edn/read-string (slurp (first *command-line-args*)))]
  (assert (= {"in-flight" 1 "awaiting-review" 1 "blocked" 1} (get-in r [:tasks :outcomes])))
  (assert (= [0 0 0] ((juxt :count :denominator :not-yet-evaluated) (get-in r [:sli :first-acceptance-conformance]))))
  (assert (= 2 (get-in r [:coverage :privacy-rejected-invalid-id])))
  (assert (= 0 (get-in r [:input :duplicates])))
  (assert (= 0 (get-in r [:zero-tolerance :duplicate-effects :count])))
  (assert (= 0 (get-in r [:zero-tolerance :critical-safety-events])))
  (println "ok   reopen 状態、不正 ID の拒否と複数 coverage"))' "$tmp/reopen.edn"

cat >"$tmp/privacy-prom.jsonl" <<'EOF'
{"event_id":"invalid id","source":"derived\"\nsk-secret-token","event_type":"run.started\"\nsk-secret-token"}
{"event_id":"BOXP-1:unsafe","source":"derived\"\nsk-secret-token","event_type":"run.started\"\nsk-secret-token"}
{"event_id":"BOXP-1:valid","source":"derived","event_type":"run.started"}
EOF
bb ai_ops_sli.bb prom "$tmp/privacy-prom.jsonl" >"$tmp/privacy-prom.out"
python3 - "$tmp/privacy-prom.out" <<'PYTEST'
import re, sys
text = open(sys.argv[1]).read()
assert 'secret' not in text and 'redacted' not in text
lines = text.splitlines()
assert 'ai_ops_events_total{source="other",event_type="other"} 1' in lines
assert 'ai_ops_events_total{source="derived",event_type="run.started"} 1' in lines
for line in lines:
    assert line.startswith('# ') or re.fullmatch(r'[a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[a-zA-Z_]+="[a-zA-Z0-9:._/-]+"(?:,[a-zA-Z_]+="[a-zA-Z0-9:._/-]+")*\})? [0-9]+', line), line
print('ok   Prometheus privacy gate と exposition')
PYTEST
cat >"$tmp/history.jsonl" <<'EOF'
{"event_id":"BOXP-9:accepted","task_id":"BOXP-9","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-9:reopened","task_id":"BOXP-9","event_type":"task.reopened","occurred_at":"2026-10-21T00:00:00Z"}
{"event_id":"BOXP-9:state","task_id":"BOXP-9","event_type":"task.state","status":"ready","occurred_at":"2026-10-22T00:00:00Z"}
{"event_id":"BOXP-9:coverage","event_type":"coverage.connected","coverage_target":"acceptance-history"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/history.jsonl" >"$tmp/history.edn"
bb -e '
(let [r (edn/read-string (slurp (first *command-line-args*)))]
  (assert (= [1 1] ((juxt :count :denominator) (get-in r [:sli :reopen-after-accept]))))
  (assert (= 1 (get-in r [:tasks :outcomes "in-flight"])))
  (println "ok   再オープン後 Ready の受入履歴"))' "$tmp/history.edn"
bb -e '
(let [[dir] *command-line-args* r #(edn/read-string (slurp (str dir "/" % ".edn")))
      b (r "backlog") u (r "unconnected") c (r "connected") stats (edn/read-string (slurp (str dir "/secrets.stats")))
      checks [["未実行 backlog と Ready を分母に含む" (and (= 3 (get-in b [:tasks :total])) (= 2 (get-in b [:tasks :never-run])) (= 1 (get-in b [:tasks :outcomes "backlog"])) (= 2 (get-in b [:guardrails :unfinished])))]
              ["closed の再オープンを抽出" (and (re-find #"BOXP-997:accepted" (slurp (str dir "/backlog.jsonl"))) (re-find #"BOXP-997:reopened" (slurp (str dir "/backlog.jsonl"))))]
              ["未宣言でも観測した重複を部分 coverage で報告" (= [1 "partial/undeclared"] ((juxt :count :coverage) (get-in u [:zero-tolerance :duplicate-effects])))]
              ["受入履歴未接続は unknown" (= :unknown (get-in u [:sli :reopen-after-accept :status]))]
              ["履歴接続時に再オープンと受入を計上" (= [1 1] ((juxt :count :denominator) (get-in c [:sli :reopen-after-accept])))]
              ["タスク間の effect と承認の重複" (and (= [1 2] ((juxt :count :tasks-involved) (get-in c [:zero-tolerance :duplicate-effects]))) (= [1 2] ((juxt :count :tasks-involved) (get-in c [:sli :duplicate-approval]))))]
              ["run 履歴無し受入は first-pass 分母外で別掲" (and (= 0 (get-in u [:sli :first-acceptance-conformance :denominator])) (= 1 (get-in u [:tasks :accepted-without-run-history])))]
              ["Owner rescue に未実行を含む" (= [1 2] ((juxt :count :denominator) (get-in c [:sli :owner-rescue])))]
              ["秘密値を emit-sim でも 5 件 redact" (and (= 5 (:privacy-redacted-values stats)) (= 5 (count (re-seq #"redacted" (slurp (str dir "/secrets.out"))))))]]]
  (doseq [[label ok] checks] (println (if ok "ok  " "FAIL") label))
  (when (some (comp not second) checks) (System/exit 1)))' "$tmp"
bb -e '
(let [[ok okst down prom extract extractst extracted timing coverage extractprom] *command-line-args*
      r (edn/read-string (slurp ok)) st (edn/read-string (slurp okst)) d (edn/read-string (slurp down))
      checks
      [["privacy gate が本文/引数 key を落とす" (= 2 (:privacy-dropped-keys st))]
       ["credential 値を redact" (= 1 (:privacy-redacted-values st))]
       ["extract でも危険値を redact" (and (= 2 (:privacy-redacted-values (edn/read-string (slurp extractst)))) (not (re-find #"Bearer|sk-abcdef" (slurp extract))))]
       ["source 未接続は unknown" (every? #(= "unknown" (get-in (edn/read-string (slurp extracted)) [:zero-tolerance % :status])) [:duplicate-effects :critical-safety-events])]
       ["coverage 宣言済みなら 0" (and (= 0 (get-in (edn/read-string (slurp coverage)) [:zero-tolerance :duplicate-effects :count])) (= 0 (get-in (edn/read-string (slurp coverage)) [:zero-tolerance :critical-safety-events])))]
       ["未知の zero-tolerance を Prom に出さない" (not (re-find #"duplicate_effect|critical_safety" (slurp extractprom)))]
       ["受入前の非 agent 是正のみ first-pass を妨げ、受入後は reopen" (let [r (edn/read-string (slurp timing))] (and (= [1 2] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance]))) (= 1 (get-in r [:sli :reopen-after-accept :count]))))]
       ["生成元に本文が残らない" (not (re-find #"送ってはいけない|Bearer|/secret" (slurp (str (fs/parent ok) "/ok.jsonl"))))]
       ["重複 event を 1 件として数える" (= 1 (get-in r [:input :duplicates]))]
       ["順序逆転を検知" (= 1 (get-in r [:input :order-inversions]))]
       ["時刻ずれを検知" (= 1 (get-in r [:input :clock-skew-gt-5m]))]
       ["取消/阻害/保留を outcome に残す" (= {"accepted" 2 "cancelled" 1 "blocked" 1 "awaiting-review" 2 "in-flight" 1} (get-in r [:tasks :outcomes]))]
       ["ticket なし会話も request_id で task 化" (= 7 (get-in r [:tasks :total]))]
       ["人の訂正が rule 判定を上書き (S3 は非 agent 起因)" (= 0 (get-in r [:sli :agent-system-correction-task-ratio :unknown-cause-tasks]))]
       ["agent-system 是正 task 1/4 (S2)" (= [1 4] ((juxt :count :denominator) (get-in r [:sli :agent-system-correction-task-ratio])))]
       ["first acceptance: 受入 2 中 1、未評価 2 は合格扱いしない" (= [1 2 2] ((juxt :count :denominator :not-yet-evaluated) (get-in r [:sli :first-acceptance-conformance])))]
       ["close 後 late feedback を reopen-after-accept に計上" (= 1 (get-in r [:sli :reopen-after-accept :count]))]
       ["Owner 救援" (= 1 (get-in r [:sli :owner-rescue :count]))]
       ["同 scope 重複承認" (= [1 1] ((juxt :count :denominator) (get-in r [:sli :duplicate-approval])))]
       ["二重実行は zero-tolerance に計上" (= 1 (get-in r [:zero-tolerance :duplicate-effects :count]))]
       ["重大 event" (= 1 (get-in r [:zero-tolerance :critical-safety-events]))]
       ["途中再起動 (interrupted) を保持" (= 1 (get-in r [:sli :run-reliability :interrupted]))]
       ["private leak は 0 でなく unknown" (= "unknown" (get-in r [:zero-tolerance :private-leak :status]))]
       ["collector 停止中も emit は継続し drop を数える" (and (= 42 (:emitted d)) (= 7 (:buffer-dropped d)) (= 35 (:delivered d)))]
       ["Prom に task/run ID を出さない" (not (re-find #"S[0-9]|req:|run_id|task_id" (slurp prom)))]]
      bad (remove second checks)]
  (doseq [[n ok?] checks] (println (if ok? "ok  " "FAIL") n))
  (System/exit (if (seq bad) 1 0)))' "$tmp/ok.edn" "$tmp/ok.stats" "$tmp/down.stats" "$tmp/ok.prom" "$tmp/extract.jsonl" "$tmp/extract.stats" "$tmp/extract.edn" "$tmp/timing.edn" "$tmp/coverage.edn" "$tmp/extract.prom"
