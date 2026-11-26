# BOXP-714: Owner-only entrance to the Pi Web trial (https://pi-web.b0xp.io).
# pi-web-agent runs inside the codex-workspace Pod; its API has no
# authentication, so four checks stand in front of it, each on its own:
# 1. Access: the Owner's email AND a login through the existing GitHub IdP
#    (same shape as codex_auth_owner). No other policy, so everything else is
#    denied.
# 2. cloudflared: the tunnel ingress requires a valid Access JWT for this
#    application's AUD (tunnel.tf).
# 3. lolice Calico: only the k8s cloudflared reaches the Pod's port 4319.
# 4. The gate (scripts/pi-web-trial/gate/gate.ts) verifies the JWT signature,
#    issuer, AUD, expiry and the Owner's email again, plus Host/Origin.
# Rules: Obsidian Projects/pi-web-agent-trial/spec.md「Cloudflare Access 入口」.

locals {
  pi_web_trial_hostname     = "pi-web.b0xp.io"
  pi_web_trial_owner_emails = ["tiyotiyouda@gmail.com"]
}

resource "cloudflare_zero_trust_access_policy" "pi_web_trial_owner" {
  account_id = var.account_id
  name       = "policy for ${local.pi_web_trial_hostname} (owner via GitHub)"
  decision   = "allow"
  include = [
    for email in local.pi_web_trial_owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "pi_web_trial" {
  zone_id                     = var.zone_id
  name                        = "Access application for ${local.pi_web_trial_hostname}"
  domain                      = local.pi_web_trial_hostname
  type                        = "self_hosted"
  session_duration            = "24h"
  allow_authenticate_via_warp = false
  allowed_idps                = [local.github_idp_id]
  auto_redirect_to_identity   = true
  enable_binding_cookie       = false
  http_only_cookie_attribute  = true
  same_site_cookie_attribute  = "lax"
  app_launcher_visible        = false
  policies                    = [{ id = cloudflare_zero_trust_access_policy.pi_web_trial_owner.id }]
}

# Published only after the Access application and the JWT-checking ingress
# exist, so the hostname never reaches the tunnel without Access in front.
resource "cloudflare_dns_record" "pi_web_trial" {
  zone_id = var.zone_id
  name    = local.pi_web_trial_hostname
  content = "${cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true

  depends_on = [
    cloudflare_zero_trust_access_application.pi_web_trial,
    cloudflare_zero_trust_tunnel_cloudflared_config.k8s_tunnel,
  ]
}

# Non-secret: the AUD is visible in Access login redirects. It goes into the
# gate's ~/.local/share/pi-web-trial/access.json in codex-workspace.
output "pi_web_trial_access_aud" {
  description = "AUD tag of the pi-web.b0xp.io Access application (aud in pi-web-trial access.json)."
  value       = cloudflare_zero_trust_access_application.pi_web_trial.aud
}
