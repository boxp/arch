# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "k8s" {
  zone_id = var.zone_id
  name    = "Access application for k8s.b0xp.io"
  domain  = "k8s.b0xp.io"

  policies = [
    cloudflare_zero_trust_access_policy.github_actions_access.id
  ]
}

resource "cloudflare_zero_trust_access_policy" "github_actions_access" {
  account_id = var.account_id
  name       = "GitHub Actions Access Policy"
  decision   = "allow"

  include {
    service_token = [var.service_token_id]
  }
}

resource "cloudflare_zero_trust_access_application" "codex_task_board" {
  zone_id          = var.zone_id
  name             = "Access application for codex-task-board.b0xp.io"
  domain           = "codex-task-board.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

resource "cloudflare_zero_trust_access_policy" "codex_task_board_policy" {
  application_id = cloudflare_zero_trust_access_application.codex_task_board.id
  zone_id        = var.zone_id
  name           = "policy for codex-task-board.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}
