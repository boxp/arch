moved {
  from = cloudflare_record.hitohub_prod
  to   = cloudflare_dns_record.hitohub_prod
}

moved {
  from = cloudflare_record.api_hitohub_prod
  to   = cloudflare_dns_record.api_hitohub_prod
}

moved {
  from = cloudflare_tunnel_config.hitohub_prod_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.hitohub_prod_tunnel
}

moved {
  from = cloudflare_tunnel.hitohub_prod_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.hitohub_prod_tunnel
}
