resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "k8s_tunnel" {
  account_id    = var.account_id
  name          = "cloudflare k8s tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "k8s_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.id
  account_id = var.account_id
  config = {
    ingress = [
      {
        hostname = cloudflare_dns_record.k8s.name
        service  = "http://argocd-server.argocd.svc.cluster.local:8080"
      },
      {
        hostname = cloudflare_dns_record.codex_task_board.name
        service  = "http://codex-task-board-dashboard.codex-workspace.svc.cluster.local:8080"
      },
      {
        service = "http_status:404"
      },
    ]
    origin_request = {}
  }

  lifecycle {
    ignore_changes = [created_at, source, version]
  }
}

# cloudflare_zero_trust_tunnel_route (removed in v5) was removed from state via tfmigrate.
# Re-add as cloudflare_zero_trust_tunnel_cloudflared_route after apply.
