# Task Board Runner Fable Stall Fix Plan

## Goal

Prevent Fable-assigned Task Board tickets from remaining in progress indefinitely
when the agent stops making progress, without imposing a maximum duration on valid
long-running work.

## Approach

1. Monitor the Fable/Codex process while it is running.
2. Treat changes to the agent output or ticket file as progress.
3. Stop only an agent that has produced no progress for the configured idle period
   (`CODEX_TASK_BOARD_AGENT_IDLE_TIMEOUT_SECONDS`, default: 7200 seconds).
4. Keep the ticket in progress after an idle stop so the next poll retries it.
5. Preserve explicit `TASK_BOARD_RESULT: blocked` handling for genuine blockers.

## Verification

- Add a regression test for an idle Fable process being retried.
- Add a regression test that periodic ticket progress prevents an idle timeout.
- Run the complete Task Board runner test suite with the CI Babashka version.
- Run Codex review and merge only after its findings are resolved and PR CI passes.
