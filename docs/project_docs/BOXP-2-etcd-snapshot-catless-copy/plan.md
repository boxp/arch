# BOXP-2 etcd snapshot catless copy plan

## Context

The Kubernetes Upgrade dry run failed after creating the etcd snapshot because the etcd container image does not provide `cat`.

## Plan

1. Stop relying on `kubectl exec ... cat` to copy snapshot bytes out of the etcd container.
2. Save the snapshot inside the etcd pod under `/var/lib/etcd`, which is hostPath-mounted by kubeadm static etcd pods.
3. Verify the snapshot inside the pod before moving it.
4. Move the snapshot on the control plane host from `/var/lib/etcd` into `/var/lib/etcd-snapshots`.
5. Keep the existing fetch-to-runner and S3 upload flow unchanged.
