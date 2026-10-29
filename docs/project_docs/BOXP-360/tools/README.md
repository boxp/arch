# ai_ops_sli.bb (BOXP-360 pilot)

```sh
# 既存 Task Board metadata -> 共通 event (summary.edn / delegation.json kind / outbox / ticket frontmatter のみ読む)
bb ai_ops_sli.bb extract ~/.codex-task-board "$CODEX_TASK_BOARD_VAULT" > /tmp/events.jsonl
bb ai_ops_sli.bb aggregate /tmp/events.jsonl   # SLI/guardrail/coverage (EDN)
bb ai_ops_sli.bb prom /tmp/events.jsonl        # 低 cardinality Prometheus exposition
# 生成元 bounded buffer + privacy gate + collector 停止 (index 10..20) の模擬
bb ai_ops_sli.bb emit-sim fixtures/synthetic-events.jsonl 4 10 20 > /tmp/collected.jsonl
./test.sh                                      # 合成 E2E 20 check
```

pilot 用であり runner / Hermes には未接続。出力 event は allowlist key のみ。
