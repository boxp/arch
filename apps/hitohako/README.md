# apps/hitohako

ひとはこさん（変身ヒロイン）のポートフォリオサイト。セクション順はプロフィール / 活動 / 配信アーカイブ / リンク / 仲間 / クレジット。

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
- `src/data/archives.json` … 配信アーカイブ（YouTube 動画 ID・タイトル・日付の明示リスト。本人チャンネル UCS8gl96UiidzwHrn9bugOKg の公開動画のみ。追加時は `https://www.youtube.com/oembed?url=...` で公開/埋込可を確認する）
- `public/illust/` … キャラクターイラスト（ひとはこ hero 絵・顔グラ、コハコ.exe / 鳴瀬理央 / 天城紗那の顔グラ）。顔グラは CSS 表示サイズの 2 倍（288x288 → 144x144 表示）で書き出した透過 PNG を `Illust` で表示する。hero 絵 `hitohako-hero.{png,webp}` は 1159x1600（2x）の透過画像で、`TitleScreen` が `<picture>`（WebP 優先）+ 高さ基準（desktop `min(800px, 82dvh)` / mobile `min(560px, 52dvh)`）で表示する。緑背景の生成原画からの透過化は `uvx --from pillow python -I scripts/make-hero.py <src.png>`。`image-rendering: pixelated` は適用しない
- `public/pixel/` … 小物のドット絵（桜・鳥居、`scripts/make-tiles.py` で生成する和柄タイル）。`PixelImg` で整数倍表示する

## 配信アーカイブ（YouTube 埋め込み）

`Archives` は初期表示ではサムネイル（`i.ytimg.com/vi/<id>/hqdefault.jpg`, lazy）と ▶ PLAY ボタンだけを描画し、押されたカードだけ `youtube-nocookie.com/embed/<id>?autoplay=1&rel=0` の iframe に置き換える（ページロード時の自動再生・iframe 生成なし）。各カードに `YouTube で見る` の外部リンクを常時表示するので、埋め込みが使えない環境でも視聴できる。

## Credits

- アイコン・ヒーローイメージ（YouTube）: nagaren さん
- フォント: [DotGothic16](https://fonts.google.com/specimen/DotGothic16)（SIL OFL 1.1）
