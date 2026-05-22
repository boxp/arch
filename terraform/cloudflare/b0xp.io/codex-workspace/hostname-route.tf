data "cloudflare_zero_trust_tunnel_cloudflared" "k8s" {
  account_id = var.account_id
  filter = {
    name = "cloudflare k8s tunnel"
  }
}

resource "cloudflare_zero_trust_network_hostname_route" "codex_workspace" {
  account_id = var.account_id
  tunnel_id  = data.cloudflare_zero_trust_tunnel_cloudflared.k8s.id
  hostname   = "codex-workspace.b0xp.io"
  comment    = "lolice codex-workspace private hostname route"
}
