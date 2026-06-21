# lolice Kubernetes 1.35 apply baseline plan

## Context

After `shanghai-1` was upgraded to Kubernetes `v1.35.6`, main `Apply Ansible` run `27909847239` still used the normal apply baseline `kubernetes_package_version=1.34.0-1.1` for every control-plane node.

The run attempted to install:

- `kubelet=1.34.0-1.1`
- `kubeadm=1.34.0-1.1`
- `kubectl=1.34.0-1.1`

on `shanghai-1`. The held packages blocked the downgrade, so the node stayed on `v1.35.6`, but main apply failed.

## Plan

1. Update the normal control-plane apply baseline so `shanghai-1` uses Kubernetes `1.35.6` / package `1.35.6-1.1`.
2. Keep `shanghai-2` and `shanghai-3` on Kubernetes `1.34.0` until their one-node Phase 3 upgrade runs complete.
3. Update the `node-shanghai-1` playbook variables to match the actual upgraded state.
4. Validate Ansible syntax and linting.
5. Merge before dispatching `target_node=shanghai-2`.

## Follow-up

After each successful control-plane upgrade, move that node's normal apply baseline to `1.35.6` before continuing to the next node.
