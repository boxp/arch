# Creates an Access application to control who can connect.
resource "cloudflare_access_application" "openclaw" {
  zone_id          = var.zone_id
  name             = "Access application for openclaw.b0xp.io"
  domain           = "openclaw.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

# Creates an Access policy for the application.
resource "cloudflare_access_policy" "openclaw_policy" {
  application_id = cloudflare_access_application.openclaw.id
  zone_id        = var.zone_id
  name           = "policy for openclaw.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}

# Creates an Access application for board.b0xp.io
resource "cloudflare_access_application" "board" {
  zone_id          = var.zone_id
  name             = "Access application for board.b0xp.io"
  domain           = "board.b0xp.io"
  session_duration = "24h"
}

# Creates an Access policy for the board application.
resource "cloudflare_access_policy" "board_policy" {
  application_id = cloudflare_access_application.board.id
  zone_id        = var.zone_id
  name           = "policy for board.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}
