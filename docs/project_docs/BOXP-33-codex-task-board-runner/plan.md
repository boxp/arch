# BOXP-33: Codex Task Board runner

## Goal

Add a codex-workspace Task Board runner that detects Obsidian tickets assigned to Codex and runs Codex work according to the Task Board lane.

## Plan

1. Add `/opt/codex-workspace/task-board/task_board_runner.bb`.
2. Treat the Task Board lane as the source of truth and sync ticket frontmatter `status` plus card `status::` to the lane.
3. Use `assignee: codex` as the explicit trigger.
4. Handle `backlog` as requirements grooming only, then move the card to `Ready`.
5. Handle `ready`, `review`, and `blocked` reassignment as resume signals and move the card to `In Progress`.
6. Run Codex as a short-lived ticket run and persist locks, run logs, prompts, and summaries under `/home/boxp/.codex-task-board`.
7. Mark stale runs as `interrupted` after heartbeat timeout and recover based on the current Task Board lane.

## Validation

- `bb docker/codex-workspace/task-board/task_board_runner.bb sync` against a temporary vault.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with no Codex-assigned ticket.
- `bash -n docker/codex-workspace/entrypoint.sh`.
- `git diff --check`.
