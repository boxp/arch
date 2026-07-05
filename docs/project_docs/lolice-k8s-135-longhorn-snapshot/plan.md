# lolice k8s 1.35 Longhorn snapshot plan

## Context

The first production phase 3 run failed before the Kubernetes upgrade because the workflow tried to fetch a 600MB+ etcd snapshot from the control-plane node to the GitHub Actions runner. That path is fragile and unnecessarily exports the snapshot from the cluster.

The `lolice` GitOps manifests already provide an `etcd-snapshots` namespace, a Longhorn PVC, and a small storage pod. The PVC is backed by Longhorn, so durable off-cluster backup should be handled by Longhorn backup settings rather than a GitHub Actions artifact transfer.

## Plan

- Stop passing a local artifact directory to the etcd snapshot task.
- Remove the direct GitHub Actions S3 upload of fetched snapshot files.
- Keep creating and verifying the snapshot on the first control-plane node.
- Stream the verified snapshot from the control-plane host into the `etcd-snapshots` Longhorn PVC through the storage pod.
- Keep the host-side snapshot by default for the existing rollback task.
- Prune old PVC snapshots by count so repeated upgrade attempts do not fill the volume.
- Update Molecule mocks so CI exercises the PVC storage path.

## Validation

- Run Ansible syntax check for the upgrade playbook.
- Run `ansible-lint` for the Ansible changes.
- Run the `kubernetes_upgrade` Molecule scenario if the local container environment supports it.
- After merge, run a production snapshot/pre-upgrade workflow before continuing with one-node-at-a-time upgrades.
