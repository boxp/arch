# BOXP-428 Task Board exporter の本文可視化・最小是正（Fable 引継ぎ、2026-11-07）

lolice#1104（Hermes observer）と同じ観測契約を `docker/codex-workspace/task-board/langfuse_exporter.bb` に適用する。正本は `LANGFUSE_EXPORTER_THREAT_MODEL.md`（Guaranteed / Not guaranteed の 2 節）。

## 方針
1. `private-tool?` の tool 名条件（Task/Agent/TodoWrite/WebSearch 以外は私的）を外し、全 tool の入出力を既存 `sanitize-span` のマスク経由で送る。`tool_body_policy` の省略表示と `hide-view?` を撤去。
2. 以後保留（`first-hit`）は K0（`withhold-output?`/`env-dump?`）と tool 結果への K1 実ヒット（`exposure?`: 既知形式・XML 要素・環境変数の実値。エントロピーと秘密語だけの行は除く）だけ。1 MiB 超の tool 結果は走査せず fail-closed。
3. 値 pin / 変換列挙は取り込まない（arch#14503 の方式は採らない）。K0 表は Hermes と同じ 9 系統を足して閉じる。
4. 各観測に `body_policy`、trace に `coverage.tool_bodies` と `coverage.withheld_reason`。系譜（Agent 子）への伝播は証拠の時刻以後の span だけ。
5. spool には sanitize と最終ガードを通した span だけ（既存どおり、試験で確認）。

## 試験
- 子 Codex（gpt-6.1-terra、1 回委譲）が実装、親（Fable）が diff を読み再実行で検証。
- Red: 新テストを origin/main の実装に当て 47 tests / 1116 assertions / 125 failures。Green: 同 0 failures（親の再実行で一致）。
- 追加: `settled-observation-contract`（Claude/Codex の Bash/Read/shell 後の tool 出力・応答が読め、`withheld_` が無く、最後の generation が `sent`）、`observation-evidence-and-limits`（K1 ヒット→`masked_known_format`+以後 `withheld_after_known_format_in_tool_output`、秘密語だけは `sent`、1 MiB 超→`withheld_unscanned_output`）、`direct-source-policy`（K0 表の各項目が `withheld_known_source`、陰性対照は sent）。既存の合成秘密が span/spool に届かない assert は維持。

## 後続
- merge → image 更新（codex-workspace 再起動、承認済み）→ lolice `tests/chainsaw/codex-workspace/task-board-langfuse` の exporter 固定を新 revision へ更新し陽性対照を追加 → 実 run の trace を Langfuse UI/MCP で陽性・陰性確認 → 入口更新。
