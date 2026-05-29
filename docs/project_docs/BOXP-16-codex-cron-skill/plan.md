# BOXP-16: Codex workspace cron skill and scheduler

## Context

`boxp/lolice` now runs Codex workspace cron through a resident sidecar scheduler. Operators need the Codex workspace image to provide that scheduler, its runner, and a skill helper that edits the live home registry instead of GitOps CronJob manifests.

## Design

- Bundle `/opt/codex-workspace/cron/scheduler.bb`.
- Bundle `/opt/codex-workspace/cron/run-codex-cron.sh`.
- Keep scheduler state under `/home/boxp/.codex-cron/jobs-state.edn`.
- Keep jobs and prompts under `/home/boxp/.codex-cron/jobs.edn` and `/home/boxp/.codex-cron/prompts`.
- Bundle a `codex-workspace-cron` skill into `/home/boxp/.codex/skills` at container startup.
- Include a Babashka helper for `list`, `show`, `add`, `update`, `enable`, `disable`, `delete`, and `run`.
- Keep scripting in Babashka and shell, not Python/Ruby.

## Validation

- `bash -n docker/codex-workspace/entrypoint.sh`
- `bash -n docker/codex-workspace/cron/run-codex-cron.sh`
- `bb docker/codex-workspace/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb --root <tmp> list`
- Smoke-test helper CRUD against a temporary home registry.
- `git diff --check`
