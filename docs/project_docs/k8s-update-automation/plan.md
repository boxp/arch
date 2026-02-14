# Kubernetes Update Automation Plan

## 概要

lolice Kubernetesクラスターのアップデート作業（現在は手動）を、既存のSSH bastion / Ansible / GitHub Actions (GHA) インフラを活用して段階的に自動化する計画書。

**対象PR例**: [boxp/arch#6349](https://github.com/boxp/arch/pull/6349) — Renovateが生成するKubernetes / CRI-Oバージョン更新PR

---

## 1. 現状分析

### 1.1 クラスタ構成

| Hostname | 機種 | Role | IP | Arch |
|----------|------|------|----|------|
| shanghai-1 | Orange Pi Zero 3 | Control Plane | 192.168.10.102 | ARM64 |
| shanghai-2 | Orange Pi Zero 3 | Control Plane | 192.168.10.103 | ARM64 |
| shanghai-3 | Orange Pi Zero 3 | Control Plane | 192.168.10.104 | ARM64 |
| golyat-1 | GMKtec G3 | Worker | 192.168.10.101 | x86_64 |
| golyat-2 | ThinkPad X1 Yoga | Worker | 192.168.10.105 | x86_64 |
| golyat-3 | GMKTec G3 | Worker | 192.168.10.106 | x86_64 |

- **VIP**: 192.168.10.99 (kube-vip管理)
- **コンテナランタイム**: CRI-O
- **CNI**: Calico
- **ストレージ**: Longhorn
- **GitOps**: ArgoCD

### 1.2 現在の手動アップデート手順

過去4回分のアップデート履歴 (v1.30→v1.31→v1.32→v1.33→v1.34) から抽出した標準手順:

#### Control Plane アップデート

1. `/etc/apt/sources.list.d/kubernetes.list` のバージョン番号を変更
2. `apt update && apt-cache madison kubeadm` で対象バージョン確認
3. kubeadm を unhold → install → hold
4. shanghai-1 で `kubeadm upgrade apply vX.Y.Z` を実行
5. shanghai-2, shanghai-3 で `kubeadm upgrade node` を実行
6. 各ノードで kubelet, kubectl を unhold → install → hold
7. `systemctl daemon-reload && systemctl restart kubelet`
8. 必要に応じて reboot
9. Grafana (grafana.b0xp.io) でメトリクス到達を確認してから次のノードへ

#### Worker Node アップデート

1. `/etc/apt/sources.list.d/kubernetes.list` のバージョン番号を変更
2. kubeadm を unhold → install → hold
3. `kubeadm upgrade node`
4. `kubectl drain <node> --ignore-daemonsets`
5. kubelet, kubectl を unhold → install → hold
6. `systemctl daemon-reload && systemctl restart kubelet`
7. reboot
8. `kubectl uncordon <node>`

### 1.3 既存の自動化インフラ

| コンポーネント | 現状 |
|------------|------|
| **Renovate** | Kubernetes/CRI-Oバージョン更新PRを自動生成。`manual-review-required` ラベル付与 |
| **plan-ansible.yml** | PR作成時に `ansible-playbook --check --diff` をbastion経由で実行 |
| **apply-ansible.yml** | mainマージ時に `max-parallel: 1` でansible-playbookを順次適用 |
| **test-ansible.yml** | ansible-lint + Molecule (ARM64 QEMU) でのロールテスト |
| **SSH Bastion** | Cloudflare Tunnel → bastion Pod (sshd:2222) → ノードの3段構成。GitHub Actions用Service Tokenあり |
| **kubernetes_components ロール** | パッケージインストールと設定の自動化済み。ただしkubeadm upgrade/drain/uncordonは未実装 |

### 1.4 自動化における課題

| 課題 | 影響度 | 説明 |
|------|--------|------|
| **kubeadm upgrade未自動化** | 高 | 現在のAnsibleロールはインストールのみ。upgradeプロセスが未実装 |
| **drain/uncordon未自動化** | 高 | ワークロード退避と復帰が手動。Control Planeノードでもワークロード退避が必要 |
| **ヘルスチェック不在** | 高 | 各ノードアップデート後の正常性確認が目視 (Grafana) |
| **ロールバック手順なし** | 高 | 失敗時のetcdスナップショット復元を含む復旧手順が未自動化 |
| **Worker Node未管理** | 中 | archリポジトリのAnsibleはControl Planeのみ。Worker (golyat-*) は管理外 |
| **CRI-Oアップデート** | 中 | aptリポジトリ設定変更とCRI-O再起動が必要 |
| **mixed architecture** | 低 | ARM64 (CP) と x86_64 (Worker) の混在。パッケージ互換性は実績あり |

---

## 2. 自動化アーキテクチャ

### 2.1 全体方針

**段階的アプローチ**: 一気に完全自動化するのではなく、Phase 1〜3 に分けて安全に進行する。

```
Phase 1: Ansible ロール拡張 (Control Plane の kubeadm upgrade + drain/uncordon + etcd snapshot)
         ※対象: 既存 inventory の control_plane グループのみ (shanghai-{1,2,3})
Phase 2: GHA ワークフロー統合 (Renovate PR → 自動テスト → 手動マージ → 自動適用)
         ※対象: Control Plane のみ。Worker は手動のまま
Phase 3: Worker Node 管理の追加 + inventory 拡張 + 完全自動化オプション
         ※対象: golyat-{1,2,3} を inventory に追加し、Worker も自動化
```

**重要**: Phase 1〜2 では既存の inventory (control_plane グループのみ) を前提とする。Worker Node の自動化は Phase 3 で inventory 拡張とともに実施する。

### 2.2 システム構成図

```
┌─────────────────────────────────────────────────────────┐
│ GitHub                                                   │
│                                                          │
│  Renovate PR ─────→ plan-ansible.yml (--check --diff)   │
│       │                     │                            │
│       │              ansible-playbook                    │
│  Manual Merge               │                            │
│       │                     ▼                            │
│       └──────→ upgrade-k8s.yml (NEW)                    │
│                     │                                    │
│           ┌─────────┴─────────┐                          │
│           ▼                   ▼                          │
│   pre-upgrade checks    sequential upgrade               │
│   (etcd snapshot,       Phase 1-2: CP1 → CP2 → CP3     │
│    health, versions)    Phase 3:   + W1 → W2 → W3      │
│                               │                          │
│                          post-upgrade                    │
│                          health check                    │
└──────────────┬───────────────────────────────────────────┘
               │ SSH via Cloudflare Tunnel
               ▼
┌──────────────────────────────────────────────────────────┐
│ Cloudflare Zero Trust                                    │
│  bastion.b0xp.io → Tunnel → bastion Pod (sshd:2222)    │
└──────────────┬───────────────────────────────────────────┘
               │ ProxyJump
               ▼
┌──────────────────────────────────────────────────────────┐
│ lolice Kubernetes Cluster                                │
│  shanghai-{1,2,3}  (Control Plane, ARM64)               │
│  golyat-{1,2,3}    (Worker, x86_64) [Phase 3で追加]    │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Phase 1: Ansible ロール拡張

### 3.1 新規ロール: `kubernetes_upgrade`

既存の `kubernetes_components` ロールを拡張せず、**アップグレード専用の新ロール** `kubernetes_upgrade` を作成する。理由: 初回インストールとアップグレードは根本的にタスクが異なり、分離したほうが保守しやすい。

#### ディレクトリ構成

```
ansible/roles/kubernetes_upgrade/
├── defaults/main.yml
├── tasks/
│   ├── main.yml
│   ├── pre_checks.yml
│   ├── etcd_snapshot.yml
│   ├── upgrade_apt_source.yml
│   ├── upgrade_control_plane_first.yml
│   ├── upgrade_control_plane_secondary.yml
│   ├── upgrade_worker.yml
│   ├── upgrade_kubelet_kubectl.yml
│   ├── health_check.yml
│   └── rollback.yml
├── handlers/main.yml
├── templates/
│   └── kubernetes.list.j2
├── molecule/
│   └── default/
│       ├── molecule.yml
│       ├── converge.yml
│       ├── prepare.yml
│       └── verify.yml
└── meta/main.yml
```

#### 変数定義 (`defaults/main.yml`)

```yaml
# Target versions
kubernetes_upgrade_version: ""       # e.g., "1.35.1"
kubernetes_upgrade_package: ""       # e.g., "1.35.1-1.1"
crio_upgrade_version: ""             # e.g., "1.35.0"

# Previous versions (for rollback reference — actual rollback uses etcd snapshot)
kubernetes_previous_version: ""      # e.g., "1.34"
kubernetes_previous_package: ""      # e.g., "1.34.0-1.1"
crio_previous_version: ""

# Upgrade behavior
upgrade_drain_timeout: 300           # seconds
upgrade_health_check_retries: 30
upgrade_health_check_delay: 10       # seconds

# etcd snapshot
etcd_snapshot_dir: /var/lib/etcd-snapshots
etcd_cacert: /etc/kubernetes/pki/etcd/ca.crt
etcd_cert: /etc/kubernetes/pki/etcd/healthcheck-client.crt
etcd_key: /etc/kubernetes/pki/etcd/healthcheck-client.key

# Role detection
node_role: "control_plane"           # "control_plane" or "worker"
is_first_control_plane: false        # true for shanghai-1
```

#### タグ設計

全タスクにAnsibleタグを付与し、GHAワークフローから `--tags` で部分実行可能にする:

| タグ名 | 対象タスク | 用途 |
|--------|-----------|------|
| `pre_checks` | pre_checks.yml, etcd_snapshot.yml | アップグレード前の検証のみ実行 |
| `etcd_snapshot` | etcd_snapshot.yml | etcdスナップショット取得のみ |
| `upgrade` | upgrade_*.yml, upgrade_kubelet_kubectl.yml | アップグレード本体 |
| `health_check` | health_check.yml | アップグレード後のヘルスチェックのみ実行 |
| `rollback` | rollback.yml | ロールバックのみ実行 |

#### 主要タスク

**main.yml** — タグ付きエントリポイント:
```yaml
- name: Run pre-upgrade checks
  include_tasks:
    file: pre_checks.yml
    apply:
      tags: [pre_checks]
  tags: [pre_checks, upgrade]

- name: Take etcd snapshot before upgrade
  include_tasks:
    file: etcd_snapshot.yml
    apply:
      tags: [etcd_snapshot, pre_checks]
  tags: [etcd_snapshot, pre_checks, upgrade]
  when: node_role == "control_plane" and is_first_control_plane

- name: Upgrade first control plane
  include_tasks:
    file: upgrade_control_plane_first.yml
    apply:
      tags: [upgrade]
  tags: [upgrade]
  when: node_role == "control_plane" and is_first_control_plane

- name: Upgrade secondary control plane
  include_tasks:
    file: upgrade_control_plane_secondary.yml
    apply:
      tags: [upgrade]
  tags: [upgrade]
  when: node_role == "control_plane" and not is_first_control_plane

- name: Upgrade worker node
  include_tasks:
    file: upgrade_worker.yml
    apply:
      tags: [upgrade]
  tags: [upgrade]
  when: node_role == "worker"

- name: Run post-upgrade health check
  include_tasks:
    file: health_check.yml
    apply:
      tags: [health_check]
  tags: [health_check, upgrade]
```

**pre_checks.yml** — アップグレード前の検証:
```yaml
- name: Verify current kubernetes version
  command: kubelet --version
  register: current_kubelet_version
  changed_when: false
  tags: [pre_checks]

- name: Verify etcd cluster health
  command: >
    etcdctl endpoint health
    --cacert={{ etcd_cacert }}
    --cert={{ etcd_cert }}
    --key={{ etcd_key }}
  register: etcd_health
  changed_when: false
  when: node_role == "control_plane"
  become: true
  tags: [pre_checks]

- name: Verify all nodes are Ready
  command: kubectl get nodes --no-headers
  register: node_status
  changed_when: false
  failed_when: "'NotReady' in node_status.stdout"
  delegate_to: "{{ groups['control_plane'][0] }}"
  run_once: true
  become: true
  tags: [pre_checks]
```

**etcd_snapshot.yml** — etcdスナップショット取得（アップグレード前の必須ゲート）:
```yaml
- name: Create etcd snapshot directory
  file:
    path: "{{ etcd_snapshot_dir }}"
    state: directory
    mode: '0700'
  become: true
  tags: [etcd_snapshot, pre_checks]

- name: Take etcd snapshot before upgrade
  command: >
    etcdctl snapshot save
    {{ etcd_snapshot_dir }}/pre-upgrade-{{ ansible_date_time.iso8601_basic_short }}.db
    --cacert={{ etcd_cacert }}
    --cert={{ etcd_cert }}
    --key={{ etcd_key }}
  become: true
  register: etcd_snapshot_result
  failed_when: etcd_snapshot_result.rc != 0
  tags: [etcd_snapshot, pre_checks]

- name: Verify etcd snapshot integrity
  command: >
    etcdctl snapshot status
    {{ etcd_snapshot_dir }}/pre-upgrade-{{ ansible_date_time.iso8601_basic_short }}.db
    --write-out=table
  become: true
  changed_when: false
  tags: [etcd_snapshot, pre_checks]
```

**upgrade_control_plane_first.yml** — 最初のControl Planeアップグレード:
```yaml
- name: Drain control plane node
  command: >
    kubectl drain {{ inventory_hostname }}
    --ignore-daemonsets --delete-emptydir-data
    --timeout={{ upgrade_drain_timeout }}s
  become: true
  tags: [upgrade]

- name: Update apt source for kubernetes
  template:
    src: kubernetes.list.j2
    dest: /etc/apt/sources.list.d/kubernetes.list
  become: true
  tags: [upgrade]

- name: Update apt cache
  apt:
    update_cache: true
  become: true
  tags: [upgrade]

- name: Unhold kubeadm
  dpkg_selections:
    name: kubeadm
    selection: install
  become: true
  tags: [upgrade]

- name: Install target kubeadm version
  apt:
    name: "kubeadm={{ kubernetes_upgrade_package }}"
    state: present
    allow_downgrade: false
  become: true
  tags: [upgrade]

- name: Hold kubeadm
  dpkg_selections:
    name: kubeadm
    selection: hold
  become: true
  tags: [upgrade]

- name: Run kubeadm upgrade apply
  command: "kubeadm upgrade apply v{{ kubernetes_upgrade_version }} --yes"
  become: true
  register: upgrade_result
  tags: [upgrade]

- name: Upgrade kubelet and kubectl
  include_tasks: upgrade_kubelet_kubectl.yml
  tags: [upgrade]

- name: Restart kubelet
  systemd:
    name: kubelet
    state: restarted
    daemon_reload: true
  become: true
  tags: [upgrade]

- name: Uncordon control plane node
  command: "kubectl uncordon {{ inventory_hostname }}"
  become: true
  tags: [upgrade]

- name: Wait for node to become Ready
  include_tasks: health_check.yml
  tags: [upgrade]
```

**upgrade_control_plane_secondary.yml** — 2台目以降のControl Planeアップグレード:
```yaml
- name: Drain control plane node
  command: >
    kubectl drain {{ inventory_hostname }}
    --ignore-daemonsets --delete-emptydir-data
    --timeout={{ upgrade_drain_timeout }}s
  delegate_to: "{{ groups['control_plane'][0] }}"
  become: true
  tags: [upgrade]

- name: Update apt source and install packages
  include_tasks: upgrade_apt_source.yml
  tags: [upgrade]

- name: Run kubeadm upgrade node
  command: kubeadm upgrade node
  become: true
  tags: [upgrade]

- name: Upgrade kubelet and kubectl
  include_tasks: upgrade_kubelet_kubectl.yml
  tags: [upgrade]

- name: Restart kubelet
  systemd:
    name: kubelet
    state: restarted
    daemon_reload: true
  become: true
  tags: [upgrade]

- name: Uncordon control plane node
  command: "kubectl uncordon {{ inventory_hostname }}"
  delegate_to: "{{ groups['control_plane'][0] }}"
  become: true
  tags: [upgrade]

- name: Verify node health
  include_tasks: health_check.yml
  tags: [upgrade]
```

**upgrade_worker.yml** — Worker Nodeアップグレード (Phase 3で使用):
```yaml
- name: Drain worker node
  command: >
    kubectl drain {{ inventory_hostname }}
    --ignore-daemonsets --delete-emptydir-data
    --timeout={{ upgrade_drain_timeout }}s
  delegate_to: "{{ groups['control_plane'][0] }}"
  become: true
  tags: [upgrade]

- name: Update apt source and install packages
  include_tasks: upgrade_apt_source.yml
  tags: [upgrade]

- name: Run kubeadm upgrade node
  command: kubeadm upgrade node
  become: true
  tags: [upgrade]

- name: Upgrade kubelet and kubectl
  include_tasks: upgrade_kubelet_kubectl.yml
  tags: [upgrade]

- name: Restart kubelet
  systemd:
    name: kubelet
    state: restarted
    daemon_reload: true
  become: true
  tags: [upgrade]

- name: Reboot worker node
  reboot:
    reboot_timeout: 300
  become: true
  tags: [upgrade]

- name: Uncordon worker node
  command: "kubectl uncordon {{ inventory_hostname }}"
  delegate_to: "{{ groups['control_plane'][0] }}"
  become: true
  tags: [upgrade]

- name: Verify node health
  include_tasks: health_check.yml
  tags: [upgrade]
```

**health_check.yml** — ノードヘルスチェック:
```yaml
- name: Wait for node to be Ready
  command: >
    kubectl get node {{ inventory_hostname }}
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
  register: node_ready
  until: node_ready.stdout == "True"
  retries: "{{ upgrade_health_check_retries }}"
  delay: "{{ upgrade_health_check_delay }}"
  delegate_to: "{{ groups['control_plane'][0] }}"
  changed_when: false
  become: true
  tags: [health_check]

- name: Verify kubelet version on node
  command: >
    kubectl get node {{ inventory_hostname }}
    -o jsonpath='{.status.nodeInfo.kubeletVersion}'
  register: node_kubelet_version
  delegate_to: "{{ groups['control_plane'][0] }}"
  changed_when: false
  failed_when: "kubernetes_upgrade_version not in node_kubelet_version.stdout"
  become: true
  tags: [health_check]

- name: Verify node conditions (no pressure)
  command: >
    kubectl get node {{ inventory_hostname }}
    -o jsonpath='{range .status.conditions[*]}{.type}={.status}{"\n"}{end}'
  register: node_conditions
  delegate_to: "{{ groups['control_plane'][0] }}"
  changed_when: false
  failed_when: >
    'MemoryPressure=True' in node_conditions.stdout or
    'DiskPressure=True' in node_conditions.stdout or
    'PIDPressure=True' in node_conditions.stdout
  become: true
  tags: [health_check]

- name: Verify etcd cluster health (control plane only)
  command: >
    etcdctl endpoint health
    --cacert={{ etcd_cacert }}
    --cert={{ etcd_cert }}
    --key={{ etcd_key }}
  changed_when: false
  become: true
  when: node_role == "control_plane"
  tags: [health_check]
```

### 3.2 新規Playbook: `upgrade-k8s.yml`

Phase 1〜2 では Control Plane のみが対象。Worker Node の play は Phase 3 で有効化する。

```yaml
---
# Kubernetes Cluster Upgrade Playbook
# Usage: ansible-playbook playbooks/upgrade-k8s.yml \
#          -e kubernetes_upgrade_version=1.35.1 \
#          -e kubernetes_upgrade_package=1.35.1-1.1 \
#          -e crio_upgrade_version=1.35.0

# Phase 1: Pre-upgrade cluster-wide checks + etcd snapshot
- name: Pre-upgrade validation and etcd snapshot
  hosts: control_plane[0]
  gather_facts: true
  tags: [pre_checks]
  tasks:
    - name: Verify cluster health
      include_role:
        name: kubernetes_upgrade
        tasks_from: pre_checks.yml
      tags: [pre_checks]
    - name: Take etcd snapshot
      include_role:
        name: kubernetes_upgrade
        tasks_from: etcd_snapshot.yml
      tags: [pre_checks, etcd_snapshot]

# Phase 2: Upgrade first control plane
- name: Upgrade first control plane (shanghai-1)
  hosts: control_plane[0]
  serial: 1
  gather_facts: true
  tags: [upgrade]
  roles:
    - role: kubernetes_upgrade
      vars:
        node_role: control_plane
        is_first_control_plane: true

# Phase 3: Upgrade remaining control planes
- name: Upgrade secondary control planes
  hosts: "control_plane[1:]"
  serial: 1
  gather_facts: true
  tags: [upgrade]
  roles:
    - role: kubernetes_upgrade
      vars:
        node_role: control_plane
        is_first_control_plane: false

# Phase 4: Upgrade worker nodes (Phase 3 で有効化。inventory に workers グループ追加が前提)
# - name: Upgrade worker nodes
#   hosts: workers
#   serial: 1
#   gather_facts: true
#   tags: [upgrade]
#   roles:
#     - role: kubernetes_upgrade
#       vars:
#         node_role: worker

# Phase 5: Post-upgrade cluster-wide health check
- name: Post-upgrade cluster health check
  hosts: control_plane
  gather_facts: false
  tags: [health_check]
  tasks:
    - name: Verify all nodes health
      include_role:
        name: kubernetes_upgrade
        tasks_from: health_check.yml
      tags: [health_check]
```

### 3.3 CRI-O アップグレード対応

CRI-Oのアップグレードは `upgrade_apt_source.yml` 内で処理する:

```yaml
- name: Update CRI-O apt repository version
  replace:
    path: /etc/apt/sources.list.d/cri-o.list
    regexp: 'cri-o/v[0-9]+\.[0-9]+/'
    replace: "cri-o/v{{ crio_upgrade_version | regex_replace('\\.[0-9]+$', '') }}/"
  become: true
  when: crio_upgrade_version is defined and crio_upgrade_version != ""
  tags: [upgrade]

- name: Upgrade CRI-O
  apt:
    name: "cri-o={{ crio_upgrade_version }}*"
    state: present
    update_cache: true
  become: true
  when: crio_upgrade_version is defined and crio_upgrade_version != ""
  notify: restart crio
  tags: [upgrade]
```

handlers/main.yml:
```yaml
- name: restart crio
  systemd:
    name: crio
    state: restarted
    daemon_reload: true
  become: true
```

---

## 4. Phase 2: GitHub Actions ワークフロー統合

### 4.1 新規ワークフロー: `upgrade-k8s.yml`

```yaml
name: Kubernetes Upgrade

on:
  # 手動実行のみ（誤実行防止のため push トリガーは使用しない）
  # Renovate PRマージ後は apply-ansible.yml がパッケージ設定を適用し、
  # その後 workflow_dispatch で本ワークフローを手動起動する運用とする。
  # 将来的にバージョン変更のみを検知する仕組みが整えば push トリガーの導入を検討する。
  workflow_dispatch:
    inputs:
      kubernetes_version:
        description: 'Target Kubernetes version (e.g., 1.35.1). 省略時は playbook から自動抽出'
        required: false
      kubernetes_package:
        description: 'Target package version (e.g., 1.35.1-1.1). 省略時は playbook から自動抽出'
        required: false
      crio_version:
        description: 'Target CRI-O version (e.g., 1.35.0). 省略時は playbook から自動抽出'
        required: false
      dry_run:
        description: 'Dry run mode (--check)'
        type: boolean
        default: true
```

#### ワークフロー ジョブ構成

```yaml
jobs:
  # バージョン抽出ジョブ（workflow_dispatch の inputs がない場合に playbook から抽出）
  extract-versions:
    name: Extract Versions from Playbook
    runs-on: ubuntu-latest
    outputs:
      k8s_version: ${{ steps.versions.outputs.k8s_version }}
      k8s_package: ${{ steps.versions.outputs.k8s_package }}
      crio_version: ${{ steps.versions.outputs.crio_version }}
    steps:
      - uses: actions/checkout@v4
      - name: Extract versions from playbook
        id: versions
        run: |
          K8S_VER=$(grep -m1 'kubernetes_version:' ansible/playbooks/control-plane.yml \
            | awk -F'"' '{print $2}')
          K8S_PKG=$(grep -m1 'kubernetes_package_version:' ansible/playbooks/control-plane.yml \
            | awk -F'"' '{print $2}')
          CRIO_VER=$(grep -m1 'crio_version:' ansible/playbooks/control-plane.yml \
            | awk -F'"' '{print $2}')
          echo "k8s_version=$K8S_VER" >> "$GITHUB_OUTPUT"
          echo "k8s_package=$K8S_PKG" >> "$GITHUB_OUTPUT"
          echo "crio_version=$CRIO_VER" >> "$GITHUB_OUTPUT"

  pre-check:
    name: Pre-upgrade Validation
    needs: extract-versions
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      id-token: write
      contents: read
    env:
      K8S_VERSION: ${{ inputs.kubernetes_version || needs.extract-versions.outputs.k8s_version }}
      K8S_PACKAGE: ${{ inputs.kubernetes_package || needs.extract-versions.outputs.k8s_package }}
      CRIO_VERSION: ${{ inputs.crio_version || needs.extract-versions.outputs.crio_version }}
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<ACCOUNT_ID>:role/GitHubActions_Ansible_Apply
      - name: Setup SSH and bastion
        # 既存のapply-ansible.ymlと同じSSH設定を再利用
        run: |
          # Cloudflare Access credentials from SSM
          CF_CLIENT_ID=$(aws ssm get-parameter --name bastion-cf-access-client-id --with-decryption --query 'Parameter.Value' --output text)
          CF_CLIENT_SECRET=$(aws ssm get-parameter --name bastion-cf-access-client-secret --with-decryption --query 'Parameter.Value' --output text)
          # SSH key setup
          mkdir -p ~/.ssh
          echo "${{ secrets.ANSIBLE_SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          # bastion ProxyCommand configuration
          # (省略: apply-ansible.yml の SSH設定と同一)
      - name: Run pre-upgrade checks
        run: |
          cd ansible
          ansible-playbook playbooks/upgrade-k8s.yml \
            --tags pre_checks \
            -e kubernetes_upgrade_version="${K8S_VERSION}" \
            -e kubernetes_upgrade_package="${K8S_PACKAGE}" \
            -e crio_upgrade_version="${CRIO_VERSION}"

  # Control Plane を1台ずつ順次アップグレード
  # matrix + max-parallel:1 ではなく、個別ジョブで厳密な順序を保証
  upgrade-cp-1:
    name: Upgrade shanghai-1 (first CP)
    needs: [extract-versions, pre-check]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      id-token: write
      contents: read
    env:
      K8S_VERSION: ${{ inputs.kubernetes_version || needs.extract-versions.outputs.k8s_version }}
      K8S_PACKAGE: ${{ inputs.kubernetes_package || needs.extract-versions.outputs.k8s_package }}
      CRIO_VERSION: ${{ inputs.crio_version || needs.extract-versions.outputs.crio_version }}
    steps:
      - uses: actions/checkout@v4
      - name: Setup SSH and bastion
        run: |
          # (apply-ansible.ymlと同じSSH設定)
      - name: Upgrade shanghai-1
        run: |
          cd ansible
          ansible-playbook playbooks/upgrade-k8s.yml \
            --tags upgrade \
            --limit shanghai-1 \
            -e kubernetes_upgrade_version="${K8S_VERSION}" \
            -e kubernetes_upgrade_package="${K8S_PACKAGE}" \
            -e crio_upgrade_version="${CRIO_VERSION}" \
            -e node_role=control_plane \
            -e is_first_control_plane=true \
            ${{ inputs.dry_run == true && '--check' || '' }}

  upgrade-cp-2:
    name: Upgrade shanghai-2
    needs: [extract-versions, upgrade-cp-1]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      id-token: write
      contents: read
    env:
      K8S_VERSION: ${{ inputs.kubernetes_version || needs.extract-versions.outputs.k8s_version }}
      K8S_PACKAGE: ${{ inputs.kubernetes_package || needs.extract-versions.outputs.k8s_package }}
      CRIO_VERSION: ${{ inputs.crio_version || needs.extract-versions.outputs.crio_version }}
    steps:
      - uses: actions/checkout@v4
      - name: Setup SSH and bastion
        run: |
          # (apply-ansible.ymlと同じSSH設定)
      - name: Upgrade shanghai-2
        run: |
          cd ansible
          ansible-playbook playbooks/upgrade-k8s.yml \
            --tags upgrade \
            --limit shanghai-2 \
            -e kubernetes_upgrade_version="${K8S_VERSION}" \
            -e kubernetes_upgrade_package="${K8S_PACKAGE}" \
            -e crio_upgrade_version="${CRIO_VERSION}" \
            -e node_role=control_plane \
            -e is_first_control_plane=false \
            ${{ inputs.dry_run == true && '--check' || '' }}

  upgrade-cp-3:
    name: Upgrade shanghai-3
    needs: [extract-versions, upgrade-cp-2]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      id-token: write
      contents: read
    env:
      K8S_VERSION: ${{ inputs.kubernetes_version || needs.extract-versions.outputs.k8s_version }}
      K8S_PACKAGE: ${{ inputs.kubernetes_package || needs.extract-versions.outputs.k8s_package }}
      CRIO_VERSION: ${{ inputs.crio_version || needs.extract-versions.outputs.crio_version }}
    steps:
      - uses: actions/checkout@v4
      - name: Setup SSH and bastion
        run: |
          # (apply-ansible.ymlと同じSSH設定)
      - name: Upgrade shanghai-3
        run: |
          cd ansible
          ansible-playbook playbooks/upgrade-k8s.yml \
            --tags upgrade \
            --limit shanghai-3 \
            -e kubernetes_upgrade_version="${K8S_VERSION}" \
            -e kubernetes_upgrade_package="${K8S_PACKAGE}" \
            -e crio_upgrade_version="${CRIO_VERSION}" \
            -e node_role=control_plane \
            -e is_first_control_plane=false \
            ${{ inputs.dry_run == true && '--check' || '' }}

  post-check:
    name: Post-upgrade Validation
    needs: [extract-versions, upgrade-cp-3]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      id-token: write
      contents: read
    env:
      K8S_VERSION: ${{ inputs.kubernetes_version || needs.extract-versions.outputs.k8s_version }}
    steps:
      - uses: actions/checkout@v4
      - name: Setup SSH and bastion
        run: |
          # (apply-ansible.ymlと同じSSH設定)
      - name: Verify cluster health
        run: |
          cd ansible
          ansible-playbook playbooks/upgrade-k8s.yml \
            --tags health_check \
            -e kubernetes_upgrade_version="${K8S_VERSION}"
```

### 4.2 Renovate PR との連携フロー

```
1. Renovate が ansible/playbooks/*.yml のバージョンを更新するPRを作成
2. plan-ansible.yml が --check --diff を実行 → PR にコメント投稿
3. 人間がPR内容を確認し、手動でマージ
4. 既存の apply-ansible.yml が playbook を適用（パッケージインストール設定を反映）
5. 人間が workflow_dispatch で upgrade-k8s.yml を手動起動
6. extract-versions ジョブが playbook 内のバージョンを自動抽出
7. upgrade-k8s.yml が pre-check → CP1 → CP2 → CP3 → post-check の順に実行
```

**apply-ansible.yml との責務分離**:
- `apply-ansible.yml`: パッケージバージョン変数の設定、kubelet 設定などの宣言的状態を適用
- `upgrade-k8s.yml`: kubeadm upgrade、drain/uncordon などの手続き的オペレーションを実行

両ワークフローは責務が明確に分かれており、`upgrade-k8s.yml` は workflow_dispatch のみで起動するため同時発火のリスクはない。

### 4.3 ノードアップグレード順序の保証と再開

**厳密な順序保証**: matrix + max-parallel:1 ではなく、個別ジョブの `needs` チェーンで CP1→CP2→CP3 の順序を保証する。これにより:

- 各ノードのアップグレード結果が明確に分離される
- 失敗時にどのノードで停止したかが明確になる

**途中失敗からの再開**: ノードN で失敗した場合:

1. GHA のログで失敗ノードと失敗タスクを特定
2. `workflow_dispatch` で再度手動実行 (dry_run: false) を起動
3. 再実行時は全ジョブが最初から実行される。既にアップグレード済みのノードでは `kubeadm upgrade apply/node` が冪等に動作し「既に最新バージョンです」で成功するため、重複実行による副作用はない
4. 特定ノードのみ再実行が必要な場合は、GHA を経由せず Ansible を直接実行する: `ansible-playbook playbooks/upgrade-k8s.yml --limit <node> --tags upgrade -e ...`

### 4.4 通知

GHA ワークフロー完了時の通知:

- **成功時**: GitHub Actions のサマリーに結果を記録
- **失敗時**: GitHub Actions のサマリー + アップグレードが中断されたノードを明示

---

## 5. SSH Bastion の利用方法

### 5.1 既存の接続パス

```
GitHub Actions Runner
  │
  │ cloudflared access ssh --hostname bastion.b0xp.io
  │   --header "CF-Access-Client-Id: <from SSM>"
  │   --header "CF-Access-Client-Secret: <from SSM>"
  │
  ▼
Cloudflare Zero Trust Tunnel
  │
  ▼
bastion Pod (Kubernetes内, panubo/sshd:2222)
  │ user: ansible
  │ authorized_keys: github.com/boxp.keys
  │
  ▼ (ProxyJump)
  │
Target Node (shanghai-*, golyat-*)
  │ user: boxp
  │ authorized_keys: github.com/boxp.keys
```

### 5.2 アップグレード用の追加要件

1. **kubectl アクセスの経路**: drain/uncordon は Control Plane ノード上で実行する (`delegate_to` で移譲)。bastion Pod から直接 kubectl を実行する必要はない。

2. **接続タイムアウト設定**: kubeadm upgrade は処理に時間がかかるため、SSH接続のタイムアウトを十分に確保する:
   ```ini
   # ansible.cfg
   [defaults]
   timeout = 600

   [ssh_connection]
   ssh_args = -o ServerAliveInterval=30 -o ServerAliveCountMax=20
   ```

3. **Worker Node (golyat-*) へのSSH (Phase 3)**: 現在のinventoryにはControl Planeのみ登録されている。Phase 3 で Worker Node を追加する際、同様の bastion 経由アクセスパターンを適用する。inventory への追加例:
   ```yaml
   workers:
     hosts:
       golyat-1:
         ansible_host: 192.168.10.101
         node_ip: 192.168.10.101
       golyat-2:
         ansible_host: 192.168.10.105
         node_ip: 192.168.10.105
       golyat-3:
         ansible_host: 192.168.10.106
         node_ip: 192.168.10.106
     vars:
       ansible_user: boxp
       ansible_ssh_common_args: '-o ProxyCommand="cloudflared access ssh --hostname %h"'
       ansible_python_interpreter: /usr/bin/python3
   ```

---

## 6. ロールバック戦略

### 6.1 ロールバックの基本方針

kubeadm にはネイティブなロールバック機能がない。**パッケージの単純ダウングレードでは Control Plane の状態整合性を保証できないため、etcd スナップショット復元を中核としたロールバック戦略を採用する。**

### 6.2 etcd スナップショットによるロールバック

#### 前提条件

- アップグレード前に `etcd_snapshot.yml` で必ずスナップショットを取得済みであること（必須ゲート）
- etcd スナップショットは最初の Control Plane (shanghai-1) の `/var/lib/etcd-snapshots/` に保存

#### ロールバック手順 (Ansible タスク)

```yaml
# rollback.yml — etcd snapshot 復元によるクラスタ復旧
# 注意: この手順は手動介入を前提とする。自動実行は Phase 3 以降で検討。

- name: Stop kubelet on all control plane nodes
  systemd:
    name: kubelet
    state: stopped
  become: true
  tags: [rollback]

- name: Restore etcd from snapshot (first control plane only)
  command: >
    etcdctl snapshot restore
    {{ etcd_snapshot_dir }}/pre-upgrade-{{ snapshot_timestamp }}.db
    --data-dir=/var/lib/etcd-restore
    --name={{ inventory_hostname }}
    --initial-cluster={{ etcd_initial_cluster }}
    --initial-advertise-peer-urls=https://{{ node_ip }}:2380
  become: true
  when: is_first_control_plane
  tags: [rollback]

- name: Replace etcd data directory
  shell: |
    mv /var/lib/etcd /var/lib/etcd-backup-{{ ansible_date_time.iso8601_basic_short }}
    mv /var/lib/etcd-restore /var/lib/etcd
  become: true
  when: is_first_control_plane
  tags: [rollback]

- name: Downgrade kubeadm to previous version
  apt:
    name: "kubeadm={{ kubernetes_previous_package }}"
    state: present
    allow_downgrade: true
  become: true
  tags: [rollback]

- name: Downgrade kubelet and kubectl
  apt:
    name:
      - "kubelet={{ kubernetes_previous_package }}"
      - "kubectl={{ kubernetes_previous_package }}"
    state: present
    allow_downgrade: true
  become: true
  tags: [rollback]

- name: Hold packages at previous version
  dpkg_selections:
    name: "{{ item }}"
    selection: hold
  loop: [kubeadm, kubelet, kubectl]
  become: true
  tags: [rollback]

- name: Start kubelet
  systemd:
    name: kubelet
    state: started
    daemon_reload: true
  become: true
  tags: [rollback]
```

### 6.3 ロールバックの判断基準

| 状況 | 対応 |
|------|------|
| `kubeadm upgrade apply` 失敗 | kubelet/kubeadm パッケージのダウングレードのみ（etcd 復元不要。upgrade apply 前の状態が保持されているため） |
| `kubeadm upgrade apply` 成功後に kubelet が Ready にならない | etcd スナップショット復元 + パッケージダウングレード |
| CP1 成功、CP2 で失敗 | CP2 のパッケージダウングレード → CP1 は新バージョンで維持（skew policy 内であれば許容） |
| 複数 CP 障害 | etcd スナップショット復元 + 全 CP のパッケージダウングレード + 手動介入 |

### 6.4 部分失敗への対応

ノードN のアップグレード中に失敗した場合:

1. そのノードの状態を確認し、適切なロールバック手順を選択
2. ロールバック成功: ワークフロー全体を中断し、人間に通知
3. ロールバック失敗: ノードを `cordon` 状態にし、人間に通知。残りのノードのアップグレードは中断

### 6.5 緊急手動復旧

自動ロールバックが失敗した場合の手動復旧ガイド:

1. `ssh bastion` → 対象ノードにログイン
2. etcd スナップショット復元の手動実行（Obsidian Vault の「control planeが一台になってしまった対応まとめ」を参照）
3. `kubeadm reset` → `kubeadm init` / `kubeadm join` で再構築

---

## 7. セキュリティ考慮事項

### 7.1 認証・認可

| 項目 | 現状 | 追加要件 |
|------|------|----------|
| **GitHub Actions → AWS** | OIDC federation (IAM role) | 変更なし |
| **AWS SSM → CF credentials** | SSM Parameter Store | 変更なし |
| **CF → bastion** | Service Token (90日ローテ) | ローテーション自動化を検討 |
| **bastion → nodes** | SSH鍵 (github.com/boxp.keys) | 変更なし |
| **kubectlアクセス** | ノード上のadmin kubeconfig (`/etc/kubernetes/admin.conf`) | 下記「最小権限化」参照 |

### 7.2 Secrets 管理

- **既存の GitHub Secrets**: `ANSIBLE_SSH_PRIVATE_KEY` を継続使用
- **追加不要**: AWS credentials は OIDC、CF credentials は SSM経由で取得済み
- **etcd 証明書**: ノード上の `/etc/kubernetes/pki/etcd/` にあり、Ansible の become (sudo) でアクセス

### 7.3 最小権限の原則

- **GHA ワークフロー**: permissions を `id-token: write` と `contents: read` に限定
- **Ansible become**: 必要なタスクのみに限定 (`become: true` をタスクレベルで指定)
- **bastion Pod**: `AllowTcpForwarding local` 設定を維持
- **kubectl 権限の最小化計画** (Phase 3 で実施):
  - 専用の ServiceAccount + ClusterRole を作成し、以下の権限のみ付与:
    - `nodes`: get, list, patch (cordon/uncordon用)
    - `pods/eviction`: create (drain用)
    - `certificatesigningrequests`: get, list, approve
  - 現状 (Phase 1-2) は admin kubeconfig をそのまま使用（既に sudo 経由のアクセスのみ）

### 7.4 監査ログ

- GHA のワークフロー実行ログが全ステップの監査証跡となる
- Ansible の `-v` オプションで詳細なタスク実行ログを記録
- Cloudflare Access のログで bastion アクセスを追跡可能

---

## 8. テスト計画

### 8.1 Unit テスト (Molecule)

`kubernetes_upgrade` ロールに Molecule テストを追加:

```yaml
# molecule/default/molecule.yml
driver:
  name: docker
platforms:
  - name: control-plane-test
    image: "debian:bookworm"
    command: /lib/systemd/systemd
    privileged: true
    pre_build_image: true
provisioner:
  name: ansible
  env:
    MOLECULE_DOCKER_PLATFORM: linux/arm64
  inventory:
    group_vars:
      all:
        kubernetes_upgrade_version: "1.35.1"
        kubernetes_upgrade_package: "1.35.1-1.1"
        crio_upgrade_version: "1.35.0"
```

テスト内容:
- apt source テンプレートが正しく生成されること
- パッケージの unhold → install → hold 順序が正しいこと
- ヘルスチェックタスクの条件が正しく評価されること
- タグによる部分実行が期待通り動作すること

### 8.2 Integration テスト

GHAワークフローの `dry_run` モード (`--check`) を使用:

1. Renovate PRの `plan-ansible.yml` で `--check --diff` が正常実行されること
2. `workflow_dispatch` の `dry_run: true` で全タスクが `--check` モードで通ること
3. `--tags pre_checks` でプリチェックのみが実行されること

### 8.3 Staging テスト

初回実施前に minor version bump (パッチバージョンの更新) で全フローを検証:

1. Renovate PR が生成される
2. plan ワークフローが正常にコメントを投稿
3. マージ後に workflow_dispatch で upgrade ワークフローを手動起動
4. extract-versions ジョブがバージョンを正しく抽出
5. 各ノードが順次アップグレードされる
6. 全ノードが Ready 状態になる

### 8.4 E2E テスト項目

| テスト | 確認内容 |
|--------|----------|
| etcd スナップショット取得 | snapshot save + status が成功 |
| Control Plane 1台目の drain + upgrade apply | drain → upgrade apply → uncordon が成功 |
| Control Plane 2台目以降の drain + upgrade node | drain → upgrade node → uncordon が成功 |
| ヘルスチェック | ノード Ready、kubelet バージョン一致、Pressure なし、etcd health |
| ロールバック (etcd復元) | 意図的に失敗させた場合に etcd 復元が動作 |
| タグによる部分実行 | `--tags pre_checks` / `--tags health_check` で期待通り動作 |
| 途中中断からの再開 | workflow_dispatch で再実行し、冪等性により安全に全ノード通過すること |
| バージョン自動抽出 | workflow_dispatch で extract-versions が playbook からバージョンを正しく取得 |

---

## 9. 実装ロードマップ

### Phase 1: Ansible ロール拡張 (Control Plane のみ)

- [ ] `kubernetes_upgrade` ロールの実装（タグ設計含む）
- [ ] etcd スナップショット取得タスクの実装
- [ ] Control Plane の drain/uncordon タスクの実装
- [ ] ロールバックタスクの実装（etcd 復元ベース）
- [ ] Molecule テストの作成と通過 (ARM64)
- [ ] `upgrade-k8s.yml` playbook の作成（Worker play はコメントアウト）
- [ ] `ansible-lint` 通過の確認
- [ ] ドキュメント更新 (README, DEPLOYMENT.md)

### Phase 2: GHA ワークフロー統合 (Control Plane のみ)

- [ ] `upgrade-k8s.yml` ワークフロー作成（個別ジョブ方式）
- [ ] extract-versions ジョブの実装と検証
- [ ] Renovate PR との連携テスト (dry-run)
- [ ] パッチバージョン更新での E2E テスト
- [ ] 障害時の通知とワークフロー中断の動作確認

### Phase 3: Worker Node 管理と完全自動化

- [ ] Worker Node (golyat-*) のインベントリ追加
- [ ] Worker Node 用 playbook の有効化
- [ ] Worker Node の Molecule テスト (x86_64)
- [ ] GHA ワークフローに Worker ジョブを追加
- [ ] kubectl 用 ServiceAccount + ClusterRole の作成（最小権限化）
- [ ] `workflow_dispatch` による手動実行オプションの整備
- [ ] 運用手順書の作成

---

## 10. リスク評価

| リスク | 発生確率 | 影響度 | 緩和策 |
|--------|----------|--------|--------|
| kubeadm upgrade 失敗 | 低 | 高 | pre-check + etcd snapshot + ロールバック |
| etcd クラスタ分断 | 低 | 致命的 | 事前 etcd ヘルスチェック + スナップショット(必須ゲート) |
| bastion Pod 障害 | 低 | 高 | アップグレード前に bastion 疎通確認 |
| SSH 接続タイムアウト | 中 | 中 | ServerAliveInterval 設定 |
| Worker Pod 退避失敗 | 中 | 中 | drain timeout + PDB 確認 (Phase 3) |
| CRI-O とK8sの非互換 | 低 | 高 | Renovate の同時更新 + 事前互換性確認 |
| Phase 2 で Worker play を誤実行 | 低 | 中 | Worker play をコメントアウト + inventory に workers 未定義 |

---

## 付録

### A. 参考資料

- [kubeadm upgrade ドキュメント](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/)
- archリポジトリ既存ワークフロー: `.github/workflows/apply-ansible.yml`
- Obsidian Vault 手順書: `operation-manual/adhoc/2025-2026/k8s version update.md` (4件)
- Obsidian Vault 障害対応: `operation-manual/adhoc/control planeが一台になってしまった対応まとめ.md`

### B. 関連コンポーネントの更新

Kubernetes本体のアップデートに伴い、以下のコンポーネントも更新が必要になる場合がある:

- **Calico**: lolice リポジトリの ArgoCD Application で管理
- **kube-vip**: `/etc/kubernetes/manifests/kube-vip.yaml` の static Pod
- **Longhorn**: ArgoCD で管理

これらは本計画のスコープ外とし、別途計画を立てる。
