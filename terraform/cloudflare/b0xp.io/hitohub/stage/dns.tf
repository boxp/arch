# Creates the CNAME record that routes hitohub-stage.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "hitohub_stage" {
  zone_id = var.zone_id
  name    = "hitohub-stage"
  content = "\${cloudflare_zero_trust_tunnel_cloudflared.hitohub_stage_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Creates the CNAME record that routes hitohub-stage.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "api_hitohub_stage" {
  zone_id = var.zone_id
  name    = "api-hitohub-stage"
  content = "\${cloudflare_zero_trust_tunnel_cloudflared.hitohub_stage_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
