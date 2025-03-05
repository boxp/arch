migration "state" "migrate_tunnel" {
  actions = [
    "move cloudflare_tunnel.prometheus_operator_tunnel cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel",
    "move cloudflare_tunnel_config.prometheus_operator_tunnel cloudflare_zero_trust_tunnel_cloudflared_config.prometheus_operator_tunnel",
  ]
} 