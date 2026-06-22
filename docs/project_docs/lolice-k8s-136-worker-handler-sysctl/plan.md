# lolice k8s 1.36 worker handler and sysctl fix

## Context

The `golyat-1` Kubernetes 1.36 upgrade completed the package upgrade, reboot, uncordon, and readiness checks, but the GitHub Actions job failed when the delayed `Restart crio` handler ran after the health checks.

During the same worker phase, kube-proxy 1.36 also required higher inotify limits than the current node defaults. Runtime values were temporarily raised on the cluster to restore kube-proxy, but the setting must be made persistent by Ansible.

## Plan

1. Flush the CRI-O restart handler immediately after CRI-O package upgrade tasks.
2. Apply the same handler ordering for worker and control-plane upgrade task flows so health checks are not followed by an unexpected CRI-O restart.
3. Persist kube-proxy-compatible inotify sysctl values in the Kubernetes component role.
4. Raise the Ansible CI timeout so changed-role Molecule tests can run both `kubernetes_components` and `kubernetes_upgrade` in one PR.
5. Run Ansible and YAML validation locally.
6. Merge the fix, confirm post-merge CI, then continue worker upgrades one node at a time.

## Validation

- `cd ansible && uv run ansible-lint`
- `git diff --check`
- GitHub Actions CI on the pull request
- Post-merge CI on `main`

## Rollback

Revert this PR. The handler ordering change only affects the manual Kubernetes upgrade workflow behavior. The sysctl additions are safe Kubernetes node tunables and can be removed by reverting the Ansible change if needed.
