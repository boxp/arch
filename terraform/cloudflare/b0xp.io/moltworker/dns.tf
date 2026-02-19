# DNS record for moltworker.b0xp.io
# Uses a proxied A record with a placeholder address (RFC 5737 TEST-NET-1).
# Actual traffic is handled by the Workers route defined in wrangler.jsonc;
# the origin IP is never contacted because Cloudflare intercepts the request.
#
# A CNAME pointing to *.workers.dev causes Error 1014 (CNAME Cross-User Banned)
# because workers.dev belongs to a different Cloudflare account.
resource "cloudflare_record" "moltworker" {
  zone_id = var.zone_id
  name    = "moltworker"
  value   = "192.0.2.1"
  type    = "A"
  proxied = true
}
