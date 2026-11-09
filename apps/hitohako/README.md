# apps/hitohako

ひとはこさん（変身ヒロインVTuber）の公式ポートフォリオサイト。プロフィール、配信アーカイブ、1CCの記録、公式リンクを紹介する。桜色を基調に、明るい余白と明朝体を組み合わせた静かなデザイン。

- stage: <https://hitohako-stage.b0xp.io>（noindex と STAGE バナー）
- 本番（`hitohako.b0xp.io`）は後続フェーズで追加予定

## Stack

- [Astro](https://astro.build) 7 + [Tailwind CSS](https://tailwindcss.com) 4
- Node 24（Astro 7 は Node 22.23.4 以上が必要）
- Cloudflare Pages（stage プロジェクト名 `boxp-hitohako-stage`）
- フォント: [Shippori Mincho B1](https://fonts.google.com/specimen/Shippori+Mincho+B1)、[Zen Kaku Gothic New](https://fonts.google.com/specimen/Zen+Kaku+Gothic+New)（SIL Open Font License 1.1）

## Commands

`apps/hitohako/` で実行する。

| Command | Action |
| :--- | :--- |
| `npm ci` | 依存関係をインストール |
| `npm run dev` | 開発サーバー起動 `localhost:4321` |
| `npm run build` | `./dist/` にビルド |
| `npm run preview` | ビルド結果をローカルでプレビュー |

## Deploy

`.github/workflows/deploy-hitohako.yml` が `apps/hitohako/**` の変更で起動する。PR ではビルドのみ、`main` への push では `wrangler pages deploy dist --project-name boxp-hitohako-stage` を実行する。

`SITE_URL` は OGP / canonical 用のサイト URL（既定は stage URL）。`PUBLIC_SITE_STAGE` が `'false'` 以外なら noindex と STAGE バナーを表示する。Pages プロジェクトと DNS は `terraform/cloudflare/b0xp.io/hitohako/` で管理し、プロジェクト名は Terraform の `local.stage_project_name` と一致させる。`public/_headers` の `X-Robots-Tag: noindex` はアクセス制御ではない。HTML・非ハッシュ asset は再検証、`/_astro/*` とハッシュ付き hero は immutable でキャッシュする。

## Content

- `src/components/` … Hero、Profile、Archives、Records、Links、Bonus、Credits、SectionHeading
- `src/data/profile.json` … プロフィールと世界観
- `src/data/allies.json` … 仲間
- `src/data/stg.json` … 1CC 記録・挑戦中
- `src/data/links.json` … 公式リンク
- `src/data/archives.json` … YouTube の動画 ID・タイトル・日付。追加時は公開・埋込可を確認する
- `public/illust/` … キャラクターイラスト。hero は原本と同一バイトの `hitohako-hero-<hash>.jpg` と 960 / 1440 / 2560 幅の WebP を使用し、ハッシュは JPEG の SHA-256 先頭10桁。`scripts/make-hero.py` で差し替えられる。

`src/lib/hero.ts` は hero の寸法とファイル名を解決し、`HERO_SIZES` を Hero の picture と Layout の preload で共有する。大画面では右側の絵を上端に合わせて下側をクロップし、左と下の縁をフェードする。小画面では正方形、幅640px以上では4:3の枠で表示する。

アーカイブはサムネイルをクリックしたときだけ youtube-nocookie のプレーヤーを生成し、各動画へのリンクを常時表示する。
