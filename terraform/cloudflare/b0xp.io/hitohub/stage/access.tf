# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "hitohub_stage" {
  zone_id          = var.zone_id
  name             = "Access application for hitohub-stage.b0xp.io"
  domain           = "hitohub-stage.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "hitohub_stage_policy" {
  application_id = cloudflare_zero_trust_access_application.hitohub_stage.id
  zone_id        = var.zone_id
  name           = "policy for hitohub-stage.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}