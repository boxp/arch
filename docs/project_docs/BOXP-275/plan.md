# BOXP-275: b0xp.io ポートフォリオサイト刷新に伴う Cloudflare Pages / DNS 変更

サイト本体の設計メモは boxp/b0xp.io の `docs/project_docs/BOXP-275/plan.md` を参照。ここでは boxp/arch 側の変更のみ記す。

## 現状（2026-10-23）

- `terraform/cloudflare/b0xp.io/portfolio/dns.tf`: `b0xp.io` / `www.b0xp.io` は `shanghai-4t4.pages.dev`（手動作成の Pages プロジェクト `shanghai`、Terraform 管理外）への proxied CNAME。
- 同ディレクトリ `pages.tf` には `cloudflare_pages_project.iikanji` が既にある。

## フェーズ分け

本人承認（2026-10-23）により、まず本番を変更せずに独立した stage 環境を別サブドメインで実公開し、確認が取れてから本番切替に進む。

### フェーズ 1: stage 公開（この PR）

1. `pages.tf` に以下を追加する。
   - `cloudflare_pages_project.portfolio`（name `boxp-portfolio`, production_branch `main`）: 本番用。このフェーズではカスタムドメインを付けず、デプロイもしない。
   - `cloudflare_pages_project.portfolio_stage`（name `boxp-portfolio-stage`）と `cloudflare_pages_domain.portfolio_stage`（`portfolio-stage.b0xp.io`）: stage 用。
2. `dns.tf` に `cloudflare_dns_record.portfolio_stage`（`portfolio-stage.b0xp.io` → stage プロジェクトの `subdomain`、proxied CNAME）を追加する。`b0xp.io` / `www.b0xp.io` の CNAME は触らない。
3. `.github/workflows/deploy-portfolio-stage.yml`（workflow_dispatch）を追加する。boxp/b0xp.io を checkout し `SITE_ENV=stage` でビルドして `boxp-portfolio-stage` へデプロイする。boxp/b0xp.io 側に `CLOUDFLARE_API_TOKEN` が設定されるまでの暫定経路で、arch が既に持つ Cloudflare 認証情報（video-rotator と同じ）を使う。本番プロジェクトへはデプロイしない。
4. apply 後、`deploy-portfolio-stage.yml` を実行し https://portfolio-stage.b0xp.io/ の表示・HTTPS・noindex メタ・robots.txt を確認する。

stage ドメイン名は `portfolio-stage.b0xp.io`。2026-10-23 時点で arch の Terraform にも実 DNS にも存在しないことを確認した（既存の stage 命名 `hitohub-stage.b0xp.io` に揃えた）。

### フェーズ 2: 本番切替（別 PR、未承認）

新サイトの内容（経歴の LinkedIn 転記を含む）を本人が stage でレビューし承認した後、

- Cloudflare ダッシュボードで旧プロジェクト `shanghai` から `b0xp.io` / `www.b0xp.io` のカスタムドメインを外す（同一アカウント内で同じカスタムドメインを 2 つの Pages プロジェクトに付けられないため）。
- `pages.tf` に `cloudflare_pages_domain`（`b0xp.io`, `www.b0xp.io`）を追加し、`dns.tf` の `local.page` を `cloudflare_pages_project.portfolio.subdomain` に置き換える。
- boxp/b0xp.io の workflow に本番プロジェクトへのデプロイを追加する。
- apply 後に https://b0xp.io/ と https://www.b0xp.io/ の表示と HTTPS を確認する。

### フェーズ 3: 後片付け（未承認）

旧 Pages プロジェクト `shanghai` の削除可否、boxp/shanghai-next の archive、stage 環境（`boxp-portfolio-stage` / `portfolio-stage.b0xp.io` / `deploy-portfolio-stage.yml`）を残すか削除するかをチケット Notes に記録する。

## 判断

- プロジェクト名は workflow の `--project-name` と Terraform の `name` を一致させる（iikanji での不一致による 522 を再発させない）。
- stage を本番プロジェクトの preview deployment ではなく独立プロジェクトにしたのは、本番プロジェクト・本番 DNS を一切触らないという承認条件に合わせるため（video-rotator の prod/dev 2 プロジェクト構成と同じ）。
- stage の `noindex` / robots.txt Disallow は検索エンジンへの表示抑制であり、アクセス制限ではない。未確認の経歴・メールアドレス・非公開原稿は stage にも載せない。
- Cloudflare API トークンは codex-workspace から取得できない（ローカルに無く、k8s Secret の読み取り権限も無い）。新しいトークンの発行や権限拡大は未承認のため、既存の arch Secrets を使う workflow_dispatch を暫定経路とし、boxp/b0xp.io への `CLOUDFLARE_API_TOKEN` 設定は本人に依頼する（`CLOUDFLARE_ACCOUNT_ID` は公開値のため設定済み）。
