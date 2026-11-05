# BOXP-428: langfuse.b0xp.io holds prompt and response bodies, so it reuses the
# existing Owner-only reusable policy of hitohako-stage (Owner email + GitHub IdP,
# see ../hitohako/access.tf) instead of a login_method policy, which would admit
# every GitHub user. The lookup fails the plan if that policy is missing or renamed.
data "cloudflare_zero_trust_access_policies" "all" {
  account_id = var.account_id
}

locals {
  owner_policy_name = "policy for hitohako-stage.b0xp.io (owner only)"
  owner_policy_id = one([
    for p in data.cloudflare_zero_trust_access_policies.all.result :
    p.id if p.name == local.owner_policy_name
  ])
}

resource "cloudflare_zero_trust_access_application" "langfuse" {
  zone_id                    = var.zone_id
  name                       = "Access application for langfuse.b0xp.io"
  domain                     = "langfuse.b0xp.io"
  session_duration           = "24h"
  type                       = "self_hosted"
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"
  app_launcher_visible       = false
  policies                   = [{ id = local.owner_policy_id }]

  lifecycle {
    precondition {
      condition     = local.owner_policy_id != null
      error_message = "Owner-only Access policy not found: refusing to publish langfuse.b0xp.io."
    }
  }
}
