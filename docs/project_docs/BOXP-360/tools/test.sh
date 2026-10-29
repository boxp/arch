#!/usr/bin/env bash
# BOXP-360 合成 E2E: drop なし / collector 停止 (bounded buffer drop) の 2 シナリオを検証する
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

bb ai_ops_sli.bb emit-sim --synthetic fixtures/synthetic-events.jsonl 64 2>"$tmp/ok.stats" >"$tmp/ok.jsonl"
cat >>"$tmp/ok.jsonl" <<'EOF'
{"event_id":"cov-acceptance-12345678","event_type":"coverage.connected","coverage_target":"acceptance-history"}
{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
EOF
bb ai_ops_sli.bb aggregate --synthetic "$tmp/ok.jsonl" >"$tmp/ok.edn"
bb ai_ops_sli.bb emit-sim --synthetic fixtures/synthetic-events.jsonl 4 10 20 2>"$tmp/down.stats" >"$tmp/down.jsonl"
bb ai_ops_sli.bb prom --synthetic "$tmp/ok.jsonl" >"$tmp/ok.prom"

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
bb ai_ops_sli.bb aggregate --synthetic "$tmp/timing.jsonl" >"$tmp/timing.edn"
cat >"$tmp/invalid-origin.jsonl" <<'EOF'
{"event_id":"BOXP-1:run","task_id":"BOXP-1","event_type":"run.started"}
{"event_id":"BOXP-1:correction","task_id":"BOXP-1","event_type":"correction","correction_origin":"invalid","correction_class":"invalid","occurred_at":"2026-10-20T01:00:00Z"}
{"event_id":"BOXP-1:accepted","task_id":"BOXP-1","event_type":"task.accepted","occurred_at":"2026-10-20T02:00:00Z"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/invalid-origin.jsonl" >"$tmp/invalid-origin.edn"
bb -e '
(load-file "ai_ops_sli.bb")
(let [r (edn/read-string (slurp (first *command-line-args*)))
      gated (:event (ai-ops-sli/privacy-gate {:event_id "BOXP-1:test" :correction_origin "invalid" :correction_class "invalid"}))]
  (assert (= ["redacted" "redacted"] ((juxt :correction_origin :correction_class) gated)))
  (assert (= "unknown" (ai-ops-sli/correction-origin gated)))
  (assert (= "agent-system" (ai-ops-sli/correction-origin (assoc gated :correction_class "source_mismatch"))))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :unknown-cause-tasks])))
  (assert (= [0 1] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance]))))
  (println "ok   不正な origin と class は unknown として first-pass 不合格"))' "$tmp/invalid-origin.edn"
