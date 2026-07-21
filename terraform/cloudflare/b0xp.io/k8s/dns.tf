# Creates the CNAME record that routes k8s.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "k8s" {
  zone_id = var.zone_id
  name    = "k8s"
  content = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.cname
  type    = "CNAME"
  proxied = true
}

resource "cloudflare_dns_record" "codex_workspace" {
  zone_id = var.zone_id
  name    = "codex-workspace"
  content = "192.168.10.98"
  type    = "A"
  proxied = false
}

resource "cloudflare_dns_record" "codex_task_board" {
  zone_id = var.zone_id
  name    = "codex-task-board"
  content = cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel.cname
  type    = "CNAME"
  proxied = true
}
