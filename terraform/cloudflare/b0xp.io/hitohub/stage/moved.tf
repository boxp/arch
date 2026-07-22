moved {
  from = cloudflare_record.hitohub_stage
  to   = cloudflare_dns_record.hitohub_stage
}

moved {
  from = cloudflare_record.api_hitohub_stage
  to   = cloudflare_dns_record.api_hitohub_stage
}

moved {
  from = cloudflare_tunnel_config.hitohub_stage_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.hitohub_stage_tunnel
}

moved {
  from = cloudflare_tunnel.hitohub_stage_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.hitohub_stage_tunnel
}

moved {
  from = cloudflare_access_application.hitohub_stage
  to   = cloudflare_zero_trust_access_application.hitohub_stage
}

