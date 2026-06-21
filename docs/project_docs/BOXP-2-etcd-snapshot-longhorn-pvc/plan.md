# BOXP-2 etcd snapshot Longhorn PVC plan

## Context

The Kubernetes upgrade pre-check successfully creates an etcd snapshot on the control-plane node, but fetching a 600MB+ snapshot back to the GitHub Actions runner can be killed by SSH/module memory limits. Storing the file in a dedicated Longhorn PVC keeps it inside the cluster and lets the existing Longhorn backup target handle durable backup.

## Plan

- Remove the GitHub Actions local artifact fetch and dedicated S3 upload path for etcd snapshots.
- Keep the previous S3 Terraform resources managed for now so an apply does not try to delete a non-empty bucket as part of this migration.
- Manage the dedicated namespace, Longhorn PVC, and storage Deployment from the lolice GitOps manifests.
- In the upgrade pre-check, wait for the GitOps-managed storage pod by label and stream the snapshot into it.
- Create the snapshot inside the etcd pod, verify it with `etcdutl snapshot status`, move it to the control-plane host, and stream it into the PVC.
- Ignore zero-byte same-day snapshot files when deciding whether a reusable snapshot exists.
- Retain only the newest PVC snapshots by count so repeated dry-runs do not fill the volume.
- Keep the control-plane host copy by default because the current rollback task restores from `etcd_snapshot_dir`.
- Make Plan Ansible CI print captured stderr and JSON tail on playbook failure, and upload plan outputs even when the job fails.

## Validation

- Run Ansible syntax and lint checks for the upgrade playbook.
- Run the kubernetes_upgrade Molecule scenario if local container support allows it.
- Run a GitHub Actions dry-run after the PR is merged to confirm the pre-check stores the snapshot in the Longhorn PVC.
