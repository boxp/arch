migration "state" "migrate_access" {
  actions = [
    # 古いリソースを削除
    "rm cloudflare_access_application.grafana",
    "rm cloudflare_access_application.prometheus_web",
    
    # 新しいリソースをインポート
    "import cloudflare_zero_trust_access_application.grafana 1984a4314b3e75f3bedce97c7a8e0c81/cfa833f1-2322-41ad-b535-064d0f54137a",
    "import cloudflare_zero_trust_access_application.prometheus_web 1984a4314b3e75f3bedce97c7a8e0c81/d3c1ed75-68dd-415e-bdcc-3dd50d791e4d",
  ]
} 