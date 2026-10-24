# apps/hitohako

ひとはこさん（変身ヒロインVTuber）のポートフォリオサイト。セクション順はプロフィール / 活動 / 配信アーカイブ / リンク / 仲間 / クレジット。

- stage: <https://hitohako-stage.b0xp.io>（現在公開中のフェーズ。noindex + STAGE バナー表示）
- 本番（`hitohako.b0xp.io`）は後続フェーズで追加予定

和風（桜・鳥居・和柄）× 90 年代レトロゲーム（小物のドット絵・DotGothic16・RPG/ADV 風ウィンドウ。CRT 風フィルタや点滅などのアニメーションは使わない）。
キャラクター（hero 絵・顔グラ）は通常のイラスト。
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
`public/_headers` で `X-Robots-Tag: noindex` を付けている（検索避けであり、アクセス制御ではない）。同じファイルで HTML・非ハッシュ asset は `max-age=0, must-revalidate`、`/_astro/*` と hero 絵 `hitohako-hero-<hash>*` は `immutable` を指定している。

## Content

- `src/data/profile.json` … プロフィール（RPG ステータス画面）
- `src/data/allies.json` … 仲間（コハコ.exe / 鳴瀬理央 / 天城紗那）
- `src/data/stg.json` … STG 1CC 記録・挑戦中
- `src/data/links.json` … リンク
- `src/data/archives.json` … 配信アーカイブ（YouTube 動画 ID・タイトル・日付の明示リスト。本人チャンネル UCS8gl96UiidzwHrn9bugOKg の公開動画のみ。追加時は `https://www.youtube.com/oembed?url=...` で公開/埋込可を確認する）
- `public/illust/` … キャラクターイラスト（ひとはこ hero 絵・顔グラ、コハコ.exe / 鳴瀬理央 / 天城紗那の顔グラ）。顔グラは CSS 表示サイズの 2 倍（288x288 → 144x144 表示）で書き出した透過 PNG を `Illust` で表示する。hero 絵は本人指定の背景込み横長完成画像（2560x1428 JPEG）をそのまま使う。`hitohako-hero-<hash>.jpg`（原本と同一バイト、`<img src>` の fallback）と `hitohako-hero-<hash>-<w>w.webp`（960 / 1440 / 2560、縮小のみ）を `srcset` に使い、`<hash>` は原本 JPEG の SHA-256 先頭 10 桁なので納品原本との照合ができる。`src/lib/hero.ts` が build 時にファイル名と寸法を解決し、`TitleScreen` の `<picture>` と `Layout` の `<link rel="preload" imagesrcset>` が同じ revision を参照する。表示は lg 以上で全幅（アスペクト比維持、`max-height: 100dvh` で縦長画面では下端だけ cover クロップ）の絵の右上余白に RPG ウィンドウで名前・肩書・一文紹介・PRESS START を重ね、lg 未満は縦積み（絵 → タイトル）。sm 未満は 4:3 枠に `object-position: 24% 50%` で人物と薙刀全体が入るように framing する（絵の加工・反転・描き直しはしない）。差し替えは `uvx --from pillow python -I scripts/make-hero.py <hero.jpg>`（旧ファイル削除込み）。絵を差し替えると URL も変わるため、旧画像の browser / CDN cache が残っても新しい絵が表示される。`image-rendering: pixelated` は適用しない
- `public/pixel/` … 小物のドット絵（桜・鳥居、`scripts/make-tiles.py` で生成する和柄タイル）。`PixelImg` で整数倍表示する

## 配信アーカイブ（YouTube 埋め込み）

`Archives` は初期表示ではサムネイル（`i.ytimg.com/vi/<id>/hqdefault.jpg`, lazy）と ▶ PLAY ボタンだけを描画し、押されたカードだけ `youtube-nocookie.com/embed/<id>?autoplay=1&rel=0` の iframe に置き換える（ページロード時の自動再生・iframe 生成なし）。各カードに `YouTube で見る` の外部リンクを常時表示するので、埋め込みが使えない環境でも視聴できる。

## Credits

- アイコン・ヒーローイメージ（YouTube）: nagaren さん
- フォント: [DotGothic16](https://fonts.google.com/specimen/DotGothic16)（SIL OFL 1.1）
