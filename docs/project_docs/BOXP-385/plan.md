# BOXP-385 独立 metadata-only pilot 計画

1. 指定文書と停止条件を確認し、checkout と稼働 runtime の差を確認する。BOXP-360 の未解決実装には触れない。
2. 既存出力を read-only で調べ、既知の metadata key の存在と意味、欠測・重複・取得不能を棚卸しする。本文や任意の識別子は出力しない。
3. 実際に意味を確認できた source のみを対象に、内容非依存 allowlist と欠測・累積・重複を明示する独立集計を実装する。実データの集計と合成 fixture を区別する。
4. 安全境界と集計のテストを実行し、再現コマンド、実測値、制約を記録する。追加モデル呼出し・外部送信・権限変更は行わない。

親による統合: Langfuse公式調査はvault正本へ保存。公開合成2課題×2route×重複除去前後の実evalを8call/同時1/retry0で完了し、数値証跡を追加した。調査子は追加model呼出しなし、親のevalとは別である。変更をP0/P1基準で一度reviewし、通常PRへ提出する。runnerのgateを通る前にmerge/安全反映の完了を主張しない。

## claude-fable 引継ぎ（2026-11-03 07:16 UTC run）

5. 旧 PR #14391 の commit を cherry-pick で再利用し、run 単位の親子 join adapter を子 Codex（terra）へ 1 回委譲、親が検証・修正する。review gate の usage 未記録を全 run の unknown 理由として明示する。
6. Hermes の local/cloud 区別と cron usage を既存 SQLite / usage_audit から固定 key で取得する。
7. Langfuse 公式（self-host / license / retention / masking / usage / OTel / eval / prompt）を再読し、既存基盤との差を Owner が選べる案として vault 正本へ書く。SLO 暫定案は既存 SLI の実測値を根拠に、分母・coverage・判定・対応を詰める。
8. 通常 PR を作成し、旧 PR は superseded として閉じる。merge と本番反映は runner gate と Owner review の後。

- 2026-11-03: Owner 承認案 A として review gate の usage 記録と run 単位の集計を追加する。

## claude-fable 継続（2026-11-03 07:43 UTC run、計画停止で中断後 08:02 UTC run で再開）

9. Owner 案 A（既存基盤の欠測解消を優先、Langfuse 導入見送り）を受け、PR #14402 を通常 merge する。
10. review gate の usage 未記録を producer 側で埋める: runner の `run-codex-review!` に `--json` を付け、`thread.started.thread_id` と `turn.completed.usage` の整数値のみを `codex-review-<owner>__<repo>-<n>-usage.jsonl` へ allowlist 記録する。欠落時は `usage_status: unrecorded` を残し、gate 判定には影響させない。実装は子 Codex（terra）へ 1 回委譲し、親が検証する。中断で残った未 commit 差分は新 worktree へ移送して継続する。
11. `run_join.py` は記録済み review gate usage を親子合計へ加算し、gate が確実に実行された run（`checked-pr-urls` あり、または失敗 gate が `codex-review`）で記録がない場合だけ `review_gate_usage_unrecorded` を付ける。merge 後の稼働版再集計を `run-join-2026-11-03b.json` に残す。
12. 全 runner test suite を子 Codex へ 1 回委譲して実行し、親が unit / 対象 bb test を直接確認する。本 PR 自身の review gate は旧稼働版 runner で走るため、usage 記録の実 readback は merge と workspace 反映後の次 run で行う。

## claude-fable retry 1/2（2026-11-03 08:30 UTC run、PR #14411 codex review P1 対応）

13. P1 指摘（複数 PR を review した run で一部 usage ファイルの書き込みが失敗しても、別の記録が1件あれば欠測と判定されず合計が完全な値に見える）を修正する。runner は review した PR ごとに codex を1回呼ぶので、`summary.edn` の `checked-pr-urls` 件数に失敗 gate が `codex-review` なら1を足した `review_gate_expected_calls` を期待呼出し数とし、usage 行数がそれに満たない場合も `review_gate_usage_unrecorded` を付ける。URL は件数だけ使い、レポートへ出さない。unit に複数 PR の部分記録ケースを追加し、集計を `run-join-2026-11-03c.json` に残す（既存 run は review 記録 0 のため件数差は新規 run 分のみ）。

## claude-opus SLO 収束（2026-11-03 18:41 UTC run）

- PR lolice#1001 を通常 merge し、Fable パネルの実 query を照合する。再復元はしない。
- 既存 metadata だけで SLO 案の現在値を出す `scripts/ai-observability/slo_snapshot.bb` を追加し、合成ケースで救援の定義を固定する。runner・image・Hermes は変更しない。
- Owner 向けの入口は vault の `slo-owner-decision.md`。定義と再現手順は `slo-contract.md`。新しい記録項目・alert・cron は Owner 判断の後。
- P1 指摘 2 件を修正する。summary が読めない run があっても同じ task の読める停止を残し、ticket が読めない停止を接触なしに数えない。欠けた入力は `coverage` などの件数で出す。
