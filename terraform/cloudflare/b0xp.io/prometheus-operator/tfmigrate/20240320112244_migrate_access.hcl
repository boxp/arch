migration "state" "migrate_access" {
  actions = [
    "move cloudflare_access_application.grafana cloudflare_zero_trust_access_application.grafana",
    "move cloudflare_access_application.prometheus_web cloudflare_zero_trust_access_application.prometheus_web",
    "move cloudflare_access_policy.grafana_policy cloudflare_zero_trust_access_policy.grafana_policy",
    "move cloudflare_access_policy.prometheus_web_policy cloudflare_zero_trust_access_policy.prometheus_web_policy",
  ]
} 