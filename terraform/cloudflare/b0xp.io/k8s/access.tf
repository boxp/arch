# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "k8s" {
  zone_id          = var.zone_id
  name             = "Access application for k8s.b0xp.io"
  domain           = "k8s.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"

  policies = [{ id = cloudflare_zero_trust_access_policy.github_actions_access.id }]

  lifecycle {
    ignore_changes = [http_only_cookie_attribute, policies, self_hosted_domains, destinations, app_launcher_visible]
  }
}

resource "cloudflare_zero_trust_access_policy" "github_actions_access" {
  account_id = var.account_id
  name       = "GitHub Actions Access Policy"
  decision   = "allow"

  include = [{
    service_token = {
      token_id = var.service_token_id
    }
  }]

  lifecycle {
    ignore_changes = [session_duration]
  }
}

resource "cloudflare_zero_trust_access_application" "codex_task_board" {
  zone_id          = var.zone_id
  name             = "Access application for codex-task-board.b0xp.io"
  domain           = "codex-task-board.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.codex_task_board_policy.id }]

  lifecycle {
    ignore_changes = [http_only_cookie_attribute, policies]
  }
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

resource "cloudflare_zero_trust_access_policy" "codex_task_board_policy" {
  account_id = var.account_id
  name       = "policy for codex-task-board.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = local.github_idp_id
    }
  }]

  lifecycle {
    ignore_changes = [session_duration]
  }
}

# BOXP-430: lolice-lineage.b0xp.io serves a private infrastructure map, so it reuses
# the existing Owner-only reusable policy (Owner email + GitHub IdP, see
# ../hitohako/access.tf) as langfuse.b0xp.io does (BOXP-428). login_method alone, as in
# codex_task_board_policy above, would admit every GitHub user. The lookup fails the
# plan if that policy is missing or renamed.
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

resource "cloudflare_zero_trust_access_application" "lolice_lineage" {
  zone_id                    = var.zone_id
  name                       = "Access application for lolice-lineage.b0xp.io"
  domain                     = "lolice-lineage.b0xp.io"
  session_duration           = "24h"
  type                       = "self_hosted"
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"
  app_launcher_visible       = false
  policies                   = [{ id = local.owner_policy_id }]

  lifecycle {
    precondition {
      condition     = local.owner_policy_id != null
      error_message = "Owner-only Access policy not found: refusing to publish lolice-lineage.b0xp.io."
    }
  }
}
