migration "state" "rm_split_tunnel" {
  # skip_plan prevents tfmigrate from failing on expected plan diffs caused by
  # v4->v5 provider migration (new attributes being tracked like session_duration)
  skip_plan = true
  actions = [
    "rm cloudflare_zero_trust_split_tunnel.warp_include",
    "rm cloudflare_zero_trust_tunnel_route.codex_workspace",
  ]
}
