migration "state" "rm_split_tunnel" {
  actions = [
    "rm cloudflare_zero_trust_split_tunnel.warp_include",
    "rm cloudflare_zero_trust_tunnel_route.codex_workspace",
  ]
}
