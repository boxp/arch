migration "state" "rm_access_policy" {
  force = true
  actions = [
    "rm cloudflare_access_policy.grafana_policy",
    "rm cloudflare_access_policy.prometheus_web_policy",
  ]
}
