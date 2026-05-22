# Creates the CNAME record that routes k8s.b0xp.io to the tunnel.
resource "cloudflare_record" "k8s" {
  zone_id = var.zone_id
  name    = "k8s"
  content = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.cname
  type    = "CNAME"
  proxied = true
}

# Used by cloudflared/Gateway to resolve the private hostname to the
# Kubernetes Service IP. WARP clients should receive a Gateway initial
# resolved IP via the private hostname route, not this private IP directly.
resource "cloudflare_record" "codex_workspace" {
  zone_id = var.zone_id
  name    = "codex-workspace"
  content = "10.111.250.7"
  type    = "A"
  proxied = false
}
