resource "random_password" "tunnel_secret" {
  length  = 64
  special = false
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "stable_diffusion" {
  account_id    = var.account_id
  name          = "cloudflare stable-diffusion tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "stable_diffusion" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.stable_diffusion.id
  account_id = var.account_id
  config = {
    ingress = [
      {
        hostname = cloudflare_dns_record.stable_diffusion.name
        service  = "http://stable-diffusion-webui.stable-diffusion.svc.cluster.local:7860"
      },
      {
        service = "http_status:404"
      },
    ]

  }
}


data "cloudflare_zero_trust_tunnel_cloudflared_token" "stable_diffusion" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.stable_diffusion.id
}
resource "aws_ssm_parameter" "stable_diffusion_tunnel_token" {
  name        = "stable-diffusion-tunnel-token"
  description = "for stable-diffusion tunnel token"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.stable_diffusion.token)
}

