# kubernetes-dashboard tunnel secret用のSSMパラメータ
resource "aws_ssm_parameter" "kubernetes_dashboard_tunnel_secret" {
  name        = "kubernetes-dashboard-tunnel-secret"
  description = "Tunnel secret for kubernetes-dashboard Cloudflare tunnel"
  type        = "SecureString"
  value       = random_password.tunnel_secret.result
}

# ランダムなトンネルシークレットを生成
resource "random_password" "tunnel_secret" {
  length  = 32
  special = true
}