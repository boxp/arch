moved {
  from = cloudflare_record.argocd
  to   = cloudflare_dns_record.argocd
}

moved {
  from = cloudflare_record.argocd_api
  to   = cloudflare_dns_record.argocd_api
}

moved {
  from = cloudflare_tunnel_config.argocd_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.argocd_tunnel
}

moved {
  from = cloudflare_tunnel_config.argocd_api_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared_config.argocd_api_tunnel
}

moved {
  from = cloudflare_tunnel.argocd_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.argocd_tunnel
}

moved {
  from = cloudflare_tunnel.argocd_api_tunnel
  to   = cloudflare_zero_trust_tunnel_cloudflared.argocd_api_tunnel
}

moved {
  from = cloudflare_access_application.argocd
  to   = cloudflare_zero_trust_access_application.argocd
}

moved {
  from = cloudflare_access_application.argocd_api
  to   = cloudflare_zero_trust_access_application.argocd_api
}

moved {
  from = cloudflare_access_policy.argocd_policy
  to   = cloudflare_zero_trust_access_policy.argocd_policy
}

moved {
  from = cloudflare_access_policy.argocd_api_policy
  to   = cloudflare_zero_trust_access_policy.argocd_api_policy
}

moved {
  from = cloudflare_access_service_token.github_action_token
  to   = cloudflare_zero_trust_access_service_token.github_action_token
}
