# Creates the CNAME record that routes hermes-agent.b0xp.io to the tunnel.
resource "cloudflare_record" "hermes_agent" {
  zone_id = var.zone_id
  name    = "hermes-agent"
  value   = cloudflare_tunnel.hermes_agent_tunnel.cname
  type    = "CNAME"
  proxied = true
}
