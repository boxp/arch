# BOXP-287: 実ひとはこさんバース原典を localllm が参照して新キャラ・魔物を作る目的未達を是正

- チケット: vault `Tickets/BOXP-287`（Owner 是正: 「結局ひとはこさんバースの設定を読み込んで作るっていう目的に沿ってなくないですか？」）
- 前提の区別: BOXP-282 の **基盤機能（vault 全域 read root、`docs-mode: create`、合成 fixture 18/18、配備後 E2E BOXP-285/286）は完了**。しかし 285/286 の出典は合成設定 `Projects/task-board-localllm-docs/refs/setting` のみで、**実ひとはこさんバース用途は未達**。本票は実利用確認と必要最小のハーネス改善。合成試作品（haku / echo）の採否は前提にしない。
- 非公開の正本: vault `Projects/task-board-localllm-docs/README.md`（実バース入口の節）、`evidence/e2e-BOXP-287/`。本 plan と PR には原典・提案本文・要約・見出しを載せない（path と件数のみ）。

## 方針（既存 runner での実利用を先行）

| 項目 | 事実 / 判断 |
| --- | --- |
| 配備 | Pod `codex-workspace-bd777f7fc-mwzpf` の `localllm_docs.bb` / `task_board_runner.bb` sha256 が arch `origin/main` と一致。loop runner 稼働中 |
| 原典の所在 | vault `ひとはこさんバース/{キャラ設定,世界観設定,アイテム設定}`。`.md` 28 件 / 約 143 KB（runner 読込後 54,455 字、除外 0、秘匿行 0、flat index 3,605 字）。LLM を呼ばず `load-corpus` で確認（本文は未読） |
| 実バースへの絞り込み | 票ごとに `docs-sources: ひとはこさんバース` を宣言（全域 read root は維持したまま探索対象を原典に限定）。これで `refs/setting` / `pilot` / `proposals` / `evidence` / 小説草案は corpus に入らない |
| 実票 | `BOXP-288`（新キャラ、`docs-kind: character`）、`BOXP-289`（新怪獣 = 魔物、`docs-kind: monster`）。Summary に全年齢・原典不変・必読ノート（世界観設定/超能力者協会、星花学園高等部、黒繭機関、キャラ設定/ひとはこ ほか / 怪獣は 世界観設定/怪獣と魔力吸収 と既存怪獣 2 件）・原典に無い要素は新規案と明示、を記載 |
| 読取の確認 | 「search 該当」や「全域を検索した」では合格にせず、audit の `:research :read-paths` と `:sources` を path だけで検証する `localllm_source_check.bb`（本 PR）を追加。許可 prefix 内 / 禁止 prefix（合成 fixture・pilot・proposals・evidence）不使用 / 必読ノートが read 済み / 出典が read 済み / status review を判定し、`:summary` や evidence 本文は一切出力しない |
| 不合格時 | 必読ノート未読や合成混入があれば PASS にせず、Review の Notes に非露骨な具体指示（必読ノートの読取）を書いて同一ノートの改稿を実行。それでも届かなければ runner 側の優先資料パケット（`docs-required-sources` の先読み）を次の限定改善として提示 |

## 変更（boxp/arch）

- `docker/codex-workspace/task-board/localllm_source_check.bb`: audit メタデータだけの読取確認 CLI（exit 0 PASS / 1 FAIL / 2 usage）。
- `tests/codex-workspace/localllm-source-check-test.sh`: 合成 audit 5 ケース（PASS、合成 fixture 混入、search 該当のみで未読、許可外出典 + 非 review、JSON / usage）。
- `.github/workflows/test-codex-task-board-runner.yml`: 上記テストを追加。
- runner 本体（`localllm_docs.bb` / `task_board_runner.bb`）は変更なし → 再配備不要。

## 結果（2026-10-24 08:30〜08:50 UTC、配備済み loop runner の通常 tick）

| 票 | 種別 | 結果 | 読んだ資料 | 必読 | 出典 | 合成 fixture / pilot / proposals / evidence の read | 原典の変更 | llm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BOXP-288 | character | Review（`proposals/characters/` に新規 1 件） | 20 件、すべて `ひとはこさんバース/` 配下 | 5/5 read 済み | 3 件（read 済み） | 0 | 0 | 579 s / prompt 88,551 tok / 7 round（read 20）/ budget-exhausted |
| BOXP-289 | monster | Review（`proposals/monsters/` に新規 1 件） | 17 件、すべて `ひとはこさんバース/` 配下 | 6/6 read 済み（怪獣規則 + 既存怪獣 2 + 組織 3） | 1 件（read 済み） | 0 | 0 | 555 s / prompt 81,086 tok / 8 round（read 26）/ rounds-exhausted |

- `localllm_source_check.bb` は両 run とも `RESULT: PASS`（出力は path / 件数のみ。evidence は vault `Projects/task-board-localllm-docs/evidence/e2e-BOXP-287/`）。
- corpus は `docs-sources: ひとはこさんバース` の 28 ノート / 54,455 字のみ（除外 0、秘匿行 0）。合成設定・小説草案・自作 proposals は corpus に入らない。
- 票は Ready → In Progress → Review（assignee boxp）へ runner が遷移。cloud 側からの手動実行・rollback なし。
- runner コードは無変更のため再配備不要。本 PR は検証 CLI・テスト・CI 配線・本 plan のみ。
- 未確認（cloud 担当では判断しない）: 提案本文の意味品質。Owner が Obsidian で 2 件を確認する。限界: 出典 path が少数ノートに集中（289 は 1 件）。次の限定改善候補は `docs-required-sources`（必読ノートの先読み）。
