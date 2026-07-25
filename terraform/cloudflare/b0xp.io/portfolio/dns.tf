# Creates the CNAME record that routes b0xp.io to the cloudflare page.
resource "cloudflare_dns_record" "top" {
  zone_id = var.zone_id
  name    = "b0xp.io"
  content = cloudflare_pages_project.iikanji.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.b0xp.io"
  content = cloudflare_pages_project.iikanji.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
