# Cloudflare Pages for the hitohako site (apps/hitohako).
#
# Stage is deployed from main by .github/workflows/deploy-hitohako.yml.
# Production is deployed only by .github/workflows/promote-hitohako-production.yml.
locals {
  stage_project_name      = "boxp-hitohako-stage"
  stage_domain            = "hitohako-stage.b0xp.io"
  production_project_name = "boxp-hitohako"
}

resource "cloudflare_pages_project" "hitohako_stage" {
  account_id        = var.account_id
  name              = local.stage_project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "hitohako_stage" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.hitohako_stage.name
  name         = local.stage_domain
}

resource "cloudflare_pages_project" "hitohako" {
  account_id        = var.account_id
  name              = local.production_project_name
  production_branch = "main"
}
