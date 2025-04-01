# Creates the CNAME record that routes grafana-api.b0xp.io to the tunnel.
resource "cloudflare_record" "grafana_api" { # Renamed from argocd_api
  zone_id = var.zone_id
  name    = "grafana-api" # Changed from argocd-api
  # Points to the CNAME of the tunnel defined in tunnel.tf
  value   = cloudflare_tunnel.grafana_api_tunnel.cname # Changed from argocd_api_tunnel
  type    = "CNAME"
  proxied = true # Must be proxied for Cloudflare Access
}
