migration "state" "migrate_tunnel" {
  actions = [
    # 古いリソースを削除
    "rm cloudflare_tunnel.prometheus_operator_tunnel",
    "rm cloudflare_tunnel_config.prometheus_operator_tunnel",
    
    # 新しいリソースをインポート
    "import cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel ${var.account_id}/${data.terraform_remote_state.cloudflare.outputs.prometheus_operator_tunnel_id}",
    "import cloudflare_zero_trust_tunnel_cloudflared_config.prometheus_operator_tunnel ${var.account_id}/${data.terraform_remote_state.cloudflare.outputs.prometheus_operator_tunnel_id}",
  ]
} 