migration "state" "migrate_tunnel" {
  actions = [
    # 古いリソースを削除
    "rm cloudflare_tunnel.prometheus_operator_tunnel",
    "rm cloudflare_tunnel_config.prometheus_operator_tunnel",
    
    # 新しいリソースをインポート
    "import cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel 1984a4314b3e75f3bedce97c7a8e0c81/25190a02-f54f-4951-ac18-c98db4501fb4",
    "import cloudflare_zero_trust_tunnel_cloudflared_config.prometheus_operator_tunnel 1984a4314b3e75f3bedce97c7a8e0c81/25190a02-f54f-4951-ac18-c98db4501fb4",
  ]
} 