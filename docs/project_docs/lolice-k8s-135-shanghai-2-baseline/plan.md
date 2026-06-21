# lolice Kubernetes 1.35 shanghai-2 baseline alignment

## Context

`shanghai-2` was upgraded to Kubernetes 1.35.6 by the `Kubernetes Upgrade` workflow run `27911856475`.
The workflow itself failed after the upgrade because the local apiserver `/readyz` endpoint returned `ok`, while the Ansible task only accepted `readyz check passed`.

Manual verification after the run:

- `shanghai-2` node is `Ready` on kubelet `v1.35.6`.
- `cri-o`, `kubeadm`, `kubectl`, and `kubelet` packages are at the 1.35 target versions.
- control-plane static pod manifests use Kubernetes `v1.35.6` images.
- local etcd endpoint is healthy.
- the node was manually uncordoned.

## Decision

1. Align the normal Apply Ansible baseline for `shanghai-2` with the live 1.35 state before proceeding to `shanghai-3`.
2. Keep `shanghai-3` at its current 1.34 Kubernetes baseline until it is upgraded.
3. Accept both `/readyz` success responses observed in the rollout:
   - `readyz check passed`
   - `ok`

## Implementation

1. Update `ansible/playbooks/control-plane.yml` so `shanghai-1` and `shanghai-2` use:
   - `kubernetes_version=1.35.6`
   - `kubernetes_package_version=1.35.6-1.1`
   - `crio_version=1.35.4`
2. Update `ansible/playbooks/node-shanghai-2.yml` to the same versions.
3. Update the control-plane upgrade ready wait tasks to accept `/readyz` output `ok`.

## Rollout

1. Merge this PR after CI passes.
2. Confirm the post-merge `Apply Ansible` workflow succeeds.
3. Start `shanghai-3` upgrade only after that apply succeeds.
