# Creates the CNAME record that routes map.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "minecraft_map" {
  zone_id = var.zone_id
  name    = "map.b0xp.io"
  # Points to the CNAME of the tunnel defined in tunnel.tf
  content = "${cloudflare_zero_trust_tunnel_cloudflared.minecraft_map_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
