migration "state" "migrate_dns" {
  actions = [
    # 古いリソースを削除
    "rm cloudflare_record.grafana",
    "rm cloudflare_record.prometheus_web",
    
    # 新しいリソースをインポート
    "import cloudflare_dns_record.grafana ${var.zone_id}/${data.terraform_remote_state.cloudflare.outputs.grafana_dns_record_id}",
    "import cloudflare_dns_record.prometheus_web ${var.zone_id}/${data.terraform_remote_state.cloudflare.outputs.prometheus_web_dns_record_id}",
  ]
} 