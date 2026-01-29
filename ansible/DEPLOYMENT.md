# Orange Pi Zero 3 Control Plane Deployment

このドキュメントは、Orange Pi Zero 3ノード（shanghai-1/2/3）へのKubernetesコントロールプレーンデプロイ手順を説明します。

## 前提条件

### 1. Cloudflareトンネル設定
各ノードがCloudflareトンネル経由でアクセス可能であること：
- shanghai-1: `cloudflared access ssh --hostname shanghai-1`
- shanghai-2: `cloudflared access ssh --hostname shanghai-2`  
- shanghai-3: `cloudflared access ssh --hostname shanghai-3`

### 2. SSH設定
`~/.ssh/config` に以下を追加：
```
Host shanghai-1
    ProxyCommand cloudflared access ssh --hostname %h
    User boxp

Host shanghai-2
    ProxyCommand cloudflared access ssh --hostname %h
    User boxp

Host shanghai-3
    ProxyCommand cloudflared access ssh --hostname %h
    User boxp
```

### 3. 必要なツール
- Ansible >= 2.12
- cloudflared CLI
- Python 3.8+

## デプロイ手順

### 1. 接続テスト
```bash
# 各ノードへの接続確認
ansible control_plane -i inventories/production/hosts.yml -m ping
```

### 2. 段階的デプロイ

#### ステップ1: ユーザーとネットワーク設定（ブートストラップ）
```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml \
  --tags "bootstrap" \
  --ask-become-pass
```

#### ステップ2: Cloudflare CLI設定
```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml \
  --tags "cloudflare"
```

#### ステップ3: Kubernetesコンポーネント設定
```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml \
  --tags "kubernetes"
```

### 3. 全体デプロイ（一括実行）
```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml \
  --ask-become-pass
```

### 4. 特定ノードのみデプロイ
```bash
# shanghai-1のみ
ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml \
  --limit shanghai-1

# 複数ノード指定
ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml \
  --limit "shanghai-1,shanghai-2"
```

## 設定確認

### 1. サービス状態確認
```bash
ansible control_plane -i inventories/production/hosts.yml \
  -m shell -a "systemctl status kubelet crio"
```

### 2. VIP確認
```bash
# VIP 192.168.10.99の確認
ping 192.168.10.99
curl -k https://192.168.10.99:6443/version
```

## トラブルシューティング

### 1. SSH接続エラー
```bash
# Cloudflareトンネル状態確認
cloudflared tunnel list

# SSH接続デバッグ
ssh -vvv shanghai-1
```

### 2. Kubernetes設定確認
```bash
# ノード上で直接確認
ssh shanghai-1
sudo systemctl status kubelet
sudo journalctl -u kubelet -f
```

## クラスター初期化

全ノードのセットアップ完了後、以下でKubernetesクラスターを初期化：

```bash
# 最初のマスターノード（shanghai-1）
ssh shanghai-1
sudo kubeadm init \
  --control-plane-endpoint="192.168.10.99:6443" \
  --upload-certs \
  --pod-network-cidr="10.244.0.0/16"

# kubeconfig設定
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# 他のマスターノード参加（shanghai-2, shanghai-3）
# kubeadm init出力のjoinコマンドを使用
```

## 注意事項

1. **段階的デプロイ推奨**: 全ロールを一度に実行せず、段階的に適用することを推奨
2. **バックアップ**: 重要な設定変更前は設定ファイルのバックアップを取得
3. **ログ確認**: 各ステップ後にサービスログを確認
4. **ネットワーク**: VIP 192.168.10.99が他のデバイスと競合しないよう確認

## リソース

- [Orange Pi Zero 3公式ドキュメント](http://www.orangepi.org/html/hardWare/computerAndMicrocontrollers/details/Orange-Pi-Zero-3.html)
- [kubeadm公式ドキュメント](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/)