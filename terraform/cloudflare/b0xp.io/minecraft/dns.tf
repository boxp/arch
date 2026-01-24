# Creates the CNAME record that routes map.b0xp.io to the tunnel.
resource "cloudflare_record" "minecraft_map" {
  zone_id = var.zone_id
  name    = "map"
  # Points to the CNAME of the tunnel defined in tunnel.tf
  value   = cloudflare_tunnel.minecraft_map_tunnel.cname
  type    = "CNAME"
  proxied = true
}
