# Creates the CNAME record that routes grafana.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "longhorn" {
  zone_id = var.zone_id
  name    = "longhorn"
  content = cloudflare_zero_trust_tunnel_cloudflared.longhorn_tunnel.cname
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
