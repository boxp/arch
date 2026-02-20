resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_tunnel" "openclaw_tunnel" {
  account_id = var.account_id
  name       = "cloudflare openclaw tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_tunnel_config" "openclaw_tunnel" {
  tunnel_id  = cloudflare_tunnel.openclaw_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.openclaw.hostname
      service  = "http://openclaw.openclaw.svc.cluster.local:18789"
    }
    ingress_rule {
      hostname = cloudflare_record.board.hostname
      service  = "http://openclaw.openclaw.svc.cluster.local:8080"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "aws_ssm_parameter" "openclaw_tunnel_token" {
  name        = "/lolice/openclaw/tunnel-token"
  description = "for openclaw tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.openclaw_tunnel.tunnel_token)
}
