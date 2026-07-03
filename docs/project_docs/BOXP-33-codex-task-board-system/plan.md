# BOXP-33: Codex Task Board system

## Goal

Obsidian Task Board の `assignee: codex` チケットを codex-workspace runner が検出し、Task Board レーンを source of truth として要件整理、実装、レビュー待ち、停止、完了まで進める。

## Plan

1. Task Board runner の仕様を `docs/project_docs/BOXP-33-codex-task-board-system/spec.md` に集約する。
2. runner の巨大化した振る舞いを black-box テストで固定する。
3. temporary vault と fake `codex` を使い、実ファイルの Task Board / ticket / lock / run summary を検証する。
4. 並列起動、active lock skip、stale lock recovery、review PR marker gate、lane/source-of-truth sync をテスト対象にする。
5. CI へ載せやすいよう、テストは単独の Babashka script として `bb tests/task_board_runner_test.bb` で実行できる形にする。

## Validation

- `bb tests/task_board_runner_test.bb`
- `bash -n docker/codex-workspace/entrypoint.sh`
- `git diff --check`
