# lolice k8s 1.36 sysctl default qdisc reload tolerance

## Context

The post-merge `Apply Ansible` run after `#10358` passed on `shanghai-1` but failed on `shanghai-2`.
`sysctl --system --ignore` still returned `rc=1` when the only stderr line was the existing host setting `net.core.default_qdisc`, which is unavailable on that node.

The inotify settings were applied, but the strict handler result blocked the main apply gate.

## Plan

1. Keep using `sysctl --system --ignore`.
2. Register the handler result and fail only when stderr contains lines other than the known `net.core.default_qdisc` unavailable-key message.
3. Validate the Ansible role locally.
4. Merge and confirm post-merge `Apply Ansible` succeeds on all control-plane nodes.

## Validation

- `cd ansible && uv run ansible-lint`
- `git diff --check`
- GitHub Actions CI on the pull request
- Post-merge `Apply Ansible`

## Rollback

Revert this PR if sysctl reload should again fail on the existing `net.core.default_qdisc` host setting.
The underlying host setting should eventually be cleaned up or made conditional, but it should not block Kubernetes node sysctl management during the upgrade.
