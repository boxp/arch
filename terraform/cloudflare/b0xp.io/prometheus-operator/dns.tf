# Creates the CNAME record that routes grafana.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "grafana" {
  zone_id = var.zone_id
  name    = "grafana.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Creates the CNAME record that routes prometheus-web.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "prometheus_web" {
  zone_id = var.zone_id
  name    = "prometheus-web.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Creates the CNAME record that routes alertmanager.b0xp.io to the tunnel.
# メール通知本文の「View in AlertManager」/ silence リンクの宛先。
# externalUrl が未設定だと Alertmanager は Pod のアドレスを使うため、
# 受信したメールのリンクが全て機能しなかった (2026-08-05 に実際に発生)。
resource "cloudflare_dns_record" "alertmanager" {
  zone_id = var.zone_id
  name    = "alertmanager.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.prometheus_operator_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
