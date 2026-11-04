# BOXP-408: Task Board 動的 TODO の受領と完了判定

正本設計: Obsidian `Projects/task-board-dynamic-todos/design.md`

## 目的
Plan の `TD-NN【必須|任意|取消】` 行を要件の正本とし、実行中の追加・変更を worker へ届け、未受領・未完了の必須項目が残る旧版結果を Done/本人待ちへ適用しない。

## 実装
1. `docker/codex-workspace/task-board/task_board_todos.bb` を追加する（parser、実質版、CLI、hook、gate 判定）。Hermes skill へ同一内容を同梱する。
2. runner: 開始 snapshot、prompt、run ごとの hook 設定、lifecycle commit 内の終了 gate、Done・Blocked 直後の再照合、`todo_state`/`summary.edn` の記録。
3. helper: `update --plan` の既存 TD 破壊を拒否する。
4. 回帰テストと CI 登録、SKILL.md の更新。

## 安全境界
新権限・課金なし。強制 kill なし。一括移行なし。Novel Board、localllm、PR gate、lane は不変。image の配備は codex-workspace/Hermes の再起動を伴うため、merge 前に対象・回数・影響・復帰を Owner に確認する。

## 完了作業での補足
- runner のチケット書き込みにも helper と共通の per-ticket lock を追加し、`todo_state` は同じロック内で再読して更新する。`board_rev` は変更しない。
- per-ticket lock は vault 内の `.task-board-locks/` に置き、同じ volume のコンテナ間でも排他する。従来の `/tmp` の lock も併せて取り、未更新の helper とも排他する。lock の届かない書き手（`ob sync` など）には、`mv --exchange` で原子交換し、押し出された内容を比較する compare-and-swap で上書きを防ぐ。不一致なら戻して読み直す。
- Done・Blocked 直後の再照合も継続予算を消費し、保留時の最終ステータスと run summary を後続の記録へ伝播する。
- hook の trust bypass は既存の無人承認バイパス時のみ使用する。hook 無効化時も終了 gate は維持する。
- Claude の `--settings` にはチケット ID をコマンド引数へ出さない一時リンクを使用し、その参照先を run-dir の `todo-hooks.json` とする。
- 短時間で終了する agent を 1 秒の polling 待ちで遅延させないよう、プロセス終了で即時復帰する待機に変更する。idle の監視間隔は 1 秒のままとする。
