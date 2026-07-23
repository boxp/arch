# Creates the CNAME record that routes grafana.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "argocd" {
  zone_id = var.zone_id
  name    = "argocd.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.argocd_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Creates the CNAME record that routes argocd-api.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "argocd_api" {
  zone_id = var.zone_id
  name    = "argocd-api.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.argocd_api_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
