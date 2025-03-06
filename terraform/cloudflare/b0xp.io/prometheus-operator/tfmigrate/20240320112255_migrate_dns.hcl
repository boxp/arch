migration "state" "migrate_dns" {
  actions = [
    # 古いリソースを削除
    "rm cloudflare_record.grafana",
    "rm cloudflare_record.prometheus_web",
    
    # 新しいリソースをインポート
    "import cloudflare_dns_record.grafana ec593206d0ef695c3aae3a4cb3173264/5c417e702ef44fa1252b50c770078c35",
    "import cloudflare_dns_record.prometheus_web ec593206d0ef695c3aae3a4cb3173264/81d8045b8d659c76675ba79e9dc92a44",
  ]
} 