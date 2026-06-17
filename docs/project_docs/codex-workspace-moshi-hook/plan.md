# codex-workspace-moshi-hook: Moshi hook integration

## Goal

Install `moshi-hook` in the codex-workspace image and start the hook daemon when the workspace container starts, so Codex CLI sessions can report events to Moshi.

## Implementation

1. Add `moshi-hook` to `docker/codex-workspace/Dockerfile` using the official Linux install script with `INSTALL_DIR=/usr/local/bin`.
2. Pin `MOSHI_HOOK_VERSION` to match the repository's existing explicit tool-version pattern.
3. Update `docker/codex-workspace/entrypoint.sh` to:
   - optionally pair with Moshi when `MOSHI_PAIRING_TOKEN` is provided,
   - run `moshi-hook install` as the `boxp` user,
   - pass the image `PATH` through `runuser` so Moshi can find installed agents such as `codex`,
   - start `moshi-hook serve` in the background,
   - keep Moshi setup best-effort so an unpaired or temporarily failing Moshi daemon does not crash the workspace.

## Operations

- Set `MOSHI_PAIRING_TOKEN` on first startup if the host is not already paired.
- Set `MOSHI_HOOK_ENABLED=0` to disable Moshi hook setup and daemon startup.
- Pairing and installed hook config are stored under the persistent `/home/boxp` volume.

## Validation

- `bash -n docker/codex-workspace/entrypoint.sh`
- `docker build -t codex-workspace:moshi-hook docker/codex-workspace`
- `docker run --rm --entrypoint /bin/bash codex-workspace:moshi-hook -lc 'command -v moshi-hook && moshi-hook version'`
