resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "k8s_tunnel" {
  account_id = var.account_id
  name       = "cloudflare k8s tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Creates the configuration for the tunnel.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "k8s_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.id
  account_id = var.account_id
  config {
    warp_routing {
      enabled = true
    }
    ingress_rule {
      hostname = cloudflare_dns_record.k8s.hostname
      service  = "http://argocd-server.argocd.svc.cluster.local:8080"
    }
    ingress_rule {
      hostname = cloudflare_dns_record.codex_task_board.hostname
      service  = "http://codex-task-board-dashboard.codex-workspace.svc.cluster.local:8080"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "cloudflare_zero_trust_tunnel_route" "codex_workspace" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.id
  network    = "192.168.10.98/32"
  comment    = "lolice codex-workspace LoadBalancer for WARP access"
}
