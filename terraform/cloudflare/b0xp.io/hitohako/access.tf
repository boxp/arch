# hitohako-stage.b0xp.io（BOXP-276 の stage 環境）を Cloudflare Access で本人限定にする。
#
# - stage は本人の表示確認用なので、既存アプリ（argocd / hermes-agent / hitohub stage 等）と同じ
#   GitHub IdP を再利用する。ただし include を login_method（= GitHub でログインした全員）にはせず、
#   boxp 本人の GitHub 公開プロフィールのメールアドレス（https://github.com/boxp の email、
#   かつ本リポジトリのコミット author）に限定し、require で GitHub IdP 経由であることを要求する。
#   BOXP-275 の portfolio-stage.b0xp.io（terraform/cloudflare/b0xp.io/portfolio/access.tf）と同じ方式。
# - noindex（meta / X-Robots-Tag）は併用するがアクセス制御の代替ではない。
#   ソースと画像は公開リポジトリ（boxp/arch apps/hitohako）にあるため、機微情報は引き続き置かない。
# - 本番（hitohako.b0xp.io は未作成）と既存他アプリの Access policy は変更しない。
# - pages.dev 直 URL / preview の迂回経路にも同じ policy を適用する（下の hitohako_stage_pages_dev）。

data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.account_id
}

locals {
  github_idp_id = [
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "github"
  ][0]

  # stage を閲覧できる本人の GitHub アカウントのメールアドレス（GitHub 公開プロフィールと同じ値）。
  stage_owner_emails = ["tiyotiyouda@gmail.com"]
}

resource "cloudflare_zero_trust_access_policy" "hitohako_stage_owner" {
  account_id = var.account_id
  name       = "policy for ${local.stage_domain} (owner only)"
  decision   = "allow"
  include = [
    for email in local.stage_owner_emails : {
      email = { email = email }
    }
  ]
  require = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "hitohako_stage" {
  zone_id          = var.zone_id
  name             = "Access application for ${local.stage_domain}"
  domain           = local.stage_domain
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.hitohako_stage_owner.id }]
}

# Cloudflare Pages の既定ドメイン（boxp-hitohako-stage.pages.dev と preview の *.boxp-hitohako-stage.pages.dev）。
# カスタムドメイン側だけ Access を付けても pages.dev 直 URL で迂回できるため、同じ policy で保護する。
# Pages ダッシュボードの "Access policy" トグルが作るものと同等の account スコープの application。
resource "cloudflare_zero_trust_access_application" "hitohako_stage_pages_dev" {
  account_id = var.account_id
  name       = "Access application for ${local.stage_project_name}.pages.dev"
  domain     = "${local.stage_project_name}.pages.dev"
  destinations = [
    { type = "public", uri = "${local.stage_project_name}.pages.dev" },
    { type = "public", uri = "*.${local.stage_project_name}.pages.dev" },
  ]
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.hitohako_stage_owner.id }]
}
