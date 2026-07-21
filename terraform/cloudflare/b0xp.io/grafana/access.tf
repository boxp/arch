# トークンローテーション設定
resource "time_rotating" "token_rotation" {
  rotation_days = 90
}

# API用のアクセスアプリケーション
resource "cloudflare_zero_trust_access_application" "grafana_api" {
  zone_id          = var.zone_id
  name             = "Access application for grafana-api.b0xp.io"
  domain           = "grafana-api.b0xp.io" # Changed from argocd-api
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.grafana_api_policy.id }]
  # Enable service token authentication
  service_auth_401_redirect = false
}

# Model Context Protocol 用のサービストークン (Grafana API用)
resource "cloudflare_zero_trust_access_service_token" "grafana_api_service_token" {
  account_id = var.account_id
  name       = "Model Context Protocol - Grafana API"

  # トークンローテーション設定
  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      time_rotating.token_rotation.id
    ]
  }
}

# サービストークンによるアクセスを許可するポリシー
resource "cloudflare_zero_trust_access_policy" "grafana_api_policy" {
  account_id = var.account_id
  name       = "Model Context Protocol access policy for grafana-api.b0xp.io"
  decision   = "non_identity"
  include = [{
    service_token = {
      token_id = cloudflare_zero_trust_access_service_token.grafana_api_service_token.id
    }
  }]
}
