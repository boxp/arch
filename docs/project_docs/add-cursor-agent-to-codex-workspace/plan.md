# Add Cursor Agent to Codex workspace

## Goal

Make Cursor Agent available inside the `ghcr.io/boxp/arch/codex-workspace` image.

## Design

- Add `CURSOR_AGENT_VERSION` to `docker/codex-workspace/Dockerfile`.
- Download the pinned Cursor Agent Linux x64 package from `downloads.cursor.com`.
- Extract the full package into `/opt/cursor-agent` because the CLI depends on bundled runtime files.
- Expose both commands expected by the installer:
  - `/usr/local/bin/cursor-agent`
  - `/usr/local/bin/agent`
- Track `CURSOR_AGENT_VERSION` with Renovate by reading the current installer script from `https://cursor.com/install`.

## Tasks

- [x] Inspect the current Cursor Agent installer output and package layout.
- [x] Add Cursor Agent to the Codex workspace image.
- [x] Add Cursor Agent version tracking to Renovate.
- [x] Add this project plan.
- [x] Verify Dockerfile build and CLI availability.
- [ ] Create PR.

## Verification

- `bash -n docker/codex-workspace/entrypoint.sh`
- `docker build -t codex-workspace:cursor-agent docker/codex-workspace`
- `docker run --rm --entrypoint /bin/bash codex-workspace:cursor-agent -lc 'agent --version && cursor-agent --version'`
- `npx --yes --package renovate renovate-config-validator renovate.json5`
