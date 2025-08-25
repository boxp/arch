# Worker Node Pipeline 実装設計書

## 概要

本プロジェクトは、lolice KubernetesクラスターのWorker Node（Intel x86_64アーキテクチャ）にAnsible管理とUSBブートイメージ自動生成パイプラインを追加することを目的とします。既存のArm64 Control Plane（Orange Pi Zero 3）パイプラインには一切変更を加えず、完全に分離された独立システムとして実装します。

## 1. 設計方針

### 1.1 アーキテクチャ分離戦略

```
🔴 既存（変更なし）: Control Plane (ARM64)
├── Orange Pi Zero 3 nodes (shanghai-1,2,3) 
├── Armbian build system
└── .github/workflows/build-orange-pi-images.yml

🟢 新規追加: Worker Nodes (x86_64)
├── Intel N100/i5 nodes (golyat-1,2,3)
├── Packer + Ubuntu autoinstall  
└── .github/workflows/build-worker-images.yml (新規)
```

### 1.2 技術スタック選択

**Control Plane (ARM64) - 現状維持**
- **OS**: Armbian (Orange Pi Zero 3特化)
- **Build System**: Armbian build framework
- **Deployment**: USB直書き + 初回起動設定

**Worker Nodes (x86_64) - 新規導入**
- **OS**: Ubuntu Server 24.04 LTS (amd64)
- **Build System**: Packer + QEMU + Ubuntu autoinstall (Subiquity)  
- **Deployment**: USBブート + 自動インストーラー

### 1.3 最小差分原則

既存Ansibleロールは最大限再利用し、アーキテクチャ差分のみ条件分岐で対応：

```yaml
# kubernetes_componentsロール内で分岐
kubernetes_apt_repository: "{{ kubernetes_apt_repository_x86_64 if ansible_architecture == 'x86_64' else kubernetes_apt_repository_arm64 }}"
```

## 2. 対象ノード仕様

| ノード名 | IPアドレス | CPU | アーキテクチャ | 用途 |
|----------|------------|-----|----------------|------|
| golyat-1 | 192.168.10.101 | Intel N100 | x86_64 | Worker Node |
| golyat-2 | 192.168.10.105 | Intel i5 | x86_64 | Worker Node |
| golyat-3 | 192.168.10.106 | Intel N100 | x86_64 | Worker Node |

## 3. 要件定義

### 3.1 機能要件

1. **SSH接続**: GitHub.com/boxp.keysからの公開鍵によるパスワードなし認証
2. **Kubernetes Components**: 
   - kubeadm v1.32
   - kubelet v1.32  
   - cri-o v1.32
3. **ユーザー管理**: boxpユーザーのパスワードなしsudo権限
4. **イメージ生成**: workflow_dispatchでUSBブート可能な.imgファイル生成
5. **S3アップロード**: 生成イメージの自動S3格納
6. **インストール機能**: USBブートから別ディスクへの自動インストール

### 3.2 非機能要件

1. **互換性**: 既存ARM64パイプラインとの完全分離
2. **拡張性**: 新しいWorkerノード追加の容易性
3. **保守性**: 既存Ansibleロールの最大限活用
4. **セキュリティ**: 最小権限によるアクセス制御

## 4. システム設計

### 4.1 新規追加ディレクトリ構造

```
packer/
├── x86_64/
│   ├── base-ubuntu.pkr.hcl        # Ubuntu Server 24.04 base
│   ├── k8s-worker.pkr.hcl         # K8s + Ansible provisioner
│   └── http/
│       ├── user-data              # Ubuntu autoinstall config
│       └── meta-data              # cloud-init metadata

.github/
└── workflows/
    └── build-worker-images.yml   # Worker専用workflow (新規)

ansible/
├── inventories/production/
│   └── hosts.yml                  # workersグループ追加
├── group_vars/
│   └── workers.yml               # Worker固有変数
└── playbooks/
    └── worker.yml                # Worker専用プレイブック
```

### 4.2 Packerテンプレート設計

#### 4.2.1 base-ubuntu.pkr.hcl

