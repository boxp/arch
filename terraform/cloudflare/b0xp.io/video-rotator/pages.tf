locals {
  project_name     = "boxp-video-rotator"
  custom_domain    = "video-rotator.b0xp.io"
  dev_project_name = "boxp-video-rotator-dev"
  dev_domain       = "video-rotator-dev.b0xp.io"
}

resource "cloudflare_pages_project" "video_rotator" {
  account_id        = var.account_id
  name              = local.project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "video_rotator" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.video_rotator.name
  name         = local.custom_domain
}

resource "cloudflare_pages_project" "video_rotator_dev" {
  account_id        = var.account_id
  name              = local.dev_project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "video_rotator_dev" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.video_rotator_dev.name
  name         = local.dev_domain
}
