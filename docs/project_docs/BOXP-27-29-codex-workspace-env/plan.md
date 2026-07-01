# BOXP-27-29 codex-workspace environment cleanup

## Summary

Codex workspace image startup should avoid noisy update prompts, load pi agent extensions from the current `extensions/` directory layout, and provide predictable editor and Yazi shell integration.

This covers:

- BOXP-27: Disable Codex startup update checks in the container-managed Codex install.
- BOXP-28: Move pi agent extension materialization away from legacy paths that trigger the `Move your extensions to the extensions/ directory.` warning.
- BOXP-29: Set `EDITOR`/`VISUAL` to `vim` and provide a `y` command that opens Yazi with cwd synchronization.

## Scope

- `docker/codex-workspace/entrypoint.sh`
  - Create and preserve user config directories for Codex and pi agent.
  - Ensure `~/.codex/config.toml` contains `check_for_update_on_startup = false`.
  - Move legacy pi `hooks/` entries, and custom `tools/` entries, into `~/.pi/agent/extensions/` when they exist.
  - Export `EDITOR=vim` and `VISUAL=vim` into login/session environments and the `even-terminal` process.
  - Add the Yazi-recommended `y()` shell wrapper so terminal sessions can open Yazi and sync the shell cwd on exit.

## Implementation Plan

1. Add minimal startup initialization for Codex config, pi extension directory layout, and shell-level Yazi integration.
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
- Yazi 26.5.6 accepts `yazi [ENTRIES]...` and supports `--cwd-file`; the provided `y()` wrapper follows the official shell-wrapper pattern and keeps shell cwd in sync after exiting Yazi.

## Risks

- Codex config schema may change in future releases. The selected key is documented as `check_for_update_on_startup`.
- Codex `file_opener` only supports editor URI schemes such as VS Code, Cursor, and Windsurf, not arbitrary commands. Yazi integration is therefore provided as a shell command instead of a Codex citation opener.
