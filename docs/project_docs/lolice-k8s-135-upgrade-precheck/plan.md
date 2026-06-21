# lolice Kubernetes 1.35 Upgrade Pre-check Fix Plan

作成日: 2026-06-21

## Goal

`Kubernetes Upgrade` workflow の node 別 upgrade job で、対象外 control plane への SSH delegate による dry-run failure を解消する。

## Background

`dry_run=true` の `target_node=all` 実行で、`shanghai-2` job が `Verify all nodes are Ready` task を `shanghai-1` に delegate しようとして SSH timeout した。

各 upgrade job は対象 node への SSH config だけを持つため、pre-check は対象 node 自身の `kubectl` で API server を確認する必要がある。

## Changes

- `ansible/roles/kubernetes_upgrade/tasks/pre_checks.yml` から `delegate_to` / `run_once` を削除する。
- `kubectl_api_server_arg` は対象 node の direct API endpoint を指すため、対象 node から全 node Ready を確認できる。

## Verification

- `cd ansible && uv run ansible-lint roles/kubernetes_upgrade/tasks/pre_checks.yml`
- `cd ansible && ANSIBLE_LOCAL_TEMP=/tmp/ansible-local ANSIBLE_ROLES_PATH=roles uv run ansible-playbook -i inventories/production/hosts.yml playbooks/upgrade-k8s.yml --tags pre_checks --limit shanghai-2 -e "ansible_ssh_common_args=''" -e kubernetes_upgrade_version=1.35.6 -e kubernetes_upgrade_package=1.35.6-1.1 -e crio_upgrade_version=1.35.4 -e node_role=control_plane -e is_first_control_plane=false`
