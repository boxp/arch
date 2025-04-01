# トークンローテーション設定
resource "time_rotating" "token_rotation" {
  rotation_days = 90
}

# API用のアクセスアプリケーション
resource "cloudflare_access_application" "grafana_api" {
  zone_id          = var.zone_id
  name             = "Access application for grafana-api.b0xp.io"
  domain           = "grafana-api.b0xp.io" # Changed from argocd-api
  session_duration = "24h"
  # Enable service token authentication
  service_auth_401_redirect = false
}

# GitHub Action用のサービストークン (Grafana API用)
resource "cloudflare_access_service_token" "grafana_api_service_token" {
  account_id           = var.account_id
  name                 = "GitHub Action - Grafana API" # Changed from ArgoCD API
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
resource "cloudflare_access_policy" "grafana_api_policy" {
  application_id = cloudflare_access_application.grafana_api.id # Changed from argocd_api
  zone_id        = var.zone_id
  name           = "GitHub Actions access policy for grafana-api.b0xp.io" # Changed from argocd-api
  precedence     = "1"
  decision       = "non_identity" # Use non_identity for service tokens
  include {
    # Allow access from the specific service token
    service_token = [cloudflare_access_service_token.grafana_api_service_token.id] # Changed from github_action_token
  }
}

# トークンIDをSSMに保存
resource "aws_ssm_parameter" "grafana_api_github_action_token" {
  name        = "grafana-api-github-action-token" # Changed from argocd-api
  description = "for GitHub Action to access Grafana API" # Changed from ArgoCD API
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.grafana_api_service_token.client_id) # Changed from github_action_token
}

# トークンシークレットをSSMに保存
resource "aws_ssm_parameter" "grafana_api_github_action_secret" {
  name        = "grafana-api-github-action-secret" # Changed from argocd-api
  description = "for GitHub Action to access Grafana API" # Changed from ArgoCD API
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.grafana_api_service_token.client_secret) # Changed from github_action_token
}