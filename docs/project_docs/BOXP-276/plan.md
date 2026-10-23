# BOXP-276: ひとはこさんポートフォリオサイト (hitohako.b0xp.io)

## Goal

VTuber ペルソナ「ひとはこ」のポートフォリオサイトを、現行 `b0xp.io`（boxp/shanghai-next）とは別の
新サブドメイン `hitohako.b0xp.io` で公開する。サイト上のひとはこさんは
Vault「ひとはこさんバース」の変身ヒロイン「一箱（ひとはこ）」と同一人物として描く。

## Scope（boxp/arch 側）

- `terraform/cloudflare/b0xp.io/portfolio/pages.tf`
  - `cloudflare_pages_project.hitohako`（name: `boxp-hitohako`, production_branch: `main`）
  - `cloudflare_pages_domain.hitohako_subdomain`（`hitohako.b0xp.io`）
- `terraform/cloudflare/b0xp.io/portfolio/dns.tf`
  - `cloudflare_dns_record.hitohako`（`hitohako.b0xp.io` → `boxp-hitohako.pages.dev` への proxied CNAME）
- 既存の `b0xp.io` / `www.b0xp.io` / `iikanji.b0xp.io` のリソースは変更しない。
- iikanji 用の `locals.project_name` は触らず、`locals.hitohako_project_name` を別に切る
  （並行チケット BOXP-275 が同モジュールを触るためコンフリクト面を小さくする）。

## Scope（サイト側: boxp/hitohako-site）

- Astro 7 + Tailwind CSS 4 + Node 22、`wrangler pages deploy dist --project-name=boxp-hitohako`。
- deploy workflow は `push: main` のときだけ wrangler を実行し、PR では `npm run build` のみ行う
  （iikanji で起きた Dependabot 起点の secrets 未参照による失敗を避ける）。
- セクション: タイトル画面（PRESS START）/ プロフィール（RPG ステータス風）/ 仲間 / 活動（STG 1CC 記録）/ リンク / クレジット。
- 演出: DotGothic16、ADV 風二重枠ウィンドウ、CRT 走査線、点滅カーソル、`image-rendering: pixelated`、
  `prefers-reduced-motion` でアニメーション停止。
- 掲載範囲: Vault の公開可能設定のみ。偽名・学校・身体ディテール・露出系/強制装着フォーム・
  黒繭機関の捕獲描写・NSFW 小説・初音ミク（PCL 未確認）・セーラー戦士フォームは掲載しない。
- nagaren さん作のアイコン・ヒーローイメージは許諾確認が取れるまで掲載せず、
  generate-pixelart で生成したドット絵のみ使う。クレジットには nagaren さんの名前を掲載する。

## Rollout

1. 本 PR（Terraform）を tfaction plan で確認してマージ・apply する。
2. boxp/hitohako-site に `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` の secrets を設定する。
3. hitohako-site の実装 PR を main にマージし、`https://hitohako.b0xp.io` の 200 応答を確認する。
4. `b0xp.io` / `www.b0xp.io` / `iikanji.b0xp.io` の挙動が変わっていないことを確認する。

## Notes

- ローカルに terraform/aqua が無い場合は CI/tfaction の plan で最終確認する。
- Terraform のプロジェクト名 `boxp-hitohako` と workflow の `--project-name` を必ず一致させる。
