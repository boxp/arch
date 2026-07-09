# BOXP-76: Task Board fable assignee routing

## Goal

Task Board runner が `assignee: fable` のチケットを自動実行対象として検出し、既存の `codex` run と同じ run log / Notes / result marker / lane 遷移を使えるようにする。

## Implementation Plan

1. `codex` と `fable` を許可 assignee として明示する小さな routing layer を追加する。
2. `fable` run は Claude Code の fable 側へ渡す prompt を生成し、重い調査・実装・検証は必要に応じて Codex へ委譲する方針を prompt に含める。
3. 実行後の `events.jsonl`、`stderr.log`、`last-message.md`、`summary.edn`、Notes、result marker 判定、PR gate は既存 runner の形式を再利用する。
4. PR gate retry で in-progress に戻す場合は、次回も元の assignee が維持されるよう run metadata から agent を追跡する。
5. 既存の `assignee: codex`、Backlog grooming、Ready/In Progress/Review/Blocked 処理、PR URL gate、対象外 assignee の無視をテストで確認する。

## Validation

- `tests/codex-workspace/task-board-runner-test.sh`
- 追加テスト:
  - `assignee: fable` が検出され、fable prompt と委譲方針が保存されること。
  - fable run の result marker と log 形式が既存と同じ場所に残ること。
  - PR gate retry 時に `assignee: fable` が維持されること。
  - `codex` / `fable` 以外の assignee が自動実行されないこと。
