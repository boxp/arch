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

moved {
  from = cloudflare_zero_trust_tunnel_route.codex_workspace
  to   = cloudflare_zero_trust_tunnel_cloudflared_route.codex_workspace
}

removed {
  from = cloudflare_zero_trust_split_tunnel.warp_include
  lifecycle {
    destroy = false
  }
}
