# Cloudflare Pages for the hitohako portfolio site (apps/hitohako).
#
# This phase only provisions the stage environment. The production project /
# custom domain (hitohako.b0xp.io) will be added in a later phase.
locals {
  stage_project_name = "boxp-hitohako-stage"
  stage_domain       = "hitohako-stage.b0xp.io"
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
