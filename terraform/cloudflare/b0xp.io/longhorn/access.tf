# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "longhorn" {
  zone_id          = var.zone_id
  name             = "Access application for longhorn.b0xp.io"
  domain           = "longhorn.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.longhorn_policy.id }]
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
resource "cloudflare_zero_trust_access_policy" "longhorn_policy" {
  account_id = var.account_id
  name       = "policy for longhorn.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}
