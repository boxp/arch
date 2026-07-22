resource "cloudflare_dns_record" "video_rotator" {
  zone_id = var.zone_id
  name    = "video-rotator.b0xp.io"
  content = cloudflare_pages_project.video_rotator.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

resource "cloudflare_dns_record" "video_rotator_dev" {
  zone_id = var.zone_id
  name    = "video-rotator-dev.b0xp.io"
  content = cloudflare_pages_project.video_rotator_dev.subdomain
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
