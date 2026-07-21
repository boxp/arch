# Creates the CNAME record that routes kubernetes-dashboard.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "kubernetes_dashboard" {
  zone_id = var.zone_id
  name    = "kubernetes-dashboard"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.kubernetes_dashboard_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
