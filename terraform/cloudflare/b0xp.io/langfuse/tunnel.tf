# BOXP-428: Owner UI route for the self-hosted Langfuse in lolice.
# Ingestion stays in-cluster: the public API is not published through the tunnel.
resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "langfuse_tunnel" {
  account_id    = var.account_id
  name          = "cloudflare langfuse tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "langfuse_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.langfuse_tunnel.id
  account_id = var.account_id
  config = {
    ingress = [
      {
        hostname = cloudflare_dns_record.langfuse.name
        path     = "^/api/public/"
        service  = "http_status:404"
      },
      {
        hostname = cloudflare_dns_record.langfuse.name
        service  = "http://langfuse-web.langfuse.svc.cluster.local:3000"
      },
      {
        service = "http_status:404"
      },
    ]
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "langfuse_tunnel" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.langfuse_tunnel.id
}

resource "aws_ssm_parameter" "langfuse_tunnel_token" {
  name        = "langfuse-tunnel-token"
  description = "for langfuse tunnel token"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.langfuse_tunnel.token)
}
