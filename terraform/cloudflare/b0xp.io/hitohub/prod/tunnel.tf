resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "hitohub_prod_tunnel" {
  account_id    = var.account_id
  name          = "cloudflare hitohub-prod tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "hitohub_prod_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.hitohub_prod_tunnel.id
  account_id = var.account_id
  config = {
    ingress = [
      {
        hostname = cloudflare_dns_record.hitohub_prod.name
        service  = "http://hitohub-frontend:3000"
      },
      {
        hostname = cloudflare_dns_record.api_hitohub_prod.name
        service  = "http://hitohub-back-end:8080"
      },
      {
        service = "http_status:404"
      },
    ]

  }
}


data "cloudflare_zero_trust_tunnel_cloudflared_token" "hitohub_prod_tunnel" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.hitohub_prod_tunnel.id
}
resource "aws_ssm_parameter" "hitohub_prod_tunnel_token" {
  name        = "hitohub-prod-tunnel-token"
  description = "for hitohub prod tunnel token"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.hitohub_prod_tunnel.token)
}
