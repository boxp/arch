# T-20260227-009: Tailscale Workload Identity PoC Terraform + tfaction Scaffold

## 概要

boxp/lolice PR #490 で策定された Tailscale Workload Identity Federation (WIF) PoC 計画に基づき、boxp/arch 側に Terraform + tfaction による最小構成を構築する。

## 変更内容

### 1. Terraform ワーキングディレクトリ (`terraform/tailscale/lolice/`)

以下のリソースを IaC 化:

| ファイル | リソース | 説明 |
|---|---|---|
| `wif.tf` | `tailscale_federated_identity` | GitHub Actions OIDC → tailnet WIF Trust Credential |
| `acl.tf` | `tailscale_acl` | タグベース ACL (tag:ci → ArgoCD API のみ許可) |
| `auth_key.tf` | `tailscale_tailnet_key` | subnet router 用 pre-authorized auth key |
| `auth_key.tf` | `aws_ssm_parameter` | auth key を SSM Parameter Store に保管 |
| `dns.tf` | (placeholder) | 将来の DNS 設定用プレースホルダー |
| `variables.tf` | - | ArgoCD ClusterIP, GitHub repo, workflow name |
| `outputs.tf` | - | WIF client_id, auth key ID |

### 2. tfaction 連携

- `tfaction-root.yaml`: `target_groups` に `terraform/tailscale/` エントリ追加
  - TAILSCALE_API_KEY / TAILSCALE_TAILNET を secrets 経由で注入
- `.github/workflows/wc-plan.yaml`: provider whitelist に `registry.terraform.io/tailscale/tailscale` 追加

### 3. テンプレート (`templates/tailscale/`)

既存の cloudflare テンプレートパターンに倣い作成:
- `backend.tf` (S3 backend, `%%TARGET%%` パターン)
- `provider.tf` (tailscale + aws provider)
- `.tflint.hcl`, `.tfmigrate.hcl`
- `aqua/` (terraform, tflint, trivy)

## 適用前チェックリスト

- [ ] GitHub Secrets に `TAILSCALE_API_KEY` と `TAILSCALE_TAILNET` を設定済み
- [ ] Tailscale アカウントが利用可能で API キーが発行済み
- [ ] tfaction plan が CI で正常通過
- [ ] `argocd_service_cluster_ip` 変数にデフォルト値なし (空文字) → apply 時に指定が必要

## 適用手順

### Phase 1: Scaffold PR マージ (本PR)

1. 本 PR をレビュー・承認
2. マージ → tfaction が自動で `terraform plan` を確認
3. apply は `argocd_service_cluster_ip` が空のため ACL ルールと autoApprovers が空リスト → 安全

### Phase 2: subnet router デプロイ後

1. boxp/lolice 側で subnet router Pod をデプロイ
2. ArgoCD Service の ClusterIP を確認
3. boxp/arch で `argocd_service_cluster_ip` 変数に値を設定する PR を作成
4. tfaction plan で ACL/autoApprovers が正しく生成されることを確認
5. マージ → tfaction apply

### Phase 3: WIF 接続テスト

1. boxp/lolice でテストワークフローを作成
2. GitHub Actions が WIF 経由で tailnet に接続できることを検証
3. ArgoCD API への疎通確認

## ロールバック手順

### 通常時 (推奨)

1. 本 PR の変更を revert する PR を作成
2. マージ → tfaction が `terraform apply` で全リソースを削除
3. SSM Parameter Store のパラメータも自動削除

### 緊急時

```bash
cd terraform/tailscale/lolice/
terraform destroy -auto-approve
```

### 最終手段

1. Tailscale 管理コンソールで Trust Credential / ACL を手動削除
2. AWS SSM Parameter Store から `/lolice/tailscale/subnet-router-auth-key` を手動削除
3. 24時間以内に Terraform state を整合:
   ```bash
   terraform state rm tailscale_federated_identity.github_actions_argocd_diff
   terraform state rm tailscale_acl.this
   terraform state rm tailscale_tailnet_key.subnet_router
   terraform state rm aws_ssm_parameter.subnet_router_auth_key
   ```

## リスク

| リスク | 影響 | 緩和策 |
|---|---|---|
| Tailscale API Key 漏洩 | tailnet 設定の不正変更 | GitHub Secrets で管理、key の最小権限化 |
| ACL 設定ミス | 意図しないアクセス許可 | PoC 初期は dst が空リスト、段階的に有効化 |
| 既存 Cloudflare 経路への影響 | なし | 並行導入、既存経路は一切変更しない |
| tfaction plan 失敗 | PR の CI ブロック | provider whitelist 追加済み、secrets 設定要 |

## 関連

- boxp/lolice PR #490: Tailscale WIF PoC 導入計画
- boxp/arch PR #7262: CLAUDE.md に Tailscale 管理方針追記 (並行)
