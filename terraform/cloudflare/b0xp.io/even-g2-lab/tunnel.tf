resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "even_g2_lab" {
  account_id    = var.account_id
  name          = "cloudflare even-g2-lab tunnel"
  config_src    = "cloudflare"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_zero_trust_network_hostname_route" "even_g2_main" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.even_g2_lab.id
  hostname   = "even-g2-main.b0xp.io"
  comment    = "lolice even-g2-lab main app private hostname"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "even_g2_lab" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.even_g2_lab.id

  config = {
    ingress = [
      {
        hostname = cloudflare_zero_trust_network_hostname_route.even_g2_main.hostname
        service  = "http://even-g2-main.even-g2-lab.svc.cluster.local:80"
      },
      {
        service = "http_status:404"
      }
    ]
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "even_g2_lab" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.even_g2_lab.id
}

resource "aws_ssm_parameter" "even_g2_lab_tunnel_token" {
  name        = "even-g2-lab-tunnel-token"
  description = "for even-g2-lab tunnel token"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.even_g2_lab.token)
}