```hcl
packer {
  required_plugins {
    qemu = {
      version = ">= 1.0.0" 
      source  = "github.com/hashicorp/qemu"
    }
  }
}

variable "node_name" {
  description = "Target node name (golyat-1, golyat-2, golyat-3)"
  type        = string
}

variable "node_ip" {
  description = "Target node IP address"
  type        = string
}

locals {
  node_ips = {
    "golyat-1" = "192.168.10.101"
    "golyat-2" = "192.168.10.105"  
    "golyat-3" = "192.168.10.106"
  }
}

source "qemu" "ubuntu" {
  iso_url      = "https://releases.ubuntu.com/24.04/ubuntu-24.04-live-server-amd64.iso"
  iso_checksum = "sha256:8762f7e74e4d64d72fceb5f70682e6b069932deedb4949c6975d0f0fe0a91be3"
  
  memory       = 4096
  cores        = 2
  disk_size    = "20G"
  format       = "qcow2"
  
  boot_wait = "5s"
  boot_command = [
    "c<wait>",
    "set gfxpayload=keep<enter>",
    "linux /casper/vmlinuz autoinstall ds=nocloud-net\\;s=http://{{.HTTPIP}}:{{.HTTPPort}}/<enter>",
    "initrd /casper/initrd<enter>",
    "boot<enter>"
  ]
  
  http_directory = "http"
  ssh_username   = "boxp"
  ssh_password   = "boxp"
  ssh_timeout    = "20m"
  
  output_directory = "output-${var.node_name}"
  vm_name         = "golyat-${var.node_name}"
}

build {
  sources = ["source.qemu.ubuntu"]
  
  provisioner "shell" {
    inline = [
      "cloud-init status --wait",
      "sudo apt-get update",
      "sudo apt-get install -y python3 python3-pip",
    ]
  }
  
  provisioner "ansible" {
    playbook_file = "../../ansible/playbooks/worker.yml"
    inventory_file = "../../ansible/inventories/production/hosts.yml"
    
    extra_arguments = [
      "--limit", "workers",
      "--extra-vars", "node_name=${var.node_name} node_ip=${lookup(local.node_ips, var.node_name)}"
    ]
    
    ansible_env_vars = [
      "ANSIBLE_HOST_KEY_CHECKING=False"
    ]
  }
  
  post-processor "compress" {
    output = "golyat-${var.node_name}.img.xz"
    format = "xz"
  }
}
```

#### 4.2.2 Ubuntu autoinstall設定 (http/user-data)

```yaml
#cloud-config
autoinstall:
  version: 1
  
  # ロケール設定
  locale: en_US.UTF-8
  keyboard:
    layout: us
  
  # ネットワーク設定（DHCP, 後でAnsibleで静的IPに変更）
  network:
    network:
      version: 2
      ethernets:
        any:
          match:
            name: "e*"
          dhcp4: true
  
  # ストレージ設定
  storage:
    layout:
      name: direct
    config:
      - type: disk
        id: disk-sda
        match:
          size: largest
      - type: partition
        id: boot-partition
        device: disk-sda
        size: 1G
        flag: boot
      - type: partition  
        id: root-partition
        device: disk-sda
        size: -1
      - type: format
        id: boot-fs
        volume: boot-partition
        fstype: ext4
      - type: format
        id: root-fs
        volume: root-partition
        fstype: ext4
      - type: mount
        id: boot-mount
        device: boot-fs
        path: /boot
      - type: mount
        id: root-mount
        device: root-fs
        path: /
  
  # パッケージ設定  
  packages:
    - openssh-server
    - python3
    - python3-pip
    - curl
    - wget
    - vim
    
  # ユーザー設定
  identity:
    hostname: golyat-template
    username: boxp
    password: "$6$rounds=4096$aQ7lQZbz$1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z"  # boxp
  
  # SSH設定  
  ssh:
    install-server: true
    allow-pw: true  # 初期設定用、Ansibleで無効化
    
  # インストール完了後の処理
  late-commands:
    - "curtin in-target --target=/target -- systemctl enable ssh"
    - "curtin in-target --target=/target -- systemctl disable snapd"
    
  # 自動再起動
  shutdown: reboot
```

### 4.3 Ansible構成拡張

#### 4.3.1 インベントリ更新 (inventories/production/hosts.yml)

