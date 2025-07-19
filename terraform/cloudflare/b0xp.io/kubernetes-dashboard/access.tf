# Creates an Access application to control who can connect.
resource "cloudflare_access_application" "kubernetes_dashboard" {
  zone_id          = var.zone_id
  name             = "Access application for kubernetes-dashboard.b0xp.io"
  domain           = "kubernetes-dashboard.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

# Creates an Access policy for the application.
resource "cloudflare_access_policy" "kubernetes_dashboard_policy" {
  application_id = cloudflare_access_application.kubernetes_dashboard.id
  zone_id        = var.zone_id
  name           = "policy for kubernetes-dashboard.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}
