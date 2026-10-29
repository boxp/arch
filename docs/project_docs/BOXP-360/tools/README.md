# ai_ops_sli.bb (BOXP-360 pilot)

```sh
# 既存 Task Board metadata -> 共通 event (summary.edn / delegation.json kind / outbox / ticket frontmatter のみ読む)
bb ai_ops_sli.bb extract ~/.codex-task-board "$CODEX_TASK_BOARD_VAULT" > /tmp/events.jsonl
bb ai_ops_sli.bb aggregate /tmp/events.jsonl   # SLI/guardrail/coverage (EDN)
bb ai_ops_sli.bb prom /tmp/events.jsonl        # 低 cardinality Prometheus exposition
# 生成元 bounded buffer + privacy gate + collector 停止 (index 10..20) の模擬
bb ai_ops_sli.bb emit-sim fixtures/synthetic-events.jsonl 4 10 20 > /tmp/collected.jsonl
./test.sh                                      # 合成 E2E と回帰 check
```

pilot 用であり runner / Hermes には未接続。extract と emit-sim は allowlist key のみ出力し、不正な値を redact する。stderr の privacy-redacted-values で件数を確認できる。短い識別子以外の文字列は保持しない。

zero-tolerance は対応する effect.applied / severity 付き event または coverage.connected event（coverage_target に duplicate-effects / critical-safety-events）を観測した場合にのみ件数を報告し、それ以外は unknown。Prom 出力は zero-tolerance メトリクスを公開しない。first acceptance は最初の受入より前の全是正を対象とし、時刻不明は不合格として扱う。
