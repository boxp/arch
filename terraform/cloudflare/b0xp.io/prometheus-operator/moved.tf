moved {
  from = cloudflare_record.grafana
  to   = cloudflare_dns_record.grafana
}

moved {
  from = cloudflare_record.prometheus_web
  to   = cloudflare_dns_record.prometheus_web
}

moved {
  from = cloudflare_tunnel_config.prometheus_operator_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.prometheus_operator_tunnel
}

moved {
  from = cloudflare_tunnel.prometheus_operator_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel
}

moved {
  from = cloudflare_access_application.grafana
  to   = cloudflare_zero_trust_access_application.grafana
}

moved {
  from = cloudflare_access_application.prometheus_web
  to   = cloudflare_zero_trust_access_application.prometheus_web
}

