# Creates the CNAME record that routes hitohub.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "hitohub_prod" {
  zone_id = var.zone_id
  name    = "hitohub.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.hitohub_prod_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Creates the CNAME record that routes hitohub.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "api_hitohub_prod" {
  zone_id = var.zone_id
  name    = "api-hitohub.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.hitohub_prod_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
