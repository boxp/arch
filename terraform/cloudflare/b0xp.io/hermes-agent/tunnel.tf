resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "hermes_agent_tunnel" {
  account_id = var.account_id
  name       = "cloudflare hermes-agent tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "hermes_agent_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.hermes_agent_tunnel.id
  account_id = var.account_id
  config = {
  ingress = [
    {
      hostname = "${cloudflare_dns_record.hermes_agent.name}.b0xp.io"
      service  = "http://127.0.0.1:9119"
      origin_request = {
      http_host_header = "127.0.0.1:9119"
      }
    },
    {
      service = "http_status:404"
    },
  ]

  }
}

resource "aws_ssm_parameter" "hermes_agent_tunnel_token" {
  name        = "hermes-agent-tunnel-token"
  description = "for hermes-agent tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_tunnel_cloudflared.hermes_agent_tunnel.tunnel_token)
}
