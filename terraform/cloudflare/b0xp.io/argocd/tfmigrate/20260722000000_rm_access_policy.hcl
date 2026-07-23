migration "state" "rm_access_policy" {
  force = true
  actions = [
    "rm cloudflare_access_policy.argocd_policy",
    "rm cloudflare_access_policy.argocd_api_policy",
  ]
}
