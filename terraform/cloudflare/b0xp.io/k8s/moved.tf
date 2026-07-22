moved {
  from = cloudflare_record.k8s
  to   = cloudflare_dns_record.k8s
}

moved {
  from = cloudflare_record.codex_workspace
  to   = cloudflare_dns_record.codex_workspace
}

moved {
  from = cloudflare_record.codex_task_board
  to   = cloudflare_dns_record.codex_task_board
}

moved {
  from = cloudflare_access_application.codex_task_board
  to   = cloudflare_zero_trust_access_application.codex_task_board
}

moved {
  from = cloudflare_access_policy.codex_task_board_policy
  to   = cloudflare_zero_trust_access_policy.codex_task_board_policy
}

# cloudflare_zero_trust_tunnel_route was a partial migration artifact;
# the v5 resource is cloudflare_zero_trust_tunnel_cloudflared_route (see tunnel.tf).
removed {
  from = cloudflare_zero_trust_tunnel_route.codex_workspace
  lifecycle {
    destroy = false
  }
}

