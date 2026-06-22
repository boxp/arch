# lolice k8s 1.36 sysctl reload ignore unknown keys

## Context

After the Kubernetes 1.36 worker safety fix was merged, the post-merge `Apply Ansible` run failed on `shanghai-1`.
The new inotify values were written successfully, but the `Reload sysctl` handler ran `sysctl --system` and failed because an existing host sysctl file contains `net.core.default_qdisc`, which is unavailable in the current kernel/module state.

The failure blocks the main apply gate before continuing worker upgrades.

## Plan

1. Change the `Reload sysctl` handler to run `sysctl --system --ignore`.
2. Keep the handler failing for real command execution problems while ignoring unknown/unavailable sysctl keys reported by procps.
3. Validate the Ansible role locally.
4. Merge the fix and confirm post-merge `Apply Ansible` succeeds.

## Validation

- `cd ansible && uv run ansible-lint`
- `git diff --check`
- GitHub Actions CI on the pull request
- Post-merge `Apply Ansible`

## Rollback

Revert this PR if sysctl reload behavior needs to be strict again.
Until the host-level `net.core.default_qdisc` setting is removed or made conditional, strict `sysctl --system` can fail normal apply on nodes where the key is unavailable.
