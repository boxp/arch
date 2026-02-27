# T-20260227-010: Phase 1.5 — Tailscale Terraform リソース有効化

## 概要

T-20260227-009 で scaffold した Tailscale Terraform 設定（コメントアウト状態）を、
GitHub Secrets（TAILSCALE_API_KEY / TAILSCALE_TAILNET）追加後に有効化する。

## 変更内容

### 1. `tfaction-root.yaml`

- tailscale target group の各 config ブロック (terraform_plan_config, tfmigrate_plan_config,
  terraform_apply_config, tfmigrate_apply_config) に secrets 設定を追加
  - `TAILSCALE_API_KEY` → `TAILSCALE_API_KEY`
  - `TAILSCALE_TAILNET` → `TAILSCALE_TAILNET`

### 2. `terraform/tailscale/lolice/backend.tf`

- `required_providers` に tailscale provider を追加（コメントアウト解除）

### 3. `terraform/tailscale/lolice/provider.tf`

- `provider "tailscale"` ブロックを有効化

### 4. `terraform/tailscale/lolice/*.tf` リソース有効化

| ファイル | リソース | 説明 |
|---|---|---|
| `wif.tf` | `tailscale_federated_identity` | GitHub Actions OIDC → tailnet WIF Trust Credential |
| `acl.tf` | `tailscale_acl` | タグベース ACL (tag:ci → ArgoCD API のみ許可) |
| `auth_key.tf` | `tailscale_tailnet_key` | subnet router 用 pre-authorized auth key |
| `auth_key.tf` | `aws_ssm_parameter` | auth key を SSM Parameter Store に保管 |
| `variables.tf` | 3 variables | argocd_service_cluster_ip, github_repository, argocd_diff_workflow_name |
| `outputs.tf` | 2 outputs | wif_client_id, subnet_router_auth_key_id |

### 5. `.terraform.lock.hcl`

- tailscale/tailscale v0.28.0 の zh: ハッシュを追加

## 前提条件

- GitHub Secrets に `TAILSCALE_API_KEY` と `TAILSCALE_TAILNET` が設定済みであること

## 関連

- T-20260227-009 / PR #7263: Phase 1 scaffold
