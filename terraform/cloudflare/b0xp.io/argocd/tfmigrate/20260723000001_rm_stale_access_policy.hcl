migration "state" "rm_stale_access_policy" {
  # The cloudflare_zero_trust_access_policy resources have stale IDs in state
  # (IDs from old app-scoped v4 cloudflare_access_policy that were incorrectly
  # moved to v5 account-scoped keys via a moved block that has since been removed).
  # The v5 API returns 404 when trying to PUT to these stale IDs at the account
  # endpoint. Remove from state so apply will CREATE fresh policies with correct IDs.
  force = true
  actions = [
    "rm cloudflare_zero_trust_access_policy.argocd_policy",
    "rm cloudflare_zero_trust_access_policy.argocd_api_policy",
  ]
}