```yaml
all:
  children:
    control_plane:
      hosts:
        shanghai-1:
          ansible_host: 192.168.10.102
          node_ip: 192.168.10.102
        shanghai-2:
          ansible_host: 192.168.10.103
          node_ip: 192.168.10.103
        shanghai-3:
          ansible_host: 192.168.10.104
          node_ip: 192.168.10.104
      vars:
        ansible_user: boxp
        ansible_ssh_common_args: '-o ProxyCommand="cloudflared access ssh --hostname %h"'
        ansible_python_interpreter: /usr/bin/python3
        kubernetes_version: "1.32"
        kubernetes_package_version: "1.32.0-1.1"
        crio_version: "1.32"
        cluster_vip: "192.168.10.99"
        cluster_domain: "cluster.local" 
        cluster_dns: "10.96.0.10"
        hardware_type: "orange_pi_zero3"
        architecture: "arm64"
        network_gateway: "192.168.10.1"
        network_dns_servers:
          - "8.8.8.8"
          - "8.8.4.4"
          
    # 新規追加: Worker Nodes
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
        ansible_python_interpreter: /usr/bin/python3
        kubernetes_version: "1.32"
        kubernetes_package_version: "1.32.0-1.1"
        crio_version: "1.32"
        cluster_domain: "cluster.local"
        cluster_dns: "10.96.0.10"
        hardware_type: "intel_x86_64"
        architecture: "x86_64"
        network_gateway: "192.168.10.1"
        network_dns_servers:
          - "8.8.8.8"
          - "8.8.4.4"
```

#### 4.3.2 Worker専用プレイブック (playbooks/worker.yml)

```yaml
---
- name: Configure x86_64 worker nodes  
  hosts: workers
  become: true
  gather_facts: true
  vars_files:
    - ../vars/nodes.yml
  vars:
    node_ip: "{{ node_ips[node_name] | default(ansible_default_ipv4.address) }}"
    cluster_domain: "{{ cluster.domain }}"
    cluster_dns: "{{ cluster.dns }}"

  tasks:
    - name: Check if running in chroot environment
      ansible.builtin.stat:
        path: /proc/1/root
      register: proc_root_stat
      tags: [ssh, bootstrap]

    - name: Detect chroot environment  
      ansible.builtin.set_fact:
        is_chroot: "{{ proc_root_stat.stat.islnk | default(false) }}"
      tags: [ssh, bootstrap]

    - name: Ensure SSH server is configured
      tags: [ssh, bootstrap]
      block:
        - name: Install OpenSSH server
          ansible.builtin.apt:
            name: openssh-server
            state: present
            update_cache: true

        - name: Configure SSH server
          ansible.builtin.lineinfile:
            path: /etc/ssh/sshd_config
            regexp: "{{ item.regexp }}"
            line: "{{ item.line }}"
            validate: 'sshd -t -f %s'
          loop:
            - { regexp: '^#?PermitRootLogin', line: 'PermitRootLogin no' }
            - { regexp: '^#?PasswordAuthentication', line: 'PasswordAuthentication no' }
            - { regexp: '^#?PubkeyAuthentication', line: 'PubkeyAuthentication yes' }
            - { regexp: '^#?ChallengeResponseAuthentication', line: 'ChallengeResponseAuthentication no' }
          notify: Restart SSH service

  handlers:
    - name: Restart SSH service
      ansible.builtin.systemd:
        name: ssh
        state: restarted
      when: not (is_chroot | default(false) | bool)

  roles:
    - role: user_management
      tags: [users, bootstrap]
      vars:
        user_management_use_github_keys: true
        user_management_github_username: "boxp"

    - role: network_configuration
      tags: [network, bootstrap]
      vars:
        network_ip_address: "{{ node_ip }}"
        network_gateway: "{{ network_gateway }}"
        network_dns_servers: "{{ network_dns_servers }}"

    - role: kubernetes_components
      tags: [kubernetes, k8s-components]
      vars:
        kubernetes_version: "{{ kubernetes_version }}"
        kubernetes_package_version: "{{ kubernetes_package_version }}"
        crio_version: "{{ crio_version }}"
        kubelet_cluster_dns: "{{ cluster_dns }}"
        kubelet_cluster_domain: "{{ cluster_domain }}"
        kubelet_node_ip: "{{ node_ip }}"
```

