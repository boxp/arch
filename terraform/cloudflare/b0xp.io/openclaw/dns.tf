# Creates the CNAME record that routes openclaw.b0xp.io to the tunnel.
resource "cloudflare_record" "openclaw" {
  zone_id = var.zone_id
  name    = "openclaw"
  value   = cloudflare_tunnel.openclaw_tunnel.cname
  type    = "CNAME"
  proxied = true
}
