moved {
  from = cloudflare_record.hermes_agent
  to   = cloudflare_dns_record.hermes_agent
}

moved {
  from = cloudflare_tunnel_config.hermes_agent_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.hermes_agent_tunnel
}

moved {
  from = cloudflare_tunnel.hermes_agent_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.hermes_agent_tunnel
}

moved {
  from = cloudflare_access_application.hermes_agent
  to   = cloudflare_zero_trust_access_application.hermes_agent
}
