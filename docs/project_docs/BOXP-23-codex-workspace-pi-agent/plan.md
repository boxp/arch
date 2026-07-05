# BOXP-23 codex-workspace pi agent

## Background

Phase 6 needs the existing `codex-workspace` workload to call `local-llm` through pi agent using the stable `gemma4-26b` model alias.

`boxp/lolice` already exposes `gemma4-26b` from `local-llm`. The current `codex-workspace` image includes Node.js but does not include the `pi` CLI.

## Plan

- Add `PI_AGENT_VERSION=0.80.2`.
- Install `@earendil-works/pi-coding-agent` globally with the other workspace npm CLIs.
- Keep GHCR publishing on the existing `Build Codex Workspace Image` workflow.
- Let `boxp/lolice` follow the published image through its existing `argocd-image-updater` integration.

## Validation

- Dockerfile diff / syntax check.
- PR `Build Codex Workspace Image` check.
- After merge, confirm GHCR publish and then verify `pi --version` in the `codex-workspace` Pod.
