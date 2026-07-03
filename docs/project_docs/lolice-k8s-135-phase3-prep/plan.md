# lolice Kubernetes 1.35 Phase 3 Prep Plan

作成日: 2026-06-21

## Goal

Phase 3 の control plane upgrade 前に、通常の `Apply Ansible` と明示的な `Kubernetes Upgrade` workflow の責務を分離する。

## Changes

- `Kubernetes Upgrade` workflow の version input を必須にする。
- `Kubernetes Upgrade` workflow が `control-plane.yml` から target version を自動抽出しないようにする。
- 通常 apply 用の control plane playbook version を現在の cluster baseline に戻す。
  - Kubernetes: `1.34.0`
  - Kubernetes package: `1.34.0-1.1`
  - CRI-O: node の現在値に合わせる
- Kubernetes apt repository を単一行の canonical file として管理し、混入した `v1.35` repo 行を通常 apply で除去できるようにする。

## Phase 3 Operation

Phase 3 の upgrade は通常 apply では行わない。`Kubernetes Upgrade` workflow を手動実行し、以下の input を明示する。

```text
kubernetes_version=1.35.6
kubernetes_package=1.35.6-1.1
crio_version=1.35.4
dry_run=true
target_node=all
```

dry-run 成功後、同じ version input で `dry_run=false` を実行する。

## Verification

- `actionlint .github/workflows/upgrade-k8s.yml`
- `cd ansible && uv run ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml --syntax-check`
- `cd ansible && uv run ansible-lint playbooks/control-plane.yml roles/kubernetes_components/tasks/kubernetes.yml`
