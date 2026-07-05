# lolice k8s 1.35 health check delegate fix

## Context

`golyat-2` upgraded to Kubernetes v1.35.6 and CRI-O 1.35.4, but the GitHub Actions run failed during the worker health check because `health_check.yml` still delegated worker checks to `groups['control_plane'][0]` (`shanghai-1`). Worker drain and pre-checks already use `kubernetes_worker_drain_delegate`, which currently resolves to `shanghai-2` and is reachable from GitHub Actions.

## Plan

1. Change worker health checks to delegate through `kubernetes_worker_drain_delegate`.
2. Use the selected delegate host's API server when checking worker node readiness, kubelet version, and pressure conditions.
3. Validate the playbook syntax and ansible-lint for the touched role files.
4. Merge after CI passes, wait for main apply, then continue with one-node-at-a-time worker upgrades.

## Rollback

Revert the PR. The change only affects where worker health-check `kubectl` commands are executed from.