#### 4.3.3 kubernetes_componentsロール拡張

**defaults/main.yml への追加:**

```yaml
# アーキテクチャ別リポジトリURL
kubernetes_apt_repository_x86_64: "https://pkgs.k8s.io/core:/stable:/v{{ kubernetes_version }}/deb/"
kubernetes_apt_repository_arm64: "https://pkgs.k8s.io/core:/stable:/v{{ kubernetes_version }}/deb/"

crio_apt_repository_x86_64: "https://download.opensuse.org/repositories/isv:/cri-o:/stable:/v{{ crio_version }}/deb/"
crio_apt_repository_arm64: "https://download.opensuse.org/repositories/isv:/cri-o:/stable:/v{{ crio_version }}/deb/"

# アーキテクチャに応じた実際のリポジトリURL設定
kubernetes_apt_repository: "{{ kubernetes_apt_repository_x86_64 if ansible_architecture == 'x86_64' else kubernetes_apt_repository_arm64 }}"
crio_apt_repository: "{{ crio_apt_repository_x86_64 if ansible_architecture == 'x86_64' else crio_apt_repository_arm64 }}"
```

### 4.4 GitHub Actions Workflow

#### 4.4.1 Worker Images Build Workflow (.github/workflows/build-worker-images.yml)

```yaml
name: Build Worker Node Images

on:
  workflow_dispatch:
    inputs:
      node_name:
        description: 'Worker node to build'
        required: true
        type: choice
        default: 'all'
        options:
          - all
          - golyat-1
          - golyat-2
          - golyat-3

jobs:
  determine-nodes:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      nodes: ${{ steps.set-nodes.outputs.nodes }}
    steps:
      - name: Determine nodes to build
        id: set-nodes
        run: |
          if [ "${{ github.event.inputs.node_name }}" = "all" ]; then
            echo "nodes=[\"golyat-1\", \"golyat-2\", \"golyat-3\"]" >> "$GITHUB_OUTPUT"
          else
            echo "nodes=[\"${{ github.event.inputs.node_name }}\"]" >> "$GITHUB_OUTPUT"
          fi

  build-images:
    needs: determine-nodes
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    strategy:
      matrix:
        node: ${{ fromJson(needs.determine-nodes.outputs.nodes) }}
      fail-fast: false
      
    steps:
      - name: Checkout repository
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502 # v4.0.2
        with:
          role-to-assume: arn:aws:iam::839695154978:role/GitHubActions_WorkerNode_Build
          aws-region: ap-northeast-1

      - name: Install Packer
        uses: hashicorp/setup-packer@main
        with:
          version: latest

      - name: Install QEMU
        run: |
          sudo apt-get update
          sudo apt-get install -y qemu-system-x86 qemu-utils

      - name: Install Ansible  
        run: |
          python -m pip install --upgrade pip
          pip install ansible

      - name: Validate Packer template
        run: |
          cd packer/x86_64
          packer validate -var "node_name=${{ matrix.node }}" k8s-worker.pkr.hcl

      - name: Build worker image with Packer
        run: |
          cd packer/x86_64  
          packer build -var "node_name=${{ matrix.node }}" k8s-worker.pkr.hcl

      - name: Convert to USB bootable image
        run: |
          cd packer/x86_64
          qemu-img convert -f qcow2 -O raw "output-${{ matrix.node }}/golyat-${{ matrix.node }}" "golyat-${{ matrix.node }}.img"
          
      - name: Compress image
        run: |
          cd packer/x86_64
          xz -9 -T 0 "golyat-${{ matrix.node }}.img"
          
      - name: Generate checksums
        run: |
          cd packer/x86_64
          sha256sum "golyat-${{ matrix.node }}.img.xz" > "golyat-${{ matrix.node }}.img.xz.sha256"

      - name: Upload to S3
        run: |
          cd packer/x86_64
          aws s3 cp "golyat-${{ matrix.node }}.img.xz" \
            "s3://arch-worker-images/images/x86_64/${{ matrix.node }}/" \
            --metadata "build-date=$(date -Iseconds),git-commit=${{ github.sha }}"
          aws s3 cp "golyat-${{ matrix.node }}.img.xz.sha256" \
            "s3://arch-worker-images/images/x86_64/${{ matrix.node }}/"

      - name: Build summary
        run: |
          cd packer/x86_64
          {
            echo "## Build Summary for ${{ matrix.node }}"
            echo "- **Node**: ${{ matrix.node }}"
            echo "- **Architecture**: x86_64"
            echo "- **Image**: golyat-${{ matrix.node }}.img.xz"
            echo "- **Size**: $(du -h "golyat-${{ matrix.node }}.img.xz" | cut -f1)"
            echo "- **Checksum**: $(cut -d' ' -f1 "golyat-${{ matrix.node }}.img.xz.sha256")"
            echo "- **S3 Path**: s3://arch-worker-images/images/x86_64/${{ matrix.node }}/"
            echo "- **Kubernetes Version**: 1.32"
            echo "- **CRI-O Version**: 1.32"
          } >> "$GITHUB_STEP_SUMMARY"
```

