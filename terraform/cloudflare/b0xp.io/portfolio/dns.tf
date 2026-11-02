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
