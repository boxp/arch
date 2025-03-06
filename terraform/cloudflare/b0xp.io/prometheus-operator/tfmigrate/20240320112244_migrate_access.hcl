migration "state" "migrate_access" {
  actions = [
    # 古いリソースを削除
    "rm cloudflare_access_application.grafana",
    "rm cloudflare_access_application.prometheus_web",
    "rm cloudflare_access_policy.grafana_policy",
    "rm cloudflare_access_policy.prometheus_web_policy",
    
    # 新しいリソースをインポート
    "import cloudflare_zero_trust_access_application.grafana ${var.account_id}/${data.terraform_remote_state.cloudflare.outputs.grafana_application_id}",
    "import cloudflare_zero_trust_access_application.prometheus_web ${var.account_id}/${data.terraform_remote_state.cloudflare.outputs.prometheus_web_application_id}",
    "import cloudflare_zero_trust_access_policy.grafana_policy ${var.account_id}/${data.terraform_remote_state.cloudflare.outputs.grafana_policy_id}",
    "import cloudflare_zero_trust_access_policy.prometheus_web_policy ${var.account_id}/${data.terraform_remote_state.cloudflare.outputs.prometheus_web_policy_id}",
  ]
} 