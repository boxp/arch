# Creates an Access application to control who can connect.
resource "cloudflare_access_application" "argocd" {
  zone_id          = var.zone_id
  name             = "Access application for argocd.b0xp.io"
  domain           = "argocd.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

# Creates an Access policy for the application.
resource "cloudflare_access_policy" "argocd_policy" {
  application_id = cloudflare_access_application.argocd.id
  zone_id        = var.zone_id
  name           = "policy for argocd.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}

# トークンローテーション設定
resource "time_rotating" "token_rotation" {
  rotation_days = 90
}

# API用のアクセスアプリケーション
resource "cloudflare_access_application" "argocd_api" {
  zone_id          = var.zone_id
  name             = "Access application for argocd-api.b0xp.io"
  domain           = "argocd-api.b0xp.io"
  session_duration = "24h"
}

# GitHub Action用のサービストークン
resource "cloudflare_access_service_token" "github_action_token" {
  account_id           = var.account_id
  name                 = "GitHub Action - ArgoCD API"
  min_days_for_renewal = 30

  # トークンローテーション設定
  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      time_rotating.token_rotation.id
    ]
  }
}

# サービストークンによるアクセスを許可するポリシー
resource "cloudflare_access_policy" "argocd_api_policy" {
  application_id = cloudflare_access_application.argocd_api.id
  zone_id        = var.zone_id
  name           = "GitHub Actions access policy for argocd-api.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    service_token = [cloudflare_access_service_token.github_action_token.id]
  }
}

# トークンIDをSSMに保存
resource "aws_ssm_parameter" "github_action_token" {
  name        = "argocd-api-github-action-token"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_action_token.client_id)
}

# トークンシークレットをSSMに保存
resource "aws_ssm_parameter" "github_action_secret" {
  name        = "argocd-api-github-action-secret"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_action_token.client_secret)
}