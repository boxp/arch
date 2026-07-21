locals {
  page = "shanghai-4t4.pages.dev"
}

# Creates the CNAME record that routes b0xp.io to the cloudflare page.
resource "cloudflare_dns_record" "top" {
  zone_id = var.zone_id
  name    = "@"
  value   = local.page
  type    = "CNAME"
  proxied = true
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www"
  value   = local.page
  type    = "CNAME"
  proxied = true
}
