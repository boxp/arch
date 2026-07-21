migration "state" "rm_split_tunnel" {
  # force=true allows tfmigrate plan to proceed even if terraform plan shows
  # expected diffs from v4->v5 provider migration (new attributes like session_duration)
  force = true
  actions = [
    "rm cloudflare_zero_trust_split_tunnel.warp_include",
    "mv cloudflare_zero_trust_tunnel_route.codex_workspace cloudflare_zero_trust_tunnel_cloudflared_route.codex_workspace",
  ]
}
