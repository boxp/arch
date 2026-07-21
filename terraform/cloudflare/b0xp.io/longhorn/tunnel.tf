resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "longhorn_tunnel" {
  account_id    = var.account_id
  name          = "cloudflare longhorn tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "longhorn_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.longhorn_tunnel.id
  account_id = var.account_id
  config = {
    ingress = [
      {
        hostname = cloudflare_dns_record.longhorn.name
        service  = "http://longhorn-frontend:80"
      },
      {
        service = "http_status:404"
      },
    ]

  }
}


data "cloudflare_zero_trust_tunnel_cloudflared_token" "longhorn_tunnel" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.longhorn_tunnel.id
}
resource "aws_ssm_parameter" "longhorn_tunnel_token" {
  name        = "longhorn-tunnel-token"
  description = "for longhorn tunnel token"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.longhorn_tunnel.token)
}
