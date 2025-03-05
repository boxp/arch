migration "state" "migrate_access" {
  actions = [
    "mv cloudflare_access_application.grafana cloudflare_zero_trust_access_application.grafana",
    "mv cloudflare_access_application.prometheus_web cloudflare_zero_trust_access_application.prometheus_web",
    "mv cloudflare_access_policy.grafana_policy cloudflare_zero_trust_access_policy.grafana_policy",
    "mv cloudflare_access_policy.prometheus_web_policy cloudflare_zero_trust_access_policy.prometheus_web_policy",
  ]
} 