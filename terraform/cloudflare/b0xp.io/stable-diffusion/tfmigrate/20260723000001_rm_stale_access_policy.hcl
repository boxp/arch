migration "state" "rm_stale_access_policy" {
  # The cloudflare_zero_trust_access_policy resource has a stale ID in state
  # (ID from old app-scoped v4 cloudflare_access_policy that was incorrectly
  # moved to v5 account-scoped key via a moved block that has since been removed).
  # The v5 API returns 404 when trying to PUT to this stale ID at the account
  # endpoint. Remove from state so apply will CREATE a fresh policy with correct ID.
  force = true
  actions = [
    "rm cloudflare_zero_trust_access_policy.stable_diffusion_github",
  ]
}
