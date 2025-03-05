migration "state" "migrate_dns" {
  actions = [
    "move cloudflare_record.grafana cloudflare_dns_record.grafana",
    "move cloudflare_record.prometheus_web cloudflare_dns_record.prometheus_web",
  ]
} 