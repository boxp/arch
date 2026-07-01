# BOXP-27-29 codex-workspace environment cleanup

## Summary

Codex workspace image startup should avoid noisy update prompts, load pi agent extensions from the current `extensions/` directory layout, and provide predictable editor defaults.

This covers:

- BOXP-27: Disable Codex startup update checks in the container-managed Codex install.
- BOXP-28: Move pi agent extension materialization away from legacy paths that trigger the `Move your extensions to the extensions/ directory.` warning.
- BOXP-29: Set `EDITOR`/`VISUAL` to `vim` so Codex and pi open Vim for external editing.

## Scope

- `docker/codex-workspace/entrypoint.sh`
  - Create and preserve user config directories for Codex and pi agent.
  - Ensure `~/.codex/config.toml` contains `check_for_update_on_startup = false`.
  - Move legacy pi `hooks/` entries, and custom `tools/` entries, into `~/.pi/agent/extensions/` when they exist.
  - Export `EDITOR=vim` and `VISUAL=vim` into login/session environments and the `even-terminal` process.

## Implementation Plan

1. Add minimal startup initialization for Codex config and pi extension directory layout.
2. Extend the session environment allowlist and profile script so SSH sessions, Codex, pi, and even-terminal receive the same editor environment.
3. Keep existing Codex skill installation behavior unchanged.

## Verification

- `bash -n docker/codex-workspace/entrypoint.sh`
- `git diff --check`
- Review rendered entrypoint logic for idempotency and ownership.
- Confirm no unrelated files are changed.

## Notes

- Codex supports `check_for_update_on_startup = false` for centrally managed installs.
- pi agent 0.80.2 emits the `Move your extensions to the extensions/ directory.` warning when legacy `hooks/` exists or `tools/` contains custom entries. The entrypoint migrates those entries into `~/.pi/agent/extensions/`.
- Yazi shell integration is intentionally left out of this change. A `y()` wrapper would only sync shell cwd after Yazi exits and is not required for Codex or pi editor behavior.

## Risks

- Codex config schema may change in future releases. The selected key is documented as `check_for_update_on_startup`.
- Codex `file_opener` only supports editor URI schemes such as VS Code, Cursor, and Windsurf, not arbitrary commands. This change does not configure Yazi as a Codex citation opener.