### 4.5 AWS IAM Role設定

WorkerノードイメージビルドのためのIAMロール作成が必要です：

```hcl
# terraform/aws/worker-node-images/iam.tf
resource "aws_iam_role" "github_actions_worker_build" {
  name = "GitHubActions_WorkerNode_Build"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::839695154978:oidc-provider/token.actions.githubusercontent.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:sub" = "repo:boxp/arch:ref:refs/heads/main"
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "s3_worker_images_access" {
  name = "S3WorkerImagesAccess"
  role = aws_iam_role.github_actions_worker_build.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::arch-worker-images",
          "arn:aws:s3:::arch-worker-images/*"
        ]
      }
    ]
  })
}

resource "aws_s3_bucket" "worker_images" {
  bucket = "arch-worker-images"
}

resource "aws_s3_bucket_versioning" "worker_images" {
  bucket = aws_s3_bucket.worker_images.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

## 5. USBインストーラー機能設計

### 5.1 インストールフロー

1. **USBブート**: 生成した.imgファイルをUSBメモリに書き込み、対象マシンでブート
2. **ターゲット選択**: 利用可能なディスクを表示し、インストール先を選択
3. **自動インストール**: 選択されたディスクにシステムを展開
4. **初期設定**: ネットワーク設定、SSH、Kubernetesコンポーネントを設定
5. **再起動**: インストール完了後、USBを取り外して本格運用開始

### 5.2 インストーラースクリプト

イメージ内に`/usr/local/bin/install-to-disk.sh`を配置：

```bash
#!/bin/bash
set -euo pipefail

# インストール先選択UI
show_disks() {
    echo "Available disks for installation:"
    lsblk -d -o NAME,SIZE,TYPE,MODEL | grep disk | nl -w2 -s') '
}

select_target_disk() {
    while true; do
        show_disks
        read -p "Select disk number for installation: " selection
        
        disk_name=$(lsblk -d -o NAME | grep -v NAME | sed -n "${selection}p")
        if [ -n "$disk_name" ]; then
            echo "/dev/$disk_name"
            break
        else
            echo "Invalid selection. Please try again."
        fi
    done
}

