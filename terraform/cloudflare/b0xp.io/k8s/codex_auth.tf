# BOXP-634: Owner-only login page for the AI CLIs of codex-workspace
# (codex-auth.b0xp.io). The page (docker/codex-workspace/auth-gateway) starts
# only the fixed official login commands, never a general shell.
#
# Three checks have to pass, each on its own:
# 1. Access: the Owner's email AND a login through the existing GitHub IdP
#    (same shape as kohako_studio_owner in ../even-g2-lab/access.tf; GitHub
#    alone would admit any GitHub user, a one-time PIN or WARP session alone
#    would skip GitHub). No other policy is attached, so everything else is
#    denied.
# 2. cloudflared: the tunnel ingress requires a valid Access JWT for this
#    application's AUD (tunnel.tf).
# 3. The gateway itself verifies the JWT signature, issuer, AUD, expiry and the
#    Owner's email again, and checks Origin on state changes.
#
# The Access session is short (1h) and bound to the browser (binding cookie),
# because the page can replace the CLI logins.

locals {
  codex_auth_hostname     = "codex-auth.b0xp.io"
  codex_auth_owner_emails = ["tiyotiyouda@gmail.com"]
  zero_trust_team_name    = trimsuffix(data.cloudflare_zero_trust_organization.current.auth_domain, ".cloudflareaccess.com")
}

resource "cloudflare_zero_trust_access_policy" "codex_auth_owner" {
  account_id = var.account_id
  name       = "policy for ${local.codex_auth_hostname} (owner via GitHub)"
  decision   = "allow"
  include = [
    for email in local.codex_auth_owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "codex_auth" {
  zone_id                     = var.zone_id
  name                        = "Access application for ${local.codex_auth_hostname}"
  domain                      = local.codex_auth_hostname
  type                        = "self_hosted"
  session_duration            = "1h"
  allow_authenticate_via_warp = false
  allowed_idps                = [local.github_idp_id]
  auto_redirect_to_identity   = true
  enable_binding_cookie       = true
  http_only_cookie_attribute  = true
  same_site_cookie_attribute  = "lax"
  app_launcher_visible        = false
  policies                    = [{ id = cloudflare_zero_trust_access_policy.codex_auth_owner.id }]
}

# Published only after the Access application and the JWT-checking ingress
# exist, so the hostname never reaches the tunnel without Access in front.
resource "cloudflare_dns_record" "codex_auth" {
  zone_id = var.zone_id
  name    = local.codex_auth_hostname
  content = "${cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true

  depends_on = [
    cloudflare_zero_trust_access_application.codex_auth,
    cloudflare_zero_trust_tunnel_cloudflared_config.k8s_tunnel,
  ]
}

# Non-secret: the AUD is visible in Access login redirects. The lolice manifest
# passes it to the gateway (CODEX_AUTH_GATEWAY_AUD).
output "codex_auth_access_aud" {
  description = "AUD tag of the codex-auth.b0xp.io Access application (set as CODEX_AUTH_GATEWAY_AUD in lolice)."
  value       = cloudflare_zero_trust_access_application.codex_auth.aud
}
