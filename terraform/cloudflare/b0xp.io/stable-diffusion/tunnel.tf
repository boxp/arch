resource "random_password" "tunnel_secret" {
  length  = 64
  special = false
}

resource "cloudflare_tunnel" "stable_diffusion" {
  account_id = var.account_id
  name       = "cloudflare stable-diffusion tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_tunnel_config" "stable_diffusion" {
  tunnel_id  = cloudflare_tunnel.stable_diffusion.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.stable_diffusion.hostname
      service  = "http://stable-diffusion-webui.stable-diffusion.svc.cluster.local:7860"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "aws_ssm_parameter" "stable_diffusion_tunnel_token" {
  name        = "stable-diffusion-tunnel-token"
  description = "for stable-diffusion tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.stable_diffusion.tunnel_token)
}

