# DNS record for moltworker-poc.b0xp.io
# Points to the Workers route (proxied through Cloudflare).
# The Workers script is deployed separately via wrangler deploy (not Terraform-managed).
resource "cloudflare_record" "moltworker_poc" {
  zone_id = var.zone_id
  name    = "moltworker-poc"
  value   = "moltbot-sandbox.boxp.workers.dev"
  type    = "CNAME"
  proxied = true
}
