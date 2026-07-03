# BOXP-28: pi agent legacy extension warning

## Goal

Stop codex-workspace startup from recreating pi agent legacy extension layout entries that trigger the `Move your extensions to the extensions/ directory.` warning.

## Plan

1. Keep startup migration for existing `~/.pi/agent/hooks/` entries into `~/.pi/agent/extensions/`.
2. Keep startup migration for custom entries in `~/.pi/agent/tools/`, while leaving managed `fd` / `rg` binaries in place.
3. Remove `moshi-hook` from the codex-workspace image and entrypoint because it is no longer needed and can recreate legacy hook entries after migration.
4. Validate the shell entrypoint and diff hygiene.

## Validation

- `bash -n docker/codex-workspace/entrypoint.sh`
- `git diff --check`
