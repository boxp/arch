# ai_ops_sli.bb (BOXP-360 pilot)

```sh
# 既存 Task Board metadata -> 共通 event (summary.edn / delegation.json kind / outbox / ticket frontmatter のみ読む)
bb ai_ops_sli.bb extract ~/.codex-task-board "$CODEX_TASK_BOARD_VAULT" > /tmp/events.jsonl
bb ai_ops_sli.bb aggregate /tmp/events.jsonl   # SLI/guardrail/coverage (EDN)
bb ai_ops_sli.bb prom /tmp/events.jsonl        # 低 cardinality Prometheus exposition
# 生成元 bounded buffer + privacy gate + collector 停止 (index 10..20) の模擬
bb ai_ops_sli.bb emit-sim --synthetic fixtures/synthetic-events.jsonl 4 10 20 > /tmp/collected.jsonl
./test.sh                                      # 合成 E2E と回帰 check
```

pilot 用であり runner / Hermes には未接続。extract と emit-sim は allowlist key のみ出力し、不正な値を redact し、不正な event_id の event は拒否する。stderr の privacy-redacted-values / privacy-rejected で件数を確認できる。aggregate は入力を再検証し、追加の拒否件数を coverage.privacy-rejected-invalid-id に記録する。coverage.connected の ID は `cov-<source>-<8桁の16進数>` の形式を使い、宣言ごとに一意にする。短い識別子以外の文字列は保持しない。

zero-tolerance は対応する effect.applied / severity 付き event または coverage.connected event（coverage_target に duplicate-effects / critical-safety-events）を観測した場合にのみ件数を報告し、それ以外は unknown。Prom 出力は zero-tolerance メトリクスを公開しない。first acceptance は最初の受入以前（同時刻を含む）の全是正を対象とし、時刻不明は不合格として扱う。

privacy gate は key ごとの許可値・ID・時刻・型を検証し、認証情報や長い英数字列も redact する。未実行の request も task 総数、outcome、未完了と Owner rescue の分母に含め、never-run を別掲する。review 到達を対象とする SLI の分母は変えない。

受入履歴の網羅性は `coverage.connected` の `acceptance-history` がなければ reopen-after-accept を unknown とする。closed が残る未完了 ticket は受入と再オープンの証拠として抽出する。duplicate-effects は effect 観測時または coverage 接続時に全 task の effect_key を横断して余分な適用数と関与 task 数を数え、宣言がない場合は coverage を partial/undeclared とし、承認も approval_key ごとに横断集計し、重複承認率は有効な approval_key 付き承認イベントの余分な件数を全承認イベント数で割る。

run 履歴の無い受入済み ticket（accepted-without-run-history）は是正有無を観測できないため、first acceptance / 是正率の分母に入れず別掲する（合格扱いしない）。reopen-after-accept は受入履歴 source 接続時のみ、現在の状態にかかわらず受入イベントがある全 task を分母に計上する。

合成データの短い ID を許可するには、`emit-sim`、`aggregate`、`prom` のコマンド直後に `--synthetic` を指定する。入力の `synthetic` フィールドだけでは ID 制約は緩和されず、`extract` は常に厳格に検証する。
受入後の最新イベントが `task.reopened` の場合は未完了（in-flight）とし、同時刻の受入より再オープンを優先する。

通常モードの `event_id` / `parent_event_id` / `evidence_event_ids` は ticket 形式、`cov-<source>-<8桁の16進数>`、または `req-` / `conv-` に英小文字・数字・ハイフン8〜64文字を続けた形式を使う。会話 ID には任意で `/` と英数字・`:`, `_`, `-` の接尾辞を付けられる。最大128文字で、token パターンは禁止する。

状態は時刻付き遷移を時刻順に評価し、時刻なし snapshot は時刻付き状態 event が存在しない場合に限り使用する。時刻不明の是正は受入前か判別できないため first acceptance を不合格とする。是正 origin が省略された場合は plan の class 分類から補い、明示された origin を優先する。`approval.resolved` は保持するが重複承認の分母には含めない。
