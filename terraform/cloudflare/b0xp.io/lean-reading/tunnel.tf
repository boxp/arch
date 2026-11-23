# BOXP-679: lolice argoproj/lean-reading の cloudflared が使う専用 tunnel。
resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "lean_reading" {
  account_id    = var.account_id
  name          = "cloudflare lean-reading tunnel"
  config_src    = "cloudflare"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "lean_reading" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.lean_reading.id

  config = {
    ingress = [
      {
        # cloudflared でも Access JWT（署名・issuer・この application の AUD）を
        # 検証し、Access を通っていない要求を拒否する。
        hostname = local.lean_reading_hostname
        service  = "http://code-server.lean-reading.svc.cluster.local:8080"
        origin_request = {
          access = {
            required  = true
            team_name = local.zero_trust_team_name
            aud_tag   = [cloudflare_zero_trust_access_application.lean_reading.aud]
          }
        }
      },
      {
        service = "http_status:404"
      }
    ]
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "lean_reading" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.lean_reading.id
}

resource "aws_ssm_parameter" "lean_reading_tunnel_token" {
  name        = "lean-reading-tunnel-token"
  description = "for lean-reading tunnel token (BOXP-679)"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.lean_reading.token)
}
