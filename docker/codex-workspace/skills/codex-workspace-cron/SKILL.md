---
name: codex-workspace-cron
description: Manage Codex workspace scheduled prompt jobs stored in the Obsidian vault. Use when the user asks to list, show, add, edit, enable, disable, delete, or manually run Codex cron jobs.
---

# Codex Workspace Cron

Use this skill to operate the Codex workspace prompt scheduler from inside the Codex workspace.

The live scheduler reads and writes only the Obsidian vault path on the workspace home PVC:

- `/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron/jobs.edn`: job registry.
- `/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron/prompts/*.md`: prompt bodies.
- `/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron/jobs-state.edn`: scheduler bookkeeping.
- `/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron/runs/<job>/<run-id>/`: run logs.

## Workflow

1. Use the bundled helper for CRUD:

   ```bash
   bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb list
   ```

2. New jobs should default to disabled unless the user explicitly asks to enable them.
3. Use `run` only when the user asks for a manual execution or validation run.

## Commands

List jobs:

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb list
```

Show one job:

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb show <job-id>
```

Add a disabled job:

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb add \
  --id daily-report \
  --name "Daily report" \
  --schedule "0 22 * * *" \
  --prompt "調査して日本語で報告してください。"
```

Update metadata or prompt:

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb update daily-report \
  --schedule "30 22 * * *" \
  --prompt "新しいプロンプト"
```

Enable or disable:

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb enable daily-report
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb disable daily-report
```

Delete:

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb delete daily-report
```

Manual run:

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb run daily-report
```

## Safety

- Confirm schedule, prompt, and enabled state before turning a job on.
- The scheduler supports standard 5-field cron expressions and polls every 30 seconds by default.
- Do not edit Kubernetes CronJobs for individual schedules; the resident scheduler sidecar reads the Obsidian vault `Codex Cron/jobs.edn`.
