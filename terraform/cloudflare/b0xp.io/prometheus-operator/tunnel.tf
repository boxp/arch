data "aws_ssm_parameter" "prometheus_operator_tunnel_secret" {
  name = "prometheus-operator-tunnel-secret"
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "prometheus_operator_tunnel" {
  account_id     = var.account_id
  name           = "cloudflare prometheus-operator tunnel"
  tunnel_secret  = sensitive(base64encode(data.aws_ssm_parameter.prometheus_operator_tunnel_secret.value))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "prometheus_operator_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.id
  account_id = var.account_id
  config = {
    ingress = [
      {
        hostname = cloudflare_dns_record.grafana.hostname
        service  = "http://grafana:3000"
      },
      {
        hostname = cloudflare_dns_record.prometheus_web.hostname
        service  = "http://prometheus-k8s:9090"
      },
      {
        service = "http_status:404"
      }
    ]
  }
}

# 環境変数CLOUDFLARE_API_TOKENを利用するためのデータソース
data "external" "env" {
  program = ["sh", "-c", "echo '{\"token\":\"'\"$CLOUDFLARE_API_TOKEN\"'\"}'"]
}

# HTTP APIを使用してトンネルトークンを取得
data "http" "prometheus_operator_tunnel_token" {
  url = "https://api.cloudflare.com/client/v4/accounts/${var.account_id}/cfd_tunnel/${cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.id}/token"
  request_headers = {
    "Authorization" = "Bearer ${data.external.env.result.token}"
    "Content-Type"  = "application/json"
  }
}

resource "aws_ssm_parameter" "prometheus_operator_tunnel_token" {
  name        = "prometheus-operator-tunnel-token"
  description = "for prometheus-operator tunnel token"
  type        = "SecureString"
  value       = sensitive(jsondecode(data.http.prometheus_operator_tunnel_token.response_body)["result"])
}
