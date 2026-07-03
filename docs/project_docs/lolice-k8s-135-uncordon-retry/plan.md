# lolice Kubernetes 1.35 uncordon retry plan

## Context

Production run `27908896441` upgraded `shanghai-1` to Kubernetes `v1.35.6`, but the workflow failed after kubelet restart because `kubectl uncordon shanghai-1` hit a transient local API server refusal on `https://192.168.10.102:6443`.

Manual recovery succeeded after the API server became ready:

- `shanghai-1` is `Ready` and uncordoned.
- kubelet reports `v1.35.6`.
- control plane static pods are running.
- etcd endpoint health passed.

## Plan

1. Add an explicit `/readyz` wait after kubelet restart and before control-plane uncordon.
2. Retry the uncordon command to absorb short API restart windows.
3. Apply the same guard to first and secondary control-plane upgrade tasks.
4. Validate with syntax check, ansible-lint, and the `kubernetes_upgrade` Molecule scenario.
5. Merge before starting the next one-node production upgrade run.

## Rollout

After merge, continue Phase 3 one node at a time:

1. Run `Kubernetes Upgrade` for `target_node=shanghai-2`.
2. Verify `shanghai-2` is `Ready`, uncordoned, and on `v1.35.6`.
3. Verify static pods and etcd health.
4. Only then run `target_node=shanghai-3`.
