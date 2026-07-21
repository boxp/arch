# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "argocd" {
  zone_id          = var.zone_id
  name             = "Access application for argocd.b0xp.io"
  domain           = "argocd.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.argocd_policy.id }]
}

data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.account_id
}

locals {
  github_idp_id = [
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "github"
  ][0]
}

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "argocd_policy" {
  account_id = var.account_id
  name       = "policy for argocd.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

# トークンローテーション設定
resource "time_rotating" "token_rotation" {
  rotation_days = 90
}

# API用のアクセスアプリケーション
resource "cloudflare_zero_trust_access_application" "argocd_api" {
  zone_id          = var.zone_id
  name             = "Access application for argocd-api.b0xp.io"
  domain           = "argocd-api.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.argocd_api_policy.id }]
}

# GitHub Action用のサービストークン
resource "cloudflare_zero_trust_access_service_token" "github_action_token" {
  account_id           = var.account_id
  name                 = "GitHub Action - ArgoCD API"

  # トークンローテーション設定
  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      time_rotating.token_rotation.id
    ]
  }
}

# サービストークンによるアクセスを許可するポリシー
resource "cloudflare_zero_trust_access_policy" "argocd_api_policy" {
  account_id = var.account_id
  name       = "GitHub Actions access policy for argocd-api.b0xp.io"
  decision   = "non_identity"
  include = [{
    service_token = {
      token_id = cloudflare_zero_trust_access_service_token.github_action_token.id
    }
  }]
}

# トークンIDをSSMに保存
resource "aws_ssm_parameter" "github_action_token" {
  name        = "argocd-api-github-action-token"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_access_service_token.github_action_token.client_id)
}

# トークンシークレットをSSMに保存
resource "aws_ssm_parameter" "github_action_secret" {
  name        = "argocd-api-github-action-secret"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_access_service_token.github_action_token.client_secret)
}
