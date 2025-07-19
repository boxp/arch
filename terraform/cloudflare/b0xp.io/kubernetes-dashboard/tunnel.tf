data "aws_ssm_parameter" "kubernetes_dashboard_tunnel_secret" {
  name = "kubernetes-dashboard-tunnel-secret"
}

resource "cloudflare_tunnel" "kubernetes_dashboard_tunnel" {
  account_id = var.account_id
  name       = "cloudflare kubernetes-dashboard tunnel"
  secret     = sensitive(base64encode(data.aws_ssm_parameter.kubernetes_dashboard_tunnel_secret.value))
}

# Creates the configuration for the tunnel.
resource "cloudflare_tunnel_config" "kubernetes_dashboard_tunnel" {
  tunnel_id  = cloudflare_tunnel.kubernetes_dashboard_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.kubernetes_dashboard.hostname
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
  value       = sensitive(cloudflare_tunnel.kubernetes_dashboard_tunnel.tunnel_token)
}
