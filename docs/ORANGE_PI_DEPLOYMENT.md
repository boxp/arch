# Orange Pi Zero 3 Kubernetes Cluster Deployment

このドキュメントでは、Orange Pi Zero 3を使用したKubernetesクラスターのデプロイメント手順を説明します。

## 概要

- **ハードウェア**: Orange Pi Zero 3 × 3台
- **ノード名**: shanghai-1, shanghai-2, shanghai-3
- **クラスター構成**: High Availability Control Plane
- **VIP**: 192.168.10.99 (kube-vip使用)
- **ネットワーク**: 192.168.10.0/24

## アーキテクチャ

### ネットワーク構成
```
192.168.10.99  - Cluster VIP (kube-vip)
192.168.10.102 - shanghai-1 (初期クラスター構築ノード)
192.168.10.103 - shanghai-2 (追加コントロールプレーンノード) 
192.168.10.104 - shanghai-3 (追加コントロールプレーンノード)
192.168.10.1   - Gateway
```

### ソフトウェア構成
- **OS**: Armbian Ubuntu 22.04 Jammy
- **Kubernetes**: v1.32.0
- **Container Runtime**: CRI-O v1.32
- **CNI**: Calico v3.29.1
- **Load Balancer**: kube-vip v0.8.9

## イメージビルドプロセス

### 1. GitHub Actionsによる自動ビルド

イメージは GitHub Actions で自動的にビルドされ、S3に保存されます：

```bash
# 全ノードのイメージをビルド
gh workflow run build-orange-pi-images.yml

# 特定ノードのみビルド
gh workflow run build-orange-pi-images.yml -f node_name=shanghai-1
```

### 2. ビルドプロセス

1. **ベースイメージ作成**: Armbianビルドフレームワークでベースイメージを作成
2. **ノード固有設定**: 各ノード用にAnsibleプレイブックを適用
3. **S3アップロード**: 圧縮イメージをS3にアップロード

### 3. 生成されるアーティファクト

各ノードについて以下が生成されます：
- `orangepi-zero3-{node}.img.xz` - 圧縮イメージファイル
- `orangepi-zero3-{node}.img.xz.sha256` - チェックサムファイル
- `image-info.json` - ビルド情報
- `latest.img.xz` - 最新イメージへのリンク

## デプロイメント手順

### 前提条件

1. **AWS認証情報**: S3からイメージをダウンロードするための認証
2. **SDカード**: 32GB以上のmicroSDカード × 3枚
3. **ネットワーク**: 192.168.10.0/24ネットワークへのアクセス

### 1. イメージのダウンロード

```bash
# S3からイメージをダウンロード
aws s3 cp s3://arch-orange-pi-images-{suffix}/images/orange-pi-zero3/shanghai-1/latest.img.xz ./
aws s3 cp s3://arch-orange-pi-images-{suffix}/images/orange-pi-zero3/shanghai-2/latest.img.xz ./
aws s3 cp s3://arch-orange-pi-images-{suffix}/images/orange-pi-zero3/shanghai-3/latest.img.xz ./
```

### 2. SDカードへの書き込み

```bash
# 各ノード用にSDカードに書き込み
xzcat orangepi-zero3-shanghai-1.img.xz | sudo dd of=/dev/sdX bs=1M status=progress
xzcat orangepi-zero3-shanghai-2.img.xz | sudo dd of=/dev/sdY bs=1M status=progress  
xzcat orangepi-zero3-shanghai-3.img.xz | sudo dd of=/dev/sdZ bs=1M status=progress
```

### 3. 初回起動と設定

#### 全ノード共通手順

1. SDカードを挿入して起動
2. root/boxpパスワードを設定（初回ログイン時）
3. ノードの初期化完了を確認
4. 手動でクラスターへ参加

```bash
# 初期化状況の確認
sudo journalctl -u init-shanghai-X.service -f

# ノードの準備状態確認
systemctl status crio kubelet
```

#### クラスター参加手順

既存クラスターからjoinトークンを取得：
```bash
# 既存クラスターで実行
kubeadm token create --print-join-command --ttl 24h

# 出力例:
# kubeadm join <cluster-endpoint>:6443 --token abcdef.1234567890abcdef \
#   --discovery-token-ca-cert-hash sha256:xxxxx \
#   --control-plane
```

各ノードで：
```bash
# 上記のコマンドをそのまま実行
sudo kubeadm join <cluster-endpoint>:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --control-plane
```

## 運用管理

### クラスター状態確認

```bash
# ノード状態
kubectl get nodes -o wide

# kube-vip状態
kubectl get pods -n kube-system | grep kube-vip

# VIP動作確認
ping 192.168.10.99
```

### トラブルシューティング

#### kube-vip問題
```bash
# ログ確認
kubectl logs -n kube-system kube-vip-shanghai-1

# マニフェスト確認  
sudo cat /etc/kubernetes/manifests/kube-vip.yaml
```

#### ネットワーク問題
```bash
# netplan設定確認
sudo netplan get

# ネットワーク再適用
sudo netplan apply
```

#### サービス状態確認
```bash
# CRI-O状態
sudo systemctl status crio

# kubelet状態
sudo systemctl status kubelet
```

## セキュリティ考慮事項

1. **デフォルトパスワード変更**: 初回ログイン時に必ず変更
2. **SSH鍵認証**: パスワード認証を無効化し、鍵認証を使用
3. **ファイアウォール**: 必要なポートのみ開放
4. **定期更新**: セキュリティパッチの定期適用

## バックアップ・復旧

### etcdバックアップ
```bash
# etcdバックアップ
sudo ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%Y%m%d).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

### 設定ファイルバックアップ
```bash
# Kubernetes設定
sudo tar -czf /backup/k8s-config-$(date +%Y%m%d).tar.gz /etc/kubernetes/

# システム設定
sudo tar -czf /backup/system-config-$(date +%Y%m%d).tar.gz /etc/systemd/ /etc/netplan/
```