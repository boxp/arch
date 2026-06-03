locals {
  project_name  = "boxp-video-rotator"
  custom_domain = "video-rotator.b0xp.io"
}

resource "cloudflare_pages_project" "video_rotator" {
  account_id        = var.account_id
  name              = local.project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "video_rotator" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.video_rotator.name
  domain       = local.custom_domain
}
