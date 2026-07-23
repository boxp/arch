moved {
  from = cloudflare_record.kubernetes_dashboard
  to   = cloudflare_dns_record.kubernetes_dashboard
}

moved {
  from = cloudflare_tunnel_config.kubernetes_dashboard_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.kubernetes_dashboard_tunnel
}

moved {
  from = cloudflare_tunnel.kubernetes_dashboard_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.kubernetes_dashboard_tunnel
}

moved {
  from = cloudflare_access_application.kubernetes_dashboard
  to   = cloudflare_zero_trust_access_application.kubernetes_dashboard
}
