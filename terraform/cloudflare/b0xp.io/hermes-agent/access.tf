# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "hermes_agent" {
  zone_id          = var.zone_id
  name             = "Access application for hermes-agent.b0xp.io"
  domain           = "hermes-agent.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [cloudflare_zero_trust_access_policy.hermes_agent_policy.id]
}

data "cloudflare_zero_trust_access_identity_provider" "github" {
  account_id = var.account_id
  filter     = {}
}

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "hermes_agent_policy" {
  account_id = var.account_id
  name       = "policy for hermes-agent.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = data.cloudflare_zero_trust_access_identity_provider.github.id
    }
  }]
}
