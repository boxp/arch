migration "state" "migrate_dns" {
  actions = [
    "mv cloudflare_record.grafana cloudflare_dns_record.grafana",
    "mv cloudflare_record.prometheus_web cloudflare_dns_record.prometheus_web",
  ]
} 