# lolice Kubernetes 1.35 upgrade Phase 2 plan

作成日: 2026-06-21

## 目的

lolice cluster の Kubernetes 1.35 系アップグレードに進む前に、`boxp/arch` の upgrade automation を安全に使える状態へ戻す。

## 背景

2026-06-21 時点で、cluster は手動収束により Kubernetes v1.34.0 へ揃った。一方、`ansible/playbooks/control-plane.yml` と `node-shanghai-*.yml` では `kubernetes_version: "1.36.1"` / `crio_version: "1.36.0"` と `kubernetes_package_version: "1.34.0-1.1"` が混在していた。

また、`.github/workflows/upgrade-k8s.yml` の pre-check は `--tags pre_checks` で etcd snapshot まで実行しており、dry-run でも cluster に副作用が出る構造だった。

## 方針

1. Orange Pi control-plane 用 Ansible playbook の Kubernetes/CRI-O version を 1.35 系へ揃える。
   - Kubernetes: `1.35.6`
   - Kubernetes package: `1.35.6-1.1`
   - CRI-O: `1.35.4`
2. workflow の version extraction で以下を検査する。
   - `kubernetes_version` / `kubernetes_package_version` / `crio_version` が抽出できる。
   - `kubernetes_package_version` の upstream version が `kubernetes_version` と一致する。
   - `crio_version` の major.minor が `kubernetes_version` と一致する。
3. dry-run の pre-check では health check のみを実行し、etcd snapshot は取得しない。
4. `dry_run=false` の本番実行前だけ、明示的な `etcd_snapshot` step で snapshot を取得し、S3 upload する。
5. check-mode でも health check が実際に状態確認できるよう、状態確認 command に `check_mode: false` を明示する。
6. kube-vip/VIP の一時的な揺れに影響されないよう、upgrade automation の `kubectl` は control-plane node の direct API server endpoint を使う。
7. upgrade 時の apt source は既存ファイルの文字列置換ではなく、target version の単一行へ正規化する。

## 変更対象

- `.github/workflows/upgrade-k8s.yml`
- `ansible/playbooks/control-plane.yml`
- `ansible/playbooks/node-shanghai-1.yml`
- `ansible/playbooks/node-shanghai-2.yml`
- `ansible/playbooks/node-shanghai-3.yml`
- `ansible/playbooks/upgrade-k8s.yml`
- `ansible/roles/kubernetes_upgrade/tasks/main.yml`
- `ansible/roles/kubernetes_upgrade/tasks/pre_checks.yml`
- `ansible/roles/kubernetes_upgrade/tasks/health_check.yml`
- `ansible/roles/kubernetes_upgrade/tasks/etcd_snapshot.yml`
- `ansible/roles/kubernetes_upgrade/tasks/upgrade_apt_source.yml`
- `ansible/roles/kubernetes_upgrade/tasks/upgrade_control_plane_first.yml`
- `ansible/roles/kubernetes_upgrade/tasks/upgrade_control_plane_secondary.yml`
- `ansible/roles/kubernetes_upgrade/tasks/upgrade_kubelet_kubectl.yml`

## 検証

- `actionlint .github/workflows/upgrade-k8s.yml`
- `cd ansible && ANSIBLE_LOCAL_TEMP=/tmp/ansible-local ANSIBLE_ROLES_PATH=roles ansible-playbook -i inventories/production/hosts.yml playbooks/upgrade-k8s.yml --syntax-check`
- `cd ansible && uv run ansible-lint playbooks/upgrade-k8s.yml roles/kubernetes_upgrade/tasks/pre_checks.yml roles/kubernetes_upgrade/tasks/health_check.yml roles/kubernetes_upgrade/tasks/etcd_snapshot.yml`
- `cd ansible && ANSIBLE_LOCAL_TEMP=/tmp/ansible-local ANSIBLE_ROLES_PATH=roles uv run ansible-playbook -i inventories/production/hosts.yml playbooks/upgrade-k8s.yml --tags pre_checks -e "ansible_ssh_common_args=''" -e kubernetes_upgrade_version=1.35.6 -e kubernetes_upgrade_package=1.35.6-1.1 -e crio_upgrade_version=1.35.4`
- `cd ansible && ANSIBLE_LOCAL_TEMP=/tmp/ansible-local ANSIBLE_ROLES_PATH=roles uv run ansible-playbook -i inventories/production/hosts.yml playbooks/upgrade-k8s.yml --tags upgrade --check -e "ansible_ssh_common_args=''" -e kubernetes_upgrade_version=1.35.6 -e kubernetes_upgrade_package=1.35.6-1.1 -e crio_upgrade_version=1.35.4`

## 検証結果

- `actionlint` 成功。
- `ansible-playbook --syntax-check` 成功。
- `ansible-lint` 成功。
- 実 cluster に対する `--tags pre_checks` 成功。snapshot task は実行されないことを確認。
- 実 cluster に対する `--tags upgrade --check` 成功。snapshot task は task list から除外され、package install / kubeadm / restart / uncordon は check-mode で skip される。
- `kubectl get --raw /version` は `v1.34.0` を返す。
- 全 control-plane の apiserver static pod は `v1.34.0`、etcd は `3.6.4-0`。

## 完了条件

- 1.36 系と 1.34 package の混在が解消されている。
- dry-run pre-check が etcd snapshot を取得しない構造になっている。
- 本番実行時の etcd snapshot 取得タイミングが workflow に明示されている。
- workflow/playbook の静的検証が通る。
