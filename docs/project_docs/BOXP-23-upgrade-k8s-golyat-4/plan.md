# BOXP-23 upgrade-k8s golyat-4

## Context

`golyat-4` is now part of the lolice Kubernetes worker fleet and is managed by the production Ansible inventory.

The `plan-ansible` / `apply-ansible` workflows already include `golyat-4`, and `ansible/inventories/production/hosts.yml` plus `ansible/vars/nodes.yml` already define `golyat-4` as `192.168.10.107`.

The `Kubernetes Upgrade` workflow still only exposes `golyat-1`, `golyat-2`, and `golyat-3` as worker targets.

## Plan

1. Add `golyat-4` to the `target_node` workflow_dispatch choices.
2. Add `golyat-4` to the `NODE_IPS` and `ALL_NODE_IPS` maps.
3. Add an `upgrade-worker-4` job matching the existing worker upgrade pattern.
4. Include `upgrade-worker-4` in post-check dependencies and success gating.

## Validation

- Parse `.github/workflows/upgrade-k8s.yml` as YAML.
- Verify all `golyat-4` references are present.
- `actionlint .github/workflows/upgrade-k8s.yml`
- Run `git diff --check`.
- `codex review --uncommitted`
