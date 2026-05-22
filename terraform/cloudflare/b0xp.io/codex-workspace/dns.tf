# Used by cloudflared/Gateway to resolve the private hostname to the
# Kubernetes Service IP. WARP clients should receive a Gateway initial
# resolved IP via the private hostname route, not this private IP directly.
resource "cloudflare_dns_record" "codex_workspace" {
  zone_id = var.zone_id
  name    = "codex-workspace"
  content = "10.111.250.7"
  type    = "A"
  proxied = false
  ttl     = 1
}
