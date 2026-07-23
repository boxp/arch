migration "state" "rm_stale_access_policy_retry" {
  force = true
  actions = [
    "rm cloudflare_zero_trust_access_policy.grafana_policy",
    "rm cloudflare_zero_trust_access_policy.prometheus_web_policy",
  ]
}
