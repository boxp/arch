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
