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
  kohako_g2_hostname   = "kohako-g2.b0xp.io"
  # Same Owner email as hitohako-stage / portfolio-stage, and the user shown on
  # the Owner's enrolled Android device (BOXP-324 4-6-8).
  kohako_g2_owner_emails = ["tiyotiyouda@gmail.com"]
  # <team>.cloudflareaccess.com -> <team>, used by cloudflared JWT validation.
  zero_trust_team_name = trimsuffix(data.cloudflare_zero_trust_organization.current.auth_domain, ".cloudflareaccess.com")
}

# BOXP-328: request came through this organization's Gateway from an enrolled
# Cloudflare One Client.
#
# BOXP-670: description は設定しない。type = "gateway" の posture rule は API が
# 書き込み時に description を受け付けるが GET では返さないため、cloudflare
# provider 5.29.0 までは refresh のたびに state が null に戻り、毎回
# 「+ description / enabled (known after apply)」の 1 change が出ていた
# (cloudflare/terraform-provider-cloudflare#7461、修正は 5.29.0 より後のリリース)。
# description は判定に使われない表示用の値で、Cloudflare 側に保存済みの値は
# この変更では消えない（Optional+Computed のため null 設定は「変更なし」になる）。
resource "cloudflare_zero_trust_device_posture_rule" "require_gateway" {
  account_id = var.account_id
  name       = "Require Gateway"
  type       = "gateway"
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
  zone_id = var.zone_id
  name    = "Access application for ${local.kohako_studio_hostname}"
  domain  = local.kohako_studio_hostname
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

# BOXP-736: 個人 WARP 不要・本人限定の試験入口 kohako-g2-trial.b0xp.io。
# 会社の Cloudflare One client を使っている間は個人組織の WARP に切り替えられず、
# 現行入口（kohako_g2: Owner email AND Require Gateway）を開けない。現行入口は
# 変えずに、別 hostname・別 Access application で本人限定の入口を試す。
# - BOXP-736 TD-04（Owner 承認 2026-11-28 案B）: 当初の GitHub ログインは Even App
#   内で GitHub の 404 になった（POST /session の 302 で発行された cookie が次の
#   GET に載らないと読める）。試験アプリだけ IdP を account 既存の one-time PIN
#   （Owner email にコードをメール送信）に替える。GitHub への遷移が無くなる。
# - include は Owner の email のみ、require は one-time PIN IdP 経由のログイン。
#   GitHub ログインや One Client session の email 一致だけでは通らない。
#   allowed_idps も one-time PIN のみ。強さは「GitHub + 2FA」から「Owner の
#   メールアカウント」に下がる（試験入口のみ。現行入口・Studio は不変）。
# - One Client 認証は使わない（allow_authenticate_via_warp = false）。
# - AUD は現行アプリと別。tunnel ingress がこの hostname にこの AUD の JWT だけを
#   要求するので、現行アプリの JWT を試験 hostname に持ち込んでも通らない（逆も同じ）。
# - 試験をやめる時はこの block と tunnel.tf / dns.tf の試験分を消す（fail-closed）。
locals {
  kohako_g2_trial_hostname = "kohako-g2-trial.b0xp.io"
  # account に既存の one-time PIN IdP（IaC 管理外、1 account に 1 つ）。
  # 無ければ plan が index error で止まる（fail-closed）。
  onetimepin_idp_id = [
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "onetimepin"
  ][0]
}

resource "cloudflare_zero_trust_access_policy" "kohako_g2_trial_owner" {
  account_id = var.account_id
  name       = "policy for ${local.kohako_g2_trial_hostname} (owner via one-time PIN, trial)"
  decision   = "allow"
  include = [
    for email in local.kohako_g2_owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.onetimepin_idp_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "kohako_g2_trial" {
  zone_id                     = var.zone_id
  name                        = "Access application for ${local.kohako_g2_trial_hostname}"
  domain                      = local.kohako_g2_trial_hostname
  type                        = "self_hosted"
  session_duration            = "24h"
  allow_authenticate_via_warp = false
  allowed_idps                = [local.onetimepin_idp_id]
  auto_redirect_to_identity   = true
  enable_binding_cookie       = false
  http_only_cookie_attribute  = true
  same_site_cookie_attribute  = "lax"
  app_launcher_visible        = false
  policies                    = [{ id = cloudflare_zero_trust_access_policy.kohako_g2_trial_owner.id }]
}
