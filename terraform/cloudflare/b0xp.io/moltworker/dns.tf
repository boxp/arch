# DNS record for moltworker.b0xp.io
# Points to the Workers route (proxied through Cloudflare).
# The Workers script is deployed separately via wrangler deploy (not Terraform-managed).
resource "cloudflare_record" "moltworker" {
  zone_id = var.zone_id
  name    = "moltworker"
  value   = "moltbot-sandbox.boxp.workers.dev"
  type    = "CNAME"
  proxied = true
}
