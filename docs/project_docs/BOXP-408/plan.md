# BOXP-408: Task Board 動的 TODO の受領と完了判定

正本設計: Obsidian `Projects/task-board-dynamic-todos/design.md`

## 目的
Plan の `TD-NN【必須|任意|取消】` 行を要件の正本とし、実行中の追加・変更を worker へ届け、未受領・未完了の必須項目が残る旧版結果を Done/本人待ちへ適用しない。

## 実装
1. `docker/codex-workspace/task-board/task_board_todos.bb` を追加する（parser、実質版、CLI、hook、gate 判定）。Hermes skill へ同一内容を同梱する。
2. runner: 開始 snapshot、prompt、run ごとの hook 設定、lifecycle commit 内の終了 gate、Done 直後の再照合、`todo_state`/`summary.edn` の記録。
3. helper: `update --plan` の既存 TD 破壊を拒否する。
4. 回帰テストと CI 登録、SKILL.md の更新。

## 安全境界
新権限・課金なし。強制 kill なし。一括移行なし。Novel Board、localllm、PR gate、lane は不変。image の配備は codex-workspace/Hermes の再起動を伴うため、merge 前に対象・回数・影響・復帰を Owner に確認する。
