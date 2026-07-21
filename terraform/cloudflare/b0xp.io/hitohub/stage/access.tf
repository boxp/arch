# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "hitohub_stage" {
  zone_id          = var.zone_id
  name             = "Access application for hitohub-stage.b0xp.io"
  domain           = "hitohub-stage.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [cloudflare_zero_trust_access_policy.hitohub_stage_policy.id]
}

data "cloudflare_zero_trust_access_identity_provider" "github" {
  account_id = var.account_id
  filter     = {}
}

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "hitohub_stage_policy" {
  account_id = var.account_id
  name       = "policy for hitohub-stage.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = data.cloudflare_zero_trust_access_identity_provider.github.id
    }
  }]
}
