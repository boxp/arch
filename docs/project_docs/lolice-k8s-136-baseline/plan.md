# lolice Kubernetes 1.36 Baseline

## Context

All lolice Kubernetes nodes have been upgraded to kubelet `v1.36.1` and CRI-O `1.36.1`.
The production inventory and normal control-plane apply playbooks still declare the previous `1.35.6` / `1.35.4` baseline, so regular Ansible apply should be aligned with the live cluster before closing the upgrade project.

## Plan

1. Update the production inventory for control-plane and worker groups to Kubernetes `1.36.1`, package `1.36.1-1.1`, and CRI-O `1.36.1`.
2. Update the per-node shanghai playbooks and `control-plane.yml` defaults to the same `1.36.1` baseline.
3. Update the manual `upgrade-k8s.yml` workflow input examples so future runs show the current version family.
4. Run focused validation for Ansible/YAML changes.
5. Merge after CI passes, then verify the post-merge Ansible apply remains green.

## Rollback

Revert this PR if regular apply exposes an issue. Reverting only changes desired-state metadata and must not be used to downgrade the already-upgraded cluster.
