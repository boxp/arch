# BOXP-2 etcd Snapshot Artifact Plan

## Context

The Kubernetes Upgrade workflow failed during pre-check because `etcdctl` is not installed on the control-plane host. The working command path is inside the static etcd pod via `kubectl exec`.

## Plan

1. Run `etcdctl snapshot save` inside the target etcd pod.
2. Copy the snapshot from the pod to the control-plane host as a staging file.
3. Fetch the staged snapshot to the GitHub Actions runner when `etcd_snapshot_local_dir` is set.
4. Upload fetched snapshots from the GitHub Actions runner to `s3://arch-etcd-snapshots/kubernetes-upgrade/`.
5. Keep the pod snapshot temporary and remove it after verification.
6. Manage the S3 bucket, encryption, lifecycle, and GitHub Actions role permissions in Terraform.
