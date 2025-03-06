# DNSレコードの作成
resource "cloudflare_record" "openhands" {
  zone_id = var.zone_id
  name    = "openhands"
  value   = cloudflare_tunnel.openhands_tunnel.cname
  type    = "CNAME"
  proxied = true
} 