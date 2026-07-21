resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "hitohub_stage_tunnel" {
  account_id = var.account_id
  name       = "cloudflare hitohub-stage tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "hitohub_stage_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.hitohub_stage_tunnel.id
  account_id = var.account_id
  config = {
  ingress = [
    {
      hostname = "${cloudflare_dns_record.hitohub_stage.name}.b0xp.io"
      service  = "http://hitohub-frontend:3000"
    },
    {
      hostname = "${cloudflare_dns_record.api_hitohub_stage.name}.b0xp.io"
      service  = "http://hitohub-back-end:8080"
    },
    {
      service = "http_status:404"
    },
  ]

  }
}


data "cloudflare_zero_trust_tunnel_cloudflared_token" "hitohub_stage_tunnel" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.hitohub_stage_tunnel.id
}
resource "aws_ssm_parameter" "hitohub_stage_tunnel_token" {
  name        = "hitohub-stage-tunnel-token"
  description = "for hitohub stage tunnel token"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.hitohub_stage_tunnel.token)
}
