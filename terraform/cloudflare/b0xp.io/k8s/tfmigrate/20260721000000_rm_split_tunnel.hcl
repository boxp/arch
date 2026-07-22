migration "state" "rm_split_tunnel" {
  # force=true allows tfmigrate plan to proceed even if terraform plan shows
  # expected diffs from v4->v5 provider migration (new attributes like session_duration)
  force = true
  actions = [
    "rm cloudflare_zero_trust_split_tunnel.warp_include",
    # cloudflare_zero_trust_tunnel_route is not a valid v5 resource type (correct name is
    # cloudflare_zero_trust_tunnel_cloudflared_route); remove from state so the v5 provider
    # can read the state without a schema error. The actual Cloudflare route object is not
    # destroyed (it remains in Cloudflare and is tracked by cloudflare_zero_trust_tunnel_cloudflared_route).
    "rm cloudflare_zero_trust_tunnel_route.codex_workspace",
    # cloudflare_access_policy does not exist in v5 provider (scope changed from app to account).
    # Remove from state here (before terraform plan runs) to avoid "no schema available" exit-code-1
    # error which force=true cannot suppress. The replacement resource
    # cloudflare_zero_trust_access_policy.codex_task_board_policy is defined in access.tf and
    # will be created on apply.
    "rm cloudflare_access_policy.codex_task_board_policy",
  ]
}
