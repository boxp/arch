# Cloudflare Access Application
resource "cloudflare_access_application" "openhands" {
  zone_id          = var.zone_id
  name             = "Access application for openhands.b0xp.io"
  domain           = "openhands.b0xp.io"
  session_duration = "24h"
}

# GitHub Identity Provider データソース
data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

# Cloudflare Access Policy
resource "cloudflare_access_policy" "openhands_policy" {
  application_id = cloudflare_access_application.openhands.id
  zone_id        = var.zone_id
  name           = "policy for openhands.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
} 