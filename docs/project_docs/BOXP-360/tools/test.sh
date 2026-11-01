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
{:ticket "BOXP-999" :run-id "20261020T010000Z-abcd" :agent "sk-abcdef" :status :succeeded :action :implement :result "review" :blocker-category "Bearer fake-secret" :finished-at "2026-10-20T02:00:00Z"}
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
{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"acceptance-history"}
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
      gated (:event (ai-ops-sli/privacy-gate {:event_id "BOXP-1:event" :correction_origin "invalid" :correction_class "invalid"}))]
  (assert (= ["redacted" "redacted"] ((juxt :correction_origin :correction_class) gated)))
  (assert (= "unknown" (ai-ops-sli/correction-origin gated)))
  (assert (= "agent-system" (ai-ops-sli/correction-origin (assoc gated :correction_class "source_mismatch"))))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :unknown-cause-tasks])))
  (assert (= [0 1] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance]))))
  (println "ok   不正な origin と class は unknown として first-pass 不合格"))' "$tmp/invalid-origin.edn"
cat >"$tmp/coverage.jsonl" <<'EOF'
{"event_id":"cov-effects-12345678","event_type":"coverage.connected","coverage_target":"duplicate-effects"}
{"event_id":"cov-safety-12345678","event_type":"coverage.connected","coverage_target":"critical-safety-events"}
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
{"event_id":"BOXP-1:effect","task_id":"BOXP-1","event_type":"effect.applied","effect_key":"op:0000000b"}
{"event_id":"BOXP-2:requested","task_id":"BOXP-2","request_id":"req:BOXP-2","event_type":"request.received"}
{"event_id":"BOXP-2:effect","task_id":"BOXP-2","event_type":"effect.applied","effect_key":"op:0000000b"}
{"event_id":"BOXP-1:approval","task_id":"BOXP-1","event_type":"approval.requested","approval_key":"op:0000000b"}
{"event_id":"BOXP-2:approval","task_id":"BOXP-2","event_type":"approval.requested","approval_key":"op:0000000b"}
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
  ;; 拒否 event は coverage.connected (是正に無関係な種別) のため first acceptance は確定できる。
  ;; 受入後に再オープン中の BOXP-1 も最初の受入履歴を持つため分母に含む
  (assert (= [3 3 0] ((juxt :count :denominator :not-yet-evaluated) (get-in r [:sli :first-acceptance-conformance]))))
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
{"event_id":"BOXP-1:event","source":"derived\"\nsk-secret-token","event_type":"run.started\"\nsk-secret-token"}
{"event_id":"BOXP-1:run","source":"derived","event_type":"run.started"}
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
{"event_id":"BOXP-102:req","task_id":"conv-abcdef01","request_id":"req-abcdef01","event_type":"request.received"}
{"event_id":"BOXP-101:approval:1","event_type":"approval.requested","approval_key":"op:0000000a"}
{"event_id":"BOXP-101:approval:2","event_type":"approval.requested","approval_key":"op:0000000a"}
{"event_id":"BOXP-101:approval:3","event_type":"approval.requested","approval_key":"op:0000000a"}
{"event_id":"BOXP-101:run","task_id":"conv-12345678","event_type":"run.started"}
{"event_id":"BOXP-101:accepted","task_id":"conv-12345678","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-101:correction","task_id":"conv-12345678","event_type":"correction","occurred_at":"2026-10-20T00:00:00Z"}
EOF
bb ai_ops_sli.bb aggregate "$tmp/four-fixes.jsonl" >"$tmp/four-fixes.edn"
bb -e '
(load-file "ai_ops_sli.bb")
(let [r (edn/read-string (slurp (first *command-line-args*)))
      checks [["孤立した重大 event は重複排除して下限計上し、拒否 event があれば unknown" (= ["unknown" 1 1] ((juxt :status :observed-lower-bound :rejected-events) (get-in r [:zero-tolerance :critical-safety-events])))]
              ["通常モードの会話 ID は別 task として保持" (and (= 2 (get-in r [:tasks :total])) (= 2 (get-in r [:guardrails :tasks-per-request :denominator])) (every? #(not (ai-ops-sli/valid-value? :task_id %)) ["conv-sk-abcdefgh" "conv-abcdef01ijklmnopqrstuvwxyz1234567890" "conv-abc/defgh" "conv-ABCDEFGH"]))]
              ["重複承認率の分母は承認イベント総数 (種別不明の拒否 event があるため unknown・観測値下限で確認)" (let [d (get-in r [:sli :duplicate-approval])] (and (= "unknown" (:status d)) (= [2 3] ((juxt :count :denominator) (:observed-lower-bound d)))))]
              ["受入と同時刻の是正は first-pass 不合格 (孤立是正があるため unknown・観測値も不合格)" (let [fa (get-in r [:sli :first-acceptance-conformance])] (and (= "unknown" (:status fa)) (= [0 1] ((juxt :count :denominator) (:observed fa)))))]]]
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
              ["受入後再オープン中の run 履歴なし task は分母外で未評価に別掲" (and (= 0 (get-in u [:sli :first-acceptance-conformance :denominator])) (= 1 (get-in u [:tasks :accepted-without-run-history])))]
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
       ["extract でも危険値を redact" (and (= 3 (:privacy-redacted-values (edn/read-string (slurp extractst)))) (not (re-find #"Bearer|sk-abcdef" (slurp extract))))]
       ["source 未接続は unknown" (every? #(= "unknown" (get-in (edn/read-string (slurp extracted)) [:zero-tolerance % :status])) [:duplicate-effects :critical-safety-events])]
       ["coverage 宣言済みなら 0" (and (= 0 (get-in (edn/read-string (slurp coverage)) [:zero-tolerance :duplicate-effects :count])) (= 0 (get-in (edn/read-string (slurp coverage)) [:zero-tolerance :critical-safety-events :count])))]
       ["未知の zero-tolerance を Prom に出さない" (and (clojure.string/includes? (slurp extractprom) "ai_ops_sli_source_connected{sli=\"duplicate_effects\"} 0") (clojure.string/includes? (slurp extractprom) "ai_ops_sli_source_connected{sli=\"critical_safety_events\"} 0"))]
       ["受入前の非 agent 是正は first-pass を妨げず、受入後は reopen" (let [r (edn/read-string (slurp timing))] (and (= [2 2] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance]))) (= 1 (get-in r [:sli :reopen-after-accept :count]))))]
       ["生成元に本文が残らない" (not (re-find #"送ってはいけない|Bearer|/secret" (slurp (str (fs/parent ok) "/ok.jsonl"))))]
       ["重複 event を 1 件として数える" (= 1 (get-in r [:input :duplicates]))]
       ["順序逆転を検知" (= 1 (get-in r [:input :order-inversions]))]
       ["時刻ずれを検知" (= 1 (get-in r [:input :clock-skew-gt-5m]))]
       ["取消/阻害/保留を outcome に残す" (= {"accepted" 1 "cancelled" 1 "blocked" 1 "awaiting-review" 1 "in-flight" 3} (get-in r [:tasks :outcomes]))]
       ["ticket なし会話も request_id で task 化" (= 7 (get-in r [:tasks :total]))]
       ["人の訂正が rule 判定を上書き (S3 は非 agent 起因)" (= 0 (get-in r [:sli :agent-system-correction-task-ratio :unknown-cause-tasks]))]
       ["agent-system 是正 task 1/4 (S2)" (= [1 4] ((juxt :count :denominator) (get-in r [:sli :agent-system-correction-task-ratio])))]
       ["first acceptance: 受入履歴 2 中 1 (再オープン中 S2 は受入前是正で不合格)、未評価 2 は合格扱いしない" (= [1 2 2] ((juxt :count :denominator :not-yet-evaluated) (get-in r [:sli :first-acceptance-conformance])))]
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
      ids ["req-abcdef01" "conv-abcdef01/event:1" "req-abcdef01/started" "BOXP-1:started" "cov-effects-12345678"]]
  (doseq [[k values] documented v values]
    (let [r (ai-ops-sli/privacy-gate {:event_id "BOXP-1:event" k v})]
      (assert (= v (get (:event r) k)) (str k " " v))))
  (doseq [id ids] (assert (= id (:event_id (:event (ai-ops-sli/privacy-gate {:event_id id :parent_event_id id :evidence_event_ids [id]}))))))
  (doseq [id ["conv-short" "conv-ABCDEFGH" "req-abcdef01/sk-secretvalue" (str "req-abcdef01/" (apply str (repeat 120 "a")))]]
    (assert (:rejected? (ai-ops-sli/privacy-gate {:event_id id}))))
  (doseq [[class origin] ai-ops-sli/correction-class-origin]
    (assert (= origin (ai-ops-sli/correction-origin {:correction_class class}))))
  (println "ok   文書化された enum、会話 event ID と是正原因"))'
cat >"$tmp/snapshot-precedence.jsonl" <<'EOF'
{"event_id":"conv-abcdef01/run","task_id":"conv-abcdef01","event_type":"run.started","occurred_at":"2026-10-19T00:00:00Z"}
{"event_id":"conv-abcdef01/state","task_id":"conv-abcdef01","event_type":"task.state","status":"review"}
{"event_id":"conv-abcdef01/accepted","task_id":"conv-abcdef01","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"conv-abcdef01/approval","task_id":"conv-abcdef01","event_type":"approval.resolved","approval_key":"op:0000000a"}
{"event_id":"conv-0123abcd/run","task_id":"conv-0123abcd","event_type":"run.started","occurred_at":"2026-10-19T00:00:00Z"}
{"event_id":"conv-0123abcd/accepted","task_id":"conv-0123abcd","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"conv-0123abcd/correction","task_id":"conv-0123abcd","event_type":"correction","correction_class":"source_mismatch"}
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
  (assert (= [2 2] ((juxt :first-pass :accepted) stratum) ((juxt :count :denominator) overall)))
  (assert (= [2 2] (mapv #(reduce + (map % (vals (:by-stratum report)))) [:first-pass :accepted])))
  (println "ok   再オープン中も受入履歴で数える層別 first acceptance は全体と一致"))'

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
  (assert (= "accepted" (ai-ops-sli/task-outcome [(lane "BOXP-31" "done" "2026-10-22T00:00:00Z")])))
  ;; ledger 単独: Ready -> In Progress -> Done の最後の done 遷移を完了として扱う
  (let [l (fn [from to time] {:event_id (str "BOXP-33:" to) :task_id "BOXP-33" :event_type "lane.changed" :lane_from from :lane_to to :occurred_at time})
        evs [(l "ready" "in-progress" "2026-10-22T00:00:00Z") (l "in-progress" "done" "2026-10-22T01:00:00Z")]
        report (ai-ops-sli/aggregate* evs)]
    (assert (= "accepted" (ai-ops-sli/task-outcome evs)))
    (assert (= {"accepted" 1} (get-in report [:tasks :outcomes])) (pr-str (:tasks report)))
    ;; done 後の再 open は未完了に戻る
    (assert (= "in-flight" (ai-ops-sli/task-outcome (conj evs (l "done" "ready" "2026-10-22T02:00:00Z"))))))
  (println "ok   lane 遷移の outcome と review 分母、現在状態と done の優先順位 (ledger 単独の done 遷移は完了)"))
(let [low {:event_id "BOXP-40:event" :event_type "correction" :severity "low"}
      report (ai-ops-sli/aggregate* [low])]
  (assert (= [0 "partial/undeclared"] ((juxt :count :coverage) (get-in report [:zero-tolerance :critical-safety-events]))))
  (println "ok   safety の low のみは重大 0 件の部分観測"))'

bb -e '
(load-file "ai_ops_sli.bb")
(let [cov {:event_id "cov-effects-12345678" :event_type "coverage.connected" :coverage_target "duplicate-effects"}
      ok {:event_id "BOXP-50:e1" :task_id "BOXP-50" :event_type "effect.applied" :effect_key "deploy:0000000a"}
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
      bad-corr {:event_id "BOXP-63:effect" :task_id "../etc/passwd" :event_type "effect.applied" :effect_key "op:0000000f" :severity "critical"}
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
      r (ai-ops-sli/aggregate* (conj covs {:event_id "BOXP-67:e1" :task_id "BOXP-67" :event_type "effect.appplied" :effect_key "deploy:0000000e"}))]
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
echo '{:ticket "BOXP-74" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :action :implement :result "review" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_inc/root/runs/BOXP-74/20261020T010000Z-aaaa/summary.edn"
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
echo '{:ticket "BOXP-72" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :action :implement :result "review" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_bad/root/runs/BOXP-72/20261020T010000Z-aaaa/summary.edn"
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
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :observed :denominator])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :observed :unevaluated-input-missing])))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :observed :unevaluated-input-missing])))
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
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :observed :unevaluated-input-missing])))
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
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :observed :denominator])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :observed :unevaluated-input-missing])))
  (assert (not (re-find #\"BOXP-82:accepted\" (slurp \"$tmp_miss/x.jsonl\"))))
  (println \"ok   summary.edn 不在の run と閉じ区切り/必須field欠落の frontmatter を欠落として該当 task を未評価にする\"))"
rm -rf "$tmp_miss"

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-91:run" :task_id "BOXP-91" :event_type "run.started"}
            {:event_id "BOXP-91:review" :task_id "BOXP-91" :event_type "run.finished" :occurred_at "2026-10-18T00:00:00Z"}
            {:event_id "BOXP-91:event" :task_id "BOXP-91" :event_type "run.started"}
            {:event_id "BOXP-91:rule1" :task_id "BOXP-91" :event_type "correction" :classifier "rule" :correction_origin "agent-system" :evidence_event_ids ["BOXP-91:run" "BOXP-91:review"] :occurred_at "2026-10-19T00:00:00Z"}
            {:event_id "BOXP-91:rule2" :task_id "BOXP-91" :event_type "correction" :classifier "rule" :correction_origin "agent-system" :evidence_event_ids ["BOXP-91:run" "BOXP-91:event"] :occurred_at "2026-10-19T01:00:00Z"}
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
mkdir -p "$tmp_str/vault/Tickets" "$tmp_str/root/outbox" "$tmp_str/root/runs/BOXP-1/20261020T010000Z-aaaa" "$tmp_str/root/runs/BOXP-1/20261020T030000Z-bbbb" "$tmp_str/root/runs/BOXP-404/20261020T010000Z-cccc"
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

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-70:run" :task_id "BOXP-70" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-70:fin" :task_id "BOXP-70" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
            {:event_id "BOXP-70:accept" :task_id "BOXP-70" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]
      ok (ai-ops-sli/aggregate* base)
      r (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-70:corr" :event_type "correction" :correction_class "instruction_violation"
                                           :correction_origin "agent-system" :occurred_at "2026-10-20T03:00:00Z"}))
      fa (get-in r [:sli :first-acceptance-conformance])]
  (assert (= 1 (get-in ok [:sli :first-acceptance-conformance :count])) (pr-str ok))
  (assert (= "unknown" (:status fa)) (pr-str fa))
  (assert (= 1 (:unlinked-corrections fa)))
  (assert (= "unknown" (get-in r [:sli :agent-system-correction-task-ratio :status])))
  (assert (= 1 (get-in r [:coverage :unlinked-task-events])))
  (let [f (str (babashka.fs/create-temp-file))]
    (spit f (str/join "\n" (map cheshire.core/generate-string (conj base {:event_id "BOXP-70:corr" :event_type "correction" :correction_origin "agent-system" :occurred_at "2026-10-20T03:00:00Z"}))))
    (assert (str/includes? (with-out-str (ai-ops-sli/prom f)) "ai_ops_unlinked_task_events_total 1"))))
(println "ok   task_id 欠落の是正 event を黙って除外せず別掲し first acceptance/是正率を unknown にする")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-71:run" :task_id "BOXP-71" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-71:fin" :task_id "BOXP-71" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
            {:event_id "BOXP-71:accept" :task_id "BOXP-71" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]
      ok (ai-ops-sli/aggregate* base)]
  (assert (= [1 1] ((juxt :count :denominator) (get-in ok [:sli :first-acceptance-conformance]))) (pr-str ok))
  ;; 受入前の是正が生成元で拒否 / buffer drop / 未配信 / 破損行として欠落したケース
  (doseq [[label lost] [["upstream 拒否" ai-ops-sli/rejected-marker]
                        ["buffer drop" {:collection_lost "buffer_dropped"}]
                        ["未配信" {:collection_lost "undelivered"}]
                        ["破損行" {:ai-ops-sli/malformed true}]
                        ["aggregate 側 privacy 拒否" {:event_id "bad id" :task_id "BOXP-71" :event_type "correction" :correction_origin "agent-system" :occurred_at "2026-10-20T03:00:00Z"}]]]
    (let [r (ai-ops-sli/aggregate* (conj base lost))
          fa (get-in r [:sli :first-acceptance-conformance])
          cr (get-in r [:sli :agent-system-correction-task-ratio])]
      (assert (= ["unknown" 1] ((juxt :status :lost-events) fa)) (str label " " (pr-str fa)))
      (assert (= [1 1] ((juxt :count :denominator) (:observed fa))) label)
      (assert (= "unknown" (:status cr)) label)
      (assert (= "unknown" (get-in r [:sli :corrections-per-task :status])) label))))