# メインインストール処理
main() {
    echo "=== Worker Node Installer ==="
    echo "This will install the system to a target disk."
    read -p "Continue? (y/N): " confirm
    
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
    
    TARGET_DISK=$(select_target_disk)
    
    echo "Installing to $TARGET_DISK..."
    echo "WARNING: All data on $TARGET_DISK will be destroyed!"
    read -p "Are you sure? (type 'yes'): " final_confirm
    
    if [ "$final_confirm" != "yes" ]; then
        echo "Installation cancelled."
        exit 0
    fi
    
    # パーティション作成とフォーマット
    parted "$TARGET_DISK" --script mklabel gpt
    parted "$TARGET_DISK" --script mkpart ESP fat32 1MiB 513MiB
    parted "$TARGET_DISK" --script mkpart root ext4 513MiB 100%
    parted "$TARGET_DISK" --script set 1 boot on
    
    # ファイルシステム作成
    mkfs.fat -F32 "${TARGET_DISK}1"
    mkfs.ext4 "${TARGET_DISK}2"
    
    # マウント
    mkdir -p /mnt/target
    mount "${TARGET_DISK}2" /mnt/target
    mkdir -p /mnt/target/boot/efi
    mount "${TARGET_DISK}1" /mnt/target/boot/efi
    
    # システムコピー
    echo "Copying system files..."
    rsync -aHAXxv --exclude={"/dev/*","/proc/*","/sys/*","/tmp/*","/run/*","/mnt/*","/media/*","/lost+found"} / /mnt/target/
    
    # fstab設定
    echo "Configuring fstab..."
    TARGET_ROOT_UUID=$(blkid -s UUID -o value "${TARGET_DISK}2")
    TARGET_BOOT_UUID=$(blkid -s UUID -o value "${TARGET_DISK}1")
    
    cat > /mnt/target/etc/fstab << EOF
UUID=$TARGET_ROOT_UUID / ext4 defaults 0 1
UUID=$TARGET_BOOT_UUID /boot/efi vfat defaults 0 2
EOF
    
    # GRUB設置
    echo "Installing bootloader..."
    mount --bind /dev /mnt/target/dev
    mount --bind /proc /mnt/target/proc
    mount --bind /sys /mnt/target/sys
    
    chroot /mnt/target grub-install --target=x86_64-efi --efi-directory=/boot/efi "$TARGET_DISK"
    chroot /mnt/target update-grub
    
    # クリーンアップ
    umount /mnt/target/dev /mnt/target/proc /mnt/target/sys
    umount /mnt/target/boot/efi
    umount /mnt/target
    
    echo "Installation completed successfully!"
    echo "Please remove the USB drive and reboot."
}