cat >"$tmp/coverage.jsonl" <<'EOF'
{"event_id":"cov-one-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
{"event_id":"cov-two-12345678","event_type":"coverage.connected","coverage_target":"critical-safety-events"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/coverage.jsonl" >"$tmp/coverage.edn"
cat >"$tmp/invalid-severity.jsonl" <<'EOF'
{"event_id":"BOXP-1:safety","event_type":"correction","severity":"invalid"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/invalid-severity.jsonl" >"$tmp/invalid-severity.edn"
bb -e '
(let [r (edn/read-string (slurp (first *command-line-args*)))]
  (assert (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (println "ok   不正 severity は safety source 接続の証拠にならない"))' "$tmp/invalid-severity.edn"
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
bb -e '
(let [events (map #(cheshire.core/parse-string % true) (clojure.string/split-lines (slurp (first *command-line-args*))))
      state (some #(when (= "BOXP-997:state" (:event_id %)) %) events)
      done (some #(when (= "BOXP-999:state" (:event_id %)) %) events)]
  (assert (= "current" (:snapshot state)))
  (assert (= ["current" "done"] ((juxt :snapshot :status) done)))
  (println "ok   extract は現在状態の snapshot を明示"))' "$tmp/backlog.jsonl"
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
  (assert (= {"in-flight" 1 "accepted" 2} (get-in r [:tasks :outcomes])))
  (assert (= [2 2 0] ((juxt :count :denominator :not-yet-evaluated) (get-in r [:sli :first-acceptance-conformance]))))
  (assert (= 2 (get-in r [:coverage :privacy-rejected-invalid-id])))
  (assert (= 0 (get-in r [:input :duplicates])))
  (assert (= 0 (get-in r [:zero-tolerance :duplicate-effects :count])))
  (assert (= 0 (get-in r [:zero-tolerance :critical-safety-events])))
  (println "ok   reopen 状態、不正 ID の拒否と複数 coverage"))' "$tmp/reopen.edn"

cat >"$tmp/spoof.jsonl" <<'EOF'
{"event_id":"patient:john-doe","synthetic":true,"task_id":"BOXP-1","event_type":"task.accepted"}
EOF
bb ai_ops_sli.bb emit-sim "$tmp/spoof.jsonl" >"$tmp/spoof.out" 2>"$tmp/spoof.stats"
bb ai_ops_sli.bb aggregate "$tmp/spoof.jsonl" >"$tmp/spoof.edn"
bb -e '
(let [[out stats report] *command-line-args*]
  (assert (= 1 (:privacy-rejected (edn/read-string (slurp stats)))))
  (assert (= 1 (get-in (edn/read-string (slurp report)) [:coverage :privacy-rejected-invalid-id])))
  (assert (not (re-find #"patient" (str (slurp out) (slurp stats) (slurp report)))))
  (println "ok   synthetic フィールドによる ID 制約の回避を拒否"))' "$tmp/spoof.out" "$tmp/spoof.stats" "$tmp/spoof.edn"

cat >"$tmp/reopened-only.jsonl" <<'EOF'
{"event_id":"BOXP-10:reopened","task_id":"BOXP-10","event_type":"task.reopened","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-10:accepted","task_id":"BOXP-10","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-11:accepted","task_id":"BOXP-11","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-11:reopened","task_id":"BOXP-11","event_type":"task.reopened","occurred_at":"2026-10-21T00:00:00Z"}
{"event_id":"BOXP-11:accepted-again","task_id":"BOXP-11","event_type":"task.accepted","occurred_at":"2026-10-22T00:00:00Z"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/reopened-only.jsonl" >"$tmp/reopened-only.edn"
bb -e '
(let [r (edn/read-string (slurp (first *command-line-args*)))]
  (assert (= {"in-flight" 1 "accepted" 1} (get-in r [:tasks :outcomes])))
  (assert (= 1 (get-in r [:guardrails :unfinished])))
  (println "ok   再オープン単独、同時刻の優先順位と再受入"))' "$tmp/reopened-only.edn"

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
cat >"$tmp/duplicate-prom.jsonl" <<'EOF'
{"event_id":"BOXP-1:run","source":"derived","event_type":"run.started"}
{"event_id":"BOXP-1:run","source":"derived","event_type":"run.started","redelivery":1}
{"event_id":"BOXP-1:accepted","source":"derived","event_type":"task.accepted"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/duplicate-prom.jsonl" >"$tmp/duplicate-prom.edn"
bb ai_ops_sli.bb prom "$tmp/duplicate-prom.jsonl" >"$tmp/duplicate-prom.out"
bb -e '
(let [[report prom] *command-line-args*
      unique (get-in (edn/read-string (slurp report)) [:input :unique])
      counts (map (comp parse-long second) (re-seq #"(?m)^ai_ops_events_total\{[^}]+\} (\d+)$" (slurp prom)))]
  (assert (= 2 unique (reduce + counts)))
  (println "ok   Prometheus のイベント数は重複排除後の集計と一致"))' "$tmp/duplicate-prom.edn" "$tmp/duplicate-prom.out"
cat >"$tmp/four-fixes.jsonl" <<'EOF'
{"event_id":"BOXP-100:critical","event_type":"correction","severity":"critical"}
{"event_id":"BOXP-100:critical","event_type":"correction","severity":"critical"}
{"event_id":"invalid id","severity":"critical"}
{"event_id":"BOXP-101:req","task_id":"conv-12345678","request_id":"req-12345678","event_type":"request.received"}
{"event_id":"BOXP-102:req","task_id":"conv-abcdefgh","request_id":"req-abcdefgh","event_type":"request.received"}
{"event_id":"BOXP-101:approval1","event_type":"approval.requested","approval_key":"op:one"}
{"event_id":"BOXP-101:approval2","event_type":"approval.requested","approval_key":"op:one"}
{"event_id":"BOXP-101:approval3","event_type":"approval.requested","approval_key":"op:one"}
{"event_id":"BOXP-101:run","task_id":"conv-12345678","event_type":"run.started"}
{"event_id":"BOXP-101:accepted","task_id":"conv-12345678","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-101:correction","task_id":"conv-12345678","event_type":"correction","occurred_at":"2026-10-20T00:00:00Z"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/four-fixes.jsonl" >"$tmp/four-fixes.edn"
bb -e '
(load-file "ai_ops_sli.bb")
(let [r (edn/read-string (slurp (first *command-line-args*)))
      checks [["孤立した重大 event は重複排除して計上" (= 1 (get-in r [:zero-tolerance :critical-safety-events]))]
              ["通常モードの会話 ID は別 task として保持" (and (= 2 (get-in r [:tasks :total])) (= 2 (get-in r [:guardrails :tasks-per-request :denominator])) (every? #(not (ai-ops-sli/valid-value? :task_id %)) ["conv-sk-abcdefgh" "conv-abcdefghijklmnopqrstuvwxyz1234567890" "conv-abc/defgh" "conv-ABCDEFGH"]))]
              ["重複承認率の分母は承認イベント総数" (= [2 3] ((juxt :count :denominator) (get-in r [:sli :duplicate-approval])))]
              ["受入と同時刻の是正は first-pass 不合格" (= [0 1] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance])))]]]
  (doseq [[label ok] checks] (println (if ok "ok  " "FAIL") label))
  (when (some (comp not second) checks) (System/exit 1)))' "$tmp/four-fixes.edn"
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
              ["再オープン済みは受入済みとして数えない" (and (= 0 (get-in u [:sli :first-acceptance-conformance :denominator])) (= 0 (get-in u [:tasks :accepted-without-run-history])))]
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
       ["受入前の非 agent 是正は first-pass を妨げず、受入後は reopen" (let [r (edn/read-string (slurp timing))] (and (= [2 2] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance]))) (= 1 (get-in r [:sli :reopen-after-accept :count]))))]
       ["生成元に本文が残らない" (not (re-find #"送ってはいけない|Bearer|/secret" (slurp (str (fs/parent ok) "/ok.jsonl"))))]
       ["重複 event を 1 件として数える" (= 1 (get-in r [:input :duplicates]))]
       ["順序逆転を検知" (= 1 (get-in r [:input :order-inversions]))]
       ["時刻ずれを検知" (= 1 (get-in r [:input :clock-skew-gt-5m]))]
       ["取消/阻害/保留を outcome に残す" (= {"accepted" 1 "cancelled" 1 "blocked" 1 "awaiting-review" 1 "in-flight" 3} (get-in r [:tasks :outcomes]))]
       ["ticket なし会話も request_id で task 化" (= 7 (get-in r [:tasks :total]))]
       ["人の訂正が rule 判定を上書き (S3 は非 agent 起因)" (= 0 (get-in r [:sli :agent-system-correction-task-ratio :unknown-cause-tasks]))]
       ["agent-system 是正 task 1/4 (S2)" (= [1 4] ((juxt :count :denominator) (get-in r [:sli :agent-system-correction-task-ratio])))]
       ["first acceptance: 受入 1 中 1、未評価 2 は合格扱いしない" (= [1 1 2] ((juxt :count :denominator :not-yet-evaluated) (get-in r [:sli :first-acceptance-conformance])))]
       ["close 後 late feedback を reopen-after-accept に計上" (= 1 (get-in r [:sli :reopen-after-accept :count]))]
       ["Owner 救援" (= 1 (get-in r [:sli :owner-rescue :count]))]
       ["同 scope 重複承認" (= [1 2] ((juxt :count :denominator) (get-in r [:sli :duplicate-approval])))]
       ["二重実行は zero-tolerance に計上" (= 1 (get-in r [:zero-tolerance :duplicate-effects :count]))]
       ["重大 event" (= 1 (get-in r [:zero-tolerance :critical-safety-events]))]
       ["途中再起動 (interrupted) を保持" (= 1 (get-in r [:sli :run-reliability :interrupted]))]
       ["private leak は 0 でなく unknown" (= "unknown" (get-in r [:zero-tolerance :private-leak :status]))]
       ["collector 停止中も emit は継続し drop を数える" (and (= 42 (:emitted d)) (= 7 (:buffer-dropped d)) (= 35 (:delivered d)))]
       ["Prom に task/run ID を出さない" (not (re-find #"S[0-9]|req:|run_id|task_id" (slurp prom)))]]
      bad (remove second checks)]
  (doseq [[n ok?] checks] (println (if ok? "ok  " "FAIL") n))
  (System/exit (if (seq bad) 1 0)))' "$tmp/ok.edn" "$tmp/ok.stats" "$tmp/down.stats" "$tmp/ok.prom" "$tmp/extract.jsonl" "$tmp/extract.stats" "$tmp/extract.edn" "$tmp/timing.edn" "$tmp/coverage.edn" "$tmp/extract.prom"

bb -e '
(load-file "ai_ops_sli.bb")
(let [documented {:event_type ["request.received" "run.started" "run.finished" "run.interrupted" "correction" "task.reopened" "approval.requested" "approval.resolved" "effect.applied" "owner.rescue" "lane.changed" "task.accepted" "task.cancelled" "task.state" "notify.run-finished" "coverage.connected"]
                  :correction_class ["instruction_violation" "source_mismatch" "done_claim_without_execution" "assignee_regression" "gate_defect" "preference_adjustment" "scope_addition" "unavoidable_safety_decision" "external_failure" "unknown"]
                  :correction_origin ["agent-system" "non-agent" "unknown"] :classifier ["rule" "human" "model"]
                  :schema_version ["ai-ops-event/v0"] :classifier_version ["correction-rules/v0"]
                  :status ["done" "closed" "accepted" "blocked" "interrupted" "review" "ready"]
                  :source ["task-board-runner" "ticket-frontmatter" "derived" "outbox:task-board-runner" "outbox:board-diff"]
                  :coverage_target ["duplicate-effects" "critical-safety-events" "acceptance-history"] :cost_source ["unknown"]
                  :stratum ["creative" "dev" "infra" "research" "assistant" "assistant-or-research"]}
      ids ["req-abcdefgh" "conv-abcdefgh/event:1" "req-abcdefgh/started" "BOXP-1:started" "cov-one-12345678"]]
  (doseq [[k values] documented v values]
    (let [r (ai-ops-sli/privacy-gate {:event_id "BOXP-1:test" k v})]
      (assert (= v (get (:event r) k)) (str k " " v))))
  (doseq [id ids] (assert (= id (:event_id (:event (ai-ops-sli/privacy-gate {:event_id id :parent_event_id id :evidence_event_ids [id]}))))))
  (doseq [id ["conv-short" "conv-ABCDEFGH" "req-abcdefgh/sk-secretvalue" (str "req-abcdefgh/" (apply str (repeat 120 "a")))]]
    (assert (:rejected? (ai-ops-sli/privacy-gate {:event_id id}))))
  (doseq [[class origin] ai-ops-sli/correction-class-origin]
    (assert (= origin (ai-ops-sli/correction-origin {:correction_class class}))))
  (println "ok   文書化された enum、会話 event ID と是正原因"))'
cat >"$tmp/snapshot-precedence.jsonl" <<'EOF'
{"event_id":"conv-abcdefgh/run","task_id":"conv-abcdefgh","event_type":"run.started","occurred_at":"2026-10-19T00:00:00Z"}
{"event_id":"conv-abcdefgh/state","task_id":"conv-abcdefgh","event_type":"task.state","status":"review"}
{"event_id":"conv-abcdefgh/accepted","task_id":"conv-abcdefgh","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"conv-abcdefgh/approval","task_id":"conv-abcdefgh","event_type":"approval.resolved","approval_key":"op:one"}
{"event_id":"conv-ijklmnop/run","task_id":"conv-ijklmnop","event_type":"run.started","occurred_at":"2026-10-19T00:00:00Z"}
{"event_id":"conv-ijklmnop/accepted","task_id":"conv-ijklmnop","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"conv-ijklmnop/correction","task_id":"conv-ijklmnop","event_type":"correction","correction_class":"source_mismatch"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/snapshot-precedence.jsonl" >"$tmp/snapshot-precedence.edn"
bb -e '
(let [r (edn/read-string (slurp (first *command-line-args*)))]
  (assert (= 2 (get-in r [:tasks :outcomes "accepted"])))
  (assert (= [1 2] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance]))))
  (assert (= [1 2] ((juxt :count :denominator) (get-in r [:sli :agent-system-correction-task-ratio]))))
  (println "ok   時刻なし snapshot と是正、承認解決の集計"))' "$tmp/snapshot-precedence.edn"

bb -e '
(load-file "ai_ops_sli.bb")
(let [base {:run-id "20261020T010000Z-abcd" :agent "codex"}
      running (ai-ops-sli/summary->events "BOXP-1" (assoc base :status :running))
      interrupted (ai-ops-sli/summary->events "BOXP-2" (assoc base :status :interrupted))
      finished-at "2026-10-20T02:00:00Z"
      interrupted-finished (ai-ops-sli/summary->events "BOXP-3" (assoc base :status :interrupted :finished-at finished-at))
      report (ai-ops-sli/aggregate* (concat running interrupted interrupted-finished))]
  (assert (= ["run.started"] (mapv :event_type running)))
  (assert (= ["run.started" "run.interrupted"] (mapv :event_type interrupted)))
  (assert (= ["run.started" "run.interrupted"] (mapv :event_type interrupted-finished)))
  (assert (= finished-at (:occurred_at (second interrupted-finished))))
  (assert (= [3 2] ((juxt :runs :interrupted) (get-in report [:sli :run-reliability]))))
  (println "ok   実行中と中断済みを区別"))
(let [base {:task_id "BOXP-1"}
      events [(merge base {:event_id "BOXP-1:run" :event_type "run.started"})
              (merge base {:event_id "BOXP-1:review" :event_type "task.state" :status "review" :result "review" :occurred_at "2026-10-20T00:00:00Z"})
              (merge base {:event_id "BOXP-1:rule" :event_type "correction" :classifier "rule" :correction_origin "agent-system"})
              (merge base {:event_id "BOXP-1:human" :event_type "correction" :classifier "human" :correction_origin "non-agent"})
              (merge base {:event_id "BOXP-1:rule2" :event_type "correction" :classifier "rule" :correction_origin "agent-system" :evidence_event_ids ["BOXP-1:run"]})
              (merge base {:event_id "BOXP-1:human2" :event_type "correction" :classifier "human" :correction_origin "non-agent" :evidence_event_ids ["BOXP-1:run"]})]
      report (ai-ops-sli/aggregate* events)]
  (assert (= 1 (get-in report [:sli :corrections-per-task :total-agent-system])))
  (println "ok   evidence がない訂正は他の分類を上書きしない"))
(let [events [{:event_id "BOXP-1:a" :task_id "invalid one" :event_type "run.started"}
              {:event_id "BOXP-2:a" :task_id "invalid two" :event_type "run.started"}
              {:event_id "BOXP-3:a" :task_id "BOXP-3" :request_id "invalid" :event_type "run.started"}
              {:event_id "BOXP-4:a" :task_id "BOXP-4" :run_id "invalid" :event_type "run.started"}
              {:event_id "BOXP-5:a" :task_id "BOXP-5" :event_type "run.started"}]
      report (ai-ops-sli/aggregate* events)]
  (assert (= 4 (get-in report [:coverage :privacy-rejected-invalid-correlation-id])))
  (assert (= 1 (get-in report [:tasks :total])))
  (assert (= 1 (get-in report [:sli :run-reliability :runs])))
  (assert (every? :rejected? (map ai-ops-sli/privacy-gate (butlast events))))
  (println "ok   不正な correlation ID のイベントを集計から除外"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-1:run" :task_id "BOXP-1" :event_type "run.started"}
            {:event_id "BOXP-1:accepted" :task_id "BOXP-1" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
            {:event_id "BOXP-1:reopened" :task_id "BOXP-1" :event_type "task.reopened" :occurred_at "2026-10-21T00:00:00Z"}]]
  (doseq [[state outcome] [["review" "awaiting-review"] ["blocked" "blocked"] ["done" "accepted"]]]
    (let [snapshot {:event_id "BOXP-1:state" :task_id "BOXP-1" :event_type "task.state" :snapshot "current" :status state}
          report (ai-ops-sli/aggregate* (conj base snapshot))]
      (assert (= 1 (get-in report [:tasks :outcomes outcome])))
      (when (= state "done")
        (assert (= [1 1] ((juxt :count :denominator) (get-in report [:sli :first-acceptance-conformance])))))
      (assert (= "current" (get-in (ai-ops-sli/privacy-gate snapshot) [:event :snapshot])))))
  (println "ok   現在の review / blocked / done snapshot は再オープン履歴より優先"))
(let [base [{:event_id "BOXP-2:run" :task_id "BOXP-2" :event_type "run.started"}
            {:event_id "BOXP-2:rule" :task_id "BOXP-2" :event_type "correction" :classifier "rule" :correction_class "source_mismatch" :correction_origin "agent-system" :evidence_event_ids ["BOXP-2:run"] :occurred_at "2026-10-19T00:00:00Z"}
            {:event_id "BOXP-2:accepted" :task_id "BOXP-2" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
            {:event_id "cov-acceptance-12345678" :event_type "coverage.connected" :coverage_target "acceptance-history"}]]
  (doseq [[class passes] [["source_mismatch" 0] ["preference_adjustment" 1]]]
    (let [human {:event_id "BOXP-2:human" :task_id "BOXP-2" :event_type "correction" :classifier "human" :correction_class class :evidence_event_ids ["BOXP-2:run"] :occurred_at "2026-10-21T00:00:00Z"}
          report (ai-ops-sli/aggregate* (conj base human))]
      (assert (= [passes 1] ((juxt :count :denominator) (get-in report [:sli :first-acceptance-conformance]))))
      (assert (= 0 (get-in report [:sli :reopen-after-accept :count])))))
  (println "ok   人の再分類は元の是正時刻を保持"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [event {:event_id "BOXP-1:event" :event_type "run.started" :source "synthetic:hermes"}
      status #(get-in (ai-ops-sli/aggregate* %) [:coverage :hermes-conversation :status])]
  (assert (= "connected" (status [event])))
  (assert (= "not-connected" (status [(dissoc event :source)])))
  (assert (= "connected" (status [(assoc event :source "derived" :runtime "hermes")])))
  (assert (= "connected" (status [{:event_id "cov-hermes-12345678" :event_type "coverage.connected" :coverage_target "hermes-conversation"}])))
  (println "ok   Hermes の source、runtime、coverage 接続と未接続"))
(let [events [{:event_id "BOXP-1:run" :task_id "BOXP-1" :event_type "run.started" :stratum "infra"}
              {:event_id "BOXP-1:accepted" :task_id "BOXP-1" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
              {:event_id "BOXP-1:reopened" :task_id "BOXP-1" :event_type "task.reopened" :occurred_at "2026-10-21T00:00:00Z"}
              {:event_id "BOXP-2:run" :task_id "BOXP-2" :event_type "run.started" :stratum "infra"}
              {:event_id "BOXP-2:accepted" :task_id "BOXP-2" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}]
      report (ai-ops-sli/aggregate* events)
      stratum (get-in report [:by-stratum "infra"])
      overall (get-in report [:sli :first-acceptance-conformance])]
  (assert (= [1 1] ((juxt :first-pass :accepted) stratum) ((juxt :count :denominator) overall)))
  (assert (= [1 1] (mapv #(reduce + (map % (vals (:by-stratum report)))) [:first-pass :accepted])))
  (println "ok   再オープンを除く層別 first acceptance は全体と一致"))'
