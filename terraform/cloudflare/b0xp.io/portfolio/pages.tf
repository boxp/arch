locals {
  project_name                 = "boxp-iikanji"
  portfolio_project_name       = "boxp-portfolio"
  portfolio_stage_project_name = "boxp-portfolio-stage"
  portfolio_stage_domain       = "portfolio-stage.b0xp.io"
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

# b0xp.io ポートフォリオサイト (boxp/arch apps/portfolio) の本番 Pages プロジェクト。
# b0xp.io / www.b0xp.io のカスタムドメインと dns.tf の CNAME 切替は、
# stage での本人確認後、旧プロジェクト `shanghai`（手動作成）からドメインを外して別 PR で行う（BOXP-275 Plan 6）。
# それまで本番プロジェクトへのデプロイは行わない。
resource "cloudflare_pages_project" "portfolio" {
  account_id        = var.account_id
  name              = local.portfolio_project_name
  production_branch = "main"
}

# 同サイトの stage 環境。本番（b0xp.io / www.b0xp.io）を変えずに新サイトを実公開して確認するための独立プロジェクト。
# デプロイは boxp/arch の .github/workflows/deploy-portfolio.yml（apps/portfolio の main push / workflow_dispatch）から
# `wrangler pages deploy --project-name boxp-portfolio-stage`。
# サイト側は SITE_ENV=stage でビルドされ、noindex メタと robots.txt の Disallow が付く
# （検索エンジン向けの表示抑制であり、アクセス制限ではない）。アクセス制限は access.tf の Cloudflare Access（本人限定）。
resource "cloudflare_pages_project" "portfolio_stage" {
  account_id        = var.account_id
  name              = local.portfolio_stage_project_name
  production_branch = "main"
}

resource "cloudflare_pages_domain" "portfolio_stage" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.portfolio_stage.name
  name         = local.portfolio_stage_domain
}
