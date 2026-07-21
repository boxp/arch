# Secret for the tunnel
resource "random_password" "tunnel_secret" {
  length = 64
}

# Grafana API用のトンネルを作成
resource "cloudflare_zero_trust_tunnel_cloudflared" "grafana_api_tunnel" { # Renamed from argocd_api_tunnel
  account_id = var.account_id
  name       = "cloudflare grafana-api tunnel" # Changed from argocd-api
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Grafana API用トンネル設定
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "grafana_api_tunnel" { # Renamed from argocd_api_tunnel
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.grafana_api_tunnel.id     # Changed from argocd_api_tunnel
  account_id = var.account_id
  config = {
  ingress = [
    {
      # Hostname from dns.tf
      hostname = cloudflare_dns_record.grafana_api.hostname # Changed from argocd_api
      # Internal Grafana service address (adjust if necessary)
      service = "http://grafana.monitoring.svc.cluster.local:3000" # Use 'grafana' service in 'monitoring' namespace
    },
    {
      service = "http_status:404"
    },
  ]

  }
}

# Grafana API用トンネルトークンをSSMに保存
resource "aws_ssm_parameter" "grafana_api_tunnel_token" { # Renamed from argocd_api_tunnel_token
  name        = "grafana-api-tunnel-token"                # Changed from argocd-api
  description = "for grafana-api tunnel token"            # Changed from argocd-api
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_tunnel_cloudflared.grafana_api_tunnel.tunnel_token) # Changed from argocd_api_tunnel
}
