# Creates the CNAME record that routes hermes-agent.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "hermes_agent" {
  zone_id = var.zone_id
  name    = "hermes-agent"
  content = "\${cloudflare_zero_trust_tunnel_cloudflared.hermes_agent_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
