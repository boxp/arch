resource "random_password" "tunnel_secret" {
  length  = 64
  special = false
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "bastion" {
  account_id = var.account_id
  name       = "bastion tunnel for ansible"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "bastion" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.bastion.id
  account_id = var.account_id
  config = {
  ingress = [
    {
      hostname = cloudflare_dns_record.bastion.name
      service  = "ssh://localhost:2222"
    },
    {
      service = "http_status:404"
    },
  ]

  }
}


data "cloudflare_zero_trust_tunnel_cloudflared_token" "bastion" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.bastion.id
}
resource "aws_ssm_parameter" "tunnel_token" {
  name        = "bastion-tunnel-token"
  description = "Tunnel token for bastion pod"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.bastion.token)
}
