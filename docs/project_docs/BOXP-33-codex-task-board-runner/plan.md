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
8. Process all currently eligible Codex-assigned tickets in one tick, re-reading the Task Board after each run so multiple assignments do not leave later tickets idle until another poll.
9. Skip missing ticket files and locked tickets without aborting the whole tick, preserving Task Board lane as the source of truth.
10. Require Codex to include a GitHub PR URL before moving repository-changing work to `Review`; allow `TASK_BOARD_REVIEW_PR: none` only when no repository changes were made.

## Validation

- `bb docker/codex-workspace/task-board/task_board_runner.bb sync` against a temporary vault.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with no Codex-assigned ticket.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with multiple Codex-assigned tickets and a fake `codex` executable.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault where one Codex run returns `review` without a PR marker.
- `bash -n docker/codex-workspace/entrypoint.sh`.
- `git diff --check`.
