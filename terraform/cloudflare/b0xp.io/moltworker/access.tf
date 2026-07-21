# Cloudflare Access application for the Moltworker.
resource "cloudflare_zero_trust_access_application" "moltworker" {
  zone_id          = var.zone_id
  name             = "Access application for moltworker.b0xp.io"
  domain           = "moltworker.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [cloudflare_zero_trust_access_policy.moltworker_policy.id]
}

data "cloudflare_zero_trust_access_identity_provider" "github" {
  account_id = var.account_id
  filter     = {}
}

resource "cloudflare_zero_trust_access_policy" "moltworker_policy" {
  account_id = var.account_id
  name       = "policy for moltworker.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = data.cloudflare_zero_trust_access_identity_provider.github.id
    }
  }]
}
