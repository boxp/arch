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
bb ai_ops_sli.bb emit-sim --synthetic fixtures/synthetic-events.jsonl 8 10 11 2>"$tmp/partial.stats" >"$tmp/partial.jsonl"
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
  ;; 拒否 event があれば zero-tolerance は 0 件確定せず unknown
  (assert (= ["unknown" 2] ((juxt :status :rejected-events) (get-in r [:zero-tolerance :duplicate-effects]))))
  (assert (= ["unknown" 2] ((juxt :status :rejected-events) (get-in r [:zero-tolerance :critical-safety-events]))))
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
      checks [["孤立した重大 event は重複排除して下限計上し、拒否 event があれば unknown" (= ["unknown" 1 1] ((juxt :status :observed-lower-bound :rejected-events) (get-in r [:zero-tolerance :critical-safety-events])))]
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
       ["coverage 宣言済みなら 0" (and (= 0 (get-in (edn/read-string (slurp coverage)) [:zero-tolerance :duplicate-effects :count])) (= 0 (get-in (edn/read-string (slurp coverage)) [:zero-tolerance :critical-safety-events :count])))]
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
       ["重大 event" (= [1 "partial/undeclared"] ((juxt :count :coverage) (get-in r [:zero-tolerance :critical-safety-events])))]
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
(let [base [{:event_id "BOXP-9:run" :task_id "BOXP-9" :event_type "run.started"}
            {:event_id "BOXP-9:rule" :task_id "BOXP-9" :event_type "task.reopened" :classifier "rule" :correction_origin "agent-system" :evidence_event_ids ["BOXP-9:run"] :occurred_at "2026-10-19T00:00:00Z"}
            {:event_id "BOXP-9:accepted" :task_id "BOXP-9" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}]
      human {:event_id "BOXP-9:human" :task_id "BOXP-9" :event_type "task.reopened" :classifier "human" :correction_origin "non-agent" :evidence_event_ids ["BOXP-9:run"] :occurred_at "2026-10-21T00:00:00Z"}
      report (ai-ops-sli/aggregate* (conj base human))]
  (assert (= 1 (get-in report [:tasks :outcomes "accepted"])))
  (assert (= [1 1] ((juxt :count :denominator) (get-in report [:sli :first-acceptance-conformance]))))
  (doseq [unmatched [(dissoc human :evidence_event_ids) (assoc human :evidence_event_ids ["BOXP-9:missing"])]]
    (assert (= 1 (get-in (ai-ops-sli/aggregate* (conj base unmatched)) [:tasks :outcomes "in-flight"]))))
  (let [no-rule (vec (remove #(= "BOXP-9:rule" (:event_id %)) base))]
    (assert (= 1 (get-in (ai-ops-sli/aggregate* (conj no-rule human)) [:tasks :outcomes "in-flight"]))))
  (let [no-evidence-event (vec (remove #(= "BOXP-9:run" (:event_id %)) base))
        r (ai-ops-sli/aggregate* (conj no-evidence-event human))]
    (assert (= 1 (get-in r [:tasks :outcomes "accepted"])))
    (assert (= 0 (get-in r [:sli :reopen-after-accept :count] 0))))
  (println "ok   人の再分類は状態遷移にせず、証拠なし・rule 判定なしの再オープンは反映"))'

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

bb -e '
(load-file "ai_ops_sli.bb")
(let [events [{:event_id "BOXP-1:run" :task_id "BOXP-1" :event_type "run.started" :stratum "infra"}
              {:event_id "BOXP-1:state" :task_id "BOXP-1" :event_type "task.state" :snapshot "current" :status "done"}
              {:event_id "BOXP-2:run" :task_id "BOXP-2" :event_type "run.started" :stratum "infra"}
              {:event_id "BOXP-2:review" :task_id "BOXP-2" :event_type "task.state" :snapshot "current" :status "review"}
              {:event_id "BOXP-2:corr1" :task_id "BOXP-2" :event_type "correction" :correction_origin "agent-system"}
              {:event_id "BOXP-2:corr2" :task_id "BOXP-2" :event_type "correction" :correction_origin "unknown"}]
      report (ai-ops-sli/aggregate* events)
      overall (get-in report [:sli :first-acceptance-conformance])
      stratum (get-in report [:by-stratum "infra"])]
  (assert (= [0 0 1] ((juxt :count :denominator :accepted-without-acceptance-time) overall)))
  (assert (= [0 0 1] ((juxt :first-pass :accepted :accepted-without-acceptance-time) stratum)))
  (assert (= 1 (get-in report [:sli :agent-system-correction-task-ratio :unknown-cause-tasks]) (:unknown-corr-tasks stratum)))
  (println "ok   受入時刻不明を未評価にし、原因不明と agent-system の重複を数える"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [events [{:event_id "BOXP-1:run" :task_id "BOXP-1" :event_type "run.started"}
              {:event_id "BOXP-1:state" :task_id "BOXP-1" :event_type "task.state" :status "review" :snapshot "current"}]
      report (ai-ops-sli/aggregate* events)]
  (assert (= 1 (get-in report [:sli :agent-system-correction-task-ratio :denominator])))
  (println "ok   時刻のない現在の Review を分母に含む"))
(let [cancelled {:event_type "task.cancelled" :occurred_at "2026-10-19T00:00:00Z"}
      reopened {:event_type "task.reopened" :occurred_at "2026-10-20T00:00:00Z"}
      accepted {:event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]
  (assert (= "in-flight" (ai-ops-sli/task-outcome [cancelled reopened])))
  (assert (= "accepted" (ai-ops-sli/task-outcome [cancelled reopened accepted])))
  (assert (= "cancelled" (ai-ops-sli/task-outcome [cancelled])))
  (assert (= "cancelled" (ai-ops-sli/task-outcome [{:event_type "task.state" :status "cancelled"}])))
  (assert (= "awaiting-review" (ai-ops-sli/task-outcome [cancelled {:event_type "task.state" :status "review" :snapshot "current"}])))
  (println "ok   取消後の再オープンと受入、現在の状態を時系列で判定"))'

bb ai_ops_sli.bb emit-sim --synthetic fixtures/synthetic-events.jsonl 4 40 99 >"$tmp/end-down.jsonl" 2>"$tmp/end-down.stats"
bb -e '
(let [[output stats-file] *command-line-args*
      stats (edn/read-string (slurp stats-file))]
  (assert (= 40 (:delivered stats) (count (remove #(clojure.string/includes? % "collection_lost") (clojure.string/split-lines (slurp output))))))
  (assert (= 2 (count (filter #(clojure.string/includes? % "\"undelivered\"") (clojure.string/split-lines (slurp output))))))
  (assert (= 2 (:undelivered-buffered stats)))
  (assert (= 2 (:buffer-max-depth stats)))
  (println "ok   collector が最後まで停止した場合はバッファを未配信に残す"))' "$tmp/end-down.jsonl" "$tmp/end-down.stats"

bb -e '
(let [[ok partial down] (map #(edn/read-string (slurp %)) *command-line-args*)]
  (assert (= 0 (:buffer-max-depth ok)))
  (assert (= 2 (:buffer-max-depth partial)))
  (assert (= 4 (:buffer-max-depth down)))
  (println "ok   バッファ最大深度は未使用・部分使用・満杯を実測"))' "$tmp/ok.stats" "$tmp/partial.stats" "$tmp/down.stats"

bb -e '
(load-file "ai_ops_sli.bb")
(let [lane (fn [id target time] {:event_id (str id ":lane") :task_id id :event_type "lane.changed" :lane_to target :occurred_at time})
      review (lane "BOXP-31" "review" "2026-10-20T00:00:00Z")
      blocked (lane "BOXP-32" "blocked" "2026-10-20T00:00:00Z")
      report (ai-ops-sli/aggregate* [review blocked {:event_id "BOXP-31:run" :task_id "BOXP-31" :event_type "run.started"}])]
  (assert (= {"awaiting-review" 1 "blocked" 1} (get-in report [:tasks :outcomes])))
  (assert (= 1 (get-in report [:sli :agent-system-correction-task-ratio :denominator])))
  (assert (= "blocked" (ai-ops-sli/task-outcome [review (assoc blocked :occurred_at "2026-10-21T00:00:00Z")])))
  (assert (= "awaiting-review" (ai-ops-sli/task-outcome [review (assoc blocked :event_type "task.state" :status "review" :snapshot "current") (lane "BOXP-31" "done" "2026-10-22T00:00:00Z")])))
  (assert (= "unobserved" (ai-ops-sli/task-outcome [(lane "BOXP-31" "done" "2026-10-22T00:00:00Z")])))
  (println "ok   lane 遷移の outcome と review 分母、現在状態と done の優先順位"))
(let [low {:event_id "BOXP-40:low" :event_type "correction" :severity "low"}
      report (ai-ops-sli/aggregate* [low])]
  (assert (= [0 "partial/undeclared"] ((juxt :count :coverage) (get-in report [:zero-tolerance :critical-safety-events]))))
  (println "ok   safety の low のみは重大 0 件の部分観測"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [cov {:event_id "cov-effects-12345678" :event_type "coverage.connected" :coverage_target "duplicate-effects"}
      ok {:event_id "BOXP-50:e1" :task_id "BOXP-50" :event_type "effect.applied" :effect_key "deploy:a"}
      bad {:event_id "BOXP-50:e2" :task_id "BOXP-50" :event_type "effect.applied" :effect_key "Bad Key!"}
      gated (keep #(:event (ai-ops-sli/privacy-gate %)) [cov ok bad])
      r (ai-ops-sli/aggregate* gated)
      d (get-in r [:zero-tolerance :duplicate-effects])]
  (assert (= "unknown" (:status d)))
  (assert (nil? (:count d)))
  (assert (= [1 0] ((juxt :unverifiable-effects :observed-duplicates-lower-bound) d)))
  (assert (= [0 "connected"] ((juxt :count :coverage) (get-in (ai-ops-sli/aggregate* (keep #(:event (ai-ops-sli/privacy-gate %)) [cov ok])) [:zero-tolerance :duplicate-effects]))))
  (println "ok   effect_key 欠落/不正があれば重複実行 0 件と確定しない"))'

tmp_bad=$(mktemp)
printf '%s\n' '{"event_id":"cov-safety-12345678","event_type":"coverage.connected","coverage_target":"critical-safety-events"}' '{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}' '{"event_id":"BOXP-60:crit","event_type":"correction","severity":"crit' '[1,2]' > "$tmp_bad"
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_bad\")]
  (assert (= 2 (get-in r [:input :malformed-lines])))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (assert (nil? (get-in r [:zero-tolerance :critical-safety-events :count])))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :duplicate-effects :status])))
  (assert (re-find #\"ai_ops_input_malformed_lines_total 2\" (with-out-str (ai-ops-sli/prom \"$tmp_bad\"))))
  (println \"ok   破損行は黙殺せず計数し、重大 event/二重実行を 0 件と確定しない\"))"
rm -f "$tmp_bad"

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-61:run" :task_id "BOXP-61" :event_type "run.started"}
            {:event_id "BOXP-61:accepted" :task_id "BOXP-61" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
            {:event_id "BOXP-61:reopen" :task_id "BOXP-61" :event_type "task.reopened" :correction_origin "agent-system" :evidence_event_ids ["BOXP-61:run"] :occurred_at "2026-10-21T00:00:00Z"}]
      human {:event_id "BOXP-61:human" :task_id "BOXP-61" :event_type "task.reopened" :classifier "human" :correction_origin "non-agent" :evidence_event_ids ["BOXP-61:run"] :occurred_at "2026-10-22T00:00:00Z"}
      r (ai-ops-sli/aggregate* (conj base human))]
  (assert (= 1 (get-in r [:tasks :outcomes "in-flight"])))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :count])))
  (println "ok   classifier なしの再オープンは人の再分類対象にしない"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [covs [{:event_id "cov-safety-12345678" :event_type "coverage.connected" :coverage_target "critical-safety-events"}
            {:event_id "cov-effects-12345678" :event_type "coverage.connected" :coverage_target "duplicate-effects"}]
      bad-id {:event_id "bad id !!" :task_id "BOXP-62" :event_type "correction" :severity "critical"}
      bad-corr {:event_id "BOXP-63:effect" :task_id "../etc/passwd" :event_type "effect.applied" :effect_key "fx-1" :severity "critical"}
      ok (ai-ops-sli/aggregate* covs)]
  (assert (= 0 (get-in ok [:zero-tolerance :critical-safety-events :count])))
  (doseq [bad [bad-id bad-corr]]
    (let [r (ai-ops-sli/aggregate* (conj covs bad))]
      (assert (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status])))
      (assert (nil? (get-in r [:zero-tolerance :critical-safety-events :count])))
      (assert (= 1 (get-in r [:zero-tolerance :critical-safety-events :rejected-events])))
      (assert (= "unknown" (get-in r [:zero-tolerance :duplicate-effects :status])))
      (assert (nil? (get-in r [:zero-tolerance :duplicate-effects :count])))))
  (println "ok   不正 ID/correlation ID で拒否した event があれば重大 event/二重実行を 0 件と確定しない"))'

tmp_gated=$(mktemp)
printf '%s\n' '{"event_id":"cov-safety-12345678","event_type":"coverage.connected","coverage_target":"critical-safety-events"}' '{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}' '{"event_id":"bad id !!","task_id":"BOXP-64","event_type":"correction","severity":"critical"}' > "$tmp_gated.in"
bb ai_ops_sli.bb emit-sim --synthetic "$tmp_gated.in" > "$tmp_gated" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_gated\")]
  (assert (not (re-find #\"BOXP-64|bad id\" (slurp \"$tmp_gated\"))))
  (assert (= 1 (get-in r [:coverage :privacy-rejected-upstream])))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (assert (= 1 (get-in r [:zero-tolerance :critical-safety-events :rejected-events])))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :duplicate-effects :status])))
  (assert (re-find #\"ai_ops_privacy_rejected_events_total\\{stage=\\\"upstream\\\"\\} 1\" (with-out-str (ai-ops-sli/prom \"$tmp_gated\"))))
  (println \"ok   生成元で拒否した event は本文なし marker で集計へ引き継ぎ、重大 event/二重実行を 0 件と確定しない\"))"
rm -f "$tmp_gated" "$tmp_gated.in"

bb -e '
(load-file "ai_ops_sli.bb")
(let [covs [{:event_id "cov-safety-12345678" :event_type "coverage.connected" :coverage_target "critical-safety-events"}]
      r (ai-ops-sli/aggregate* (conj covs {:event_id "BOXP-65:corr" :task_id "BOXP-65" :event_type "correction" :severity "catastrophic"}))]
  (assert (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (assert (nil? (get-in r [:zero-tolerance :critical-safety-events :count])))
  (assert (= 1 (get-in r [:zero-tolerance :critical-safety-events :unverifiable-severity])))
  (println "ok   不正 severity の event があれば重大 event を 0 件と確定しない"))'

tmp_drop=$(mktemp)
{ printf '%s\n' '{"event_id":"cov-safety-12345678","event_type":"coverage.connected","coverage_target":"critical-safety-events"}' '{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}'
  for i in 1 2 3 4 5; do printf '{"event_id":"BOXP-66:e%s","task_id":"BOXP-66","event_type":"correction","severity":"critical"}\n' "$i"; done; } > "$tmp_drop.in"
bb ai_ops_sli.bb emit-sim --synthetic "$tmp_drop.in" 1 2 4 > "$tmp_drop" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_drop\")]
  (assert (= 2 (get-in r [:coverage :collection-lost :buffer-dropped])))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (assert (nil? (get-in r [:zero-tolerance :critical-safety-events :count])))
  (assert (= 2 (get-in r [:zero-tolerance :critical-safety-events :collection-lost-events])))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :duplicate-effects :status])))
  (assert (re-find #\"ai_ops_collection_lost_events_total\\{reason=\\\"buffer_dropped\\\"\\} 2\" (with-out-str (ai-ops-sli/prom \"$tmp_drop\"))))
  (println \"ok   collector 停止中の drop を marker で集計へ引き継ぎ、重大 event/二重実行を 0 件と確定しない\"))"
rm -f "$tmp_drop" "$tmp_drop.in"

bb -e '
(load-file "ai_ops_sli.bb")
(let [covs [{:event_id "cov-safety-12345678" :event_type "coverage.connected" :coverage_target "critical-safety-events"}
            {:event_id "cov-effects-12345678" :event_type "coverage.connected" :coverage_target "duplicate-effects"}]
      r (ai-ops-sli/aggregate* (conj covs {:event_id "BOXP-67:e1" :task_id "BOXP-67" :event_type "effect.appplied" :effect_key "deploy:x"}))]
  (assert (= "unknown" (get-in r [:zero-tolerance :duplicate-effects :status])))
  (assert (nil? (get-in r [:zero-tolerance :duplicate-effects :count])))
  (assert (= 1 (get-in r [:zero-tolerance :duplicate-effects :unverifiable-event-types])))
  (assert (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (println "ok   不正 event_type の event があれば二重実行/重大 event を 0 件と確定しない"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [r (ai-ops-sli/aggregate* [{:event_id "BOXP-68:req" :task_id "BOXP-68" :request_id "req:BOXP-68" :event_type "request.received" :occurred_at "2026-10-29T00:00:00Z"}
                                {:event_id "BOXP-68:state" :task_id "BOXP-68" :event_type "task.state" :status "cancelled" :snapshot "current"}])]
  (assert (= {"cancelled" 1} (get-in r [:tasks :outcomes])))
  (assert (= 0 (get-in r [:guardrails :unfinished])))
  (println "ok   privacy gate 経由でも task.state cancelled snapshot を取消 outcome に残す"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [r (ai-ops-sli/aggregate* [{:event_id "BOXP-69:state" :task_id "BOXP-69" :event_type "task.state" :status "cancelled" :snapshot "current"}
                                {:event_id "BOXP-70:cancel" :task_id "BOXP-70" :event_type "task.cancelled" :occurred_at "2026-10-29T00:00:00Z"}
                                {:event_id "BOXP-71:state" :task_id "BOXP-71" :event_type "task.state" :status "in-progress" :snapshot "current"}])]
  (assert (= 3 (get-in r [:tasks :total])))
  (assert (= {"cancelled" 2 "in-flight" 1} (get-in r [:tasks :outcomes])))
  (println "ok   状態 event だけを持つ task も集計から落とさない"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [gated (:event (ai-ops-sli/privacy-gate {:event_id "BOXP-73:state" :task_id "BOXP-73" :event_type "task.state" :status "accepted" :snapshot "current"}))
      r (ai-ops-sli/aggregate* [{:event_id "BOXP-73:start" :task_id "BOXP-73" :run_id "20261020T010000Z-aaaa" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
                                {:event_id "BOXP-73:run" :task_id "BOXP-73" :run_id "20261020T010000Z-aaaa" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
                                gated])]
  (assert (= "accepted" (:status gated)))
  (assert (= "accepted" (ai-ops-sli/task-outcome [gated])))
  (assert (= {"accepted" 1} (get-in r [:tasks :outcomes])))
  (assert (= 0 (get-in r [:guardrails :unfinished])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :accepted-without-acceptance-time])))
  (println "ok   privacy gate 経由の task.state accepted を受入 outcome とし、受入時刻不明として別掲する"))'

tmp_inc=$(mktemp -d)
mkdir -p "$tmp_inc/root/runs/BOXP-74/20261020T010000Z-aaaa" "$tmp_inc/root/runs/BOXP-74/20261020T030000Z-bbbb" "$tmp_inc/root/runs/BOXP-74/20261020T040000Z-cccc" "$tmp_inc/root/outbox" "$tmp_inc/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_inc/vault/Tickets/BOXP-74.md"
echo '{:ticket "BOXP-74" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_inc/root/runs/BOXP-74/20261020T010000Z-aaaa/summary.edn"
echo '{}' > "$tmp_inc/root/runs/BOXP-74/20261020T030000Z-bbbb/summary.edn"
echo '{:ticket "BOXP-99" :run-id "20261020T040000Z-cccc" :status :succeeded}' > "$tmp_inc/root/runs/BOXP-74/20261020T040000Z-cccc/summary.edn"
bb ai_ops_sli.bb extract "$tmp_inc/root" "$tmp_inc/vault" > "$tmp_inc/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_inc/x.jsonl\")]
  (assert (= 2 (get-in r [:input :unreadable-runs])))
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :denominator])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :unevaluated-input-missing])))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :unevaluated-input-missing])))
  (println \"ok   必須field欠落/ticket・run-id不一致の summary.edn も欠落として該当 task を未評価にする\"))"
rm -rf "$tmp_inc"

tmp_bad=$(mktemp -d)
mkdir -p "$tmp_bad/root/runs/BOXP-72/20261020T010000Z-aaaa" "$tmp_bad/root/runs/BOXP-72/20261020T030000Z-bbbb" "$tmp_bad/root/outbox" "$tmp_bad/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_bad/vault/Tickets/BOXP-72.md"
echo '{:ticket "BOXP-72" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_bad/root/runs/BOXP-72/20261020T010000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-72" :run-id ' > "$tmp_bad/root/runs/BOXP-72/20261020T030000Z-bbbb/summary.edn"
echo '{:ticket-id ' > "$tmp_bad/root/outbox/broken.edn"
echo '{}' > "$tmp_bad/root/outbox/incomplete.edn"
echo '{:ticket-id "BOXP-72" :event-type "task-board.lane-changed"}' > "$tmp_bad/root/outbox/no-id.edn"
bb ai_ops_sli.bb extract "$tmp_bad/root" "$tmp_bad/vault" > "$tmp_bad/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_bad/x.jsonl\")]
  (assert (= 1 (get-in r [:input :unreadable-runs])))
  (assert (= 3 (get-in r [:input :unreadable-inputs])))
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :denominator])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :unevaluated-input-missing])))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :unevaluated-input-missing])))
  (assert (= 1 (reduce + (map :unevaluated-input-missing (vals (:by-stratum r))))))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (assert (re-find #\"ai_ops_collection_lost_events_total\\{reason=\\\"input_unreadable\\\"\\} 3\" (with-out-str (ai-ops-sli/prom \"$tmp_bad/x.jsonl\"))))
  (println \"ok   破損/必須field欠落の summary.edn/outbox は欠落として計数し、該当 task の first acceptance/是正率を未評価にする\"))"
rm -rf "$tmp_bad"

tmp_fm=$(mktemp -d)
mkdir -p "$tmp_fm/root/runs/BOXP-80/20261020T010000Z-aaaa" "$tmp_fm/root/outbox" "$tmp_fm/vault/Tickets"
printf 'broken\ncreated: 2026-10-20\n' > "$tmp_fm/vault/Tickets/BOXP-80.md"
echo '{:ticket "BOXP-80" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_fm/root/runs/BOXP-80/20261020T010000Z-aaaa/summary.edn"
echo '{:event-id "e1" :ticket-id "BOXP-80" :event-type "" :created-at "2026-10-20T02:00:00Z"}' > "$tmp_fm/root/outbox/empty-type.edn"
echo '{:event-id "e2" :ticket-id "BOXP-80" :event-type "task-board.unknown" :created-at "2026-10-20T02:00:00Z"}' > "$tmp_fm/root/outbox/unknown-type.edn"
bb ai_ops_sli.bb extract "$tmp_fm/root" "$tmp_fm/vault" > "$tmp_fm/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_fm/x.jsonl\")]
  (assert (= 3 (get-in r [:input :unreadable-inputs])))
  (assert (zero? (get-in r [:input :sources \"outbox:\"] 0)))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :unevaluated-input-missing])))
  (assert (= \"unknown\" (get-in r [:zero-tolerance :critical-safety-events :status])))
  (println \"ok   空/未知の outbox event-type と frontmatter 破損 ticket は欠落として計数し、run を保持して該当 task を未評価にする\"))"
rm -rf "$tmp_fm"

tmp_miss=$(mktemp -d)
mkdir -p "$tmp_miss/root/runs/BOXP-81/20261020T010000Z-aaaa" "$tmp_miss/root/runs/BOXP-81/20261020T030000Z-bbbb" "$tmp_miss/root/outbox" "$tmp_miss/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_miss/vault/Tickets/BOXP-81.md"
printf -- '---\ncreated: 2026-10-20\nstatus: ready\n\nbody\nstatus: done\nclosed: 2026-10-21\n' > "$tmp_miss/vault/Tickets/BOXP-82.md"
printf -- '---\nid: BOXP-83\n---\n' > "$tmp_miss/vault/Tickets/BOXP-83.md"
echo '{:ticket "BOXP-81" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_miss/root/runs/BOXP-81/20261020T010000Z-aaaa/summary.edn"
bb ai_ops_sli.bb extract "$tmp_miss/root" "$tmp_miss/vault" > "$tmp_miss/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_miss/x.jsonl\")]
  (assert (= 3 (get-in r [:input :unreadable-runs])))
  (assert (= 2 (get-in r [:input :unreadable-inputs])))
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :denominator])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :unevaluated-input-missing])))
  (assert (not (re-find #\"BOXP-82:accepted\" (slurp \"$tmp_miss/x.jsonl\"))))
  (println \"ok   summary.edn 不在の run と閉じ区切り/必須field欠落の frontmatter を欠落として該当 task を未評価にする\"))"
rm -rf "$tmp_miss"

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-91:run" :task_id "BOXP-91" :event_type "run.started"}
            {:event_id "BOXP-91:review" :task_id "BOXP-91" :event_type "run.finished" :occurred_at "2026-10-18T00:00:00Z"}
            {:event_id "BOXP-91:other" :task_id "BOXP-91" :event_type "run.started"}
            {:event_id "BOXP-91:rule1" :task_id "BOXP-91" :event_type "correction" :classifier "rule" :correction_origin "agent-system" :evidence_event_ids ["BOXP-91:run" "BOXP-91:review"] :occurred_at "2026-10-19T00:00:00Z"}
            {:event_id "BOXP-91:rule2" :task_id "BOXP-91" :event_type "correction" :classifier "rule" :correction_origin "agent-system" :evidence_event_ids ["BOXP-91:run" "BOXP-91:other"] :occurred_at "2026-10-19T01:00:00Z"}
            {:event_id "BOXP-91:human" :task_id "BOXP-91" :event_type "correction" :classifier "human" :correction_origin "non-agent" :evidence_event_ids ["BOXP-91:review" "BOXP-91:run"] :occurred_at "2026-10-21T00:00:00Z"}]
      r (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-91:accepted" :task_id "BOXP-91" :event_type "task.accepted" :occurred_at "2026-10-22T00:00:00Z"}))]
  (assert (= 1 (get-in r [:sli :corrections-per-task :total-agent-system])) (pr-str (get-in r [:sli :corrections-per-task]))))
(println "ok   人の再分類は evidence 集合全体が一致する是正だけに適用 (先頭 ID の一致では適用しない)")
(let [evs [{:event_id "BOXP-92:run" :task_id "BOXP-92" :event_type "run.started"}
           {:event_id "BOXP-92:accepted" :task_id "BOXP-92" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
           {:event_id "BOXP-93:accepted" :task_id "BOXP-93" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
           {:event_id "BOXP-93:state" :task_id "BOXP-93" :event_type "task.state" :snapshot "current" :status "done"}
           {:event_id "BOXP-94:run" :task_id "BOXP-94" :event_type "run.started"}
           {:event_id "BOXP-94:unreadable" :task_id "BOXP-94" :event_type "run.unreadable"}
           {:event_id "BOXP-94:accepted" :task_id "BOXP-94" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}]
      fa (get-in (ai-ops-sli/aggregate* evs) [:sli :first-acceptance-conformance])]
  (assert (= [1 1] ((juxt :count :denominator) fa)) (pr-str fa))
  (assert (= [1 3] ((juxt :count :denominator) (:incl-unevaluated-as-not-pass fa))) (pr-str fa)))
(println "ok   未評価を含めた適合率の分母に run 履歴なし受入・入力欠落 task を含める")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [evs [{:event_id "BOXP-95:run" :task_id "BOXP-95" :event_type "run.started"}
           {:event_id "BOXP-95:accepted" :task_id "BOXP-95" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
           {:event_id "BOXP-96:state" :task_id "BOXP-96" :event_type "task.state" :snapshot "current" :status "done"}]
      r (ai-ops-sli/aggregate* evs)
      fa (get-in r [:sli :first-acceptance-conformance])]
  (assert (= [1 1] ((juxt :count :denominator) fa)) (pr-str fa))
  (assert (= [1 2] ((juxt :count :denominator) (:incl-unevaluated-as-not-pass fa))) (pr-str fa))
  (assert (= 1 (get-in r [:tasks :accepted-without-run-history])) (pr-str (:tasks r))))
(println "ok   run 履歴も受入時刻もない done snapshot のみの受入 task を保守的分母と未評価件数に含める")'

tmp_perm=$(mktemp -d)
mkdir -p "$tmp_perm/root/runs/BOXP-97/20261020T010000Z-aaaa" "$tmp_perm/root/outbox" "$tmp_perm/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_perm/vault/Tickets/BOXP-97.md"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_perm/vault/Tickets/BOXP-98.md"
echo '{:ticket "BOXP-97" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_perm/root/runs/BOXP-97/20261020T010000Z-aaaa/summary.edn"
chmod 000 "$tmp_perm/vault/Tickets/BOXP-97.md"
if [ "$(id -u)" != 0 ]; then
  bb ai_ops_sli.bb extract "$tmp_perm/root" "$tmp_perm/vault" > "$tmp_perm/x.jsonl" 2>/dev/null
  bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_perm/x.jsonl\")]
  (assert (= 1 (get-in r [:input :unreadable-inputs])) (pr-str (:input r)))
  (assert (pos? (get-in r [:input :tasks-with-unreadable-runs])) (pr-str (:input r)))
  (assert (re-find #\"BOXP-98\" (slurp \"$tmp_perm/x.jsonl\")))
  (println \"ok   読み取り不能 ticket は欠落入力として計数し、他 ticket の抽出を継続する\"))"
fi
chmod 600 "$tmp_perm/vault/Tickets/BOXP-97.md"; rm -rf "$tmp_perm"

tmp_type=$(mktemp -d)
mkdir -p "$tmp_type/root/runs/BOXP-99/20261020T010000Z-aaaa" "$tmp_type/root/runs/BOXP-99/20261020T030000Z-bbbb" "$tmp_type/root/runs/BOXP-100/20261020T010000Z-cccc" "$tmp_type/root/outbox" "$tmp_type/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_type/vault/Tickets/BOXP-99.md"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_type/vault/Tickets/BOXP-100.md"
echo '{:ticket "BOXP-99" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_type/root/runs/BOXP-99/20261020T010000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-99" :run-id "20261020T030000Z-bbbb" :agent "codex" :status 1 :action 2}' > "$tmp_type/root/runs/BOXP-99/20261020T030000Z-bbbb/summary.edn"
echo '{:ticket "BOXP-100" :run-id "20261020T010000Z-cccc" :agent "codex" :status :succeeded :result "review" :action :implement :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_type/root/runs/BOXP-100/20261020T010000Z-cccc/summary.edn"
bb ai_ops_sli.bb extract "$tmp_type/root" "$tmp_type/vault" > "$tmp_type/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_type/x.jsonl\")]
  (assert (= 1 (get-in r [:input :unreadable-runs])) (pr-str (:input r)))
  (assert (re-find #\"BOXP-100\" (slurp \"$tmp_type/x.jsonl\")))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :denominator])) (pr-str (get-in r [:sli :first-acceptance-conformance])))
  (println \"ok   field 型が不正な summary.edn は欠落として未評価にし、extract を継続する\"))"
rm -rf "$tmp_type"

bb -e '
(load-file "ai_ops_sli.bb")
(let [acc (fn [t] {:event_id (str t ":accepted") :task_id t :event_type "task.accepted" :occurred_at "2026-10-21T23:59:59Z" :occurred_precision "day"})
      run (fn [t] {:event_id (str t ":run") :task_id t :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z" :result "review"})
      corr (fn [t at] {:event_id (str t ":corr") :task_id t :event_type "correction" :occurred_at at :correction_origin "agent-system" :correction_class "gate_defect"})
      evs [(run "BOXP-101") (acc "BOXP-101") (corr "BOXP-101" "2026-10-21T10:00:00Z")
           (run "BOXP-102") (acc "BOXP-102") (corr "BOXP-102" "2026-10-20T10:00:00Z")
           (run "BOXP-103") (acc "BOXP-103")]
      r (ai-ops-sli/aggregate* evs)
      fa (get-in r [:sli :first-acceptance-conformance])]
  (assert (= [1 2] ((juxt :count :denominator) fa)) (pr-str fa))
  (assert (= 1 (:acceptance-day-ambiguous fa)) (pr-str fa))
  (assert (= 3 (get-in fa [:incl-unevaluated-as-not-pass :denominator])) (pr-str fa))
  (assert (= 1 (reduce + (map :acceptance-day-ambiguous (vals (:by-stratum r)))))))
(println "ok   日粒度の受入と同日の是正は前後不明として first acceptance の分子・分母から除き別掲する")'

tmp_str=$(mktemp -d)
mkdir -p "$tmp_str/vault/Tickets" "$tmp_str/root/runs/BOXP-1/20261020T010000Z-aaaa" "$tmp_str/root/runs/BOXP-1/20261020T030000Z-bbbb" "$tmp_str/root/runs/BOXP-404/20261020T010000Z-cccc"
printf -- '---\ncreated: 2026-10-20\nstatus: in-progress\n---\n' > "$tmp_str/vault/Tickets/BOXP-1.md"
echo '{:ticket "BOXP-1" :run-id "20261020T010000Z-aaaa" :agent "codex" :status "succeeded" :result "review" :action "implement" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_str/root/runs/BOXP-1/20261020T010000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-1" :run-id "20261020T030000Z-bbbb" :agent "codex" :status "interrupted" :action "implement" :finished-at "2026-10-20T04:00:00Z"}' > "$tmp_str/root/runs/BOXP-1/20261020T030000Z-bbbb/summary.edn"
echo '{:ticket "BOXP-404" :run-id "20261020T010000Z-cccc" :agent "codex" :status :succeeded :result "review" :action :implement :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_str/root/runs/BOXP-404/20261020T010000Z-cccc/summary.edn"
bb ai_ops_sli.bb extract "$tmp_str/root" "$tmp_str/vault" > "$tmp_str/x.jsonl" 2>/dev/null
bb -e "
(require '[cheshire.core :as json] '[clojure.string :as str])
(let [evs (->> (str/split-lines (slurp \"$tmp_str/x.jsonl\")) (map #(json/parse-string % true)))
      ty (fn [t] (set (keep #(when (= t (:task_id %)) (:event_type %)) evs)))]
  (assert (contains? (ty \"BOXP-1\") \"run.interrupted\") (pr-str (ty \"BOXP-1\")))
  (assert (= 1 (count (filter #(and (= \"BOXP-1\" (:task_id %)) (= \"run.finished\" (:event_type %))) evs))))
  (assert (contains? (ty \"BOXP-1\") \"task.reopened\") (pr-str (ty \"BOXP-1\")))
  (assert (every? (ty \"BOXP-404\") [\"run.started\" \"run.finished\" \"run.unreadable\"]) (pr-str (ty \"BOXP-404\")))
  (println \"ok   文字列形式の run status/action も keyword と同じく集計し、vault に無い ticket の run も計上して ticket 欠落を明示する\"))"
rm -rf "$tmp_str"

bb -e '
(load-file "ai_ops_sli.bb")
(doseq [[label result] [["keyword" :review] ["文字列" "review"]]]
  (let [prev {:ticket "BOXP-1" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result result :action :implement
              :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z" :blocker-category :none}
        cur {:ticket "BOXP-1" :run-id "20261020T030000Z-bbbb" :agent "codex" :status :succeeded :result result :action :implement
             :started-at "2026-10-20T03:00:00Z" :finished-at "2026-10-20T04:00:00Z"}
        fin (some #(when (= "run.finished" (:event_type %)) %) (ai-ops-sli/summary->events "BOXP-1" prev))
        corr (ai-ops-sli/derive-corrections "BOXP-1" [prev cur])]
    (assert (= "review" (:result fin)) (pr-str label (:result fin)))
    (assert (= "none" (:blocker_category fin)) (pr-str label (:blocker_category fin)))
    (assert (= ["task.reopened"] (mapv :event_type corr)) (pr-str label corr))))
(println "ok   keyword/文字列形式の :result を同じく正規化し Review 到達と再オープンを導出")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [ev (fn [agent] (->> (ai-ops-sli/summary->events "BOXP-1" {:ticket "BOXP-1" :run-id "20261020T010000Z-aaaa" :agent agent :status :succeeded :result :review :action :implement
                                                               :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"})
                          (mapv #(select-keys % [:event_id :event_type :agent :runtime]))))
      kw (ev :codex) s (ev "codex")]
  (assert (= kw s) (pr-str kw s))
  (assert (every? #(and (= "codex" (:agent %)) (= "codex-cli" (:runtime %))) kw) (pr-str kw))
  (assert (= "claude-cli" (:runtime (first (ev :claude-opus)))))
  (assert (= "localllm" (:runtime (first (ev :localllm)))))
  (let [gated (map (comp :event ai-ops-sli/privacy-gate) kw)]
    (assert (every? #(= "codex" (:agent %)) gated) (pr-str gated))))
(println "ok   keyword/文字列形式の :agent を同じ値に正規化し runtime 判定と privacy gate で誤分類しない")'
