resource "cloudflare_zero_trust_access_application" "stable_diffusion" {
  zone_id          = var.zone_id
  name             = "Access application for sd-webui.b0xp.io"
  domain           = "sd-webui.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [cloudflare_zero_trust_access_policy.stable_diffusion_github.id]
}

data "cloudflare_zero_trust_access_identity_provider" "github" {
  account_id = var.account_id
  filter     = {}
}

resource "cloudflare_zero_trust_access_policy" "stable_diffusion_github" {
  account_id = var.account_id
  name       = "policy for sd-webui.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = data.cloudflare_zero_trust_access_identity_provider.github.id
    }
  }]
}
