# lolice k8s 1.35 per-node post-check plan

## Goal

- Make the Kubernetes Upgrade workflow safe for one-control-plane-at-a-time Phase 3 execution.

## Context

- Production upgrades should use separate workflow_dispatch runs for `shanghai-1`, `shanghai-2`, and `shanghai-3` instead of `target_node=all`.
- Dry-run run `27903389682` for `target_node=shanghai-1` succeeded in the upgrade job but failed in post-check because post-check expected kubelet `1.35.6` while dry-run leaves the node on `v1.34.0`.
- Per-node production runs would also fail if post-check validated all control planes before the later nodes are upgraded.

## Plan

1. In post-check, derive an Ansible limit from `inputs.target_node`: `control_plane` for `all`, otherwise the selected node.
2. Pass the derived limit to the post-check playbook.
3. Pass `--check` to post-check when `dry_run=true` so version assertions do not fail on an intentionally unchanged node.
4. Validate with actionlint and a PR CI run before rerunning per-node dry-runs.
