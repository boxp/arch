# Codex Cron Runner Switch Plan

## Goal

Allow each Codex workspace cron job to choose the CLI runner and model independently, so jobs can run with either `codex` or `cursor-agent`.

## Implementation

- Add optional `:runner` job metadata, defaulting to `codex` for existing jobs.
- Emit `CODEX_CRON_RUNNER` from job selection.
- Teach `run-codex-cron.sh` to dispatch:
  - `codex`: current `codex exec --json` behavior, preserving `events.jsonl` and `last-message.md`.
  - `cursor`: `cursor-agent --print --output-format text --trust --workspace ...`, writing `stdout.log` and copying it to `last-message.md`.
- Keep `:model` runner-neutral and pass it as `--model` to either CLI.
- Update the bundled `codex-workspace-cron` helper and skill docs with `--runner`.

## Validation

- `bash -n docker/codex-workspace/cron/run-codex-cron.sh`
- `bb docker/codex-workspace/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb --root <tmp> add ... --runner cursor --model claude-opus-4-8-high`
- `bb docker/codex-workspace/cron/select-codex-cron-job.bb <job-id>` with `CODEX_CRON_ROOT=<tmp>`
