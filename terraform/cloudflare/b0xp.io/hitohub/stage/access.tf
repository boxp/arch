# Creates an Access application to control who can connect.
removed {
  from = cloudflare_access_policy.hitohub_stage_policy
  lifecycle {
    destroy = false
  }
}

resource "cloudflare_zero_trust_access_application" "hitohub_stage" {
  zone_id          = var.zone_id
  name             = "Access application for hitohub-stage.b0xp.io"
  domain           = "hitohub-stage.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.hitohub_stage_policy.id }]
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
resource "cloudflare_zero_trust_access_policy" "hitohub_stage_policy" {
  account_id = var.account_id
  name       = "policy for hitohub-stage.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}
