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
8. Start every currently eligible Codex-assigned ticket in parallel within one tick, with an independent ticket lock, run directory, prompt, and Codex process per ticket.
9. Serialize Task Board writes inside the runner and re-read the board for each card move so parallel ticket runs do not overwrite unrelated lane changes.
10. Close stale ticket locks at tick startup, mark the previous run `interrupted`, and then decide whether to restart or stop from the current Task Board lane and assignee.
11. Skip missing ticket files and active locked tickets without aborting the whole tick, preserving Task Board lane as the source of truth.
12. Require Codex to include a GitHub PR URL before moving repository-changing work to `Review`; allow `TASK_BOARD_REVIEW_PR: none` only when no repository changes were made.
13. Document the system under the Obsidian vault `Projects/codex-task-board-runner/` directory.
14. Add black-box tests for the runner behavior that had regressed or was ambiguous: parallel starts, stale lock recovery, and review PR gating.
15. Add a GitHub Actions workflow that runs the runner tests when the runner, tests, or workflow change.

## Validation

- `bb docker/codex-workspace/task-board/task_board_runner.bb sync` against a temporary vault.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with no Codex-assigned ticket.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with multiple Codex-assigned tickets and a fake `codex` executable, confirming overlapping starts in the fake Codex log.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with an active ticket lock, confirming only that ticket is skipped while other candidates start.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with a stale lock, confirming the old run is marked `interrupted` and the ticket can restart in the same tick.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with a corrupt lock file, confirming the lock is cleared and the candidate can start.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault with comma-separated and space-separated multi-repo frontmatter, confirming per-run git worktrees are prepared.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` with `CODEX_TASK_BOARD_BYPASS_APPROVALS=false`, confirming the vault and worktree gitdirs are passed through `--add-dir`.
- `bb docker/codex-workspace/task-board/task_board_runner.bb tick` against a temporary vault where one Codex run returns `review` without a PR marker.
- `tests/codex-workspace/task-board-runner-test.sh`, which covers parallel fake Codex starts, stale lock recovery, and blocking review without a PR marker.
- `bash -n docker/codex-workspace/entrypoint.sh`.
- `git diff --check`.
