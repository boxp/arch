# Cloudflare Access application for the Moltworker.
# Separate from the existing openclaw.b0xp.io Access policy.
resource "cloudflare_access_application" "moltworker" {
  zone_id          = var.zone_id
  name             = "Access application for moltworker.b0xp.io"
  domain           = "moltworker.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

resource "cloudflare_access_policy" "moltworker_policy" {
  application_id = cloudflare_access_application.moltworker.id
  zone_id        = var.zone_id
  name           = "policy for moltworker.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}
