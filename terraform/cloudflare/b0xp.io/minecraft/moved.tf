moved {
  from = cloudflare_record.minecraft_map
  to   = cloudflare_dns_record.minecraft_map
}

moved {
  from = cloudflare_tunnel_config.minecraft_map_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.minecraft_map_tunnel
}

moved {
  from = cloudflare_tunnel.minecraft_map_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.minecraft_map_tunnel
}
