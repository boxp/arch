# BOXP-328: published application route for Kohako G2. TLS terminates at the
# Cloudflare edge with the existing Universal SSL certificate (b0xp.io and
# *.b0xp.io), so no cert-manager or DNS-edit token is needed.
#
# The record is created only after the Access application and the tunnel
# ingress (which requires a valid Access JWT in cloudflared) exist, so the
# hostname never resolves to the tunnel without Access in front of it.
# even-g2-main.b0xp.io stays private (Gateway DNS override, dns_policy.tf).
resource "cloudflare_dns_record" "kohako_g2" {
  zone_id = var.zone_id
  name    = local.kohako_g2_hostname
  content = "${cloudflare_zero_trust_tunnel_cloudflared.even_g2_lab.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true

  depends_on = [
    cloudflare_zero_trust_access_application.kohako_g2,
    cloudflare_zero_trust_tunnel_cloudflared_config.even_g2_lab,
  ]
}
