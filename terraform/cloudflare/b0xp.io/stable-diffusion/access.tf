resource "cloudflare_zero_trust_access_application" "stable_diffusion" {
  zone_id          = var.zone_id
  name             = "Access application for sd-webui.b0xp.io"
  domain           = "sd-webui.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

resource "cloudflare_zero_trust_access_policy" "stable_diffusion_github" {
  application_id = cloudflare_zero_trust_access_application.stable_diffusion.id
  zone_id        = var.zone_id
  name           = "policy for sd-webui.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}

