# apps/hitohako

ひとはこさん（VTuber / 変身ヒロイン）のポートフォリオサイト。

- stage: <https://hitohako-stage.b0xp.io>（現在公開中のフェーズ。noindex + STAGE バナー表示）
- 本番（`hitohako.b0xp.io`）は後続フェーズで追加予定

和風（桜・鳥居・和柄）× 90 年代レトロゲーム（小物のドット絵・DotGothic16・RPG/ADV 風ウィンドウ。CRT 風フィルタや点滅などのアニメーションは使わない）。
キャラクター（立ち絵・顔グラ）は通常のイラスト。
配色は変身衣装に合わせた紫 × 金 × 桜ピンク。

## Stack

- [Astro](https://astro.build) 7 + [Tailwind CSS](https://tailwindcss.com) 4
- Node 24（Astro 7 は Node 22.23.4 以上が必要）
- Cloudflare Pages（stage プロジェクト名 `boxp-hitohako-stage`）

## Commands

`apps/hitohako/` で実行する。

| Command           | Action                               |
| :---------------- | :----------------------------------- |
| `npm ci`          | 依存関係をインストール               |
| `npm run dev`     | 開発サーバー起動 `localhost:4321`    |
| `npm run build`   | `./dist/` にビルド                   |
| `npm run preview` | ビルド結果をローカルでプレビュー     |

## Deploy

`.github/workflows/deploy-hitohako.yml` が `apps/hitohako/**` の変更で起動する。

- PR: `npm ci && npm run build` のみ（wrangler は走らない）
- `main` への push: `wrangler pages deploy dist --project-name boxp-hitohako-stage`

環境変数:

| 変数                | 用途                                                             |
| :------------------ | :--------------------------------------------------------------- |
| `SITE_URL`          | `astro.config.mjs` の `site`（OGP / canonical）。既定は stage URL |
| `PUBLIC_SITE_STAGE` | `'false'` 以外なら noindex meta と STAGE バナーを出す             |

Pages プロジェクトと DNS は `terraform/cloudflare/b0xp.io/hitohako/` で管理する。
`--project-name` は Terraform 側の `local.stage_project_name` と必ず一致させる。
`public/_headers` で `X-Robots-Tag: noindex` を付けている（検索避けであり、アクセス制御ではない）。

## Content

- `src/data/profile.json` … プロフィール（RPG ステータス画面）
- `src/data/allies.json` … 仲間（コハコ.exe / 鳴瀬理央 / 天城紗那）
- `src/data/stg.json` … STG 1CC 記録・挑戦中
- `src/data/links.json` … リンク
- `public/illust/` … キャラクターイラスト（ひとはこ立ち絵・顔グラ、コハコ.exe / 鳴瀬理央 / 天城紗那の顔グラ）。CSS 表示サイズの 2 倍（立ち絵 560x1280 → 280x640 表示、顔グラ 288x288 → 144x144 表示）で書き出した透過 PNG を `Illust` で表示する。`image-rendering: pixelated` は適用しない
- `public/pixel/` … 小物のドット絵（桜・鳥居、`scripts/make-tiles.py` で生成する和柄タイル）。`PixelImg` で整数倍表示する

## Credits

- アイコン・ヒーローイメージ（YouTube）: nagaren さん
- フォント: [DotGothic16](https://fonts.google.com/specimen/DotGothic16)（SIL OFL 1.1）
