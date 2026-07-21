# Token rotation configuration
resource "time_rotating" "token_rotation" {
  rotation_days = 90
}

# Access application for bastion SSH
resource "cloudflare_zero_trust_access_application" "bastion" {
  zone_id                   = var.zone_id
  name                      = "Bastion SSH Access"
  domain                    = "bastion.b0xp.io"
  type                      = "ssh"
  session_duration          = "24h"
  policies                  = [{ id = cloudflare_zero_trust_access_policy.bastion.id }]
  service_auth_401_redirect = false
}

# Service token for GitHub Actions
resource "cloudflare_zero_trust_access_service_token" "github_actions" {
  account_id           = var.account_id
  name                 = "GitHub Actions - Ansible Bastion"

  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      time_rotating.token_rotation.id
    ]
  }
}

# Access policy allowing service token authentication
resource "cloudflare_zero_trust_access_policy" "bastion" {
  account_id = var.account_id
  name       = "GitHub Actions access policy for bastion"
  decision   = "non_identity"
  include = [{
    service_token = {
      token_id = cloudflare_zero_trust_access_service_token.github_actions.id
    }
  }]
}
