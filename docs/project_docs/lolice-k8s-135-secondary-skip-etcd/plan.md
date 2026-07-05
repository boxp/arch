# lolice Kubernetes 1.35 secondary control plane etcd phase skip

## Context

The production `shanghai-2` Kubernetes 1.35.6 upgrade failed during `kubeadm upgrade node`.
The node remained on kubelet `v1.34.0`, while CRI-O and kubeadm had already been upgraded to 1.35.4 / 1.35.6. The failure occurred in kubeadm's internal etcd backup path:

```text
failed to back up etcd data, output: "cp: cannot stat '/var/lib/etcd/member/wal/0.tmp': No such file or directory\n"
```

Cluster health stayed intact and `shanghai-2` was manually uncordoned after verifying the node, static pods, and local etcd endpoint were healthy.

## Decision

Use the same etcd policy for secondary control planes as the first control plane:

- Keep the project-owned pre-upgrade etcd snapshot in the `etcd-snapshots` Longhorn PVC.
- Do not fetch the snapshot into GitHub Actions.
- Do not rely on kubeadm's internal etcd backup/upgrade phase during the Kubernetes 1.35 rollout.
- Pass `--etcd-upgrade=false` to `kubeadm upgrade node` unless `kubeadm_upgrade_etcd` is explicitly enabled.

`kubeadm upgrade node --help` on `shanghai-2` with kubeadm 1.35.6 confirms that `--etcd-upgrade` is supported for the command and defaults to `true`.

## Implementation

1. Update `ansible/roles/kubernetes_upgrade/tasks/upgrade_control_plane_secondary.yml`.
2. Change `kubeadm upgrade node` to pass:

```text
--etcd-upgrade={{ kubeadm_upgrade_etcd | bool | ternary('true', 'false') }}
```

3. Keep the existing default `kubeadm_upgrade_etcd: false`.
4. Validate the playbook syntax and lint the touched playbook/role.

## Rollout

1. Merge this fix.
2. Confirm the post-merge `Apply Ansible` workflow succeeds.
3. Re-run `Kubernetes Upgrade` only for `target_node=shanghai-2` with:
   - `dry_run=false`
   - `kubernetes_version=1.35.6`
   - `kubernetes_package=1.35.6-1.1`
   - `crio_version=1.35.4`
4. Verify `shanghai-2` is `Ready` on kubelet `v1.35.6`.
5. Update the normal apply baseline for `shanghai-2` before starting `shanghai-3`.
