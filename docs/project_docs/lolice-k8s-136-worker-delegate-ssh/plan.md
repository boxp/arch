# lolice k8s 1.36 worker delegate SSH fix

## Context

The Kubernetes 1.36 worker upgrade for `golyat-1` failed before package changes started.
The failing Ansible task delegated worker drain to `shanghai-2`, but the GitHub Actions SSH config only registered IP address aliases for the worker and control-plane delegate.

The workflow also overrides `ansible_ssh_common_args` to an empty string, so Ansible must be able to connect with the inventory host name used by `delegate_to`.

## Plan

1. Add inventory host name aliases to the worker upgrade SSH config for each `golyat-*` job.
2. Keep IP aliases as well, because the workflow still performs direct IP connectivity checks.
3. Verify SSH connectivity with both the worker inventory name and `shanghai-2`, matching the names Ansible uses during delegated drain and uncordon tasks.
4. Run GitHub Actions workflow lint checks locally.
5. Merge the fix, confirm post-merge CI, then retry worker upgrades one node at a time.

## Validation

- `actionlint .github/workflows/upgrade-k8s.yml`
- `ghalint run`
- `git diff --check`
- GitHub Actions CI on the pull request
- Post-merge CI on `main`

## Rollback

Revert this PR. The change only affects SSH host aliases in the manual Kubernetes upgrade workflow and does not change cluster state directly.
