# Creates the CNAME record that routes grafana.b0xp.io to the tunnel.
resource "cloudflare_record" "grafana" {
  zone_id = var.zone_id
  name    = "grafana"
  value   = cloudflare_tunnel.prometheus_operator_tunnel.cname
  type    = "CNAME"
  proxied = true
}

# Creates the CNAME record that routes prometheus-web.b0xp.io to the tunnel.
resource "cloudflare_record" "prometheus_web" {
  zone_id = var.zone_id
  name    = "prometheus-web"
  value   = cloudflare_tunnel.prometheus_operator_tunnel.cname
  type    = "CNAME"
  proxied = true
}