(println "ok   受入前の是正が拒否/drop/未配信/破損で欠落したら first acceptance/是正率を確定せず unknown (観測値は observed)")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-72:run" :task_id "BOXP-72" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-72:fin" :task_id "BOXP-72" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
            {:event_id "BOXP-72:accept" :task_id "BOXP-72" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]
      bad-corr {:event_id "bad id" :task_id "BOXP-72" :event_type "correction" :correction_origin "agent-system" :occurred_at "2026-10-20T03:00:00Z"}
      bad-notify {:event_id "bad id" :task_id "BOXP-72" :event_type "notify.run-finished" :occurred_at "2026-10-20T03:00:00Z"}
      m-corr (ai-ops-sli/rejected-marker-for bad-corr)
      m-notify (ai-ops-sli/rejected-marker-for bad-notify)
      m-unknown (ai-ops-sli/rejected-marker-for {:event_id "bad id" :event_type "secret value"})]
  ;; marker は本文・ID を持たず、許可 enum の event_type だけを残す
  (assert (= {:privacy_rejected "upstream" :event_type "correction"} m-corr))
  (assert (= {:privacy_rejected "upstream"} m-unknown))
  (doseq [[label evs status] [["是正種別の upstream 拒否" [m-corr] "unknown"]
                              ["種別不明の upstream 拒否" [m-unknown] "unknown"]
                              ["notify の upstream 拒否" [m-notify] nil]
                              ["notify の aggregate 側拒否" [bad-notify] nil]]]
    (let [r (ai-ops-sli/aggregate* (into base evs))
          fa (get-in r [:sli :first-acceptance-conformance])]
      (assert (= status (:status fa)) (str label " " (pr-str fa)))
      ;; zero-tolerance は種別に関係なく保守的に unknown
      (assert (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status])) label)))
  (let [f (str (babashka.fs/create-temp-file))]
    (spit f (cheshire.core/generate-string (assoc bad-corr :synthetic true)))
    (let [out (with-out-str (binding [*err* (java.io.StringWriter.)] (ai-ops-sli/emit-sim f 4 100 100)))]
      (assert (str/includes? out "\"event_type\":\"correction\"") out)
      (assert (not (str/includes? out "bad id")) out))))
