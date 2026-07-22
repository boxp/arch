moved {
  from = cloudflare_record.grafana_api
  to   = cloudflare_dns_record.grafana_api
}

moved {
  from = cloudflare_tunnel_config.grafana_api_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.grafana_api_tunnel
}

moved {
  from = cloudflare_tunnel.grafana_api_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.grafana_api_tunnel
}

moved {
  from = cloudflare_access_application.grafana_api
  to   = cloudflare_zero_trust_access_application.grafana_api
}

removed {
  from = cloudflare_access_policy.grafana_api_policy
  lifecycle {
    destroy = false
  }
}

moved {
  from = cloudflare_access_service_token.grafana_api_service_token
  to   = cloudflare_zero_trust_access_service_token.grafana_api_service_token
}
