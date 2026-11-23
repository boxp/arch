# BOXP-679: 読書実習用ブラウザ VS Code（code-server + Lean）の入口。
#
# code-server は端末とファイル操作を持つので、本人だけが開けるようにする。
# - kohako-studio と同じ方式: include は Owner の email のみ、require で既存の
#   GitHub IdP 経由のログインを要求する（WARP/One Client 不要でスマホから開ける）。
# - allowed_idps も GitHub のみ。ほかのポリシーは付けないので、それ以外は拒否。
# - tunnel 側でも Access JWT（この application の AUD）を検証する（tunnel.tf）。
# - code-server 自体は --auth none。認証は Access に一本化し、Pod へ届く経路は
#   lolice の NetworkPolicy で cloudflared（と検証用 codex-workspace）に限る。
data "cloudflare_zero_trust_organization" "current" {
  account_id = var.account_id
}

data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.account_id
}

locals {
  lean_reading_hostname     = "lean-reading.b0xp.io"
  lean_reading_owner_emails = ["tiyotiyouda@gmail.com"]
  github_idp_id = [
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "github"
  ][0]
  # <team>.cloudflareaccess.com -> <team>, used by cloudflared JWT validation.
  zero_trust_team_name = trimsuffix(data.cloudflare_zero_trust_organization.current.auth_domain, ".cloudflareaccess.com")
}

resource "cloudflare_zero_trust_access_policy" "lean_reading_owner" {
  account_id = var.account_id
  name       = "policy for ${local.lean_reading_hostname} (owner via GitHub)"
  decision   = "allow"
  include = [
    for email in local.lean_reading_owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "lean_reading" {
  zone_id                     = var.zone_id
  name                        = "Access application for ${local.lean_reading_hostname}"
  domain                      = local.lean_reading_hostname
  type                        = "self_hosted"
  session_duration            = "24h"
  allow_authenticate_via_warp = false
  allowed_idps                = [local.github_idp_id]
  auto_redirect_to_identity   = true
  enable_binding_cookie       = false
  http_only_cookie_attribute  = true
  same_site_cookie_attribute  = "lax"
  app_launcher_visible        = false
  policies                    = [{ id = cloudflare_zero_trust_access_policy.lean_reading_owner.id }]
}
