# BOXP-129: lolice cluster に Oracle Cloud Free Tier control plane を追加

## 目標

物理 control plane (shanghai-1/2/3) のうち **2台同時障害**が発生してもクラスターが稼働し続けられる構成を実現する。

## 採用アーキテクチャ

- **クラウドCP**: Oracle Cloud Free Tier × 2台 (Ampere A1, 東京, ARM64, ¥0/月)
- **etcd構成**: 物理3 + クラウド2 = 計5台、クォーラム=3
  - 物理CP 2台障害 → 残り1物理+2クラウド=3 ≥ クォーラム3 → **継続 ✓**
- **接続**: Tailscale VPN (既存 tailnet 活用)
- **kube-vip**: クラウドCPには適用しない (L2 VIPはLAN外無効)

## 実装ファイル

### 1. terraform/oci/lolice-control-plane/

OCI (Oracle Cloud Infrastructure) Terraform モジュール。

| ファイル | 内容 |
|---|---|
| `backend.tf` | S3バックエンド (tfaction-state) |
| `provider.tf` | oracle/oci + hashicorp/aws プロバイダー |
| `variables.tf` | OCI認証情報・設定変数 |
| `network.tf` | VCN, Subnet, Internet Gateway, Route Table, Security List |
| `compute.tf` | Ampere A1インスタンス × 2台 |
| `cloud_init.tf` | cloud-initテンプレート (Tailscale自動登録) |
| `outputs.tf` | インスタンスIPなどの出力 |
| `tfaction.yaml` | TFAction設定 |

### 2. terraform/tailscale/lolice/

既存 Tailscale lolice モジュールを拡張。

- **acl.tf**: `tag:cloud-control-plane` をtagOwnersに追加、etcd (2379/2380)・kubelet (10250)・apiserver (6443) の通信をon-prem ↔ クラウドCP間で許可
- **auth_key.tf**: クラウドCP用 auth key (reusable/preauthorized, tag:cloud-control-plane) + SSM保存

### 3. ansible/inventories/production/hosts.yml

`cloud_control_plane` グループを追加:
- `ansible_host`: Tailscale IP (terraform apply後に設定)
- `kube_vip_enabled: false`

### 4. ansible/playbooks/cloud-control-plane-join.yml

kubeadm join プレイブック:
- CRI-O / kubelet / kubeadm インストール
- kubeadm join with `--control-plane --apiserver-advertise-address=<tailscale-ip>`

## フェーズ

1. **IaC実装** (本PR): Terraform + Ansible コード追加
2. **アカウント設定**: Oracle Cloud API Key → SSM保存 (手動)
3. **terraform apply**: OCI VM × 2台プロビジョニング
4. **kubeadm join**: Ansible playbook実行でクラスターに参加
5. **検証**: etcd health / クォーラムテスト / RTT確認

## OCI認証設定 (手動作業)

```bash
# OCI認証情報をSSMに保存 (初回のみ)
aws ssm put-parameter --name "/lolice/oci/tenancy-ocid" \
    --value "<TENANCY_OCID>" --type SecureString
aws ssm put-parameter --name "/lolice/oci/user-ocid" \
    --value "<USER_OCID>" --type SecureString
aws ssm put-parameter --name "/lolice/oci/fingerprint" \
    --value "<FINGERPRINT>" --type SecureString --overwrite
aws ssm put-parameter --name "/lolice/oci/private-key" \
    --value "$(cat ~/.oci/oci_api_key.pem)" --type SecureString
```
