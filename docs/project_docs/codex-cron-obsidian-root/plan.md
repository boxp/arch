# codex-cron-obsidian-root: Codex cron root を Obsidian vault に寄せる

## Goal

Codex workspace cron の source of truth を `~/.codex-cron` symlink ではなく、Obsidian vault 上の実体 `/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron` にする。

## Plan

1. `docker/codex-workspace/cron/codex_cron_lib.bb` の default root を Obsidian vault path に変更する。
2. `docker/codex-workspace/cron/run-codex-cron.sh` の fallback root も同じ path に変更する。
3. `docker/codex-workspace/entrypoint.sh` では `~/.codex-cron` を作らず、Obsidian vault path を作成する。
4. bundled `codex-workspace-cron` skill の説明を vault path 前提に更新する。

## Validation

- `bash -n docker/codex-workspace/entrypoint.sh docker/codex-workspace/cron/run-codex-cron.sh`
- `bb docker/codex-workspace/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb list`
