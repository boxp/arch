# BOXP-275: b0xp.io ポートフォリオサイト刷新に伴う Cloudflare Pages / DNS 変更

サイト本体の設計メモは boxp/b0xp.io の `docs/project_docs/BOXP-275/plan.md` を参照。ここでは boxp/arch 側の変更のみ記す。

## 現状（2026-10-23）

- `terraform/cloudflare/b0xp.io/portfolio/dns.tf`: `b0xp.io` / `www.b0xp.io` は `shanghai-4t4.pages.dev`（手動作成の Pages プロジェクト `shanghai`、Terraform 管理外）への proxied CNAME。
- 同ディレクトリ `pages.tf` には `cloudflare_pages_project.iikanji` が既にある。

## 手順

1. **Pages プロジェクト追加（この PR）**: `cloudflare_pages_project.portfolio`（name `boxp-portfolio`, production_branch `main`）を `pages.tf` に追加する。DNS とカスタムドメインは触らない。apply 後、boxp/b0xp.io の Secrets に `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を設定し、main への push で `boxp-portfolio.pages.dev` に配信されることを確認する。
2. **DNS 切替（別 PR）**: 新サイトの内容（経歴の LinkedIn 転記を含む）を本人がレビューした後、
   - Cloudflare ダッシュボードで旧プロジェクト `shanghai` から `b0xp.io` / `www.b0xp.io` のカスタムドメインを外す（同一アカウント内で同じカスタムドメインを 2 つの Pages プロジェクトに付けられないため）。
   - `pages.tf` に `cloudflare_pages_domain`（`b0xp.io`, `www.b0xp.io`）を追加し、`dns.tf` の `local.page` を `cloudflare_pages_project.portfolio.subdomain` に置き換える。
   - apply 後に https://b0xp.io/ と https://www.b0xp.io/ の表示と HTTPS を確認する。
3. **後片付け**: 旧 Pages プロジェクト `shanghai` の削除可否と boxp/shanghai-next の archive をチケット Notes に記録する。

## 判断

- プロジェクト名は workflow の `--project-name` と Terraform の `name` を一致させる（iikanji での不一致による 522 を再発させない）。
- プロジェクト追加と DNS 切替を分けるのは、切替前に `*.pages.dev` で動作確認する余地を残すため。
