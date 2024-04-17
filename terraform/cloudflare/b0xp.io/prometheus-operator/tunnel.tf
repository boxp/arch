data "aws_ssm_parameter" "prometheus_operator_tunnel_secret" {
  name = "prometheus-operator-tunnel-secret"
}

resource "cloudflare_tunnel" "prometheus_operator_tunnel" {
  account_id = var.account_id
  name       = "cloudflare prometheus-operator tunnel"
  secret     = sensitive(base64encode(data.aws_ssm_parameter.prometheus_operator_tunnel_secret.value))
}

# Creates the configuration for the tunnel.
resource "cloudflare_tunnel_config" "prometheus_operator_tunnel" {
  tunnel_id  = cloudflare_tunnel.prometheus_operator_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.grafana.hostname
      service  = "http://grafana:3000"
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
  value       = sensitive(cloudflare_tunnel.prometheus_operator_tunnel.tunnel_token)
}
