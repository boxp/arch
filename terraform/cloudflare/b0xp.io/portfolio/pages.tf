locals {
  project_name = "boxp-iikanji"
}

resource "cloudflare_pages_project" "iikanji" {
  account_id        = var.account_id
  name              = local.project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "iikanji_subdomain" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.iikanji.name
  name         = "iikanji.b0xp.io"
}

# BOXP-276: ひとはこさん (VTuber persona) portfolio site.
# Site source lives in boxp/hitohako-site and is deployed with
# `wrangler pages deploy dist --project-name=boxp-hitohako` from GitHub Actions.
locals {
  hitohako_project_name = "boxp-hitohako"
}

resource "cloudflare_pages_project" "hitohako" {
  account_id        = var.account_id
  name              = local.hitohako_project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "hitohako_subdomain" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.hitohako.name
  name         = "hitohako.b0xp.io"
}
