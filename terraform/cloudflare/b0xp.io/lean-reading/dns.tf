# BOXP-679: TLS は Cloudflare edge の既存 Universal SSL（*.b0xp.io）で終端する。
# Access application と JWT 検証付きの tunnel ingress ができてから DNS を作り、
# Access を通らずに tunnel へ届く時間を作らない。
resource "cloudflare_dns_record" "lean_reading" {
  zone_id = var.zone_id
  name    = local.lean_reading_hostname
  content = "${cloudflare_zero_trust_tunnel_cloudflared.lean_reading.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true

  depends_on = [
    cloudflare_zero_trust_access_application.lean_reading,
    cloudflare_zero_trust_tunnel_cloudflared_config.lean_reading,
  ]
}
