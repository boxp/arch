# BOXP-42: Task Board runner PR review gates

## Goal

Ensure repository-changing Task Board runs only move to `Review` after the created PR is ready for human review.

## Plan

1. Preserve the existing `TASK_BOARD_REVIEW_PR: none` path for review transitions with no repository changes.
2. For review transitions with a GitHub PR URL, query GitHub mergeability before moving the ticket.
3. Wait for associated PR checks to finish and require successful, skipped, or neutral conclusions.
4. Run a Codex review pass against the PR diff and require an explicit clean result.
5. Block the ticket, update Notes, and record the failed gate in the run summary when any gate fails.
6. Extend the runner black-box tests with conflict, CI failure, Codex review issue, all gates passing, and no-repo review cases.

## Validation

- `tests/codex-workspace/task-board-runner-test.sh`
- `git diff --check`
