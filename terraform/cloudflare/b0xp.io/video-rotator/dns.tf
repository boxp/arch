resource "cloudflare_dns_record" "video_rotator" {
  zone_id = var.zone_id
  name    = "video-rotator"
  value   = cloudflare_pages_project.video_rotator.subdomain
  type    = "CNAME"
  proxied = true
}

resource "cloudflare_dns_record" "video_rotator_dev" {
  zone_id = var.zone_id
  name    = "video-rotator-dev"
  value   = cloudflare_pages_project.video_rotator_dev.subdomain
  type    = "CNAME"
  proxied = true
}
