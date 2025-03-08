# Creates the CNAME record that routes grafana.b0xp.io to the tunnel.
resource "cloudflare_record" "argocd" {
  zone_id = var.zone_id
  name    = "argocd"
  value   = cloudflare_tunnel.argocd_tunnel.cname
  type    = "CNAME"
  proxied = true
}

# Creates the CNAME record that routes argocd-api.b0xp.io to the tunnel.
resource "cloudflare_record" "argocd_api" {
  zone_id = var.zone_id
  name    = "argocd-api"
  value   = cloudflare_tunnel.argocd_api_tunnel.cname
  type    = "CNAME"
  proxied = true
}
