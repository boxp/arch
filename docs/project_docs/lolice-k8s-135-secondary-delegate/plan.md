# lolice k8s 1.35 secondary delegate fix plan

## Goal

- Make the Kubernetes Upgrade workflow usable for Phase 3 control-plane upgrades when each per-node job only has SSH access to its target node.

## Context

- Dry-run run `27902028437` failed on `Upgrade shanghai-2` because secondary control-plane drain still delegated kubectl execution to `shanghai-1`.
- The pre-check delegate issue was already fixed in `boxp/arch#10330`.
- `upgrade_control_plane_first.yml` already runs drain/uncordon from the target node itself using `kubectl_api_server_arg`.

## Plan

1. Remove `delegate_to: groups[control_plane][0]` from secondary control-plane drain and uncordon tasks.
2. Remove the same delegate from node health checks so post-upgrade per-node checks run from the target node.
3. Keep worker drain/uncordon unchanged for now because worker Phase 4 may need separate SSH topology handling.
4. Validate with ansible-lint and a shanghai-2 check-mode upgrade run that reproduces the GitHub Actions SSH topology.
5. Open a PR, wait for CI, merge, then rerun Kubernetes Upgrade dry-run with explicit version inputs.
