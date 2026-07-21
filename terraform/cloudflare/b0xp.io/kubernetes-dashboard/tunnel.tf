# ランダムな秘密トークンの生成
resource "random_password" "tunnel_secret" {
  length  = 64
  special = false
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "kubernetes_dashboard_tunnel" {
  account_id = var.account_id
  name       = "cloudflare kubernetes-dashboard tunnel"
  secret     = base64sha256(random_password.tunnel_secret.result)
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "kubernetes_dashboard_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.kubernetes_dashboard_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_dns_record.kubernetes_dashboard.hostname
      service  = "https://kubernetes-dashboard-lb.kube-dashboard:443"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "aws_ssm_parameter" "kubernetes_dashboard_tunnel_token" {
  name        = "kubernetes-dashboard-tunnel-token"
  description = "for kubernetes-dashboard tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_tunnel_cloudflared.kubernetes_dashboard_tunnel.tunnel_token)
}
