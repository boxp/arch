migration "state" "rm_access_policy" {
  # force=true allows tfmigrate plan to proceed even if terraform plan shows
  # expected diffs from v4->v5 provider migration.
  force = true
  actions = [
    # cloudflare_access_policy does not exist in provider v5; remove from state
    # so the v5 provider can read state without a schema error.
    # The actual Cloudflare access policy is not destroyed (it remains in Cloudflare).
    "rm cloudflare_access_policy.moltworker_policy",
  ]
}
