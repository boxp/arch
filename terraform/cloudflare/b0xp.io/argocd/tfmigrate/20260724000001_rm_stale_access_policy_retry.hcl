migration "state" "rm_stale_access_policy_retry" {
  force = true
  actions = [
    "rm cloudflare_zero_trust_access_policy.argocd_policy",
    "rm cloudflare_zero_trust_access_policy.argocd_api_policy",
  ]
}