main "$@"
```

## 6. 実装手順

### 6.1 Phase 1: Terraform基盤構築

1. **AWS IAM設定**
   ```bash
   cd terraform/aws/worker-node-images
   terraform init
   terraform plan
   terraform apply
   ```

2. **S3バケット確認**
   ```bash
   aws s3 ls s3://arch-worker-images
   ```

### 6.2 Phase 2: Packer設定作成

1. **ディレクトリ作成**
   ```bash
   mkdir -p packer/x86_64/http
   ```

2. **Packerテンプレート作成**
   - `packer/x86_64/k8s-worker.pkr.hcl`
   - `packer/x86_64/http/user-data`
   - `packer/x86_64/http/meta-data`

3. **バリデーション**
   ```bash
   cd packer/x86_64
   packer validate k8s-worker.pkr.hcl
   ```

### 6.3 Phase 3: Ansible設定拡張

1. **インベントリ更新**
   ```bash
   vim ansible/inventories/production/hosts.yml
   ```

2. **kubernetes_componentsロール拡張**
   ```bash
   vim ansible/roles/kubernetes_components/defaults/main.yml
   ```

3. **Workerプレイブック作成**
   ```bash
   vim ansible/playbooks/worker.yml
   ```

4. **設定検証**
   ```bash
   cd ansible
   ansible-playbook --syntax-check playbooks/worker.yml
   ```

### 6.4 Phase 4: GitHub Actions設定

1. **Workflow作成**
   ```bash
   vim .github/workflows/build-worker-images.yml
   ```

2. **actionlint検証**
   ```bash
   actionlint .github/workflows/build-worker-images.yml
   ```

### 6.5 Phase 5: テストビルド

1. **手動ワークフロー実行**
   - GitHub ActionsのWorkflow Dispatchでgolyat-1をビルド

2. **S3アップロード確認**
   ```bash
   aws s3 ls s3://arch-worker-images/images/x86_64/golyat-1/
   ```

3. **イメージ検証**
   - ダウンロードしてQEMUで動作確認

## 7. テスト計画

### 7.1 単体テスト

1. **Packerテンプレート**
   - `packer validate`による構文チェック
   - ローカルQEMU環境での単体ビルドテスト

2. **Ansibleプレイブック**
   - `ansible-playbook --syntax-check`による構文チェック
   - `molecule test`によるロール単体テスト

3. **GitHub Actions**
   - `actionlint`による構文チェック
   - ドライランモードでの実行テスト

### 7.2 統合テスト

1. **イメージビルドテスト**
   - 全ノード（golyat-1,2,3）のイメージ生成確認
   - S3アップロード完了確認
   - チェックサム整合性確認

2. **USBブートテスト**
   - 生成イメージからのUSBブート確認
   - インストーラー機能動作確認
   - 別ディスクへのインストール確認

3. **Kubernetesクラスター統合**
   - Worker NodeのKubernetesクラスター参加確認
   - Control PlaneとWorker間通信確認
   - Pod配置動作確認

## 8. 運用計画

### 8.1 定期メンテナンス

1. **イメージ更新**
   - 月次でのベースOS更新（Ubuntu Security Updates）
   - Kubernetesバージョンアップに合わせた再ビルド
   - Ansibleロール更新反映

2. **S3ストレージ管理**
   - 古いイメージファイルの自動削除（90日保持）
   - ストレージ使用量監視
   - コスト最適化

### 8.2 障害対応

1. **ビルド失敗時**
   - GitHub Actions実行ログの確認
   - Packerビルドプロセスの詳細調査
   - Ansible実行結果の検証

2. **イメージ問題時**
   - 既知正常イメージへのロールバック
   - 問題切り分け（OS/Ansible/Kubernetes）
   - 修正版の緊急リリース

### 8.3 セキュリティ

1. **脆弱性管理**
   - 定期的なOSパッケージ更新
   - コンテナイメージの脆弱性スキャン
   - セキュリティパッチの迅速適用

2. **アクセス制御**
   - S3バケットのアクセス権限最小化
   - IAMロールの定期見直し
   - GitHub Actionsシークレットの適切管理

## 9. 予想される課題と対策

### 9.1 技術的課題

| 課題 | 影響 | 対策 |
|------|------|------|
| Mixed-archクラスター対応 | Pod配置の制約 | nodeAffinityによる適切な配置制御 |
| Intel NIC名の動的性 | ネットワーク設定失敗 | systemd-networkdによる動的設定 |
| BIOS/UEFI起動差異 | USBブート失敗 | 両モード対応のGRUB設定 |
| CRI-O 1.32安定性 | コンテナランタイム障害 | 事前検証とフォールバック機能 |

### 9.2 運用課題

| 課題 | 影響 | 対策 |
|------|------|------|
| ビルド時間の長大化 | 開発効率低下 | 段階ビルドとキャッシュ活用 |
| S3ストレージコスト | 運用コスト増加 | ライフサイクル管理とIA移行 |
| 手動インストール工数 | スケーラビリティ制約 | PXEブートによる完全自動化検討 |

## 10. 将来拡張計画

### 10.1 短期拡張（3ヶ月以内）

1. **PXEブート対応**
   - USBメモリ不要の完全ネットワークブート
   - DHCP/TFTPサーバー構築
   - Wake-on-LAN統合

2. **監視統合**
   - Prometheus/Grafanaへのメトリクス送信
   - ノードヘルスチェック自動化
   - 障害自動通知システム

### 10.2 中期拡張（6ヶ月以内）

1. **GPU Worker対応**
   - NVIDIA/AMD GPUドライバー自動インストール
   - コンテナランタイムGPU統合
   - GPU特化ワークロード対応

2. **エッジ環境対応**
   - ARM64 Worker Node追加
   - 低電力モード最適化
   - オフライン環境対応

### 10.3 長期拡張（1年以内）

1. **完全IaC化**
   - インフラ全体のTerraform管理
   - GitOpsによる設定管理統合
   - 構成ドリフト自動検知・修正

2. **マルチクラウド対応**
   - AWS/GCP/Azure統合
   - ハイブリッドクラウド構成
   - ディザスターリカバリ機能

## 11. まとめ

本設計では、既存ARM64 Control Plane環境に影響を与えることなく、x86_64 Worker Nodeの完全自動管理システムを構築します。Packer + Ubuntu autoinstallによる現代的なイメージ生成と、既存Ansibleロールの最大活用により、保守性と拡張性を両立した実装を実現します。

この設計により、lolice Kubernetesクラスターは真のHybrid Archクラスターとして運用され、将来のワークロード多様化に柔軟に対応できる基盤が整備されます。