(println "ok   upstream 拒否 marker は event_type enum のみ保持し、是正に無関係な種別 (notify 等) の拒否では是正 SLI を unknown にしない")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-72:run" :task_id "BOXP-72" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-72:fin" :task_id "BOXP-72" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
            {:event_id "BOXP-72:accept" :task_id "BOXP-72" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]
      ;; 受入前の correction だった可能性がある種別不明 (欠落/不正) の event
      r (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-72:x" :task_id "BOXP-72" :event_type "bogus" :occurred_at "2026-10-20T03:00:00Z"}))
      r2 (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-72:y" :task_id "BOXP-72" :occurred_at "2026-10-20T03:00:00Z"}))
      prom-out (fn [evs] (let [f (str (babashka.fs/create-temp-file))]
                           (spit f (str/join "\n" (map cheshire.core/generate-string evs)))
                           (with-out-str (ai-ops-sli/prom f))))]
  (doseq [x [r r2] k [:first-acceptance-conformance :agent-system-correction-task-ratio]]
    (assert (= "unknown" (get-in x [:sli k :status])) (pr-str (get-in x [:sli k]))))
  (let [ok-out (prom-out base)
        bad-out (prom-out (conj base {:event_id "BOXP-72:x" :task_id "BOXP-72" :event_type "bogus" :occurred_at "2026-10-20T03:00:00Z"}))]
    (assert (str/includes? ok-out "ai_ops_sli_determinable{sli=\"agent_system_correction_task_ratio\"} 1") ok-out)
    (assert (str/includes? ok-out "ai_ops_reached_review_tasks 1") ok-out)
    (assert (str/includes? bad-out "ai_ops_sli_determinable{sli=\"agent_system_correction_task_ratio\"} 0") bad-out)
    (assert (str/includes? bad-out "ai_ops_sli_determinable{sli=\"first_acceptance_conformance\"} 0") bad-out)
    (assert (not (re-find #"ai_ops_correction_tasks|ai_ops_reached_review_tasks" bad-out)) bad-out)
    ;; 欠落 event の所属層は不明なので、層別の分子・分母も確定値として出さない
    (assert (re-find #"ai_ops_stratum_tasks\{[^}]*kind=\"reached_review\"\} 1" ok-out) ok-out)
    (assert (not (re-find #"ai_ops_stratum_tasks\{[^}]*kind=\"(reached_review|agent_system_corr|unknown_corr|accepted|first_pass)\"" bad-out)) bad-out)))
(println "ok   種別不明 event は是正 SLI を unknown にし、Prom は unknown の是正率を確定値として出さず判定可否 gauge を出す")'
tmp_zero=$(mktemp)
echo '{"event_id":"BOXP-1:requested","task_id":"BOXP-1","event_type":"request.received","source":"ticket-frontmatter"}' > "$tmp_zero"
zero_out=$(bb ai_ops_sli.bb prom "$tmp_zero")
grep -q 'ai_ops_sli_determinable{sli="agent_system_correction_task_ratio"} 0' <<<"$zero_out" \
  && grep -q 'ai_ops_sli_determinable{sli="first_acceptance_conformance"} 0' <<<"$zero_out" \
  || { echo "FAIL 分母 0 の SLI が判定可能と出力された"; echo "$zero_out"; exit 1; }
echo "ok   分母 0 の SLI は Prom で判定不能 (determinable=0) として出す"
tmp_partial=$(mktemp)
cat >"$tmp_partial" <<'EOF'
{"event_id":"BOXP-1:requested","task_id":"BOXP-1","event_type":"request.received","source":"ticket-frontmatter"}
{"event_id":"BOXP-1:effect","task_id":"BOXP-1","event_type":"effect.applied","effect_key":"op:0000000b","severity":"low"}
EOF
partial_out=$(bb ai_ops_sli.bb prom "$tmp_partial")
grep -q 'ai_ops_sli_source_connected{sli="duplicate_effects"} 0' <<<"$partial_out" \
  && grep -q 'ai_ops_sli_source_partial{sli="duplicate_effects"} 1' <<<"$partial_out" \
  && grep -q 'ai_ops_sli_source_connected{sli="critical_safety_events"} 0' <<<"$partial_out" \
  && grep -q 'ai_ops_sli_source_partial{sli="critical_safety_events"} 1' <<<"$partial_out" \
  || { echo "FAIL coverage 未宣言の部分観測が source 接続済みと出力された"; echo "$partial_out" | grep source_; exit 1; }
printf '%s\n' '{"event_id":"cov-effects-0000000a","event_type":"coverage.connected","coverage_target":"duplicate-effects"}' >>"$tmp_partial"
partial_out=$(bb ai_ops_sli.bb prom "$tmp_partial")
grep -q 'ai_ops_sli_source_connected{sli="duplicate_effects"} 1' <<<"$partial_out" \
  && grep -q 'ai_ops_sli_source_partial{sli="duplicate_effects"} 0' <<<"$partial_out" \
  || { echo "FAIL coverage 宣言済みの source が接続済みと出力されない"; echo "$partial_out" | grep source_; exit 1; }
echo "ok   coverage 未宣言の部分観測は source_connected=0/source_partial=1、宣言済みなら connected=1"


tmp_cxl=$(mktemp -d)
mkdir -p "$tmp_cxl/root/runs/BOXP-110/20261020T010000Z-aaaa" "$tmp_cxl/root/outbox" "$tmp_cxl/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: cancelled\nclosed: 2026-10-22\n---\n' > "$tmp_cxl/vault/Tickets/BOXP-110.md"
printf -- '---\ncreated: 2026-10-20\nstatus: cancelled\n---\n' > "$tmp_cxl/vault/Tickets/BOXP-111.md"
echo '{:ticket "BOXP-110" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :action :implement :result "review" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_cxl/root/runs/BOXP-110/20261020T010000Z-aaaa/summary.edn"
bb ai_ops_sli.bb extract "$tmp_cxl/root" "$tmp_cxl/vault" > "$tmp_cxl/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_cxl/x.jsonl\")
      evs (map #(cheshire.core/parse-string % true) (clojure.string/split-lines (slurp \"$tmp_cxl/x.jsonl\")))]
  (assert (= {\"cancelled\" 2} (get-in r [:tasks :outcomes])) (pr-str (get-in r [:tasks :outcomes])))
  (assert (= 0 (get-in r [:guardrails :unfinished])))
  (assert (not-any? #(#{\"task.accepted\" \"task.reopened\"} (:event_type %)) evs))
  (println \"ok   取消済み ticket は extract から aggregate まで cancelled として集計し、closed を受入/再open扱いしない\"))"
rm -rf "$tmp_cxl"

tmp_unk=$(mktemp -d)
mkdir -p "$tmp_unk/root/runs/BOXP-84/20261020T010000Z-aaaa" "$tmp_unk/root/runs/BOXP-84/20261020T030000Z-bbbb" "$tmp_unk/root/outbox" "$tmp_unk/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_unk/vault/Tickets/BOXP-84.md"
echo '{:ticket "BOXP-84" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_unk/root/runs/BOXP-84/20261020T010000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-84" :run-id "20261020T030000Z-bbbb" :agent "codex" :status :succeeded :result "review" :action "review_fix" :started-at "2026-10-20T03:00:00Z" :finished-at "2026-10-20T04:00:00Z"}' > "$tmp_unk/root/runs/BOXP-84/20261020T030000Z-bbbb/summary.edn"
bb ai_ops_sli.bb extract "$tmp_unk/root" "$tmp_unk/vault" > "$tmp_unk/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_unk/x.jsonl\")
      fa (get-in r [:sli :first-acceptance-conformance])]
  (assert (= 1 (get-in r [:input :unreadable-runs])) (pr-str (:input r)))
  (assert (= 0 (or (:count fa) (get-in fa [:observed :count]))) (pr-str fa))
  (assert (= 1 (or (:unevaluated-input-missing fa) (get-in fa [:observed :unevaluated-input-missing]))) (pr-str fa))
  (println \"ok   未知の :action/:status/:result を持つ summary.edn は欠落入力として該当 task を未評価にし first acceptance 合格扱いしない\"))"
rm -rf "$tmp_unk"

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-71:run" :task_id "BOXP-71" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-71:fin" :task_id "BOXP-71" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
            {:event_id "BOXP-71:accept" :task_id "BOXP-71" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]]
  (doseq [e [{:event_id "BOXP-72:run" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
             {:event_id "BOXP-72:accept" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}
             {:event_id "BOXP-72:state" :event_type "task.state" :status "done" :snapshot "current"}]]
    (let [r (ai-ops-sli/aggregate* (conj base e))]
      (assert (= "unknown" (get-in r [:sli :first-acceptance-conformance :status])) (pr-str e))
      (assert (= "unknown" (get-in r [:sli :agent-system-correction-task-ratio :status])) (pr-str e))
      (assert (= 1 (get-in r [:coverage :unlinked-task-events]))))))
(println "ok   task_id 欠落の run/受入/状態 event でも是正率/first acceptance を確定値にしない")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [cov [{:event_id "cov-effects-12345678" :event_type "coverage.connected" :coverage_target "duplicate-effects"}
           {:event_id "cov-safety-12345678" :event_type "coverage.connected" :coverage_target "critical-safety-events"}]
      base (into cov [{:event_id "BOXP-75:run" :task_id "BOXP-75" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}])
      ok (ai-ops-sli/aggregate* base)
      r (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-75:unreadable" :task_id "BOXP-75" :event_type "run.unreadable"}))]
  (assert (= 0 (get-in ok [:zero-tolerance :duplicate-effects :count])) (pr-str (:zero-tolerance ok)))
  (assert (= 0 (get-in ok [:zero-tolerance :critical-safety-events :count])) (pr-str (:zero-tolerance ok)))
  (assert (= "unknown" (get-in r [:zero-tolerance :duplicate-effects :status])) (pr-str (:zero-tolerance r)))
  (assert (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status])) (pr-str (:zero-tolerance r)))
  (assert (= 1 (get-in r [:zero-tolerance :critical-safety-events :unreadable-runs]))))
(println "ok   読めない run summary (run.unreadable) があれば coverage 接続済みでも二重実行/重大 event を 0 件と確定しない")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [r (ai-ops-sli/aggregate*
         [{:event_id "BOXP-76:run" :task_id "BOXP-76" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
          {:event_id "BOXP-76:fin" :task_id "BOXP-76" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
          {:event_id "BOXP-77:run" :task_id "BOXP-77" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
          {:event_id "BOXP-77:fin" :task_id "BOXP-77" :event_type "run.finished" :result "bogus_review" :occurred_at "2026-10-20T02:00:00Z"}])
      c (get-in r [:sli :agent-system-correction-task-ratio])]
  (assert (= 1 (:denominator c)) (pr-str c))
  (assert (= 1 (:unevaluated-input-missing c)) (pr-str c))
  (assert (= 1 (get-in r [:input :unverifiable-state-events])) (pr-str (:input r))))
(println "ok   状態/結果 field が不正値で redact された task は是正率の分母から黙って消さず入力欠落として別掲する")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [r (ai-ops-sli/aggregate*
         [{:event_id "BOXP-80:run" :task_id "BOXP-80" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
          {:event_id "BOXP-80:accept1" :task_id "BOXP-80" :event_type "task.accepted"}
          {:event_id "BOXP-80:corr" :task_id "BOXP-80" :event_type "correction" :correction_origin "agent-system" :occurred_at "2026-10-21T00:00:00Z"}
          {:event_id "BOXP-80:accept2" :task_id "BOXP-80" :event_type "task.accepted" :occurred_at "2026-10-22T00:00:00Z"}])
      f (get-in r [:sli :first-acceptance-conformance])]
  (assert (= 0 (:denominator f)) (pr-str f))
  (assert (= 1 (:accepted-without-acceptance-time f)) (pr-str f)))
(println "ok   最初の受入時刻が不明なら後の時刻付き受入を first acceptance の基準にせず受入時刻不明として別掲する")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [r (ai-ops-sli/aggregate*
         [{:event_id "BOXP-81:run" :task_id "BOXP-81" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
          {:event_id "BOXP-81:fin" :task_id "BOXP-81" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T01:00:00Z"}
          {:event_id "BOXP-81:accept" :task_id "BOXP-81" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}
          {:event_id "BOXP-81:state9" :task_id "BOXP-81" :event_type "task.state" :snapshot "current"}
          {:event_id "BOXP-82:run" :task_id "BOXP-82" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
          {:event_id "BOXP-82:lane" :task_id "BOXP-82" :event_type "lane.changed" :lane_from "in-progress" :occurred_at "2026-10-20T01:00:00Z"}])
      c (get-in r [:sli :agent-system-correction-task-ratio])
      f (get-in r [:sli :first-acceptance-conformance])]
  (assert (= 2 (get-in r [:input :unverifiable-state-events])) (pr-str (:input r)))
  (assert (= 0 (:denominator c)) (pr-str c))
  (assert (= 2 (:unevaluated-input-missing c)) (pr-str c))
  (assert (= 0 (:denominator f)) (pr-str f)))
(println "ok   必須状態 field (task.state の status / lane.changed の lane_to) が欠落した event も入力欠落として未評価に別掲する")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [cov {:event_id "cov-acceptance-12345678" :event_type "coverage.connected" :coverage_target "acceptance-history"}
      base [{:event_id "BOXP-83:run" :task_id "BOXP-83" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
            {:event_id "BOXP-83:accept" :task_id "BOXP-83" :event_type "task.accepted"}
            {:event_id "BOXP-83:reopen" :task_id "BOXP-83" :event_type "task.reopened" :correction_origin "agent-system" :occurred_at "2026-10-22T00:00:00Z"}
            cov]
      ra (get-in (ai-ops-sli/aggregate* base) [:sli :reopen-after-accept])
      ;; 受入時刻は確定でも是正時刻が不明なら受入後かどうか確定できない
      timed (assoc-in base [1 :occurred_at] "2026-10-21T00:00:00Z")
      rb (get-in (ai-ops-sli/aggregate* (assoc timed 2 (dissoc (nth timed 2) :occurred_at))) [:sli :reopen-after-accept])
      rc (get-in (ai-ops-sli/aggregate* timed) [:sli :reopen-after-accept])]
  (assert (and (= :unknown (:status ra)) (= 1 (:indeterminate ra))) (pr-str ra))
  ;; 時刻なし再open は前後不明の入力欠落 (unordered transition) として未評価になる
  (assert (and (= :unknown (:status rb)) (= 1 (:unevaluated-input-missing rb))) (pr-str rb))
  (assert (= [1 1] ((juxt :count :denominator) rc)) (pr-str rc)))
(println "ok   受入時刻または是正時刻が不明な task があれば reopen-after-accept を確定せず unknown (前後不明件数を別掲)")'

tmp_status=$(mktemp -d); trap 'rm -rf "$tmp" "$tmp_status"' EXIT
mkdir -p "$tmp_status/root/runs" "$tmp_status/root/outbox" "$tmp_status/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: donee\nclosed: 2026-10-21\n---\n' >"$tmp_status/vault/Tickets/BOXP-84.md"
bb ai_ops_sli.bb extract "$tmp_status/root" "$tmp_status/vault" >"$tmp_status/extract.jsonl" 2>/dev/null
bb -e '
(load-file "ai_ops_sli.bb")
(let [evs (map #(cheshire.core/parse-string % true) (clojure.string/split-lines (slurp (first *command-line-args*))))]
  (assert (some #(and (= "BOXP-84" (:task_id %)) (= "run.unreadable" (:event_type %))) evs) (pr-str evs))
  (assert (not-any? #(and (= "BOXP-84" (:task_id %)) (#{"task.accepted" "task.state"} (:event_type %))) evs) (pr-str evs)))
(println "ok   未知の ticket status (例 donee) は frontmatter 破損として run.unreadable で未評価にする")' "$tmp_status/extract.jsonl"

bb -e '
(load-file "ai_ops_sli.bb")
(let [cov {:event_id "cov-acceptance-12345678" :event_type "coverage.connected" :coverage_target "acceptance-history"}
      base [{:event_id "BOXP-85:run" :task_id "BOXP-85" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
            {:event_id "BOXP-85:fin" :task_id "BOXP-85" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-85:accept" :task_id "BOXP-85" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}
            cov]
      ok (get-in (ai-ops-sli/aggregate* base) [:sli :reopen-after-accept])
      ;; 受入後の task.reopened が collector drop / privacy 拒否 / 読めない run に含まれていた場合
      dropped (get-in (ai-ops-sli/aggregate* (conj base {:collection_lost "buffer_dropped"})) [:sli :reopen-after-accept])
      rejected (get-in (ai-ops-sli/aggregate* (conj base {:privacy_rejected "upstream" :event_type "task.reopened"})) [:sli :reopen-after-accept])
      unreadable (get-in (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-85:unreadable" :task_id "BOXP-85" :event_type "run.unreadable"})) [:sli :reopen-after-accept])
      unlinked (get-in (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-1084:reopen" :event_type "task.reopened" :occurred_at "2026-10-22T00:00:00Z"})) [:sli :reopen-after-accept])]
  (assert (= [0 1] ((juxt :count :denominator) ok)) (pr-str ok))
  (doseq [r [dropped rejected unreadable unlinked]]
    (assert (= :unknown (:status r)) (pr-str r))
    (assert (= 0 (get-in r [:observed :count])) (pr-str r))))
(println "ok   欠落・未紐付け event や入力欠落 task があれば reopen-after-accept を 0 件と確定せず unknown (観測値は observed)")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [cov [{:event_id "cov-effects-12345678" :event_type "coverage.connected" :coverage_target "duplicate-effects"}
           {:event_id "cov-safety-12345678" :event_type "coverage.connected" :coverage_target "critical-safety-events"}]
      run {:event_id "BOXP-86:e1" :task_id "BOXP-86" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
      eff {:event_id "BOXP-86:e1" :task_id "BOXP-86" :event_type "effect.applied" :effect_key "effect:0000000a" :severity "critical" :occurred_at "2026-10-20T00:01:00Z"}
      ;; 同一内容の再送 (observed_at/redelivery のみ違う) は衝突ではない
      resend (assoc run :observed_at "2026-10-20T00:05:00Z" :redelivery 1)]
  (doseq [evs [(concat [run eff] cov) (concat [eff run] cov)]]
    (let [r (ai-ops-sli/aggregate* evs)]
      (assert (= 1 (get-in r [:input :id-collisions])) (pr-str (:input r)))
      (assert (= "unknown" (get-in r [:zero-tolerance :duplicate-effects :status])) (pr-str (:zero-tolerance r)))
      (assert (= "unknown" (get-in r [:zero-tolerance :critical-safety-events :status])) (pr-str (:zero-tolerance r)))
      (assert (= "unknown" (get-in r [:sli :agent-system-correction-task-ratio :status])) (pr-str (:sli r)))))
  (let [r (ai-ops-sli/aggregate* (concat [run resend] cov))]
    (assert (= [0 1] ((juxt :id-collisions :duplicates) (:input r))) (pr-str (:input r)))
    (assert (= 0 (get-in r [:zero-tolerance :critical-safety-events :count])) (pr-str (:zero-tolerance r)))))
(println "ok   同じ event_id で内容が異なる event (ID 衝突) は入力順に関係なく zero-tolerance/是正 SLI を unknown にし、同一内容の再送は衝突扱いしない")'

tmp_fin=$(mktemp -d); trap 'rm -rf "$tmp" "$tmp_status" "$tmp_fin"' EXIT
mkdir -p "$tmp_fin/root/outbox" "$tmp_fin/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: review\n---\n' >"$tmp_fin/vault/Tickets/BOXP-86.md"
for r in 20261020T000000Z-a 20261020T010000Z-b 20261020T020000Z-c; do mkdir -p "$tmp_fin/root/runs/BOXP-86/$r"; done
echo '{:ticket "BOXP-86" :run-id "20261020T000000Z-a" :status :succeeded :result "review" :action :implement :agent "claude-opus" :started-at "2026-10-20T00:00:00Z"}' >"$tmp_fin/root/runs/BOXP-86/20261020T000000Z-a/summary.edn"
echo '{:ticket "BOXP-86" :run-id "20261020T010000Z-b" :status :running :action :implement :agent "claude-opus" :started-at "2026-10-20T01:00:00Z"}' >"$tmp_fin/root/runs/BOXP-86/20261020T010000Z-b/summary.edn"
echo '{:ticket "BOXP-86" :run-id "20261020T020000Z-c" :status :interrupted :action :implement :agent "claude-opus" :started-at "2026-10-20T02:00:00Z"}' >"$tmp_fin/root/runs/BOXP-86/20261020T020000Z-c/summary.edn"
bb ai_ops_sli.bb extract "$tmp_fin/root" "$tmp_fin/vault" >"$tmp_fin/extract.jsonl" 2>/dev/null
bb -e '
(load-file "ai_ops_sli.bb")
(let [evs (map #(cheshire.core/parse-string % true) (clojure.string/split-lines (slurp (first *command-line-args*))))
      of-run (fn [r] (set (map :event_type (filter #(= r (:run_id %)) evs))))]
  ;; 終了状態なのに :finished-at が無い run は run.started だけの正常 run として集計せず run.unreadable にする
  (assert (= #{"run.unreadable"} (of-run "20261020T000000Z-a")) (pr-str evs))
  ;; 実行中/中断は :finished-at 無しが正常
  (assert (= #{"run.started"} (of-run "20261020T010000Z-b")) (pr-str evs))
  (assert (contains? (of-run "20261020T020000Z-c") "run.interrupted") (pr-str evs)))
(println "ok   終了状態 (succeeded 等) の run summary に :finished-at が無ければ run.unreadable で未評価にし、running/interrupted は許容する")' "$tmp_fin/extract.jsonl"

tmp_ob=$(mktemp -d); trap 'rm -rf "$tmp" "$tmp_status" "$tmp_fin" "$tmp_ob"' EXIT
mkdir -p "$tmp_ob/root/runs/BOXP-87/20261020T000000Z-a" "$tmp_ob/root/outbox" "$tmp_ob/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' >"$tmp_ob/vault/Tickets/BOXP-87.md"
echo '{:ticket "BOXP-87" :run-id "20261020T000000Z-a" :status :succeeded :result "review" :action :implement :agent "claude-opus" :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T01:00:00Z"}' >"$tmp_ob/root/runs/BOXP-87/20261020T000000Z-a/summary.edn"
echo '{:event-id "BOXP-87-20261020T000000Z-a-done" :run-id "20261020T000000Z-a" :ticket-id "BOXP-87" :event-type "task-board.run-finished" :source "task-board-runner" :created-at "2026-10-20T01:00:00Z"}' >"$tmp_ob/root/outbox/ob1.edn"
echo '{:event-id "BOXP-87-lane-review-20261020T010000Z-0000000b" :ticket-id "BOXP-87" :event-type "task-board.lane-changed" :source "board-diff" :from-status "in-progress" :to-status "review" :hermes-status "sent" :created-at "2026-10-20T01:00:00Z"}' >"$tmp_ob/root/outbox/ob2.edn"
bb ai_ops_sli.bb extract "$tmp_ob/root" "$tmp_ob/vault" >"$tmp_ob/extract.jsonl" 2>/dev/null
bb -e '
(load-file "ai_ops_sli.bb")
(let [evs (map #(cheshire.core/parse-string % true) (clojure.string/split-lines (slurp (first *command-line-args*))))
      ob (filter #(clojure.string/starts-with? (or (:source %) "") "outbox:") evs)
      r (ai-ops-sli/aggregate* evs)]
  (assert (= 2 (count ob)) (pr-str evs))
  ;; 通知配送状態 (hermes-status) は task の :status に写さない
  (assert (every? #(nil? (:status %)) ob) (pr-str ob))
  (assert (zero? (get-in r [:input :unverifiable-state-events])) (pr-str (:input r)))
  (assert (zero? (get-in r [:sli :first-acceptance-conformance :unevaluated-input-missing] 0)) (pr-str (:sli r))))
(println "ok   outbox の通知配送状態は task status に写さず、正常な outbox event を持つ task を入力欠落扱いしない")' "$tmp_ob/extract.jsonl"

bb -e '
(load-file "ai_ops_sli.bb")
(let [ok [{:event_id "BOXP-88:approval1" :task_id "BOXP-88" :event_type "approval.requested" :approval_key "op:0000000a"}]
      nokey {:event_id "BOXP-88:approval2" :task_id "BOXP-88" :event_type "approval.requested"}
      r1 (ai-ops-sli/aggregate* (conj ok nokey))
      r2 (ai-ops-sli/aggregate* ok)]
  (assert (= "unknown" (get-in r1 [:sli :duplicate-approval :status])) (pr-str (get-in r1 [:sli :duplicate-approval])))
  (assert (= 1 (get-in r1 [:sli :duplicate-approval :unverifiable-approvals])) (pr-str (get-in r1 [:sli :duplicate-approval])))
  (assert (= [0 1] ((juxt :count :denominator) (get-in r2 [:sli :duplicate-approval]))) (pr-str (get-in r2 [:sli :duplicate-approval]))))
(println "ok   approval_key 欠落/不正の承認があれば重複承認率を確定せず unknown (観測値は下限、検証不能件数を別掲)")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [ap {:event_id "BOXP-89:approval1" :task_id "BOXP-89" :event_type "approval.requested" :approval_key "op:0000000a"}
      rejected-ap {:event_id "bad id!" :task_id "BOXP-90" :event_type "approval.requested" :approval_key "op:0000000a"}
      notify-marker {:privacy_rejected "upstream" :event_type "notify.run-finished"}
      r1 (ai-ops-sli/aggregate* [ap rejected-ap])
      r2 (ai-ops-sli/aggregate* [ap {:collection_lost "buffer_dropped"}])
      r3 (ai-ops-sli/aggregate* [ap notify-marker])]
  (assert (= "unknown" (get-in r1 [:sli :duplicate-approval :status])) (pr-str (get-in r1 [:sli :duplicate-approval])))
  (assert (= 1 (get-in r1 [:sli :duplicate-approval :lost-events])) (pr-str (get-in r1 [:sli :duplicate-approval])))
  (assert (= "unknown" (get-in r2 [:sli :duplicate-approval :status])) (pr-str (get-in r2 [:sli :duplicate-approval])))
  ;; 承認以外と分かる拒否 event では確定のまま
  (assert (= [0 1] ((juxt :count :denominator) (get-in r3 [:sli :duplicate-approval]))) (pr-str (get-in r3 [:sli :duplicate-approval]))))
(println "ok   承認 event だった可能性のある欠落 (privacy 拒否・drop) があれば重複承認率を unknown (承認以外と分かる拒否では確定)")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-91:requested" :task_id "BOXP-91" :request_id "req:BOXP-91" :event_type "request.received"}
            {:event_id "BOXP-91:rescue" :task_id "BOXP-91" :event_type "owner.rescue"}]
      r0 (ai-ops-sli/aggregate* base)
      r1 (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-92:rescue" :event_type "owner.rescue"}))
      r2 (ai-ops-sli/aggregate* (conj base {:privacy_rejected "upstream" :event_type "owner.rescue"}))]
  (assert (= 1 (get-in r0 [:sli :owner-rescue :count])) (pr-str (get-in r0 [:sli :owner-rescue])))
  (assert (= "unknown" (get-in r1 [:sli :owner-rescue :status])) (pr-str (get-in r1 [:sli :owner-rescue])))
  (assert (= 1 (get-in r1 [:sli :owner-rescue :unlinked-rescues])) (pr-str (get-in r1 [:sli :owner-rescue])))
  (assert (= "unknown" (get-in r2 [:sli :owner-rescue :status])) (pr-str (get-in r2 [:sli :owner-rescue])))
  (assert (= 1 (get-in r2 [:sli :owner-rescue :observed-lower-bound :count])) (pr-str (get-in r2 [:sli :owner-rescue]))))
(println "ok   救援 event の欠落 (拒否等) や task_id 欠落の救援があれば Owner 救援率を unknown (観測値は下限)")'

tmp_ts=$(mktemp -d)
mkdir -p "$tmp_ts/root/runs/BOXP-84/20261020T010000Z-aaaa" "$tmp_ts/root/runs/BOXP-84/20261022T010000Z-bbbb" "$tmp_ts/root/outbox" "$tmp_ts/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: done\nclosed: 2026-10-21\n---\n' > "$tmp_ts/vault/Tickets/BOXP-84.md"
echo '{:ticket "BOXP-84" :run-id "20261020T010000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_ts/root/runs/BOXP-84/20261020T010000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-84" :run-id "20261022T010000Z-bbbb" :agent "codex" :status :succeeded :result "review" :action :review-fix :started-at "invalid" :finished-at "2026-10-22T02:00:00Z"}' > "$tmp_ts/root/runs/BOXP-84/20261022T010000Z-bbbb/summary.edn"
bb ai_ops_sli.bb extract "$tmp_ts/root" "$tmp_ts/vault" > "$tmp_ts/x.jsonl" 2>/dev/null
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_ts/x.jsonl\")]
  (assert (= 1 (get-in r [:input :unreadable-runs])) (pr-str (:input r)))
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :denominator])) (pr-str (get-in r [:sli :first-acceptance-conformance])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :unevaluated-input-missing])) (pr-str (get-in r [:sli :first-acceptance-conformance])))
  (println \"ok   解釈できない時刻を持つ summary.edn は欠落入力 (run.unreadable) として該当 task を未評価にする\"))"
rm -rf "$tmp_ts"

bb -e '
(load-file "ai_ops_sli.bb")
(let [r (ai-ops-sli/aggregate* [{:event_id "BOXP-93:requested" :task_id "BOXP-93" :request_id "req:BOXP-93" :event_type "request.received"}
                                {:event_id "BOXP-94:rescue" :task_id "BOXP-94" :event_type "owner.rescue"}])]
  (assert (= [1 2] ((juxt :count :denominator) (get-in r [:sli :owner-rescue]))) (pr-str (get-in r [:sli :owner-rescue]))))
(println "ok   救援 event だけが観測された task も Owner 救援率の分子・分母に含める")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-95:requested" :task_id "BOXP-95" :request_id "req:BOXP-95" :event_type "request.received" :occurred_at "2026-10-20T00:00:00Z"}
            {:event_id "BOXP-95:run1:started" :task_id "BOXP-95" :run_id "20261020T010000Z-aaaa" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-95:run1:finished" :task_id "BOXP-95" :run_id "20261020T010000Z-aaaa" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
            {:event_id "BOXP-95:accepted" :task_id "BOXP-95" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]
      r0 (ai-ops-sli/aggregate* base)
      _ (assert (= [1 1] ((juxt :count :denominator) (get-in r0 [:sli :first-acceptance-conformance]))) (pr-str (get-in r0 [:sli :first-acceptance-conformance])))
      r (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-95:reopened" :task_id "BOXP-95" :event_type "task.reopened" :occurred_at "not-a-time"}))]
  (assert (= 1 (get-in r [:input :unverifiable-state-events])) (pr-str (:input r)))
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :denominator])) (pr-str (get-in r [:sli :first-acceptance-conformance])))
  (assert (= 1 (get-in r [:sli :first-acceptance-conformance :unevaluated-input-missing])) (pr-str (get-in r [:sli :first-acceptance-conformance]))))
(println "ok   時刻を解釈できない状態遷移 event (task.reopened 等) は入力欠落として該当 task を未評価にする")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-96:rescue" :task_id "BOXP-96" :event_type "owner.rescue"}]
      r0 (ai-ops-sli/aggregate* base)
      r1 (ai-ops-sli/aggregate* (conj base {:event_id "BOXP-97:requested" :task_id "bad id" :event_type "request.received"}))]
  (assert (= [1 1] ((juxt :count :denominator) (get-in r0 [:sli :owner-rescue]))) (pr-str (get-in r0 [:sli :owner-rescue])))
  (assert (= "unknown" (get-in r1 [:sli :owner-rescue :status])) (pr-str (get-in r1 [:sli :owner-rescue])))
  (assert (= [1 1] ((juxt :count :denominator) (get-in r1 [:sli :owner-rescue :observed]))) (pr-str (get-in r1 [:sli :owner-rescue]))))
(println "ok   分母に影響する task 紐付け event の欠落 (不正 ID 拒否等) があれば Owner 救援率を unknown")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [base [{:event_id "BOXP-98:run" :task_id "BOXP-98" :run_id "20261020T010000Z-aaaa" :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z"}
            {:event_id "BOXP-98:fin" :task_id "BOXP-98" :run_id "20261020T010000Z-aaaa" :event_type "run.finished" :status "succeeded" :result "review" :occurred_at "2026-10-20T02:00:00Z"}
            {:event_id "BOXP-98:accepted" :task_id "BOXP-98" :event_type "task.accepted" :occurred_at "2026-10-21T00:00:00Z"}]
      reopened {:event_id "BOXP-98:reopened" :task_id "BOXP-98" :event_type "task.reopened"}
      r (ai-ops-sli/aggregate* (conj base reopened))
      ;; 現在状態 snapshot があればそれを優先し前後不明にしない
      rs (ai-ops-sli/aggregate* (conj base reopened {:event_id "BOXP-98:state" :task_id "BOXP-98" :event_type "task.state" :status "review" :snapshot "current"}))]
  (assert (= {"indeterminate" 1} (get-in r [:tasks :outcomes])) (pr-str (get-in r [:tasks :outcomes])))
  (assert (= 1 (get-in r [:guardrails :unfinished])) (pr-str (:guardrails r)))
  (assert (= 1 (get-in r [:input :unverifiable-state-events])) (pr-str (:input r)))
  (assert (= 0 (get-in r [:sli :first-acceptance-conformance :denominator])) (pr-str (get-in r [:sli :first-acceptance-conformance])))
  (assert (= {"awaiting-review" 1} (get-in rs [:tasks :outcomes])) (pr-str (get-in rs [:tasks :outcomes])))
  (assert (= 0 (get-in rs [:input :unverifiable-state-events])) (pr-str (:input rs))))
(println "ok   現在状態 snapshot が無いとき occurred_at 欠落の再open/取消/lane 遷移は前後不明として受入済みと確定せず入力欠落にする")'

# 入力ディレクトリ不在/空の ticket ディレクトリは空データとして集計せずエラー終了する
tmp_in=$(mktemp -d); trap 'rm -rf "$tmp" "$tmp_in"' EXIT
for case in no-root empty-tickets no-outbox; do
  rm -rf "$tmp_in/root" "$tmp_in/vault"
  case $case in
    no-root) mkdir -p "$tmp_in/vault/Tickets"; printf -- '---\nstatus: done\ncreated: 2026-10-01\n---\n' >"$tmp_in/vault/Tickets/BOXP-1.md" ;;
    empty-tickets) mkdir -p "$tmp_in/root/runs" "$tmp_in/root/outbox" "$tmp_in/vault/Tickets" ;;
    no-outbox) mkdir -p "$tmp_in/root/runs" "$tmp_in/vault/Tickets"; printf -- '---\nstatus: done\ncreated: 2026-10-01\n---\n' >"$tmp_in/vault/Tickets/BOXP-1.md" ;;
  esac
  if bb ai_ops_sli.bb extract "$tmp_in/root" "$tmp_in/vault" >"$tmp_in/x.jsonl" 2>/dev/null; then
    echo "FAIL extract は入力欠落 ($case) でエラー終了する"; exit 1
  fi
  [ -s "$tmp_in/x.jsonl" ] && { echo "FAIL 入力欠落 ($case) で event を出さない"; exit 1; }
done
echo "ok   入力ディレクトリ不在/空 ticket ディレクトリは空データとして集計せず extract をエラー終了する"

# 受入後に再オープン中の task も最初の受入履歴で first acceptance に計上する (受入前是正があれば不合格)
cat >"$tmp/reopened-first-accept.jsonl" <<'JEOF'
{"event_id":"BOXP-20:run","task_id":"BOXP-20","event_type":"run.started","occurred_at":"2026-10-18T00:00:00Z"}
{"event_id":"BOXP-20:corr","task_id":"BOXP-20","event_type":"correction","correction_origin":"agent-system","correction_class":"instruction_violation","occurred_at":"2026-10-19T00:00:00Z"}
{"event_id":"BOXP-20:accepted","task_id":"BOXP-20","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
{"event_id":"BOXP-20:reopened","task_id":"BOXP-20","event_type":"task.reopened","occurred_at":"2026-10-21T00:00:00Z"}
{"event_id":"BOXP-21:run","task_id":"BOXP-21","event_type":"run.started","occurred_at":"2026-10-18T00:00:00Z"}
{"event_id":"BOXP-21:accepted","task_id":"BOXP-21","event_type":"task.accepted","occurred_at":"2026-10-20T00:00:00Z"}
JEOF
bb ai_ops_sli.bb aggregate "$tmp/reopened-first-accept.jsonl" >"$tmp/reopened-first-accept.edn"
bb -e '
(let [r (edn/read-string (slurp (first *command-line-args*)))]
  (assert (= 1 (get-in r [:tasks :outcomes "in-flight"])))
  (assert (= [1 2] ((juxt :count :denominator) (get-in r [:sli :first-acceptance-conformance]))))
  (assert (= 2 (get-in r [:by-stratum nil :accepted])))
  (println "ok   再オープン中 task を最初の受入履歴で first acceptance に計上"))' "$tmp/reopened-first-accept.edn"


bb -e '
(load-file "ai_ops_sli.bb")
(let [evs [{:event_id "BOXP-111:accepted" :task_id "BOXP-111" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}
           {:event_id "BOXP-111:reopen" :task_id "BOXP-111" :event_type "task.reopened" :occurred_at "2026-10-21T00:00:00Z"}
           {:event_id "BOXP-112:run" :task_id "BOXP-112" :event_type "run.started" :occurred_at "2026-10-19T00:00:00Z"}
           {:event_id "BOXP-112:accepted" :task_id "BOXP-112" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z"}]
      r (ai-ops-sli/aggregate* evs)
      fa (get-in r [:sli :first-acceptance-conformance])]
  (assert (= 1 (get-in r [:tasks :accepted-without-run-history])) (pr-str (:tasks r)))
  (assert (= [1 1] ((juxt :count :denominator) fa)) (pr-str fa))
  (assert (= [1 2] ((juxt :count :denominator) (:incl-unevaluated-as-not-pass fa))) (pr-str fa)))
(println "ok   受入後に再オープン中の run 履歴なし task も accepted-without-run-history と保守的分母に含める")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [run (fn [t] {:event_id (str t ":run") :task_id t :event_type "run.started" :occurred_at "2026-10-20T01:00:00Z" :result "review"})
      dacc (fn [t] {:event_id (str t ":accepted:1") :task_id t :event_type "task.accepted" :occurred_at "2026-10-21T23:59:59Z" :occurred_precision "day"})
      tacc (fn [t at] {:event_id (str t ":accepted:2") :task_id t :event_type "task.accepted" :occurred_at at :occurred_precision "second"})
      corr (fn [t at] {:event_id (str t ":corr") :task_id t :event_type "correction" :occurred_at at :correction_origin "agent-system" :correction_class "gate_defect"})
      evs [;; 同日の日粒度受入と時刻付き受入、間の是正: 日粒度受入が先だった可能性があり前後不明
           (run "BOXP-121") (dacc "BOXP-121") (tacc "BOXP-121" "2026-10-21T12:00:00Z") (corr "BOXP-121" "2026-10-21T10:00:00Z")
           ;; 時刻付き受入と同時刻の是正も前後不明
           (run "BOXP-122") (dacc "BOXP-122") (tacc "BOXP-122" "2026-10-21T12:00:00Z") (corr "BOXP-122" "2026-10-21T12:00:00Z")
           ;; 前日の是正は確実に受入前: 不合格
           (run "BOXP-123") (dacc "BOXP-123") (tacc "BOXP-123" "2026-10-21T12:00:00Z") (corr "BOXP-123" "2026-10-20T10:00:00Z")
           ;; 時刻付き受入後の是正は確実に受入後: 合格 (reopen-after-accept 側)
           (run "BOXP-124") (dacc "BOXP-124") (tacc "BOXP-124" "2026-10-21T12:00:00Z") (corr "BOXP-124" "2026-10-21T13:00:00Z")
           ;; 時刻付き受入が日粒度受入の前日: 時刻付き受入が確定的に最初
           (run "BOXP-125") (dacc "BOXP-125") (tacc "BOXP-125" "2026-10-20T12:00:00Z") (corr "BOXP-125" "2026-10-20T13:00:00Z")]
      r (ai-ops-sli/aggregate* evs)
      fa (get-in r [:sli :first-acceptance-conformance])]
  (assert (= 2 (:acceptance-day-ambiguous fa)) (pr-str fa))
  (assert (= [2 3] ((juxt :count :denominator) fa)) (pr-str fa)))
(println "ok   日粒度受入と同日の時刻付き受入が混在する場合は最初の受入を前後不明として扱う")'

# 添付ノート (BOXP-<数字>-*.md) だけの Tickets は正本 ticket 0 件として extract をエラー終了する
mkdir -p "$tmp/notes-only/vault/Tickets" "$tmp/notes-only/root/runs" "$tmp/notes-only/root/outbox"
printf -- '---\nstatus: done\ncreated: 2026-10-01\n---\n' >"$tmp/notes-only/vault/Tickets/BOXP-144-notes.md"
if bb ai_ops_sli.bb extract "$tmp/notes-only/root" "$tmp/notes-only/vault" >"$tmp/notes-only.jsonl" 2>/dev/null; then
  echo "FAIL 添付ノートのみの Tickets を空入力として検出しない"; exit 1
fi
echo "ok   添付ノートのみの Tickets を空入力としてエラー終了"

bb -e '
(load-file "ai_ops_sli.bb")
(let [cov {:event_id "cov-acceptance-12345678" :event_type "coverage.connected" :coverage_target "acceptance-history"}
      evs [{:event_id "BOXP-126:run" :task_id "BOXP-126" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
           {:event_id "BOXP-126:accept" :task_id "BOXP-126" :event_type "task.accepted" :occurred_at "2026-10-21T23:59:59Z" :occurred_precision "day"}
           {:event_id "BOXP-126:reopen" :task_id "BOXP-126" :event_type "task.reopened" :correction_origin "agent-system" :occurred_at "2026-10-21T23:59:59Z"}
           cov]
      ra (get-in (ai-ops-sli/aggregate* evs) [:sli :reopen-after-accept])]
  ;; 日粒度受入の内部時刻 (23:59:59Z) と同時刻の再オープンは同日内で前後不明: 受入後と確定しない
  (assert (and (= :unknown (:status ra)) (= 1 (:indeterminate ra))) (pr-str ra)))
(println "ok   日粒度受入と同時刻の再オープンは同時刻特例を適用せず reopen-after-accept を unknown にする")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [evs [;; run.started を取得できず result=review の終了 event だけが残った task
           {:event_id "BOXP-127/20261020T000000Z-ab12:finished" :task_id "BOXP-127" :run_id "20261020T000000Z-ab12" :event_type "run.finished" :status "succeeded" :occurred_at "2026-10-20T01:00:00Z" :result "review"}
           {:event_id "BOXP-128/20261020T000000Z-cd34:started" :task_id "BOXP-128" :run_id "20261020T000000Z-cd34" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
           {:event_id "BOXP-128/20261020T000000Z-cd34:finished" :task_id "BOXP-128" :run_id "20261020T000000Z-cd34" :event_type "run.finished" :status "succeeded" :occurred_at "2026-10-20T01:00:00Z" :result "review"}]
      r (ai-ops-sli/aggregate* evs)
      ct (get-in r [:sli :agent-system-correction-task-ratio])]
  ;; 終了 event 単独の task も計上し、run 履歴不足として未評価に別掲する (分母から黙って消さない)
  (assert (= 2 (get-in r [:tasks :total])) (pr-str (:input r)))
  (assert (= 1 (:unevaluated-input-missing ct)) (pr-str ct))
  (assert (= 1 (:denominator ct)) (pr-str ct)))
(println "ok   run.finished のみ観測された task を計上し run 履歴不足として未評価に別掲")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [evs [;; run/状態 event を取得できず task_id 付きの是正 event だけが届いた task
           {:event_id "BOXP-129:corr" :task_id "BOXP-129" :event_type "correction" :correction_class "instruction_violation" :correction_origin "agent-system" :occurred_at "2026-10-20T01:00:00Z"}
           {:event_id "BOXP-130/20261020T000000Z-ef56:started" :task_id "BOXP-130" :run_id "20261020T000000Z-ef56" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"}
           {:event_id "BOXP-130/20261020T000000Z-ef56:finished" :task_id "BOXP-130" :run_id "20261020T000000Z-ef56" :event_type "run.finished" :status "succeeded" :occurred_at "2026-10-20T01:00:00Z" :result "review"}]
      r (ai-ops-sli/aggregate* evs)
      ct (get-in r [:sli :agent-system-correction-task-ratio])]
  ;; 是正 event 単独の task も計上し、run 履歴不足として未評価に別掲する (分母から黙って消さない)
  (assert (= 2 (get-in r [:tasks :total])) (pr-str (:tasks r)))
  (assert (= 1 (:unevaluated-input-missing ct)) (pr-str ct))
  (assert (= 1 (:denominator ct)) (pr-str ct)))
(println "ok   correction のみ観測された task を計上し run 履歴不足として未評価に別掲")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [run (fn [t] {:event_id (str t "/20261020T000000Z-ab12:started") :task_id t :run_id "20261020T000000Z-ab12" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"})
      evs [(run "BOXP-131")
           ;; 日粒度受入の精度 field が破損 (privacy gate で redact) → 23:59:59Z を正確な受入時刻と誤認してはならない
           {:event_id "BOXP-131:accept" :task_id "BOXP-131" :event_type "task.accepted" :occurred_at "2026-10-21T23:59:59Z" :occurred_precision "dya"}
           {:event_id "BOXP-131:corr" :task_id "BOXP-131" :event_type "correction" :correction_class "instruction_violation" :correction_origin "agent-system" :occurred_at "2026-10-21T10:00:00Z"}
           (run "BOXP-132")
           {:event_id "BOXP-132:accept" :task_id "BOXP-132" :event_type "task.accepted" :occurred_at "2026-10-21T23:59:59Z" :occurred_precision "day"}]
      r (ai-ops-sli/aggregate* evs)
      fa (get-in r [:sli :first-acceptance-conformance])]
  ;; 精度不正の受入 task は合格/不合格にせず入力欠落として未評価
  (assert (= [1 1] ((juxt :count :denominator) fa)) (pr-str fa))
  (assert (= 1 (:unevaluated-input-missing fa)) (pr-str fa)))
(println "ok   occurred_precision が不正な受入は正確な時刻扱いせず入力欠落として未評価")'

bb -e '
(load-file "ai_ops_sli.bb")
(let [run (fn [t] {:event_id (str t "/20261020T000000Z-ab12:started") :task_id t :run_id "20261020T000000Z-ab12" :event_type "run.started" :occurred_at "2026-10-20T00:00:00Z"})
      acc (fn [t] {:event_id (str t ":accept") :task_id t :event_type "task.accepted" :occurred_at "2026-10-21T12:00:00Z" :occurred_precision "second"})
      corr (fn [t at p] {:event_id (str t ":corr") :task_id t :event_type "correction" :correction_class "instruction_violation" :correction_origin "agent-system" :occurred_at at :occurred_precision p})
      evs [;; 受入 12:00 (秒精度) と同日の日粒度是正: 受入前の可能性があるため合格にしない (前後不明)
           (run "BOXP-133") (acc "BOXP-133") (corr "BOXP-133" "2026-10-21T23:59:59Z" "day")
           ;; 前日の日粒度是正: 全期間が受入前 → 不合格
           (run "BOXP-134") (acc "BOXP-134") (corr "BOXP-134" "2026-10-20T23:59:59Z" "day")
           ;; 翌日の日粒度是正: 全期間が受入後 → first acceptance は合格、受入後是正として計上
           (run "BOXP-135") (acc "BOXP-135") (corr "BOXP-135" "2026-10-22T00:00:00Z" "day")]
      r (ai-ops-sli/aggregate* evs)
      fa (get-in r [:sli :first-acceptance-conformance])]
  (assert (= [1 2] ((juxt :count :denominator) fa)) (pr-str fa))
  (assert (= 1 (:acceptance-day-ambiguous fa)) (pr-str fa)))
(println "ok   日粒度の是正は当日全体の期間として受入と比較し前後不明を別掲")'

tmp_fm=$(mktemp -d); trap 'rm -rf "$tmp" "$tmp_status" "$tmp_fm"' EXIT
printf -- '---\ncreated: 2026-10-20\nstatus: done\n---\n本文 Bearer secret-body\n' >"$tmp_fm/BOXP-136.md"
printf -- '---\ncreated: 2026-10-20\n本文に区切り無し\nstatus: done\n' >"$tmp_fm/BOXP-137.md"
bb -e '
(load-file "ai_ops_sli.bb")
(let [[ok open] *command-line-args*]
  ;; ファイル全体を slurp せず、終了区切りまでだけ読む (本文をプロセスに取り込まない)
  (with-redefs [slurp (fn [& _] (throw (ex-info "ticket file must not be slurped" {})))]
    (assert (= {:created "2026-10-20" :status "done"} (ai-ops-sli/frontmatter ok)) "frontmatter 抽出失敗")
    (assert (nil? (ai-ops-sli/frontmatter open)) "終了区切り無しは破損扱い")))
(println "ok   ticket frontmatter は終了区切りまで逐次読み、本文を読み込まない")' "$tmp_fm/BOXP-136.md" "$tmp_fm/BOXP-137.md"

bb -e '
(load-file "ai_ops_sli.bb")
(let [g (ai-ops-sli/privacy-gate {:event_id "BOXP-1/r1" :event_type "run.started" :task_id "BOXP-1" :attempt 12345678901234567890 :tokens_in 1.5 :exit_code 1 :tokens_out 1000})]
  (assert (= "redacted" (get-in g [:event :attempt])) (pr-str g))
  (assert (= "redacted" (get-in g [:event :tokens_in])) (pr-str g))
  (assert (= [1 1000] ((juxt :exit_code :tokens_out) (:event g))) (pr-str g))
  (assert (= 2 (:redacted-values g)) (pr-str g)))
(println "ok   数値fieldは整数範囲外 (長い数値・小数) を redact")'

bb -e '
(load-file "ai_ops_sli.bb")
;; 生成元ごとの固定 ID 形式に合わない短い秘密値は token denylist に掛からなくても通さない
(doseq [id ["BOXP-1:password-hunter2" "BOXP-1/hunter2" "BOXP-1:pw:hunter2" "conv-passwordhunter2" "req-hunter22-secret" "cov-password-12345678"]]
  (assert (not (ai-ops-sli/event-id? id false)) id)
  (assert (:rejected? (ai-ops-sli/privacy-gate {:event_id id :event_type "run.started"})) id))
(doseq [[k v] [[:effect_key "password:hunter2"] [:approval_key "password:hunter2"] [:effect_key "op:hunter2"]
               [:task_id "conv-passwordhunter2"] [:request_id "req-hunter2secret"] [:run_id "20261020T000000Z-hunter2"]]]
  (assert (not (ai-ops-sli/valid-value? k v)) (str k " " v)))
;; 実 extract / outbox が生成する ID 形式は通す
(doseq [id ["BOXP-1/20261029T053619Z-96bcfde3-8008-4361-857b-1f87823f798f:started" "BOXP-1/20261029T053619Z:finished"
            "BOXP-1:20261029T053619Z-dd5bab52-356d-4629-8c8d-61aa51dde55c-groom:unreadable" "BOXP-1:frontmatter-unreadable"
            "BOXP-1-lane-done-20261029T053619Z-1a2b3c4d" "BOXP-1-20261029T053619Z-96bcfde3-8008-4361-857b-1f87823f798f-review"
            "cov-effects-12345678" "conv-0123abcd/accepted"]]
  (assert (ai-ops-sli/event-id? id false) id))
(assert (ai-ops-sli/valid-value? :effect_key "deploy:0000000a"))
(println "ok   privacy gate は生成元ごとの固定 ID 形式のみ許可し短い秘密値を拒否")'

bb -e '
(load-file "ai_ops_sli.bb")
(require (quote [clojure.string :as str]))
;; README の許可例・拒否例が privacy gate の実判定と一致する (文書と実装の ID 仕様の乖離を防ぐ)
(let [lines (str/split-lines (slurp "README.md"))
      ids (fn [prefix] (->> lines (filter #(str/starts-with? % prefix)) first (re-seq #"`([^`]+)`") (map second)))
      ok (ids "- 許可例:") ng (ids "- 拒否例:")]
  (assert (and (seq ok) (seq ng)))
  (doseq [id ok] (assert (ai-ops-sli/event-id? id false) id))
  (doseq [id ng] (assert (not (ai-ops-sli/event-id? id false)) id)))
(println "ok   README の ID 許可例・拒否例が privacy gate の判定と一致")'

bb -e '
(load-file "ai_ops_sli.bb")
;; 通常モードでは入力の synthetic field を信頼しない (run 履歴なし受入を観測済み・合格扱いにしない)
(let [evs [{:event_id "BOXP-97:accepted" :task_id "BOXP-97" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z" :synthetic true}]
      r (ai-ops-sli/aggregate* evs)
      fa (get-in r [:sli :first-acceptance-conformance])
      rs (binding [ai-ops-sli/*synthetic-mode* true] (ai-ops-sli/aggregate* [{:event_id "s97" :task_id "S97" :event_type "task.accepted" :occurred_at "2026-10-20T00:00:00Z" :synthetic true}]))]
  (assert (= 0 (:denominator fa)) (pr-str fa))
  (assert (= 1 (get-in r [:tasks :accepted-without-run-history])) (pr-str (:tasks r)))
  (assert (= 1 (get-in rs [:sli :first-acceptance-conformance :denominator])) (pr-str (:sli rs))))
(println "ok   通常モードでは synthetic field で run 履歴なし受入を観測済み扱いにしない")'

bb -e '
(load-file "ai_ops_sli.bb")
;; runner ledger と既存 extract を join しても同じ run の run/retry/是正/lane 遷移を二重計上しない
(let [run "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57"
      run2 "20261029T063201Z-7d2adcd6-e49e-4399-b92c-d22645e07a3b"
      base {:task_id "BOXP-98" :request_id "req:BOXP-98" :run_id run :source "task-board-runner" :occurred_at "2026-10-29T05:57:35Z"}
      extract [(assoc base :event_id (str "BOXP-98/" run ":started") :event_type "run.started")
               (assoc base :event_id (str "BOXP-98/" run ":finished") :event_type "run.finished" :status "retrying")
               ;; run の gate 失敗を受けた次の review-fix run の開始時に導出される是正 (原因 run = run)
               (assoc base :event_id (str "BOXP-98/" run2 ":corr") :run_id run2 :event_type "correction" :source "derived" :classifier "rule"
                      :evidence_event_ids [(str "BOXP-98/" run2 ":started") (str "BOXP-98/" run ":finished")]
                      :correction_class "gate_defect" :correction_origin "agent-system")]
      ledger [(assoc base :event_id (str "BOXP-98/" run ":ledger:started") :event_type "run.started" :lane_from "ready" :lane_to "in-progress")
              (assoc base :event_id (str "BOXP-98/" run ":ledger:finished") :event_type "run.finished" :status "retrying")
              (assoc base :event_id (str "BOXP-98/" run ":ledger:correction") :event_type "correction" :classifier "rule"
                     :correction_class "gate_defect" :correction_origin "agent-system")
              (assoc base :event_id (str "BOXP-98/" run ":ledger:lane") :event_type "lane.changed" :lane_from "ready" :lane_to "in-progress")]
      only-extract (ai-ops-sli/aggregate* extract)
      joined (ai-ops-sli/aggregate* (concat extract ledger))
      only-ledger (ai-ops-sli/aggregate* ledger)]
  (assert (= (get-in only-extract [:sli :run-reliability]) (get-in joined [:sli :run-reliability])) (pr-str (get-in joined [:sli :run-reliability])))
  (assert (= 1 (get-in joined [:sli :run-reliability :runs])))
  (assert (= 1 (get-in joined [:sli :run-reliability :retrying])))
  (assert (= 3 (get-in joined [:input :ledger-merged])) (pr-str (:input joined)))
  (assert (= (get-in only-extract [:sli :agent-system-correction-task-ratio]) (get-in joined [:sli :agent-system-correction-task-ratio])))
  (assert (= 1 (get-in only-ledger [:sli :run-reliability :runs])))
  (assert (= 0 (get-in only-ledger [:input :ledger-merged]))))
(println "ok   runner ledger と extract の併用で同じ run を二重計上しない")'

bb -e '
(load-file "ai_ops_sli.bb")
;; Ready から始まり Review で終わる run: outbox (Ready→Review) と ledger (Ready→In Progress, In Progress→Review) を
;; join しても終了遷移は1件に統合され、lane 履歴は Ready→In Progress→Review になる
(let [t "BOXP-94" r "20261029T123804Z-cacd1e0e-9737-4ab6-ac0f-dbea9be0b4e6"
      outbox (ai-ops-sli/outbox->events {:event-id (str t "-" r "-review") :event-type "task-board.lane-changed"
                                         :ticket-id t :run-id r :from-status "ready" :to-status "review"
                                         :result "review" :source "task-board-runner"
                                         :created-at "2026-10-29T12:50:00Z" :accepted-at "2026-10-29T12:50:01Z"})
      base {:task_id t :request_id (str "req:" t) :run_id r :source "task-board-runner"}
      ledger [(assoc base :event_id (str t "/" r ":ledger:lane-start") :event_type "lane.changed" :lane_from "ready" :lane_to "in-progress" :occurred_at "2026-10-29T12:38:04Z")
              (assoc base :event_id (str t "/" r ":ledger:lane") :event_type "lane.changed" :lane_from "in-progress" :lane_to "review" :occurred_at "2026-10-29T12:50:00Z")]
      {:keys [events merged]} (ai-ops-sli/merge-ledger-events (concat outbox ledger))
      lanes (->> events (filter #(= "lane.changed" (:event_type %))) (sort-by :occurred_at) (map (juxt :lane_from :lane_to)))
      agg (ai-ops-sli/aggregate* (concat outbox ledger))]
  (assert (= 1 merged) (pr-str merged))
  (assert (= [["ready" "in-progress"] ["in-progress" "review"]] lanes) (pr-str lanes))
  (assert (= 1 (get-in agg [:input :ledger-merged])) (pr-str (:input agg)))
  (assert (= {"awaiting-review" 1} (get-in agg [:tasks :outcomes])) (pr-str (:tasks agg))))
(println "ok   outbox と ledger の終了 lane 遷移を1件に統合し lane 履歴を連続させる")'

bb -e '
(load-file "ai_ops_sli.bb")
;; extract と runner ledger を併用しても、バージョン/reasoning 付き担当名が ledger と同じ基本担当名で残る
(let [run "20261029T114416Z-7a59ee61-f3ae-4a53-a6b7-ea575ed7d67b"
      summ {:ticket "BOXP-95" :run-id run :agent "claude-opus-5-5" :status :succeeded :result :review :action :implement
            :started-at "2026-10-29T11:44:16Z" :finished-at "2026-10-29T12:04:00Z"}
      extract (keep (comp :event ai-ops-sli/privacy-gate) (ai-ops-sli/summary->events "BOXP-95" summ))
      base {:task_id "BOXP-95" :request_id "req:BOXP-95" :run_id run :source "task-board-runner" :agent "claude-opus" :runtime "claude-cli"
            :occurred_at "2026-10-29T11:44:16Z"}
      ledger [(assoc base :event_id (str "BOXP-95/" run ":ledger:started") :event_type "run.started")
              (assoc base :event_id (str "BOXP-95/" run ":ledger:finished") :event_type "run.finished" :status "succeeded" :result "review")]
      merged (:events (ai-ops-sli/merge-ledger-events (concat extract ledger)))
      runs (filter #(#{"run.started" "run.finished"} (:event_type %)) merged)]
  (assert (seq runs))
  (assert (every? #(= "claude-opus" (:agent %)) runs) (pr-str (map (juxt :event_id :agent) runs)))
  (assert (every? #(= "claude-cli" (:runtime %)) runs))
  (assert (= "codex-terra" (:agent (first (ai-ops-sli/summary->events "BOXP-95" (assoc summ :agent "codex-terra-high"))))))
  (assert (= "unknown-agent-9" (ai-ops-sli/normalize-agent "unknown-agent-9"))))
(println "ok   extract も ledger と同じ規則で担当名を正規化し、統合後も agent を失わない")'

bb -e '
(load-file "ai_ops_sli.bb")
;; 同じ review-fix run に「直前 run の gate 失敗由来の derived 是正」と「その run 自身の gate 失敗 (ledger)」がある場合は別の事実
(let [r0 "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57"
      r1 "20261029T063201Z-7d2adcd6-e49e-4399-b92c-d22645e07a3b"
      base {:task_id "BOXP-97" :request_id "req:BOXP-97" :source "task-board-runner" :occurred_at "2026-10-29T06:32:01Z"}
      evs [(assoc base :event_id (str "BOXP-97/" r0 ":started") :run_id r0 :event_type "run.started")
           (assoc base :event_id (str "BOXP-97/" r0 ":finished") :run_id r0 :event_type "run.finished" :status "retrying")
           (assoc base :event_id (str "BOXP-97/" r1 ":started") :run_id r1 :event_type "run.started")
           (assoc base :event_id (str "BOXP-97/" r1 ":finished") :run_id r1 :event_type "run.finished" :status "succeeded" :result "review")
           (assoc base :event_id (str "BOXP-97/" r1 ":corr") :run_id r1 :event_type "correction" :source "derived" :classifier "rule"
                  :evidence_event_ids [(str "BOXP-97/" r1 ":started") (str "BOXP-97/" r0 ":finished")]
                  :correction_class "gate_defect" :correction_origin "agent-system")
           (assoc base :event_id (str "BOXP-97/" r1 ":ledger:correction") :run_id r1 :event_type "correction" :classifier "rule"
                  :evidence_event_ids [(str "BOXP-97/" r1 ":ledger:started")]
                  :correction_class "gate_defect" :correction_origin "agent-system")]
      r (ai-ops-sli/aggregate* evs)]
  (assert (= 0 (get-in r [:input :ledger-merged])) (pr-str (:input r)))
  (assert (= 2 (get-in r [:sli :corrections-per-task :total-agent-system])) (pr-str (get-in r [:sli :corrections-per-task]))))
(println "ok   同じ run 内の別々の gate 失敗由来の是正を ledger 統合で落とさない")'

bb -e '
(load-file "ai_ops_sli.bb")
;; 統合時は実 gate 結果を持つ ledger 側の分類を正とする (pr-gate 失敗は ledger では unknown、derived は一律 gate_defect と推定)
(let [r0 "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57"
      r1 "20261029T063201Z-7d2adcd6-e49e-4399-b92c-d22645e07a3b"
      base {:task_id "BOXP-96" :request_id "req:BOXP-96" :source "task-board-runner" :occurred_at "2026-10-29T06:32:01Z"}
      derived (assoc base :event_id (str "BOXP-96/" r1 ":corr") :run_id r1 :event_type "correction" :source "derived" :classifier "rule"
                     :evidence_event_ids [(str "BOXP-96/" r1 ":started") (str "BOXP-96/" r0 ":finished")]
                     :correction_class "gate_defect" :correction_origin "agent-system" :confidence "high")
      evs [(assoc base :event_id (str "BOXP-96/" r0 ":started") :run_id r0 :event_type "run.started")
           (assoc base :event_id (str "BOXP-96/" r0 ":finished") :run_id r0 :event_type "run.finished" :status "retrying")
           (assoc base :event_id (str "BOXP-96/" r1 ":started") :run_id r1 :event_type "run.started")
           (assoc base :event_id (str "BOXP-96/" r1 ":finished") :run_id r1 :event_type "run.finished" :status "succeeded" :result "review")
           derived
           (assoc base :event_id (str "BOXP-96/" r0 ":ledger:correction") :run_id r0 :event_type "correction" :classifier "rule"
                  :correction_class "unknown" :correction_origin "unknown" :confidence "low")]
      r (ai-ops-sli/aggregate* evs)
      merged (:events (ai-ops-sli/merge-ledger-events evs))
      corr (filter #(= "correction" (:event_type %)) merged)]
  (assert (= 1 (get-in r [:input :ledger-merged])) (pr-str (:input r)))
  (assert (= [(:event_id derived)] (map :event_id corr)) (pr-str corr))
  (assert (= ["unknown" "unknown" "low"] ((juxt :correction_class :correction_origin :confidence) (first corr))) (pr-str corr))
  (assert (= (:evidence_event_ids derived) (:evidence_event_ids (first corr))))
  (assert (= 0 (get-in r [:sli :corrections-per-task :total-agent-system])) (pr-str (get-in r [:sli :corrections-per-task])))
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :unknown-cause-tasks])) (pr-str (get-in r [:sli :agent-system-correction-task-ratio]))))
(println "ok   ledger 統合時は実 gate 結果の是正分類を保持する")'

bb -e '
(load-file "ai_ops_sli.bb")
;; 統合時は ledger 側の実 gate 失敗時刻を保持する (derived は次の review-fix run 開始時刻で、間の受入を跨ぐと受入後是正に化ける)
(let [r0 "20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57"
      r1 "20261029T063201Z-7d2adcd6-e49e-4399-b92c-d22645e07a3b"
      base {:task_id "BOXP-95" :request_id "req:BOXP-95" :source "task-board-runner"}
      evs [(assoc base :event_id (str "BOXP-95/" r0 ":started") :run_id r0 :event_type "run.started" :occurred_at "2026-10-29T05:57:35Z")
           (assoc base :event_id (str "BOXP-95/" r0 ":finished") :run_id r0 :event_type "run.finished" :status "retrying" :occurred_at "2026-10-29T06:00:00Z")
           (assoc base :event_id (str "BOXP-95/" r0 ":ledger:correction") :run_id r0 :event_type "correction" :classifier "rule"
                  :correction_class "gate_defect" :correction_origin "agent-system" :occurred_at "2026-10-29T06:00:00Z")
           (assoc base :event_id "BOXP-95:accepted" :event_type "task.accepted" :occurred_at "2026-10-29T06:10:00Z")
           (assoc base :event_id (str "BOXP-95/" r1 ":started") :run_id r1 :event_type "run.started" :occurred_at "2026-10-29T06:32:01Z")
           (assoc base :event_id (str "BOXP-95/" r1 ":corr") :run_id r1 :event_type "correction" :source "derived" :classifier "rule"
                  :evidence_event_ids [(str "BOXP-95/" r1 ":started") (str "BOXP-95/" r0 ":finished")]
                  :correction_class "gate_defect" :correction_origin "agent-system" :occurred_at "2026-10-29T06:32:01Z")]
      merged (:events (ai-ops-sli/merge-ledger-events evs))
      corr (first (filter #(= "correction" (:event_type %)) merged))
      fa (get-in (ai-ops-sli/aggregate* evs) [:sli :first-acceptance-conformance])]
  (assert (= (str "BOXP-95/" r1 ":corr") (:event_id corr)) (pr-str corr))
  (assert (= "2026-10-29T06:00:00Z" (:occurred_at corr)) (pr-str corr))
  (assert (= [0 1] [(:count fa) (:denominator fa)]) (pr-str fa)))
(println "ok   ledger 統合時は実 gate 失敗時刻を保持し受入前の是正を受入後に移さない")'

cat >"$tmp/emit-ledger.clj" <<EOF
(load-file "$(pwd)/../../../../docker/codex-workspace/task-board/ai_ops_ledger.bb")
(let [t "BOXP-96" r "20261029T065116Z-73b3af54-9911-4b9a-aefe-6352c5ec0973"
      base {:task_id t :request_id (str "req:" t) :run_id r :agent "claude-opus" :runtime "claude-cli" :action "implement"}]
  (doseq [[w f] [["started" {:event_type "run.started" :lane_from "ready" :lane_to "in-progress"}]
                 ["lane-start" {:event_type "lane.changed" :lane_from "ready" :lane_to "in-progress"}]
                 ["correction" {:event_type "correction" :classifier "rule" :classifier_version "correction-rules/v0"
                                :correction_class "gate_defect" :correction_origin "agent-system" :confidence "high"
                                :evidence_event_ids [(ai-ops-ledger/event-id t r "started")]}]
                 ["finished" {:event_type "run.finished" :status "retrying"}]
                 ["lane" {:event_type "lane.changed" :lane_from "in-progress" :lane_to "review"}]]]
    (assert (ai-ops-ledger/emit! "$tmp/ledger-root" (merge base {:event_id (ai-ops-ledger/event-id t r w)} f)) w)))
EOF
bb "$tmp/emit-ledger.clj"
bb ai_ops_sli.bb aggregate "$tmp"/ledger-root/ai-ops/ledger/events-*.jsonl >"$tmp/ledger.edn"
bb -e "
(let [r (clojure.edn/read-string (slurp \"$tmp/ledger.edn\"))]
  (assert (= 5 (get-in r [:input :unique])) (pr-str (:input r)))
  (assert (every? zero? (map #(get-in r [:coverage %]) [:privacy-rejected-invalid-id :privacy-rejected-invalid-correlation-id :privacy-rejected-upstream])) (pr-str (:coverage r)))
  (assert (= 1 (get-in r [:sli :corrections-per-task :total-agent-system])) (pr-str (:sli r)))
  (assert (= {\"awaiting-review\" 1} (get-in r [:tasks :outcomes])) (pr-str (:tasks r))))"
echo "ok   runner が実際に出力した ledger event (lane-start 含む) を通常モードで拒否せず集計する"
python3 - "$tmp/ok.prom" "$tmp/extract.prom" <<'PYTEST'
import sys
ok, extracted = (open(p).read() for p in sys.argv[1:])
for name in ('ai_ops_sli_info', 'ai_ops_sli_generated_timestamp_seconds', 'ai_ops_first_acceptance_tasks', 'ai_ops_first_acceptance_denominator_tasks', 'ai_ops_first_acceptance_excluded_tasks', 'ai_ops_first_acceptance_conservative_tasks', 'ai_ops_correction_events', 'ai_ops_correction_unevaluated_tasks', 'ai_ops_sli_source_connected', 'ai_ops_runs', 'ai_ops_stratum_tasks', 'ai_ops_guardrail_tasks'):
    assert '# TYPE ' + name + ' gauge' in ok, name
for sli in ('owner_rescue', 'duplicate_approval', 'reopen_after_accept'):
    assert f'ai_ops_sli_determinable{{sli="{sli}"}} 0' in extracted
    assert f'ai_ops_sli_count{{sli="{sli}"}}' not in extracted
    assert f'ai_ops_sli_denominator{{sli="{sli}"}}' not in extracted
assert 'ai_ops_lead_time_hours{quantile="0.5"}' in extracted
assert 'ai_ops_lead_time_precision_info{precision="day"} 1' in extracted
print('ok   SLI snapshot metrics and unknown handling')
PYTEST
# unknown の理由を Owner 向け 4 分類 (not_connected/history_missing/unclassifiable/out_of_scope) と件数で Prom に出す。
# 確定している SLI には出さず、unknown を 0 や成功に置き換えない。
grep -qF 'ai_ops_sli_unknown_info{sli="tokens_cost",category="out_of_scope",reason_code="subscription_no_token_cost"} 1' "$tmp/extract.prom"
grep -qF 'ai_ops_sli_unknown_info{sli="owner_rescue",category="not_connected",reason_code="rescue_source_not_connected"} 1' "$tmp/extract.prom"
grep -qF 'ai_ops_sli_unknown_info{sli="private_leak",category="not_connected",reason_code="leak_detector_not_connected"} 1' "$tmp/extract.prom"
grep -qF 'ai_ops_sli_unknown_info{sli="agent_system_correction_task_ratio",category="unclassifiable",reason_code="unknown_cause_reopen"} 1' "$tmp/extract.prom"
if grep -q 'ai_ops_sli_unknown_info{sli="first_acceptance_conformance"' "$tmp/extract.prom"; then echo "確定済み SLI に unknown_info が出ている" >&2; exit 1; fi
tmp_unk=$(mktemp); cp "$tmp/extract.jsonl" "$tmp_unk"; echo 'not json' >>"$tmp_unk"
bb ai_ops_sli.bb prom "$tmp_unk" >"$tmp_unk.prom"
grep -qF 'ai_ops_sli_unknown_info{sli="critical_safety_events",category="history_missing",reason_code="input_loss"} 1' "$tmp_unk.prom"
grep -qF 'ai_ops_sli_unknown_detail{sli="critical_safety_events",detail="malformed_lines"} 1' "$tmp_unk.prom"
grep -qF 'ai_ops_sli_unknown_info{sli="agent_system_correction_task_ratio",category="history_missing",reason_code="input_loss"} 1' "$tmp_unk.prom"
grep -qF 'ai_ops_sli_unknown_detail{sli="agent_system_correction_task_ratio",detail="lost_events"} 1' "$tmp_unk.prom"
grep -qF 'ai_ops_sli_determinable{sli="agent_system_correction_task_ratio"} 0' "$tmp_unk.prom"
# aggregate で unknown (または not-connected) な SLI/coverage には必ず unknown_info がある
bb -e "(load-file \"ai_ops_sli.bb\")
(let [r (ai-ops-sli/aggregate \"$tmp_unk\")
      ps (with-out-str (ai-ops-sli/prom \"$tmp_unk\"))
      unknown (for [[path label] [[[:sli :agent-system-correction-task-ratio] \"agent_system_correction_task_ratio\"] [[:sli :first-acceptance-conformance] \"first_acceptance_conformance\"]
                                   [[:sli :owner-rescue] \"owner_rescue\"] [[:sli :duplicate-approval] \"duplicate_approval\"] [[:sli :reopen-after-accept] \"reopen_after_accept\"]
                                   [[:coverage :ready-ack-latency] \"ready_ack_latency\"] [[:coverage :tokens-cost] \"tokens_cost\"] [[:coverage :hermes-conversation] \"hermes_conversation\"]
                                   [[:zero-tolerance :critical-safety-events] \"critical_safety_events\"] [[:zero-tolerance :duplicate-effects] \"duplicate_effects\"] [[:zero-tolerance :private-leak] \"private_leak\"]]
                     :when (#{\"unknown\" \"not-connected\"} (some-> (get-in r (conj path :status)) name))]
                 label)]
  (assert (seq unknown))
  (doseq [l unknown] (assert (re-find (re-pattern (str \"ai_ops_sli_unknown_info\\\\{sli=\\\"\" l \"\\\",category=\\\"(not_connected|history_missing|unclassifiable|out_of_scope)\\\"\")) ps) l)))"
rm -f "$tmp_unk" "$tmp_unk.prom"
echo "ok   unknown reason classification (4 categories) exported to Prom"
./insight-test.sh

# codex-review 指摘: 結果マーカーなしの正常終了 (:result nil) は runner が既定で Review (groom は Ready) に進める。
# extract も同じ既定で補完し、Review 到達 (分母) と Review 後の再開を落とさない。
tmp_nil=$(mktemp -d)
mkdir -p "$tmp_nil/root/runs/BOXP-98/20261020T000000Z-aaaa" "$tmp_nil/root/runs/BOXP-98/20261020T010000Z-bbbb" "$tmp_nil/root/runs/BOXP-98/20261021T010000Z-cccc" "$tmp_nil/root/outbox" "$tmp_nil/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: review\n---\n' > "$tmp_nil/vault/Tickets/BOXP-98.md"
echo '{:ticket "BOXP-98" :run-id "20261020T000000Z-aaaa" :agent "codex" :status :succeeded :result nil :action :groom :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T00:30:00Z"}' > "$tmp_nil/root/runs/BOXP-98/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-98" :run-id "20261020T010000Z-bbbb" :agent "codex" :status :succeeded :result nil :action :implement :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_nil/root/runs/BOXP-98/20261020T010000Z-bbbb/summary.edn"
echo '{:ticket "BOXP-98" :run-id "20261021T010000Z-cccc" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-21T01:00:00Z" :finished-at "2026-10-21T02:00:00Z"}' > "$tmp_nil/root/runs/BOXP-98/20261021T010000Z-cccc/summary.edn"
bb ai_ops_sli.bb extract "$tmp_nil/root" "$tmp_nil/vault" > "$tmp_nil/x.jsonl"
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [evs (map #(cheshire.core/parse-string % true) (line-seq (java.io.BufferedReader. (java.io.StringReader. (slurp \"$tmp_nil/x.jsonl\")))))
      by-id (into {} (map (juxt :event_id identity) evs))
      r (ai-ops-sli/aggregate \"$tmp_nil/x.jsonl\")]
  (assert (= \"ready\" (:result (by-id \"BOXP-98/20261020T000000Z-aaaa:finished\"))) \"groom のマーカーなしは ready\")
  (assert (= \"review\" (:result (by-id \"BOXP-98/20261020T010000Z-bbbb:finished\"))) \"implement のマーカーなしは review\")
  (assert (= \"task.reopened\" (:event_type (by-id \"BOXP-98/20261021T010000Z-cccc:reopen\"))) \"マーカーなし Review の後の implement は再開\")
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :denominator])) (pr-str (get-in r [:sli :agent-system-correction-task-ratio])))
  (println \"ok   結果マーカーなしの正常終了を runner の既定 (Review/Ready) で補完し、Review 到達と再開を落とさない\"))"
rm -rf "$tmp_nil"

# codex-review 指摘: :action 欠落の run は effective-result の既定 (Review/Ready) も review-fix の是正導出もできない。
# 読めない run (run.unreadable) として該当 task を未評価にし、Review 到達や是正を確定値に入れない。
tmp_noact=$(mktemp -d)
mkdir -p "$tmp_noact/root/runs/BOXP-97/20261020T000000Z-aaaa" "$tmp_noact/root/runs/BOXP-97/20261020T010000Z-bbbb" "$tmp_noact/root/outbox" "$tmp_noact/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: review\n---\n' > "$tmp_noact/vault/Tickets/BOXP-97.md"
echo '{:ticket "BOXP-97" :run-id "20261020T000000Z-aaaa" :agent "codex" :status :succeeded :result nil :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T00:30:00Z"}' > "$tmp_noact/root/runs/BOXP-97/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-97" :run-id "20261020T010000Z-bbbb" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T01:00:00Z" :finished-at "2026-10-20T02:00:00Z"}' > "$tmp_noact/root/runs/BOXP-97/20261020T010000Z-bbbb/summary.edn"
bb ai_ops_sli.bb extract "$tmp_noact/root" "$tmp_noact/vault" > "$tmp_noact/x.jsonl"
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [evs (map #(cheshire.core/parse-string % true) (line-seq (java.io.BufferedReader. (java.io.StringReader. (slurp \"$tmp_noact/x.jsonl\")))))
      types (set (map :event_type evs))
      r (ai-ops-sli/aggregate \"$tmp_noact/x.jsonl\")
      ct (get-in r [:sli :agent-system-correction-task-ratio])]
  (assert (contains? types \"run.unreadable\") (pr-str types))
  (assert (not-any? #(= \"BOXP-97/20261020T000000Z-aaaa:finished\" (:event_id %)) evs) \":action 欠落 run を正常 run として出力しない\")
  (assert (= 0 (:denominator ct)) (pr-str ct))
  (assert (= 1 (:unevaluated-input-missing ct)) (pr-str ct))
  (println \"ok   :action 欠落の run は unreadable として該当 task を未評価にし Review 到達を確定値に入れない\"))"
rm -rf "$tmp_noact"

# 中断 (interrupted) run は runner が top-level :action を書かず :previous-lock に残す。extract はこれを補完して
# run.started の action と是正導出 (review-fix) に使い、補完できない中断 run は run.unreadable として該当 task を未評価にする。
tmp_int=$(mktemp -d)
mkdir -p "$tmp_int/root/runs/BOXP-96/20261020T000000Z-aaaa" "$tmp_int/root/runs/BOXP-96/20261020T010000Z-bbbb" "$tmp_int/root/runs/BOXP-95/20261020T000000Z-aaaa" "$tmp_int/root/runs/BOXP-95/20261020T010000Z-bbbb" "$tmp_int/root/outbox" "$tmp_int/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: review\n---\n' > "$tmp_int/vault/Tickets/BOXP-96.md"
printf -- '---\ncreated: 2026-10-20\nstatus: review\n---\n' > "$tmp_int/vault/Tickets/BOXP-95.md"
echo '{:ticket "BOXP-96" :run-id "20261020T000000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T00:30:00Z"}' > "$tmp_int/root/runs/BOXP-96/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-96" :run-id "20261020T010000Z-bbbb" :status :interrupted :updated-at "2026-10-20T01:10:00Z" :previous-lock {:action :review-fix :ticket "BOXP-96" :started-at "2026-10-20T01:00:00Z"}}' > "$tmp_int/root/runs/BOXP-96/20261020T010000Z-bbbb/summary.edn"
echo '{:ticket "BOXP-95" :run-id "20261020T000000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T00:30:00Z"}' > "$tmp_int/root/runs/BOXP-95/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-95" :run-id "20261020T010000Z-bbbb" :status :interrupted :updated-at "2026-10-20T01:10:00Z" :previous-lock {:ticket "BOXP-95"}}' > "$tmp_int/root/runs/BOXP-95/20261020T010000Z-bbbb/summary.edn"
bb ai_ops_sli.bb extract "$tmp_int/root" "$tmp_int/vault" > "$tmp_int/x.jsonl"
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [evs (map #(cheshire.core/parse-string % true) (line-seq (java.io.BufferedReader. (java.io.StringReader. (slurp \"$tmp_int/x.jsonl\")))))
      by-id (into {} (map (juxt :event_id identity) evs))
      r (ai-ops-sli/aggregate \"$tmp_int/x.jsonl\")
      ct (get-in r [:sli :agent-system-correction-task-ratio])]
  (assert (= \"review-fix\" (:action (by-id \"BOXP-96/20261020T010000Z-bbbb:started\"))) (pr-str (by-id \"BOXP-96/20261020T010000Z-bbbb:started\")))
  (assert (= \"run.interrupted\" (:event_type (by-id \"BOXP-96/20261020T010000Z-bbbb:interrupted\"))))
  (assert (= \"agent-system\" (:correction_origin (by-id \"BOXP-96/20261020T010000Z-bbbb:corr\"))) \"中断した review-fix も是正として導出\")
  (assert (some #(and (= \"run.unreadable\" (:event_type %)) (= \"BOXP-95\" (:task_id %))) evs) \":action を補完できない中断 run は unreadable\")
  (assert (= [1 1] ((juxt :count :denominator) ct)) (pr-str ct))
  (assert (= 1 (:unevaluated-input-missing ct)) (pr-str ct))
  (println \"ok   中断 run の :action を :previous-lock から補完して是正導出に使い、補完できない中断 run は該当 task を未評価にする\"))"
rm -rf "$tmp_int"

# codex-review 指摘: 結果補完は runner の final-status と同じ規則にする。groom は明示マーカーが review でも Ready に
# 進む (Review 到達/再開に数えない)。docs-groom は result=blocked なら Blocked、それ以外は Ready。
tmp_groom=$(mktemp -d)
mkdir -p "$tmp_groom/root/runs/BOXP-94/20261020T000000Z-aaaa" "$tmp_groom/root/runs/BOXP-94/20261021T010000Z-bbbb" "$tmp_groom/root/runs/BOXP-93/20261020T000000Z-aaaa" "$tmp_groom/root/runs/BOXP-92/20261020T000000Z-aaaa" "$tmp_groom/root/outbox" "$tmp_groom/vault/Tickets"
printf -- '---\ncreated: 2026-10-20\nstatus: in-progress\n---\n' > "$tmp_groom/vault/Tickets/BOXP-94.md"
printf -- '---\ncreated: 2026-10-20\nstatus: ready\n---\n' > "$tmp_groom/vault/Tickets/BOXP-93.md"
printf -- '---\ncreated: 2026-10-20\nstatus: blocked\n---\n' > "$tmp_groom/vault/Tickets/BOXP-92.md"
echo '{:ticket "BOXP-94" :run-id "20261020T000000Z-aaaa" :agent "claude-opus" :status :succeeded :result "review" :action :groom :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T00:30:00Z"}' > "$tmp_groom/root/runs/BOXP-94/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-94" :run-id "20261021T010000Z-bbbb" :agent "claude-opus" :status :succeeded :result "review" :action :implement :started-at "2026-10-21T01:00:00Z" :finished-at "2026-10-21T02:00:00Z"}' > "$tmp_groom/root/runs/BOXP-94/20261021T010000Z-bbbb/summary.edn"
echo '{:ticket "BOXP-93" :run-id "20261020T000000Z-aaaa" :agent "codex" :status :succeeded :result "review" :action :docs-groom :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T00:30:00Z"}' > "$tmp_groom/root/runs/BOXP-93/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-92" :run-id "20261020T000000Z-aaaa" :agent "codex" :status :succeeded :result "blocked" :action :docs-groom :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T00:30:00Z"}' > "$tmp_groom/root/runs/BOXP-92/20261020T000000Z-aaaa/summary.edn"
bb ai_ops_sli.bb extract "$tmp_groom/root" "$tmp_groom/vault" > "$tmp_groom/x.jsonl"
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [evs (map #(cheshire.core/parse-string % true) (line-seq (java.io.BufferedReader. (java.io.StringReader. (slurp \"$tmp_groom/x.jsonl\")))))
      by-id (into {} (map (juxt :event_id identity) evs))
      r (ai-ops-sli/aggregate \"$tmp_groom/x.jsonl\")]
  (assert (= \"ready\" (:result (by-id \"BOXP-94/20261020T000000Z-aaaa:finished\"))) \"groom の review マーカーは runner が Ready に進めるので ready\")
  (assert (nil? (by-id \"BOXP-94/20261021T010000Z-bbbb:reopen\")) \"groom (Ready) の後の implement は Review 後の再開ではない\")
  (assert (= \"ready\" (:result (by-id \"BOXP-93/20261020T000000Z-aaaa:finished\"))) \"docs-groom の review マーカーは ready\")
  (assert (= \"blocked\" (:result (by-id \"BOXP-92/20261020T000000Z-aaaa:finished\"))) \"docs-groom の blocked は blocked\")
  (assert (= 1 (get-in r [:sli :agent-system-correction-task-ratio :denominator])) (pr-str (get-in r [:sli :agent-system-correction-task-ratio])))
  (println \"ok   groom/docs-groom の結果補完が runner final-status と一致 (groom の review マーカーを Review 到達/再開に数えない)\"))"
rm -rf "$tmp_groom"

# codex-review 指摘: 結果マーカーなしの retrying/blocked implement run にも effective-result "review" が補完されるが、
# gate で止まった run は Owner の Review に到達していない。Review 到達 (是正率の分母) は status=succeeded の run に限る。
tmp_gate=$(mktemp -d)
mkdir -p "$tmp_gate/root/runs/BOXP-131/20261020T000000Z-aaaa" "$tmp_gate/root/runs/BOXP-132/20261020T000000Z-aaaa" "$tmp_gate/root/runs/BOXP-133/20261020T000000Z-aaaa" "$tmp_gate/root/runs/BOXP-134/20261020T000000Z-aaaa" "$tmp_gate/root/outbox" "$tmp_gate/vault/Tickets"
for t in 131 132 133 134; do printf -- '---\ncreated: 2026-10-20\nstatus: in-progress\n---\n' > "$tmp_gate/vault/Tickets/BOXP-$t.md"; done
# review マーカーあり・gate 失敗 (retrying) / マーカーなし・blocked / マーカーなし・成功 (runner 既定で Review) / review マーカーあり・成功
echo '{:ticket "BOXP-131" :run-id "20261020T000000Z-aaaa" :agent "claude-opus" :status :retrying :result "review" :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T01:00:00Z"}' > "$tmp_gate/root/runs/BOXP-131/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-132" :run-id "20261020T000000Z-aaaa" :agent "claude-opus" :status :blocked :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T01:00:00Z"}' > "$tmp_gate/root/runs/BOXP-132/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-133" :run-id "20261020T000000Z-aaaa" :agent "claude-opus" :status :succeeded :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T01:00:00Z"}' > "$tmp_gate/root/runs/BOXP-133/20261020T000000Z-aaaa/summary.edn"
echo '{:ticket "BOXP-134" :run-id "20261020T000000Z-aaaa" :agent "claude-opus" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T01:00:00Z"}' > "$tmp_gate/root/runs/BOXP-134/20261020T000000Z-aaaa/summary.edn"
bb ai_ops_sli.bb extract "$tmp_gate/root" "$tmp_gate/vault" > "$tmp_gate/x.jsonl"
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [evs (map #(cheshire.core/parse-string % true) (line-seq (java.io.BufferedReader. (java.io.StringReader. (slurp \"$tmp_gate/x.jsonl\")))))
      by-id (into {} (map (juxt :event_id identity) evs))
      r (ai-ops-sli/aggregate \"$tmp_gate/x.jsonl\")
      ct (get-in r [:sli :agent-system-correction-task-ratio])
      reached (set (for [t [\"BOXP-131\" \"BOXP-132\" \"BOXP-133\" \"BOXP-134\"]
                         :when (pos? (get-in (ai-ops-sli/aggregate* (filter #(= t (:task_id %)) evs)) [:sli :agent-system-correction-task-ratio :denominator]))] t))]
  (assert (= [\"retrying\" \"review\"] ((juxt :status :result) (by-id \"BOXP-131/20261020T000000Z-aaaa:finished\"))) \"retrying run は result=review を持つが status で区別する\")
  (assert (= [\"blocked\" \"review\"] ((juxt :status :result) (by-id \"BOXP-132/20261020T000000Z-aaaa:finished\"))) \"マーカーなし blocked run も補完で review になる\")
  (assert (= #{\"BOXP-133\" \"BOXP-134\"} reached) (pr-str reached))
  (assert (= 2 (:denominator ct)) (pr-str ct))
  ;; aggregate* 直接入力: status 欠落/retrying の run.finished は Review 到達の証拠にしない (succeeded のみ)
  (doseq [[label st expected] [[\"succeeded\" \"succeeded\" 1] [\"retrying\" \"retrying\" 0] [\"blocked\" \"blocked\" 0] [\"status 欠落\" nil 0]]]
    (let [r2 (ai-ops-sli/aggregate* [{:event_id \"BOXP-135:run\" :task_id \"BOXP-135\" :event_type \"run.started\" :occurred_at \"2026-10-20T00:00:00Z\"}
                                      (cond-> {:event_id \"BOXP-135:fin\" :task_id \"BOXP-135\" :event_type \"run.finished\" :result \"review\" :occurred_at \"2026-10-20T01:00:00Z\"} st (assoc :status st))])]
      (assert (= expected (get-in r2 [:sli :agent-system-correction-task-ratio :denominator])) (str label \" \" (pr-str (get-in r2 [:sli :agent-system-correction-task-ratio]))))))
  (println \"ok   gate で止まった retrying/blocked run (補完 result=review) を Review 到達に数えず、succeeded の run だけを是正率の分母にする\"))"
rm -rf "$tmp_gate"

# codex-review 指摘: notify.run-finished の :result は agent の生の結果マーカーで最終遷移先ではない。review マーカーを出した run が
# 非 retryable な gate 失敗で Blocked に移ると to-status=blocked/result=review の通知になる。Review 到達は通知の lane_to=review で判定する。
tmp_nb=$(mktemp -d)
mkdir -p "$tmp_nb/root/runs/BOXP-136/20261020T000000Z-aaaa" "$tmp_nb/root/runs/BOXP-137/20261020T000000Z-aaaa" "$tmp_nb/root/outbox" "$tmp_nb/vault/Tickets"
for t in 136 137; do printf -- '---\ncreated: 2026-10-20\nstatus: in-progress\n---\n' > "$tmp_nb/vault/Tickets/BOXP-$t.md"; done
# BOXP-136: review マーカー + 非 retryable gate 失敗で Blocked (runner summary status=blocked、通知 to-status=blocked/result=review)
echo '{:ticket "BOXP-136" :run-id "20261020T000000Z-aaaa" :agent "claude-opus" :status :blocked :result "review" :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T01:00:00Z"}' > "$tmp_nb/root/runs/BOXP-136/20261020T000000Z-aaaa/summary.edn"
echo '{:event-id "BOXP-136-20261020T000000Z-aaaa-blocked" :run-id "20261020T000000Z-aaaa" :ticket-id "BOXP-136" :event-type "task-board.run-finished" :source "task-board-runner" :from-status "ready" :to-status "blocked" :result "review" :hermes-status "accepted" :created-at "2026-10-20T01:00:01Z" :accepted-at "2026-10-20T01:00:05Z"}' > "$tmp_nb/root/outbox/nb1.edn"
# BOXP-137: 同じ review マーカーで gate 通過 (to-status=review)
echo '{:ticket "BOXP-137" :run-id "20261020T000000Z-aaaa" :agent "claude-opus" :status :succeeded :result "review" :action :implement :started-at "2026-10-20T00:00:00Z" :finished-at "2026-10-20T01:00:00Z"}' > "$tmp_nb/root/runs/BOXP-137/20261020T000000Z-aaaa/summary.edn"
echo '{:event-id "BOXP-137-20261020T000000Z-aaaa-review" :run-id "20261020T000000Z-aaaa" :ticket-id "BOXP-137" :event-type "task-board.run-finished" :source "task-board-runner" :from-status "ready" :to-status "review" :result "review" :hermes-status "accepted" :created-at "2026-10-20T01:00:01Z" :accepted-at "2026-10-20T01:00:05Z"}' > "$tmp_nb/root/outbox/nb2.edn"
bb ai_ops_sli.bb extract "$tmp_nb/root" "$tmp_nb/vault" > "$tmp_nb/x.jsonl"
bb -e "
(load-file \"ai_ops_sli.bb\")
(let [evs (map #(cheshire.core/parse-string % true) (line-seq (java.io.BufferedReader. (java.io.StringReader. (slurp \"$tmp_nb/x.jsonl\")))))
      notify (filter #(= \"notify.run-finished\" (:event_type %)) evs)
      reached (set (for [t [\"BOXP-136\" \"BOXP-137\"]
                         :when (pos? (get-in (ai-ops-sli/aggregate* (filter #(= t (:task_id %)) evs)) [:sli :agent-system-correction-task-ratio :denominator]))] t))]
  (assert (= 2 (count notify)) (pr-str evs))
  (assert (= #{[\"blocked\" \"review\"] [\"review\" \"review\"]} (set (map (juxt :lane_to :result) notify))) (pr-str notify))
  (assert (= #{\"BOXP-137\"} reached) (pr-str reached))
  ;; aggregate* 直接入力: notify.run-finished は lane_to=review のみ Review 到達。result=review でも lane_to=blocked/欠落は数えない
  (doseq [[label lane expected] [[\"lane_to review\" \"review\" 1] [\"lane_to blocked\" \"blocked\" 0] [\"lane_to 欠落\" nil 0]]]
    (let [r2 (ai-ops-sli/aggregate* [{:event_id \"BOXP-138/20261020T000000Z-aaaa:started\" :task_id \"BOXP-138\" :run_id \"20261020T000000Z-aaaa\" :event_type \"run.started\" :occurred_at \"2026-10-20T00:00:00Z\"}
                                      (cond-> {:event_id \"BOXP-138-20261020T000000Z-aaaa-blocked\" :task_id \"BOXP-138\" :run_id \"20261020T000000Z-aaaa\" :event_type \"notify.run-finished\" :result \"review\" :occurred_at \"2026-10-20T01:00:00Z\"} lane (assoc :lane_to lane))])]
      (assert (= expected (get-in r2 [:sli :agent-system-correction-task-ratio :denominator])) (str label \" \" (pr-str (get-in r2 [:sli :agent-system-correction-task-ratio]))))))
  (println \"ok   Blocked に移った run の通知 (to-status=blocked/result=review) を Review 到達に数えず、通知は lane_to=review のみ分母にする\"))"
rm -rf "$tmp_nb"

# Hermes ledger の join: 会話 (hermes-observer、opaque conv- ID) は task として残すが Board の未完了 guardrail・run 数には
# 混ぜず、層は assistant に補完し、会話/turn/承認 event 数を coverage に別掲する。source_stale marker があれば partial/stale。
bb -e "
(require '[clojure.string :as str])
(load-file \"ai_ops_sli.bb\")
(def conv \"conv-29344c58-47e8-dc1a-68fd-feab0fc10335\")
(def board [{:event_id \"BOXP-140/20261020T000000Z-aaaa:started\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"run.started\" :occurred_at \"2026-10-20T00:00:00Z\" :stratum \"infra\"}
            {:event_id \"BOXP-140/20261020T000000Z-aaaa:finished\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"run.finished\" :status \"succeeded\" :result \"review\" :occurred_at \"2026-10-20T01:00:00Z\"}
            {:event_id \"BOXP-140:state\" :task_id \"BOXP-140\" :event_type \"task.state\" :status \"review\" :snapshot \"current\"}])
(def hermes [{:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :event_type \"run.started\" :occurred_at \"2026-10-31T00:00:03Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:started\")}
             {:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :event_type \"run.finished\" :status \"succeeded\" :occurred_at \"2026-10-31T00:00:09Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:finished\")}
             {:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :run_id \"20261031T000103Z-ee2d7527\" :event_type \"run.started\" :occurred_at \"2026-10-31T00:01:03Z\" :event_id (str conv \"/20261031T000103Z-ee2d7527:started\")}
             {:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :event_type \"approval.requested\" :approval_key \"op:0000000a\" :occurred_at \"2026-10-31T00:01:05Z\" :event_id (str conv \"/20261031T000103Z-ee2d7527:req\")}])
(let [b (ai-ops-sli/aggregate* board) j (ai-ops-sli/aggregate* (concat board hermes))
      h (get-in j [:coverage :hermes-conversation])]
  (assert (= \"not-connected\" (get-in b [:coverage :hermes-conversation :status])))
  (assert (= {:status \"connected\" :coverage \"connected\" :conversations 1 :turns-started 2 :turns-finished {\"succeeded\" 1}
              :approvals-requested 1 :approvals-resolved 0 :unverifiable-event-types 0 :stale-snapshot-markers 0} h) (pr-str h))
  ;; 会話は Board の task 集計 (総数・outcome・層別) に入れず、件数を :tasks :conversations に別掲する
  (assert (= 1 (get-in j [:tasks :total])) (pr-str (:tasks j)))
  (assert (= 1 (get-in j [:tasks :conversations])))
  (assert (nil? (get-in j [:tasks :by-stratum \"assistant\"])))
  (assert (nil? (get-in j [:tasks :outcomes \"unobserved\"])))
  ;; 未完了 guardrail・tasks-per-request・run 数・SLI は Board 側と同じ (会話を混ぜない)
  (assert (= (dissoc (:guardrails b) :conversations-unobserved) (dissoc (:guardrails j) :conversations-unobserved)) (pr-str (:guardrails j)))
  (assert (= 1 (get-in j [:guardrails :conversations-unobserved])))
  ;; 救援率の分母 (全 task 数) も会話で変わらない
  (let [rescue {:event_id \"BOXP-140:rescue\" :task_id \"BOXP-140\" :event_type \"owner.rescue\" :occurred_at \"2026-10-20T02:00:00Z\"}
        rb (ai-ops-sli/aggregate* (conj board rescue)) rj (ai-ops-sli/aggregate* (concat board [rescue] hermes))]
    (assert (= {:count 1 :denominator 1 :permille 1000} (get-in rb [:sli :owner-rescue])) (pr-str (get-in rb [:sli :owner-rescue])))
    (assert (= (get-in rb [:sli :owner-rescue]) (get-in rj [:sli :owner-rescue])) (pr-str (get-in rj [:sli :owner-rescue]))))
  (assert (= (get-in b [:sli :run-reliability]) (get-in j [:sli :run-reliability])) (pr-str (get-in j [:sli :run-reliability])))
  (assert (= 1 (get-in j [:sli :run-reliability :runs])))
  (assert (= (get-in b [:sli :agent-system-correction-task-ratio]) (get-in j [:sli :agent-system-correction-task-ratio])))
  (assert (= (get-in b [:sli :first-acceptance-conformance]) (get-in j [:sli :first-acceptance-conformance])))
  ;; Hermes 由来の承認 event は重複承認 SLI の入力に残る (会話を除外しない)
  (assert (= 1 (get-in j [:sli :duplicate-approval :denominator])) (pr-str (get-in j [:sli :duplicate-approval])))
  ;; request.received / task.state 等を持つ ticket なしの依頼は従来どおり task (会話扱いにしない)
  (let [t (ai-ops-sli/aggregate* (concat hermes [{:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :event_type \"request.received\" :occurred_at \"2026-10-31T00:00:00Z\" :event_id (str conv \"/req\")}]))]
    (assert (= 1 (get-in t [:tasks :total])) (pr-str (:tasks t)))
    (assert (= 0 (get-in t [:tasks :conversations])))
    (assert (= 1 (get-in t [:guardrails :unfinished]))))
  ;; ticket 形式の task_id を持つ Hermes event (将来の ticket 付き会話) は会話扱いにしない
  (let [t (ai-ops-sli/aggregate* [(assoc (first hermes) :task_id \"BOXP-141\" :request_id nil :event_id \"BOXP-141/20261031T000003Z-ee2d7526:started\")])]
    (assert (= \"connected\" (get-in t [:coverage :hermes-conversation :status])))
    (assert (= 0 (get-in t [:coverage :hermes-conversation :conversations])))
    (assert (= 1 (get-in t [:sli :run-reliability :runs]))))
  ;; stale marker: 前回 snapshot を使っているので partial/stale (接続済みにしない)。SLI・件数は変えない
  (let [s (ai-ops-sli/aggregate* (concat board hermes [ai-ops-sli/stale-source-marker]))]
    (assert (= \"partial/stale\" (get-in s [:coverage :hermes-conversation :coverage])))
    (assert (= 1 (get-in s [:coverage :hermes-conversation :stale-snapshot-markers])))
    (assert (= 1 (get-in s [:coverage :source-stale :hermes-observer])))
    (assert (= (dissoc (:sli j) :duplicate-approval) (dissoc (:sli s) :duplicate-approval)) \"stale marker changes no SLI but the approval one\")
    ;; 承認 event の source が stale の間は、失敗中に起きた承認 (重複を含む) が入力に無いので重複承認率を確定しない
    (assert (= {:count 0 :denominator 1} (select-keys (get-in j [:sli :duplicate-approval]) [:count :denominator])) (pr-str (get-in j [:sli :duplicate-approval])))
    (let [d (get-in s [:sli :duplicate-approval])]
      (assert (= \"unknown\" (:status d)) (pr-str d))
      (assert (= \"partial/stale\" (:coverage d)))
      (assert (= 1 (:stale-snapshot-markers d)))
      (assert (= {:count 0 :denominator 1} (select-keys (:observed-lower-bound d) [:count :denominator]))))
    ;; 失敗中に重複承認が増えても (次の取り込みで届く)、stale のまま確定値へ戻らない
    (let [dup (assoc (last hermes) :event_id (str conv \"/20261031T000103Z-ee2d7527:req2\") :occurred_at \"2026-10-31T00:01:06Z\")
          fresh (ai-ops-sli/aggregate* (concat board hermes [dup]))
          stale (ai-ops-sli/aggregate* (concat board hermes [dup ai-ops-sli/stale-source-marker]))]
      (assert (= {:count 1 :denominator 2} (select-keys (get-in fresh [:sli :duplicate-approval]) [:count :denominator])) (pr-str (get-in fresh [:sli :duplicate-approval])))
      (assert (= \"unknown\" (get-in stale [:sli :duplicate-approval :status])))
      (assert (= {:count 1 :denominator 2} (select-keys (get-in stale [:sli :duplicate-approval :observed-lower-bound]) [:count :denominator]))))
    (assert (= (:zero-tolerance j) (:zero-tolerance s)) \"stale marker is not a lost event\"))
  (println \"ok   Hermes ledger join: 会話は task 集計から分け件数を別掲、未完了 guardrail/救援率/run 数/SLI は不変、会話/turn/承認数を別掲、stale は partial\"))"

# 回帰: (1) mirror が受け入れる source は hermes-observer。runtime が欠落/redact された有効 event も会話として扱い、
# Board の task/run 集計に混ぜず hermes_conversation を connected にする。(2) 初回取り込み失敗 (snapshot 無し・stale marker
# のみ) では他 source の承認があっても重複承認率を確定せず、hermes_conversation は未配線ではなく取り込み失敗 (history_missing) で別掲する
bb -e "(load-file \"ai_ops_sli.bb\")
(def conv \"conv-29344c58-47e8-dc1a-68fd-feab0fc10335\")
(def board [{:event_id \"BOXP-140/20261020T000000Z-aaaa:started\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"run.started\" :occurred_at \"2026-10-20T00:00:00Z\" :stratum \"infra\"}
            {:event_id \"BOXP-140/20261020T000000Z-aaaa:finished\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"run.finished\" :status \"succeeded\" :result \"review\" :occurred_at \"2026-10-20T01:00:00Z\"}
            {:event_id \"BOXP-140:state\" :task_id \"BOXP-140\" :event_type \"task.state\" :status \"review\" :snapshot \"current\"}])
(def no-runtime [{:source \"hermes-observer\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :event_type \"run.started\" :occurred_at \"2026-10-31T00:00:03Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:started\")}
                 {:source \"hermes-observer\" :runtime \"unknown\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :event_type \"run.finished\" :status \"succeeded\" :occurred_at \"2026-10-31T00:00:09Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:finished\")}])
(let [b (ai-ops-sli/aggregate* board) j (ai-ops-sli/aggregate* (concat board no-runtime)) h (get-in j [:coverage :hermes-conversation])]
  (assert (= \"connected\" (:status h)) (pr-str h))
  (assert (= 1 (:conversations h)) (pr-str h))
  (assert (= 1 (get-in j [:tasks :total])) \"runtime-less hermes-observer event must not become a Board task\")
  (assert (= (:runs b) (:runs j)) \"runtime-less hermes-observer turn must not be counted as a Board run\")
  (assert (= (:sli b) (:sli j)) \"join must not change the SLIs\"))
;; 初回取り込み失敗: Hermes event は無く stale marker だけ。Board 側の承認 2 件 (重複なし) があっても確定しない
(def approvals [{:event_id \"BOXP-140/20261020T000000Z-aaaa:req1\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"approval.requested\" :approval_key \"op:0000000a\" :occurred_at \"2026-10-20T00:10:00Z\"}
                {:event_id \"BOXP-140/20261020T000000Z-aaaa:req2\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"approval.requested\" :approval_key \"op:0000000b\" :occurred_at \"2026-10-20T00:20:00Z\"}])
(let [settled (ai-ops-sli/aggregate* (concat board approvals))
      first-fail (ai-ops-sli/aggregate* (concat board approvals [ai-ops-sli/stale-source-marker]))
      d (get-in first-fail [:sli :duplicate-approval]) h (get-in first-fail [:coverage :hermes-conversation])]
  (assert (= {:count 0 :denominator 2} (select-keys (get-in settled [:sli :duplicate-approval]) [:count :denominator])) (pr-str (get-in settled [:sli :duplicate-approval])))
  (assert (= \"unknown\" (:status d)) (pr-str d))
  (assert (= \"partial/stale\" (:coverage d)))
  (assert (= {:count 0 :denominator 2} (select-keys (:observed-lower-bound d) [:count :denominator])))
  (assert (= [\"history_missing\" \"stale_source_snapshot\"] (ai-ops-sli/unknown-classification d)))
  (assert (= {:status \"not-connected\" :coverage \"missing/stale\" :stale-snapshot-markers 1} h) (pr-str h))
  (assert (= [\"history_missing\" \"stale_source_snapshot\"] (ai-ops-sli/unknown-classification h)) \"never-obtained snapshot is a pull failure, not an unwired source\")
  ;; 承認が 0 件でも未接続ではなく欠落として報告する
  (let [d0 (get-in (ai-ops-sli/aggregate* (concat board [ai-ops-sli/stale-source-marker])) [:sli :duplicate-approval])]
    (assert (= \"unknown\" (:status d0))) (assert (= 1 (:stale-snapshot-markers d0)) (pr-str d0))))
(println \"ok   hermes-observer source だけの event を会話と認識し、初回取り込み失敗 (stale marker のみ) では重複承認率を確定せず取り込み失敗として別掲\")"
# 回帰: event_type が欠落/redact (mirror の gate が enum 外を置換) の event を含む Hermes 会話は、同じ会話に有効な run.started が
# あっても Board task に昇格させない (task 総数・run 数・救援率の分母を変えない)。種別不明 event は会話 coverage に別掲し、
# 全体の unverifiable-event-types として zero-tolerance 指標を unknown にする (黙って捨てない)
bb -e "(load-file \"ai_ops_sli.bb\")
(def conv \"conv-29344c58-47e8-dc1a-68fd-feab0fc10335\")
(def board [{:event_id \"BOXP-140/20261020T000000Z-aaaa:started\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"run.started\" :occurred_at \"2026-10-20T00:00:00Z\" :stratum \"infra\"}
            {:event_id \"BOXP-140/20261020T000000Z-aaaa:finished\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"run.finished\" :status \"succeeded\" :result \"review\" :occurred_at \"2026-10-20T01:00:00Z\"}
            {:event_id \"BOXP-140:state\" :task_id \"BOXP-140\" :event_type \"task.state\" :status \"review\" :snapshot \"current\"}
            {:event_id \"BOXP-140/20261020T000000Z-aaaa:rescue\" :task_id \"BOXP-140\" :run_id \"20261020T000000Z-aaaa\" :event_type \"owner.rescue\" :occurred_at \"2026-10-20T00:30:00Z\"}])
(def mixed [{:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :event_type \"run.started\" :occurred_at \"2026-10-31T00:00:03Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:started\")}
            {:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :event_type \"redacted\" :occurred_at \"2026-10-31T00:00:05Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:rescue\")}
            {:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :occurred_at \"2026-10-31T00:00:06Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:req1\")}
            {:source \"hermes-observer\" :runtime \"hermes\" :task_id conv :request_id conv :run_id \"20261031T000003Z-ee2d7526\" :event_type \"run.finished\" :status \"succeeded\" :occurred_at \"2026-10-31T00:00:09Z\" :event_id (str conv \"/20261031T000003Z-ee2d7526:finished\")}])
(let [b (ai-ops-sli/aggregate* board) j (ai-ops-sli/aggregate* (concat board mixed)) h (get-in j [:coverage :hermes-conversation])]
  (assert (= 1 (get-in j [:tasks :total])) (str \"conversation with unknown-type events must not become a Board task: \" (pr-str (:tasks j))))
  (assert (= (:runs b) (:runs j)) \"its turns must not be counted as Board runs\")
  ;; 救援率: 会話は分母に入らない (観測値の分母は Board だけの集計と同じ)。種別不明 event は救援だった可能性があるので確定はしない
  (let [o (get-in j [:sli :owner-rescue])]
    (assert (= \"unknown\" (:status o)) (pr-str o))
    (assert (= (get-in b [:sli :owner-rescue :denominator]) (get-in o [:observed-lower-bound :denominator])) (pr-str o))
    (assert (= 2 (:lost-events o))))
  (assert (= 1 (:conversations h)) (pr-str h))
  (assert (= 2 (:unverifiable-event-types h)) (pr-str h))
  (assert (= \"connected\" (:status h)))
  ;; 種別不明 event は黙って消えない: 全体の unverifiable-event-types として zero-tolerance 指標を確定しない
  (assert (= 2 (get-in j [:zero-tolerance :duplicate-effects :unverifiable-event-types])) (pr-str (get-in j [:zero-tolerance :duplicate-effects])))
  (assert (= \"unknown\" (get-in j [:zero-tolerance :duplicate-effects :status]))))
(println \"ok   種別不明 event を含む Hermes 会話を Board task に混ぜず、件数を会話 coverage と unverifiable-event-types に別掲\")"
tmp_hj=$(mktemp -d)
cat >"$tmp_hj/j.jsonl" <<'EOF'
{"source":"hermes-observer","runtime":"hermes","task_id":"conv-29344c58-47e8-dc1a-68fd-feab0fc10335","request_id":"conv-29344c58-47e8-dc1a-68fd-feab0fc10335","run_id":"20261031T000003Z-ee2d7526","event_type":"run.started","occurred_at":"2026-10-31T00:00:03Z","event_id":"conv-29344c58-47e8-dc1a-68fd-feab0fc10335/20261031T000003Z-ee2d7526:started"}
{"source":"hermes-observer","runtime":"hermes","task_id":"conv-29344c58-47e8-dc1a-68fd-feab0fc10335","request_id":"conv-29344c58-47e8-dc1a-68fd-feab0fc10335","run_id":"20261031T000003Z-ee2d7526","event_type":"run.finished","status":"succeeded","occurred_at":"2026-10-31T00:00:09Z","event_id":"conv-29344c58-47e8-dc1a-68fd-feab0fc10335/20261031T000003Z-ee2d7526:finished"}
{"source_stale":"hermes-observer"}
EOF
bb ai_ops_sli.bb prom "$tmp_hj/j.jsonl" >"$tmp_hj/j.prom"
grep -q 'ai_ops_sli_source_connected{sli="hermes_conversation"} 0' "$tmp_hj/j.prom"
grep -q 'ai_ops_sli_source_partial{sli="hermes_conversation"} 1' "$tmp_hj/j.prom"
grep -q 'ai_ops_source_stale_snapshot_markers{source="hermes-observer"} 1' "$tmp_hj/j.prom"
grep -q '^ai_ops_hermes_conversations 1$' "$tmp_hj/j.prom"
grep -q 'ai_ops_hermes_conversation_turns{kind="finished_succeeded"} 1' "$tmp_hj/j.prom"
grep -q 'ai_ops_hermes_conversation_events{kind="unverifiable_type"} 0' "$tmp_hj/j.prom"
grep -q 'ai_ops_guardrail_tasks{kind="conversations_unobserved"} 1' "$tmp_hj/j.prom"
grep -q 'ai_ops_runs{status="all"} 0' "$tmp_hj/j.prom"
! grep -q 'conv-29344c58' "$tmp_hj/j.prom"
! grep -q 'sli="hermes_conversation",category' "$tmp_hj/j.prom"
echo "ok   prom: 通常モードの実 Hermes ledger 形式 (stale marker 付き) で partial 表示・会話件数・ID 非含有"
rm -rf "$tmp_hj"
