moved {
  from = cloudflare_record.stable_diffusion
  to   = cloudflare_dns_record.stable_diffusion
}

moved {
  from = cloudflare_tunnel_config.stable_diffusion
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.stable_diffusion
}

moved {
  from = cloudflare_tunnel.stable_diffusion
  to   = cloudflare_zero_trust_tunnel_cloudflared.stable_diffusion
}

moved {
  from = cloudflare_access_application.stable_diffusion
  to   = cloudflare_zero_trust_access_application.stable_diffusion
}
