# BOXP-328 (Slice 1 of the BOXP-324 design): Owner-only Access in front of the
# Kohako G2 published route (kohako-g2.b0xp.io, see dns.tf / tunnel.tf).
#
# - Identity comes from "Authenticate with Cloudflare One Client" (client
#   sessions). The organization-wide session duration is set in
#   ../k8s/zero_trust_organization.tf; it is enabled here for this application
#   only (the organization "apply to all applications" stays off).
# - The single allow policy requires BOTH the Owner's email AND the
#   "Require Gateway" device posture. Require Gateway only proves that the
#   request came through this organization's Gateway from an enrolled client
#   (codex-workspace is also enrolled, with a service token), so it is never
#   treated as Owner authentication on its own. Everything else is denied by
#   default because no other policy is attached.
# - Binding Cookie cannot be combined with client session authentication
#   (Cloudflare docs), so it stays off. Stolen-cookie replay is limited by
#   Require Gateway, which is evaluated on every request for self-hosted apps.
# - login_method is not required: the IdP used to enroll the Owner's device is
#   not confirmed yet, and requiring the wrong one would lock the Owner out.

data "cloudflare_zero_trust_organization" "current" {
  account_id = var.account_id
}

locals {
  kohako_studio_hostname = "kohako-studio.b0xp.io"
  # BOXP-500 TD-01: 覚えやすい本命入口。Studio と同じ Access application の
  # 追加 destination にして AUD を共有する（BFF は単一 AUD を検証するため）。
  kohako_home_hostname = "kohako-home.b0xp.io"
  kohako_g2_hostname     = "kohako-g2.b0xp.io"
  # Same Owner email as hitohako-stage / portfolio-stage, and the user shown on
  # the Owner's enrolled Android device (BOXP-324 4-6-8).
  kohako_g2_owner_emails = ["tiyotiyouda@gmail.com"]
  # <team>.cloudflareaccess.com -> <team>, used by cloudflared JWT validation.
  zero_trust_team_name = trimsuffix(data.cloudflare_zero_trust_organization.current.auth_domain, ".cloudflareaccess.com")
}

resource "cloudflare_zero_trust_device_posture_rule" "require_gateway" {
  account_id  = var.account_id
  name        = "Require Gateway"
  description = "BOXP-328: request came through this organization's Gateway from an enrolled Cloudflare One Client"
  type        = "gateway"
}

resource "cloudflare_zero_trust_access_policy" "kohako_g2_owner" {
  account_id = var.account_id
  name       = "policy for ${local.kohako_g2_hostname} (owner via One Client + Gateway)"
  decision   = "allow"
  include = [
    for email in local.kohako_g2_owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    device_posture = {
      integration_uid = cloudflare_zero_trust_device_posture_rule.require_gateway.id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "kohako_g2" {
  zone_id                     = var.zone_id
  name                        = "Access application for ${local.kohako_g2_hostname}"
  domain                      = local.kohako_g2_hostname
  type                        = "self_hosted"
  session_duration            = "24h"
  allow_authenticate_via_warp = true
  enable_binding_cookie       = false
  http_only_cookie_attribute  = true
  same_site_cookie_attribute  = "lax"
  app_launcher_visible        = false
  policies                    = [{ id = cloudflare_zero_trust_access_policy.kohako_g2_owner.id }]
}

# BOXP-441: コード/モデルの公開許可は画面の Access 解除ではない。
# Studio は端末非依存の Web UI なので、G2 用の kohako_g2_owner（Owner email AND
# Require Gateway）を流用せず専用 policy に分離する（Owner 指定 2026-11-06:
# One Client/WARP 不要・GitHub 認証のみ）。
# - include は Owner の email のみ（GitHub でログインした全員ではない）。
# - require で既存 GitHub IdP 経由のログインを要求し、他 IdP（one-time PIN 等）や
#   WARP client session での email 一致だけでは通らない。
# - allowed_idps も GitHub のみにし、ログイン画面に他の入口を出さない。
# - kohako_g2_owner / kohako_g2 application と tunnel の AUD 検証は変更しない。
data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.account_id
}

locals {
  github_idp_id = [
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "github"
  ][0]
}

resource "cloudflare_zero_trust_access_policy" "kohako_studio_owner" {
  account_id = var.account_id
  name       = "policy for ${local.kohako_studio_hostname} (owner via GitHub)"
  decision   = "allow"
  include = [
    for email in local.kohako_g2_owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "kohako_studio" {
  zone_id                     = var.zone_id
  name                        = "Access application for ${local.kohako_studio_hostname}"
  domain                      = local.kohako_studio_hostname
  destinations = [
    { type = "public", uri = local.kohako_studio_hostname },
    { type = "public", uri = local.kohako_home_hostname },
  ]
  type                        = "self_hosted"
  session_duration            = "24h"
  allow_authenticate_via_warp = false
  allowed_idps                = [local.github_idp_id]
  auto_redirect_to_identity   = true
  enable_binding_cookie       = false
  http_only_cookie_attribute  = true
  same_site_cookie_attribute  = "lax"
  app_launcher_visible        = false
  policies                    = [{ id = cloudflare_zero_trust_access_policy.kohako_studio_owner.id }]
}
