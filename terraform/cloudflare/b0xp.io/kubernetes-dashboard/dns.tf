# Creates the CNAME record that routes kubernetes-dashboard.b0xp.io to the tunnel.
resource "cloudflare_record" "kubernetes_dashboard" {
  zone_id = var.zone_id
  name    = "kubernetes-dashboard"
  value   = cloudflare_tunnel.kubernetes_dashboard_tunnel.cname
  type    = "CNAME"
  proxied = true
}
