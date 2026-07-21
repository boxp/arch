# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "k8s" {
  zone_id = var.zone_id
  name    = "Access application for k8s.b0xp.io"
  domain  = "k8s.b0xp.io"

  policies = [{ id = cloudflare_zero_trust_access_policy.github_actions_access.id }]
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
}

resource "cloudflare_zero_trust_access_application" "codex_task_board" {
  zone_id          = var.zone_id
  name             = "Access application for codex-task-board.b0xp.io"
  domain           = "codex-task-board.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.codex_task_board_policy.id }]
}

data "cloudflare_zero_trust_access_identity_provider" "github" {
  account_id = var.account_id
  filter     = {}
}

resource "cloudflare_zero_trust_access_policy" "codex_task_board_policy" {
  account_id = var.account_id
  name       = "policy for codex-task-board.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = data.cloudflare_zero_trust_access_identity_provider.github.id
    }
  }]
}
