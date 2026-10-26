resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "even_g2_lab" {
  account_id    = var.account_id
  name          = "cloudflare even-g2-lab tunnel"
  config_src    = "cloudflare"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "even_g2_lab" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.even_g2_lab.id

  config = {
    ingress = [
      {
        hostname = local.even_g2_main_hostname
        service  = "http://even-g2-main.even-g2-lab.svc.cluster.local:80"
      },
      {
        service = "http_status:404"
      }
    ]
  }
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "even_g2_lab" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.even_g2_lab.id
}

resource "aws_ssm_parameter" "even_g2_lab_tunnel_token" {
  name        = "even-g2-lab-tunnel-token"
  description = "for even-g2-lab tunnel token"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.even_g2_lab.token)
}

# BOXP-318: the former private hostname route never became reachable from WARP
# clients (Gateway logs show the query answered without an initial resolved IP,
# and cloudflared would resolve the hostname itself at L4 instead of using the
# ingress rule). Route the Service ClusterIP through this tunnel instead, matching
# the proven WARP -> tunnel -> private IP path used by codex-workspace.
# The ClusterIP is pinned in boxp/lolice argoproj/even-g2-lab/service.yaml.
resource "cloudflare_zero_trust_tunnel_cloudflared_route" "even_g2_main" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.even_g2_lab.id
  network    = "${local.even_g2_main_cluster_ip}/32"
  comment    = "lolice even-g2-main ClusterIP for WARP access"
}
