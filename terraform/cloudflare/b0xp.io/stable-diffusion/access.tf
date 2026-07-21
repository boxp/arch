resource "cloudflare_zero_trust_access_application" "stable_diffusion" {
  zone_id          = var.zone_id
  name             = "Access application for sd-webui.b0xp.io"
  domain           = "sd-webui.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.stable_diffusion_github.id }]
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

resource "cloudflare_zero_trust_access_policy" "stable_diffusion_github" {
  account_id = var.account_id
  name       = "policy for sd-webui.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}
