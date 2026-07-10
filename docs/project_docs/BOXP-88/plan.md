# BOXP-88: Task Board runner の Codex reasoning level 指定

## Goal

Task Board の `assignee` に既存の Codex アサイン名と reasoning level を組み合わせて指定できるようにし、既存のアサインと環境変数によるモデル・profile 指定の挙動を維持する。

## Plan

1. Codex アサインをベース名と任意の reasoning suffix に解析する共通処理を追加し、supported assignee 判定とモデル解決に使用する。
2. suffix 指定時だけ `-c model_reasoning_effort=<level>` を Codex CLI 引数に追加し、元のアサイン文字列は run の記録・再試行に保持する。
3. runner 内蔵テストと fake Codex を使うシェルテストで、全 level、既存名、無効値、起動引数を検証する。
4. Task Board 操作スキルにアサイン文法と `fable` の対象外を記載する。
5. 関連テスト、構文チェック、差分チェックを実行し、コミット・push・draft PR を作成する。

## Validation

- `bb docker/codex-workspace/task-board/task_board_runner.bb test`
- `tests/codex-workspace/task-board-runner-test.sh`
- `git diff --check`
