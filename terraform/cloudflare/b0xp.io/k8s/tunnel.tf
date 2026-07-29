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

resource "cloudflare_zero_trust_tunnel_cloudflared_route" "codex_workspace" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.id
  network    = "192.168.10.98/32"
  comment    = "lolice codex-workspace LoadBalancer for WARP access"
}

# Look up the existing route UUID so the import block below can import it into state.
# The v4 state entry (cloudflare_zero_trust_tunnel_route.codex_workspace) was removed
# via tfmigrate during the v4→v5 provider migration, leaving this route untracked.
# Using both network_subset and network_superset ensures exactly the /32 is matched.
data "cloudflare_zero_trust_tunnel_cloudflared_route" "codex_workspace" {
  account_id = var.account_id
  filter = {
    network_subset   = "192.168.10.98/32"
    network_superset = "192.168.10.98/32"
    is_deleted       = false
  }
}

import {
  to = cloudflare_zero_trust_tunnel_cloudflared_route.codex_workspace
  id = "${var.account_id}/${data.cloudflare_zero_trust_tunnel_cloudflared_route.codex_workspace.id}"
}
