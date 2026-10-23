locals {
  project_name           = "boxp-iikanji"
  portfolio_project_name = "boxp-portfolio"
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

# b0xp.io ポートフォリオサイト (boxp/b0xp.io) の Pages プロジェクト。
# デプロイは boxp/b0xp.io の GitHub Actions から `wrangler pages deploy --project-name boxp-portfolio`。
# b0xp.io / www.b0xp.io のカスタムドメインと dns.tf の CNAME 切替は、
# 旧プロジェクト `shanghai`（手動作成）からドメインを外した後に別 PR で行う（BOXP-275 Plan 6）。
resource "cloudflare_pages_project" "portfolio" {
  account_id        = var.account_id
  name              = local.portfolio_project_name
  production_branch = "main"
}
