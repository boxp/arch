data "aws_ssm_parameter" "prometheus_operator_tunnel_secret" {
  name = "prometheus-operator-tunnel-secret"
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "prometheus_operator_tunnel" {
  account_id    = var.account_id
  name          = "cloudflare prometheus-operator tunnel"
  tunnel_secret = sensitive(base64encode(data.aws_ssm_parameter.prometheus_operator_tunnel_secret.value))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "prometheus_operator_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.id
  account_id = var.account_id
  config = {
    ingress = [
      {
        hostname = "${cloudflare_dns_record.grafana.name}.b0xp.io"
        service  = "http://grafana:3000"
      },
      {
        hostname = "${cloudflare_dns_record.prometheus_web.name}.b0xp.io"
        service  = "http://prometheus-k8s:9090"
      },
      {
        service = "http_status:404"
      }
    ]
  }
}

# トンネルトークンの管理方法に関する新方針
# 1. AWS SSM Parameterリソースは残し、後で手動でトークンを設定
# 2. valueに一時的な値「DUMMY」を設定
# 3. ignore_changesを使用して手動更新をTerraformに管理させない
resource "aws_ssm_parameter" "prometheus_operator_tunnel_token" {
  name        = "prometheus-operator-tunnel-token"
  description = "for prometheus-operator tunnel token"
  type        = "SecureString"
  value       = "DUMMY" # この値は後で手動で正しいトークンに置き換えてください

  lifecycle {
    ignore_changes = [value]
  }
}
