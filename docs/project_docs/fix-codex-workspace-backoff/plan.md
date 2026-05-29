# fix-codex-workspace-backoff: Codex workspace startup failure

## Context

`codex-workspace` Pod is in `CrashLoopBackOff`. The failing container is `workspace`, and its previous log shows the entrypoint exiting while copying bundled Codex skills into the persistent home directory:

```text
cp: cannot create directory '/home/boxp/.codex/skills/./codex-workspace-cron': Permission denied
cp: failed to preserve ownership for '/home/boxp/.codex/skills/.': Permission denied
```

The workspace container runs as root but drops broad capabilities. The persistent `/home/boxp` tree is owned by `boxp`, so root without write override cannot create or copy files under the directory. `cp -a` also attempts to preserve ownership, which is unnecessary for bundled skills and fails in this restricted startup context.

## Plan

- Initialize home subdirectories as the `boxp` user instead of root.
- Copy bundled skills as the `boxp` user instead of root.
- Avoid preserving source ownership and mode when syncing the bundled skills.
- Keep the entrypoint behavior otherwise unchanged.

## Verification

- `bash -n docker/codex-workspace/entrypoint.sh`
- Build the image locally enough to exercise entrypoint startup.
- Run a container with a pre-created `boxp`-owned home directory to confirm the skill copy no longer fails.
