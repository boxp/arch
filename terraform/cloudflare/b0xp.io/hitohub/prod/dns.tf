# Creates the CNAME record that routes hitohub.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "hitohub_prod" {
  zone_id = var.zone_id
  name    = "hitohub"
  value   = cloudflare_zero_trust_tunnel_cloudflared.hitohub_prod_tunnel.cname
  type    = "CNAME"
  proxied = true
}

# Creates the CNAME record that routes hitohub.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "api_hitohub_prod" {
  zone_id = var.zone_id
  name    = "api-hitohub"
  value   = cloudflare_zero_trust_tunnel_cloudflared.hitohub_prod_tunnel.cname
  type    = "CNAME"
  proxied = true
}
