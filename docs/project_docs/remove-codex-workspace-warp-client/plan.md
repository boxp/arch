# Remove Codex Workspace WARP Client

## Background

`codex-workspace` previously installed and optionally started the Cloudflare WARP client inside the workspace container. Investigation of the `192.168.10.98:22` connectivity failure showed that an in-pod WARP session changed the pod network namespace/routing and broke return traffic for kube-vip and NodePort access.

The `boxp/lolice` deployment has already stopped configuring and starting WARP in the pod. This change removes the WARP package and startup logic from the source image so the running pod no longer contains the WARP client binaries.

## Plan

1. Remove the Cloudflare WARP apt repository and `cloudflare-warp` package from `docker/codex-workspace/Dockerfile`.
2. Remove the entrypoint function that writes WARP MDM config, starts `warp-svc`, registers the client, and runs `warp-cli connect`.
3. Verify that `docker/codex-workspace` no longer references WARP startup/configuration strings.
4. Verify `docker/codex-workspace/entrypoint.sh` with `bash -n`.
5. Merge the change so the main-branch image build publishes a new `ghcr.io/boxp/arch/codex-workspace` image.
6. Confirm the deployed `codex-workspace` pod no longer has `warp-cli`/`warp-svc` and still reaches `192.168.10.98:22`.

## Verification

- `rg -n "CLOUDFLARE_WARP|cloudflare-warp|warp-cli|warp-svc|pkg.cloudflareclient|CLOUDFLARE_WARP_DISTRO" docker/codex-workspace`
- `bash -n docker/codex-workspace/entrypoint.sh`
- After deployment: `command -v warp-cli`, `command -v warp-svc`, and `pgrep -a warp-svc` return no WARP client artifacts in the pod.
