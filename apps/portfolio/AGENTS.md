# AGENTS.md

このディレクトリ（boxp/arch `apps/portfolio/`）は Keitaro Takeuchi (BOXP) のポートフォリオサイト https://b0xp.io/ のソースです。コマンドはこのディレクトリで実行してください。

## 構成

- Astro 7 + Tailwind CSS 4（`@tailwindcss/vite`）。静的 HTML + CSS が基本。クライアント JS は `Layout.astro` の配色テーマ切替（head の inline script、フレームワーク・hydration なし）だけに留める。
- コンテンツは `src/content/` の Content Collections（スキーマ: `src/content.config.ts`）。
- トップは `src/pages/index.astro`。セクション共通部品は `src/components/`。インフラ図は紹介ページを作らず、トップの Infrastructure 節のカードから各図の URL へ直接リンクする（内容は `src/lib/diagrams.ts`）。図の本体はこの repo に置かない。
- 全体図のカードは stage でだけ生成する。図の匿名公開は未承認なので、本番ビルドに URL も導線もサムネイルも出さない（CI が検査する）。
- 全体図のサムネイルはコミットせず、`public/` にも置かない（本番設定のビルドに混ざる）。stage の deploy がビルド後に環境 `portfolio-stage-private` の secret から `dist/diagrams/` へ復元する。stage の `dist` は public repo の artifact へ上げない。
- OGP 画像は `npm run og` で `public/og.png` を生成する（`@resvg/resvg-js` + 同梱 Inter）。
- デプロイはリポジトリルートの `.github/workflows/deploy-portfolio.yml`（`apps/portfolio/**` の変更で起動）。PR ではビルド + Lighthouse CI のみ、`main` push で Cloudflare Pages の stage プロジェクト `boxp-portfolio-stage`（https://portfolio-stage.b0xp.io/、Cloudflare Access で本人限定）へデプロイ。本番 `boxp-portfolio` へのデプロイは本番切替フェーズで追加する。
- プロフィール画像は GitHub アカウント boxp のアバター（`src/assets/boxp-github-avatar.jpg`）。生成・改変した画像に差し替えない。更新するときは https://avatars.githubusercontent.com/u/1819576?v=4 を取り直す。
- `SITE_ENV=stage` / `SITE_URL` はビルド時環境変数（`astro.config.mjs` の `env.schema`、`src/lib/site.ts`）。stage では noindex メタ・robots.txt Disallow・stage バナーを出す。noindex はアクセス制限ではないので、stage にも未確認の経歴・メールアドレス・非公開原稿は載せない。
- DNS / Pages プロジェクト / Cloudflare Access は同リポジトリの Terraform（`terraform/cloudflare/b0xp.io/portfolio/`）で管理。tfaction の plan / apply を経由する。

## 作業ルール

- `npm run build` が通ること（`astro check` を含む）。
- 依存を追加するときは理由を PR に書く。ランタイムで外部 API（GitHub / LinkedIn 等）を叩く実装は入れない。
- GitHub Actions は SHA でピン留めし、コメントにバージョンを残す。
- 経歴（`src/content/experience/`）は本人の公開記事・LinkedIn・本人提供資料など、公開されている一次情報で裏付けのある内容だけを要約し、`sources` に根拠 URL を書く。入社年月・役職名・数字などを推測で書かない。年収・退職理由・社外秘になり得る情報は書かない。
- プロジェクト一覧は最終更新日（`lastUpdated`）降順。最終 push が 2 年以上前のものは `archived: true` にする。
- Lighthouse（モバイル）で Performance / Accessibility / SEO が 90 を下回る変更は入れない。
- 設計メモはリポジトリルートの `docs/project_docs/<チケット番号>/plan.md` に残す（BOXP-275: `docs/project_docs/BOXP-275/plan.md`）。
- 掲載可否の判断や非公開情報（LinkedIn エクスポート原本、メールアドレス、未公開原稿）は public なこのリポジトリ / PR に書かない。

## 開発コマンド

```sh
npm ci
npm run dev
npm run build
npm run og
```
