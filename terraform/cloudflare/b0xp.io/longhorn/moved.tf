moved {
  from = cloudflare_record.longhorn
  to   = cloudflare_dns_record.longhorn
}

moved {
  from = cloudflare_tunnel_config.longhorn_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.longhorn_tunnel
}

moved {
  from = cloudflare_tunnel.longhorn_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.longhorn_tunnel
}

moved {
  from = cloudflare_access_application.longhorn
  to   = cloudflare_zero_trust_access_application.longhorn
}

moved {
  from = cloudflare_access_policy.longhorn_policy
  to   = cloudflare_zero_trust_access_policy.longhorn_policy
}
