# BOXP-276: ひとはこさんポートフォリオサイト（stage: hitohako-stage.b0xp.io）

## Goal

VTuber「ひとはこ」のポートフォリオサイトを boxp/arch のモノレポ構成で実装し、
まず独立した stage 環境 `https://hitohako-stage.b0xp.io` で実公開・表示確認する。
本番ドメイン（`hitohako.b0xp.io`）の作成や既存サイト（`b0xp.io` / `www.b0xp.io` /
`iikanji.b0xp.io`）の変更は本フェーズの対象外。

## 配置（boxp/arch 内）

| 役割 | パス |
| --- | --- |
| サイト本体（Astro 7 + Tailwind CSS 4） | `apps/hitohako/` |
| Cloudflare Pages / DNS（独立 working directory・独立 state） | `terraform/cloudflare/b0xp.io/hitohako/` |
| CI / デプロイ | `.github/workflows/deploy-hitohako.yml` |

- 並行チケット BOXP-275（`apps/portfolio` 想定）とディレクトリ・Terraform state・workflow を分離し、
  共有モジュール `terraform/cloudflare/b0xp.io/portfolio/` には変更を入れない。
- 構成は既存の `apps/video-rotator` + `terraform/cloudflare/b0xp.io/video-rotator/` に揃える。

## Terraform（PR 1）

- `cloudflare_pages_project.hitohako_stage`（name: `boxp-hitohako-stage`, production_branch: `main`）
- `cloudflare_pages_domain.hitohako_stage`（`hitohako-stage.b0xp.io`）
- `cloudflare_dns_record.hitohako_stage`（`hitohako-stage.b0xp.io` → Pages subdomain への proxied CNAME）
- 事前確認: `hitohako-stage.b0xp.io` は未使用（NXDOMAIN）。

## アプリ / CI（PR 2）

- 実装は boxp/hitohako-site PR #1 の内容を `apps/hitohako/` へ移管（内容一致、独立 repo 側の deploy は有効化しない）。
- `deploy-hitohako.yml`: `apps/hitohako/**` の変更で起動。PR では `npm ci && npm run build` のみ、
  `main` への push 時だけ `wrangler pages deploy dist --project-name boxp-hitohako-stage` を実行する。
  secrets は arch 既存の `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を使う。
- stage 表示: 画面上部の STAGE バナー、`<meta name="robots" content="noindex">`、
  `public/_headers` の `X-Robots-Tag: noindex`。noindex はアクセス制御ではない。
- セクション: タイトル画面（PRESS START）/ プロフィール（RPG ステータス風）/ 仲間 / 活動（STG 1CC 記録）/ リンク / クレジット。
- 演出: DotGothic16、ADV 風二重枠ウィンドウ、CRT 走査線、点滅カーソル、`image-rendering: pixelated`、
  `prefers-reduced-motion` でアニメーション停止。

## Rollout

1. PR 1（Terraform）を tfaction plan で確認してマージし、apply で Pages project と DNS を作成する。
2. PR 2（アプリ + workflow）をマージし、`deploy-hitohako.yml` で stage へデプロイする。
3. `https://hitohako-stage.b0xp.io` の HTTPS 200 応答、デスクトップ/モバイル表示、主要リンク、画像、
   console エラー無し、noindex を確認する。
4. `b0xp.io` / `www.b0xp.io` / `iikanji.b0xp.io` / `hitohako.b0xp.io`（未作成のまま）が変わっていないことを確認する。

## Rollback

- アプリ: `apps/hitohako/` の変更を revert して main に push すると前の内容で再デプロイされる。
  緊急時は Cloudflare Pages の deployment を以前のものへ rollback する。
- Terraform: PR 1 を revert してマージすると stage の Pages project / DNS が削除される。
