---
name: codex-workspace-cron
description: Manage Codex workspace scheduled prompt jobs in boxp/lolice. Use when the user asks to list, show, add, edit, enable, disable, delete, or manually run Codex cron jobs backed by argoproj/codex-workspace jobs.yaml and Kubernetes CronJobs.
---

# Codex Workspace Cron

Use this skill to operate the Codex workspace prompt scheduler from inside the Codex workspace.

The scheduler is GitOps-managed in `boxp/lolice`:

- `argoproj/codex-workspace/cron-configmap.yaml`
  - embedded `jobs.yaml` registry
  - `prompt-*.md` prompt bodies
  - runner scripts
- `argoproj/codex-workspace/cronjob.yaml`
  - one Kubernetes CronJob per registered job

## Workflow

1. Work in a `boxp/lolice` worktree, preferably using the `worktree` skill.
2. Use the bundled script for manifest CRUD:

   ```bash
   bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice list
   ```

3. After changes, run:

   ```bash
   kustomize build argoproj/codex-workspace
   git diff --check
   ```

4. Commit and update the `boxp/lolice` PR.

## Commands

List jobs:

```bash
bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice list
```

Show one job:

```bash
bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice show <job-id>
```

Add a job:

```bash
bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice add \
  --id daily-report \
  --name "Daily report" \
  --schedule "0 22 * * *" \
  --prompt-file prompt-daily-report.md \
  --prompt "調査して日本語で報告してください。" \
  --enabled false
```

Update metadata or prompt:

```bash
bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice update daily-report \
  --schedule "30 22 * * *" \
  --prompt "新しいプロンプト"
```

Enable or disable:

```bash
bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice enable daily-report
bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice disable daily-report
```

Delete:

```bash
bb <this-skill>/scripts/codex_cron_jobs.bb --repo /path/to/lolice delete daily-report
```

## Safety

- New jobs should default to disabled unless the user explicitly asks to enable them.
- Keep `jobs.yaml enabled` and CronJob `spec.suspend` consistent.
- Do not run `kubectl` mutations unless the user explicitly asks for live cluster operations.
- For manual live runs, prefer documenting the command from `argoproj/codex-workspace/cron.md`.
