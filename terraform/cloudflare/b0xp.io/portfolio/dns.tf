locals {
  page = "shanghai-4t4.pages.dev"
}

# Creates the CNAME record that routes b0xp.io to the cloudflare page.
resource "cloudflare_dns_record" "top" {
  zone_id = var.zone_id
  name    = "@"
  content = local.page
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www"
  content = local.page
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
