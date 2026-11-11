removed {
  from = cloudflare_access_policy.stable_diffusion_github
  lifecycle {
    destroy = false
  }
}

# Remove stale v5 state entry that has old app-scoped ID from v4->v5 migration.
removed {
  from = cloudflare_zero_trust_access_policy.stable_diffusion_github
  lifecycle {
    destroy = false
  }
}

resource "cloudflare_zero_trust_access_application" "stable_diffusion" {
  zone_id          = var.zone_id
  name             = "Access application for sd-webui.b0xp.io"
  domain           = "sd-webui.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.stable_diffusion_access.id }]
}

# BOXP-498: comfyui.b0xp.io は本人限定にする。
#
# sd-webui.b0xp.io の policy は include が login_method だけで、GitHub でログインした全員を通す。
# ComfyUI は利用者が組んだ workflow を実行し、入口から LLM の停止（GPU 切替）も起こせるため、
# その範囲では公開しない。hitohako-stage / portfolio-stage と同じ方式で、boxp 本人の GitHub
# メールアドレスに限定し、require で GitHub IdP 経由であることを要求する。
# BOXP-502: sd-webui.b0xp.io も同じ本人限定 policy 形式へ変更した（下の stable_diffusion_access）。
locals {
  owner_emails = ["tiyotiyouda@gmail.com"]
}

resource "cloudflare_zero_trust_access_policy" "comfyui_owner" {
  account_id = var.account_id
  name       = "policy for comfyui.b0xp.io (owner only)"
  decision   = "allow"
  include = [
    for email in local.owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "comfyui" {
  zone_id          = var.zone_id
  name             = "Access application for comfyui.b0xp.io"
  domain           = "comfyui.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.comfyui_owner.id }]
}

data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.account_id
}

locals {
  github_idp_id = [
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "github"
  ][0]
}

# BOXP-502: sd-webui.b0xp.io も GitHub ログイン全員ではなく本人限定にする。
# comfyui_owner と同型（本人メールを include、GitHub IdP を require）。policy は in-place 更新し、
# application と policy の ID は変えない。（BOXP-502 readback 用の検証 PR。merge しない）
resource "cloudflare_zero_trust_access_policy" "stable_diffusion_access" {
  account_id = var.account_id
  name       = "policy for sd-webui.b0xp.io"
  decision   = "allow"
  include = [
    for email in local.owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}
