# lolice k8s 1.36 test ansible timeout

## Context

The Kubernetes 1.36 worker safety fix changes both `kubernetes_components` and `kubernetes_upgrade`.
The `pull_request_target` check runs reusable workflows from the base branch, so increasing `test-ansible.yml` inside that PR does not affect the PR check itself.

The current 30 minute timeout is too short when Molecule runs multiple changed Ansible roles sequentially on ARM64 emulation.

## Plan

1. Raise the reusable `test-ansible` job timeout from 30 minutes to 60 minutes on `main`.
2. Merge this base workflow update first.
3. Rebase and rerun the Kubernetes 1.36 worker safety PR after the new timeout is available from the base branch.

## Validation

- `actionlint .github/workflows/test-ansible.yml`
- `git diff --check`
- GitHub Actions CI on the pull request

## Rollback

Revert this PR if the longer timeout causes unacceptable CI queue pressure.
The change only affects the maximum runtime of Ansible role tests.
