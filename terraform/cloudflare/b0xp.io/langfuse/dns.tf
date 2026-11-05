# BOXP-428: routes langfuse.b0xp.io to the tunnel. Behind Access (access.tf).
resource "cloudflare_dns_record" "langfuse" {
  zone_id = var.zone_id
  name    = "langfuse.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.langfuse_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
