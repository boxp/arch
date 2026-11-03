# apps/portfolio — b0xp.io

Keitaro Takeuchi (BOXP) のソフトウェアエンジニアとしてのポートフォリオサイト。
https://b0xp.io/ （本番、未切替）/ https://portfolio-stage.b0xp.io/ （stage、Cloudflare Access で本人限定）

boxp/arch モノレポ内の `apps/portfolio/` に置いている（BOXP-275。初期実装は boxp/b0xp.io から移管）。

- Astro + Tailwind CSS による静的サイト（クライアント JS なし）
- Cloudflare Pages へ GitHub Actions から `wrangler pages deploy`
  - stage: プロジェクト `boxp-portfolio-stage` → https://portfolio-stage.b0xp.io/ （noindex + Cloudflare Access 本人限定。現フェーズのデプロイ先）
  - 本番: プロジェクト `boxp-portfolio` → https://b0xp.io/ （本番切替フェーズで有効化。未切替）
- DNS / Pages プロジェクト / Cloudflare Access の定義は同リポジトリの `terraform/cloudflare/b0xp.io/portfolio/` で管理
- プロフィール画像は GitHub アカウント boxp のアバター（`src/assets/boxp-github-avatar.jpg`、https://avatars.githubusercontent.com/u/1819576 原寸 460x460）。Astro の `<Image>` で 160px / 320px (2x) の WebP に変換して表示

## 開発

```sh
npm ci
npm run dev      # http://localhost:4321
npm run build    # astro check + astro build -> dist/（本番設定）
npm run build:stage  # SITE_ENV=stage SITE_URL=https://portfolio-stage.b0xp.io でビルド（noindex + stage バナー）
npm run preview
npm run og       # public/og.png を再生成（profile.json の名前・ハンドルを反映）
```

Node 22.23.4 以上が必要です（`package.json` の `engines` 参照。Astro 7 の要求バージョンに合わせています）。

## コンテンツの更新

すべて `src/content/` 配下の Markdown / JSON（Astro Content Collections）で管理しています。外部 API への実行時依存はありません。

| パス | 内容 | 備考 |
| --- | --- | --- |
| `profile.json` | 名前・ハンドル・一言紹介・SNS リンク | `links.linkedin` を設定すると経歴セクションに LinkedIn 導線が出ます |
| `experience/*.md` | 経歴（1 社 1 ファイル） | 正本は LinkedIn。`_template.md` をコピーして作成。`linkedinSyncedAt` に突き合わせ日を記録 |
| `skills.json` | スキル（カテゴリ別） | `evidence` に裏付けとなる GitHub リポジトリを列挙 |
| `projects.json` | 主要プロジェクト | `lastUpdated` 降順で表示。`archived: true` は「過去の取り組み」として折りたたみ |
| `articles.json` | 公開記事 | |
| `talks.json` | 登壇資料（Speaker Deck） | `category: hobby` は折りたたみ表示 |

スキーマは `src/content.config.ts` を参照してください。ビルド時に zod で検証されます。

### 経歴の掲載ルール

- LinkedIn プロフィールを正本とし、会社名・役職・在籍期間（年月）・担当領域の要約のみを転記する
- 年収・退職理由・社外秘になり得るプロジェクト名は書かない
- LinkedIn 側を更新したら対応するファイルを更新し、`linkedinSyncedAt` を更新する

## デプロイ

workflow は `.github/workflows/deploy-portfolio.yml`（`apps/portfolio/**` と workflow 自身の変更で起動）。

- PR: 本番設定でビルドし Lighthouse CI（モバイルで Performance / Accessibility / SEO 各 90 以上をアサート）のみ
- `main` への push / workflow_dispatch: `SITE_ENV=stage` でビルド後に `wrangler pages deploy dist --project-name boxp-portfolio-stage`（stage のみ。本番 `boxp-portfolio` へのデプロイは本番切替フェーズで追加する）
- Secrets は arch リポジトリ既存の `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を使う

### ビルド時環境変数

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `SITE_URL` | `https://b0xp.io` | canonical / OGP / sitemap / robots.txt の URL |
| `SITE_ENV` | `production` | `stage` にすると `<meta name="robots" content="noindex, nofollow">`、robots.txt `Disallow: /`、画面上部の stage バナーが付く。検索エンジン向けの表示抑制であり、アクセス制限ではない（アクセス制限は Terraform 側の Cloudflare Access） |

## ライセンス

`scripts/fonts/` の Inter は SIL Open Font License 1.1（`scripts/fonts/LICENSE.txt`）。
サイト本文・画像の著作権は Keitaro Takeuchi に帰属します。
