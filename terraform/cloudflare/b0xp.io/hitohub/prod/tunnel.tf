resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_tunnel" "hitohub_prod_tunnel" {
  account_id = var.account_id
  name       = "cloudflare hitohub-prod tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_tunnel_config" "hitohub_prod_tunnel" {
  tunnel_id  = cloudflare_tunnel.hitohub_prod_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.hitohub_prod.hostname
      service  = "http://hitohub-frontend:3000"
    }
    ingress_rule {
      hostname = cloudflare_record.api_hitohub_prod.hostname
      service  = "http://hitohub-back-end:8080"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "aws_ssm_parameter" "hitohub_prod_tunnel_token" {
  name        = "hitohub-prod-tunnel-token"
  description = "for hitohub prod tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.hitohub_prod_tunnel.tunnel_token)
}
