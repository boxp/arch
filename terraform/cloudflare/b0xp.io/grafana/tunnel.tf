# Secret for the tunnel
resource "random_password" "tunnel_secret" {
  length = 64
}

# Grafana API用のトンネルを作成
resource "cloudflare_tunnel" "grafana_api_tunnel" { # Renamed from argocd_api_tunnel
  account_id = var.account_id
  name       = "cloudflare grafana-api tunnel" # Changed from argocd-api
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Grafana API用トンネル設定
resource "cloudflare_tunnel_config" "grafana_api_tunnel" { # Renamed from argocd_api_tunnel
  tunnel_id  = cloudflare_tunnel.grafana_api_tunnel.id # Changed from argocd_api_tunnel
  account_id = var.account_id
  config {
    ingress_rule {
      # Hostname from dns.tf
      hostname = cloudflare_record.grafana_api.hostname # Changed from argocd_api
      # Internal Grafana service address (adjust if necessary)
      service  = "http://prometheus-grafana.monitoring.svc.cluster.local:80" # Changed from argocd-server
    }
    # Default rule: return 404 for unmatched requests
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# Grafana API用トンネルトークンをSSMに保存
resource "aws_ssm_parameter" "grafana_api_tunnel_token" { # Renamed from argocd_api_tunnel_token
  name        = "grafana-api-tunnel-token" # Changed from argocd-api
  description = "for grafana-api tunnel token" # Changed from argocd-api
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.grafana_api_tunnel.tunnel_token) # Changed from argocd_api_tunnel
}
