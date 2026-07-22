moved {
  from = cloudflare_record.bastion
  to   = cloudflare_dns_record.bastion
}

moved {
  from = cloudflare_tunnel_config.bastion
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.bastion
}

moved {
  from = cloudflare_tunnel.bastion
  to   = cloudflare_zero_trust_tunnel_cloudflared.bastion
}

moved {
  from = cloudflare_access_application.bastion
  to   = cloudflare_zero_trust_access_application.bastion
}

moved {
  from = cloudflare_access_service_token.github_actions
  to   = cloudflare_zero_trust_access_service_token.github_actions
}
