# ひとはこGBC の試遊ページ hitohako-gbc.b0xp.io（BOXP-629）。本人限定で、一般には公開しない。
#
# - 置く物はページとエミュレーターと ROM。非公開リポジトリ boxp/hitohako-gbc の CI が配布物だけを
#   非公開リポジトリ boxp/hitohako-gbc-play へ送り、.github/workflows/deploy-hitohako-gbc-play.yml が
#   それを読んでこの Pages project へ配備する（apps/hitohako-gbc-play）。
# - ページも ROM も同じ Pages project の中にあるので、下の Access application がどちらも本人限定にする。
#   方式は hitohako-stage（access.tf）と同じで、本人のメールアドレスを include、GitHub IdP を require。
# - pages.dev 直 URL と配備ごとの URL（*.pages.dev）にも同じ policy を付ける。
# - policy は stage の物を使い回さず、この置き場だけの物にする（stage 側の変更がここへ及ばないように）。
locals {
  gbc_play_project_name = "boxp-hitohako-gbc-play"
  gbc_play_domain       = "hitohako-gbc.b0xp.io"
}

resource "cloudflare_pages_project" "gbc_play" {
  account_id        = var.account_id
  name              = local.gbc_play_project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "gbc_play" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.gbc_play.name
  name         = local.gbc_play_domain
}

resource "cloudflare_dns_record" "gbc_play" {
  zone_id = var.zone_id
  name    = local.gbc_play_domain
  content = cloudflare_pages_project.gbc_play.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

resource "cloudflare_zero_trust_access_policy" "gbc_play_owner" {
  account_id = var.account_id
  name       = "policy for ${local.gbc_play_domain} (owner only)"
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

resource "cloudflare_zero_trust_access_application" "gbc_play" {
  zone_id          = var.zone_id
  name             = "Access application for ${local.gbc_play_domain}"
  domain           = local.gbc_play_domain
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.gbc_play_owner.id }]
}

resource "cloudflare_zero_trust_access_application" "gbc_play_pages_dev" {
  account_id = var.account_id
  name       = "Access application for ${local.gbc_play_project_name}.pages.dev"
  domain     = "${local.gbc_play_project_name}.pages.dev"
  destinations = [
    { type = "public", uri = "${local.gbc_play_project_name}.pages.dev" },
    { type = "public", uri = "*.${local.gbc_play_project_name}.pages.dev" },
  ]
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.gbc_play_owner.id }]

  # Pages project がまだ無いうちに作ると "domain does not belong to zone" で失敗する（#15359 の apply）。
  # project.name を参照していないので、順番を明示する。
  depends_on = [cloudflare_pages_project.gbc_play]
}
