# lolice k8s 1.35 baseline

## Context

All lolice Kubernetes nodes have been upgraded to kubelet v1.35.6 and CRI-O 1.35.4. The production inventory still carries an older Kubernetes/CRI-O baseline, so regular Ansible apply should be aligned with the live cluster before closing the upgrade project.

## Plan

1. Update production inventory Kubernetes and CRI-O version variables to the live v1.35 baseline.
2. Validate the inventory/playbooks with ansible-lint and syntax checks.
3. Merge after CI passes and verify main Apply Ansible succeeds.
4. After baseline apply succeeds, complete post-upgrade cleanup: restore maintenance settings, remove upgrade etcd snapshots from the Longhorn PVC, and update project notes.

## Rollback

Revert the PR if regular apply exposes an issue. The cluster is already running v1.35.6, so reverting only changes desired-state metadata and should not be used to downgrade nodes.
