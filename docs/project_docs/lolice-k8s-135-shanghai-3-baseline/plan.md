# lolice Kubernetes 1.35 shanghai-3 baseline alignment

## Context

`shanghai-3` was upgraded to Kubernetes 1.35.6 by the `Kubernetes Upgrade` workflow run `27913594139`.
The run completed successfully, including post-upgrade validation.

Current control-plane state after the run:

- `shanghai-1`: kubelet `v1.35.6`, CRI-O `1.35.4`
- `shanghai-2`: kubelet `v1.35.6`, CRI-O `1.35.4`
- `shanghai-3`: kubelet `v1.35.6`, CRI-O `1.35.4`

All nodes returned to `Ready`.

## Decision

Align the normal Apply Ansible desired state for all control-plane nodes with the live 1.35 state before starting worker upgrades.

## Implementation

1. Update `ansible/playbooks/control-plane.yml` so all control-plane nodes use:
   - `kubernetes_version=1.35.6`
   - `kubernetes_package_version=1.35.6-1.1`
   - `crio_version=1.35.4`
2. Update `ansible/playbooks/node-shanghai-3.yml` to the same versions.

## Rollout

1. Merge this PR after CI passes.
2. Confirm the post-merge `Apply Ansible` workflow succeeds.
3. Proceed to worker node upgrades one node at a time.
