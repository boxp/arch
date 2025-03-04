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
  config {
    ingress_rule {
      hostname = cloudflare_dns_record.grafana.hostname
      service  = "http://grafana:3000"
    }
    ingress_rule {
      hostname = cloudflare_dns_record.prometheus_web.hostname
      service  = "http://prometheus-k8s:9090"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "aws_ssm_parameter" "prometheus_operator_tunnel_token" {
  name        = "prometheus-operator-tunnel-token"
  description = "for prometheus-operator tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.tunnel_token)
}
