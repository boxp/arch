# Creates the CNAME record that routes k8s.b0xp.io to the tunnel.
resource "cloudflare_record" "k8s" {
  zone_id = var.zone_id
  name    = "k8s"
  content = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.cname
  type    = "CNAME"
  proxied = true
}
