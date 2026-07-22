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

removed {
  from = cloudflare_access_policy.codex_task_board_policy
  lifecycle {
    destroy = false
  }
}

