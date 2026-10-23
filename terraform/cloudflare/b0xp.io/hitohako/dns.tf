resource "cloudflare_dns_record" "hitohako_stage" {
  zone_id = var.zone_id
  name    = local.stage_domain
  content = cloudflare_pages_project.hitohako_stage.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
