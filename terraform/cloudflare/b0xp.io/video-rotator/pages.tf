locals {
  project_name  = "boxp-video-rotator"
  custom_domain = "video-rotator.b0xp.io"
}

resource "cloudflare_pages_project" "video_rotator" {
  account_id        = var.account_id
  name              = local.project_name
  production_branch = "main"

  build_config {
    build_command   = "cd apps/video-rotator && npm ci && npm run build"
    destination_dir = "apps/video-rotator/dist"
    root_dir        = ""
  }

  source {
    type = "github"
    config {
      owner                         = "boxp"
      repo_name                     = "arch"
      production_branch             = "main"
      pr_comments_enabled           = true
      production_deployment_enabled = true
      preview_deployment_setting    = "custom"
      preview_branch_includes       = ["feature/*"]
      preview_branch_excludes       = ["main"]
    }
  }
}

resource "cloudflare_pages_domain" "video_rotator" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.video_rotator.name
  domain       = local.custom_domain
}
