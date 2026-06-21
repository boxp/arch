# lolice k8s 1.35 skip kubeadm etcd phase plan

## Context

The production shanghai-1 Kubernetes 1.35.6 upgrade reached `kubeadm upgrade apply`, but kubeadm failed during the etcd static pod phase:

- kubeadm moved a temporary etcd manifest into `/etc/kubernetes/manifests/etcd.yaml`.
- kubelet restarted etcd, but kubeadm did not observe the static pod hash change within its 5 minute timeout.
- kubeadm rolled etcd back to the pre-upgrade state.
- The cluster remained on Kubernetes v1.34.0 and etcd recovered healthy.

The lolice cluster already takes a pre-upgrade etcd snapshot and stores it in a Longhorn PVC, with S3 backup delegated to Longhorn BackupTarget/recurring backup. The current etcd image is already `registry.k8s.io/etcd:3.6.4-0`, so retrying kubeadm's etcd static pod phase adds risk without being necessary for the Kubernetes component upgrade.

## Plan

1. Add a role variable `kubeadm_upgrade_etcd`, defaulting to `false`.
2. Pass `--etcd-upgrade=false` to `kubeadm upgrade apply` by default for the first control plane upgrade.
3. Keep the option configurable so a future explicit etcd upgrade can set `kubeadm_upgrade_etcd=true`.
4. Remove leftover `*.db.part` files from the etcd data directory after snapshot creation, so kubeadm's internal etcd backup does not copy temporary snapshot fragments.
5. Validate Ansible syntax and lint locally.
6. Merge, wait for main CI/apply, then rerun shanghai-1 only.

## Rollback

If the change causes issues, revert this PR. The cluster state remains protected by the pre-upgrade etcd snapshot stored in the `etcd-snapshots` Longhorn PVC and by Longhorn's BackupTarget/recurring backup path.
