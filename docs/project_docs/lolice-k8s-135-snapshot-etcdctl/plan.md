# lolice k8s 1.35 snapshot etcdctl plan

## Context

The first production run after switching etcd snapshots to the Longhorn PVC failed before the upgrade started. Snapshot creation succeeded, but integrity verification used `etcdutl`, which is not present in the running etcd container image.

The previous `etcdctl snapshot status` command is available in the etcd container and had already worked in the earlier production attempt.

## Plan

- Change snapshot integrity verification from `etcdutl snapshot status` back to `etcdctl snapshot status`.
- Update the Molecule kubectl mock to match the production command.
- Keep the Longhorn PVC storage path unchanged.

## Validation

- Run Ansible syntax check for the upgrade playbook.
- Run `ansible-lint` for the changed role files.
- Run the `kubernetes_upgrade` Molecule scenario if local Docker support is available.
