# Token rotation configuration
resource "time_rotating" "token_rotation" {
  rotation_days = 90
}

# Access application for bastion SSH
resource "cloudflare_access_application" "bastion" {
  zone_id                   = var.zone_id
  name                      = "Bastion SSH Access"
  domain                    = "bastion.b0xp.io"
  type                      = "ssh"
  session_duration          = "24h"
  service_auth_401_redirect = false
}

# Service token for GitHub Actions
resource "cloudflare_access_service_token" "github_actions" {
  account_id           = var.account_id
  name                 = "GitHub Actions - Ansible Bastion"
  min_days_for_renewal = 30

  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      time_rotating.token_rotation.id
    ]
  }
}

# Access policy allowing service token authentication
resource "cloudflare_access_policy" "bastion" {
  application_id = cloudflare_access_application.bastion.id
  zone_id        = var.zone_id
  name           = "GitHub Actions access policy for bastion"
  precedence     = "1"
  decision       = "non_identity"
  include {
    service_token = [cloudflare_access_service_token.github_actions.id]
  }
}
