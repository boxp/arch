resource "random_password" "tunnel_secret" {
  length  = 64
  special = false
}

resource "cloudflare_tunnel" "bastion" {
  account_id = var.account_id
  name       = "bastion tunnel for ansible"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_tunnel_config" "bastion" {
  tunnel_id  = cloudflare_tunnel.bastion.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.bastion.hostname
      service  = "ssh://localhost:2222"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "aws_ssm_parameter" "tunnel_token" {
  name        = "bastion-tunnel-token"
  description = "Tunnel token for bastion pod"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.bastion.tunnel_token)
}
