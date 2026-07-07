# BOXP-58: Hermes Agent custom image

## Goal

Move Hermes Agent runtime bootstrap from the `boxp/lolice` Pod into a reproducible `boxp/arch` image published as `ghcr.io/boxp/arch/hermes-agent`.

## Image contents

- Base image: `docker.io/nousresearch/hermes-agent@sha256:94f90d3cb66c848e6d7465fb7ca11dc485f096700edc26f571fedab59f4274f7`.
- Added runtime tools:
  - `obsidian-headless@0.0.12` under `/opt/obsidian-headless`.
  - `babashka@1.12.218` as `/usr/local/bin/bb`, with SHA256 verification.
  - BOXP Obsidian Task Board skill under `/opt/boxp/hermes-agent/skills/obsidian-task-board`.
- UID/GID policy stays owned by the workload manifests: Hermes runs with `HERMES_UID=1000` and `HERMES_GID=10000`, while the image keeps static tooling root-owned and read-only.

## Publish flow

- `.github/workflows/build-hermes-agent-image.yml` builds `docker/hermes-agent` for `linux/amd64`.
- Pull requests build but do not push.
- `main` pushes `YYYYMMDDHHmm`, `sha-*`, and `latest` tags to GHCR.
- Renovate can update the base image digest through Dockerfile detection and the pinned `OBSIDIAN_HEADLESS_VERSION` / `BABASHKA_VERSION` args through custom managers.

## lolice changes

- `argoproj/hermes-agent` consumes `ghcr.io/boxp/arch/hermes-agent:latest` for the bootstrap initContainer, main Hermes container, and `obsidian-sync` sidecar.
- Runtime `npm install`, runtime Babashka download, and ConfigMap-backed skill copy initContainers are removed.
- The remaining initContainer only handles PVC state:
  - create `/opt/data/Documents/obsidian-headless/BOXP`;
  - one-time shared UID/GID migration;
  - seed `/opt/data/config.yaml` only when absent;
  - seed the Task Board skill only when absent;
  - keep group-write permissions on the shared PVC paths.

## Rollback

1. In `boxp/lolice`, switch `argoproj/hermes-agent/deployment.yaml` back to `docker.io/nousresearch/hermes-agent@sha256:94f90d3cb66c848e6d7465fb7ca11dc485f096700edc26f571fedab59f4274f7`.
2. Restore the Node/Babashka/skill initContainers and the `hermes-agent-obsidian-task-board-skill` ConfigMap generator.
3. Remove `argoproj/argocd-image-updater/imageupdaters/hermes-agent.yaml` so ImageUpdater stops writing back the custom image digest.
4. Sync the `hermes-agent` Argo CD Application.

## Verification

- `docker build -t hermes-agent:boxp-58 docker/hermes-agent`
- `docker run --rm --entrypoint sh hermes-agent:boxp-58 -c 'hermes --version && ob --version && bb --version && test -f /opt/boxp/hermes-agent/skills/obsidian-task-board/bin/task-board.bb'`
- In `boxp/lolice`:
  - `kubectl kustomize argoproj/hermes-agent`
  - `kubectl kustomize argoproj/argocd-image-updater`
- After rollout:
  - `kubectl -n hermes-agent rollout status deploy/hermes-agent`
  - confirm Cloudflare Access reaches `https://hermes-agent.b0xp.io`;
  - confirm local LLM calls still target `http://llama-server.local-llm.svc.cluster.local:8080/v1`;
  - confirm both Hermes and `obsidian-sync` can read/write `/home/boxp/Documents/obsidian-headless/BOXP`.
