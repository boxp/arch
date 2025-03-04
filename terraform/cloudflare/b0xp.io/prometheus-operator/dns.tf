# Creates the CNAME record that routes grafana.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "grafana" {
  zone_id = var.zone_id
  name    = "grafana"
  content = cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.cname
  type    = "CNAME"
  proxied = true
}

# Creates the CNAME record that routes prometheus-web.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "prometheus_web" {
  zone_id = var.zone_id
  name    = "prometheus-web"
  content = cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.cname
  type    = "CNAME"
  proxied = true
}
