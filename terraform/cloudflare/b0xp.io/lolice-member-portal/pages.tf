locals {
  pages_project_name = "lolice-member-portal"
  pages_domain       = "lolice.b0xp.io"
}

resource "cloudflare_pages_project" "lolice_member_portal" {
  account_id        = var.account_id
  name              = local.pages_project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "lolice_member_portal" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.lolice_member_portal.name
  domain       = local.pages_domain
}
