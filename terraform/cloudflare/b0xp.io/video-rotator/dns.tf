resource "cloudflare_record" "video_rotator" {
  zone_id = var.zone_id
  name    = "video-rotator"
  value   = cloudflare_pages_project.video_rotator.subdomain
  type    = "CNAME"
  proxied = true
}
