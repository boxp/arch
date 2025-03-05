# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "grafana" {
  account_id       = var.account_id
  name             = "Access application for grafana.b0xp.io"
  domain           = "grafana.b0xp.io"
  session_duration = "24h"
}

# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "prometheus_web" {
  account_id       = var.account_id
  name             = "Access application for prometheus-web.b0xp.io"
  domain           = "prometheus-web.b0xp.io"
  session_duration = "24h"
}

# 変数を使用するため、データソース参照は不要
# data "cloudflare_zero_trust_access_identity_provider" "github" {
#   account_id = var.account_id
#   name       = "GitHub"
# }

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "grafana_policy" {
  account_id  = var.account_id
  application_id = cloudflare_zero_trust_access_application.grafana.id
  name        = "policy for grafana.b0xp.io"
  decision    = "allow"
  include {
    login_method = [var.identity_provider_id]
  }
}

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "prometheus_web_policy" {
  account_id  = var.account_id
  application_id = cloudflare_zero_trust_access_application.prometheus_web.id
  name        = "policy for prometheus-web.b0xp.io"
  decision    = "allow"
  include {
    login_method = [var.identity_provider_id]
  }
}
