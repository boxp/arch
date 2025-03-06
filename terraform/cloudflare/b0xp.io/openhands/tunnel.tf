# ランダムな秘密トークンの生成
resource "random_password" "tunnel_secret" {
  length  = 64
  special = false
}

# Cloudflare Tunnelの作成
resource "cloudflare_tunnel" "openhands_tunnel" {
  account_id = var.account_id
  name       = "cloudflare openhands tunnel"
  secret     = base64sha256(random_password.tunnel_secret.result)
}

# Tunnelの設定
resource "cloudflare_tunnel_config" "openhands_tunnel" {
  tunnel_id  = cloudflare_tunnel.openhands_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = "openhands.b0xp.io"
      service  = "http://openhands-service.openhands.svc.cluster.local:80"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# トークンをAWS Systems Managerパラメータストアに保存
resource "aws_ssm_parameter" "openhands_tunnel_token" {
  name        = "openhands-tunnel-token"
  description = "for openhands tunnel token"
  type        = "SecureString"
  value       = cloudflare_tunnel.openhands_tunnel.tunnel_token
} 