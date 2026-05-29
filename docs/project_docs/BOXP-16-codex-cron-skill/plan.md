# BOXP-16: Codex workspace cron CRUD skill

## Context

`boxp/lolice` PR #594 adds Codex workspace scheduled prompts through `argoproj/codex-workspace/cron-configmap.yaml` and `cronjob.yaml`. Operators need a Codex skill inside the workspace that can inspect and edit those GitOps manifests safely.

## Design

- Bundle a `codex-workspace-cron` skill into the Codex workspace image.
- Sync image-provided skills from `/opt/codex-workspace/skills` into `/home/boxp/.codex/skills` at container startup so the existing Longhorn home PVC receives updates.
- Include a deterministic Babashka helper for `list`, `show`, `add`, `update`, `enable`, `disable`, and `delete`.
- Keep operations GitOps-only. The skill does not mutate the live Kubernetes cluster unless the user separately asks for a manual live run.

## Validation

- `bash -n docker/codex-workspace/entrypoint.sh`
- `bb docker/codex-workspace/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb --help` exits with usage
- Helper smoke test against a copied `boxp/lolice` cron manifest.
