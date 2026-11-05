locals {
  page = "shanghai-4t4.pages.dev"
}

# Creates the CNAME record that routes b0xp.io to the cloudflare page.
resource "cloudflare_dns_record" "top" {
  zone_id = var.zone_id
  name    = "b0xp.io"
  content = local.page
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.b0xp.io"
  content = local.page
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

resource "cloudflare_dns_record" "iikanji" {
  zone_id = var.zone_id
  name    = "iikanji.b0xp.io"
  content = cloudflare_pages_project.iikanji.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# b0xp.io ポートフォリオ新サイトの stage 環境 (BOXP-275)。本番 b0xp.io / www.b0xp.io の CNAME は変更しない。
resource "cloudflare_dns_record" "portfolio_stage" {
  zone_id = var.zone_id
  name    = local.portfolio_stage_domain
  content = cloudflare_pages_project.portfolio_stage.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# BOXP-435: the Worker in apps/lolice-architecture answers every request on this hostname,
# so the record only has to be proxied. 100:: is Cloudflare's documented originless target.
# Created after the Access application so the hostname never resolves without Access.
resource "cloudflare_dns_record" "lolice_architecture" {
  zone_id = var.zone_id
  name    = local.lolice_architecture_domain
  content = "100::"
  type    = "AAAA"
  ttl     = 1
  proxied = true

  depends_on = [cloudflare_zero_trust_access_application.lolice_architecture]
}
