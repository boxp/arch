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

## Cloudflare Access（PR 3: stage を本人限定にする）

- stage は本人の表示確認用のため、`terraform/cloudflare/b0xp.io/hitohako/access.tf` で
  `hitohako-stage.b0xp.io` を Cloudflare Access で保護する。
- 既存アプリと同じ GitHub IdP（`cloudflare_zero_trust_access_identity_providers` から `type == "github"` を取得）を再利用する。
  include は GitHub ログイン全員（`login_method`）ではなく本人の GitHub 公開プロフィールのメールアドレスに限定し、
  require で GitHub IdP 経由を要求する。BOXP-275 の `portfolio/access.tf` と同じ方式。
- 迂回経路: `boxp-hitohako-stage.pages.dev` と preview `*.boxp-hitohako-stage.pages.dev` にも
  account スコープの Access application を追加し同じ policy を適用する。
- noindex は併用するがアクセス制御の代替ではない。公開リポジトリ内のソース・画像は Access で秘密化できない。
- 本番 / 既存他アプリの Access policy は変更しない。

## アプリ / CI（PR 2）

- 実装は boxp/hitohako-site PR #1 の内容を `apps/hitohako/` へ移管（内容一致、独立 repo 側の deploy は有効化しない）。
- `deploy-hitohako.yml`: `apps/hitohako/**` の変更で起動。PR では `npm ci && npm run build` のみ、
  `main` への push 時だけ `wrangler pages deploy dist --project-name boxp-hitohako-stage` を実行する。
  secrets は arch 既存の `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を使う。
- stage 表示: 画面上部の STAGE バナー、`<meta name="robots" content="noindex">`、
  `public/_headers` の `X-Robots-Tag: noindex`。noindex はアクセス制御ではない。
- セクション順: タイトル画面（PRESS START）/ プロフィール（RPG ステータス風）/ 活動（STG 1CC 記録）/ リンク / 仲間 / クレジット。
  メニューの並びも同じ順にする（2026-10-23 変更: 仲間はリンクの下）。
- 文言（2026-10-23 変更）: 肩書は「変身ヒロイン」のみとし、VTuber 由来の肩書やキャラクター制作由来の説明文は置かない。
  SKILLS は作中能力と「趣味でゲーム配信をしています」程度の紹介に留め、プロフィール内のナビゲーター会話枠（コハコ.exe）は置かない
  （仲間セクションのコハコ.exe 紹介は維持）。
- キャラクター（ひとはこ立ち絵・顔グラ、コハコ.exe / 鳴瀬理央 / 天城紗那の顔グラ）はドット絵ではなく
  通常のイラストにする（2026-10-23 方針変更。旧「高解像度ドット絵化」は撤回）。原典の作画資料を参照して
  生成した通常イラストの原本を緑背景透過・トリミングし、CSS 表示サイズの 2 倍（立ち絵 560x1280、顔グラ 288x288）
  の透過 PNG として `public/illust/` に置き、`Illust` コンポーネントで表示する。キャラにはドット絵変換・減色・
  `image-rendering: pixelated` / nearest 拡大・整数倍強制を適用しない。
- 背景タイル・桜・鳥居などの小ドット素材と和風 × レトロゲーム UI は維持し、`image-rendering: pixelated` は
  `.pixel`（小物・タイル）だけに限定する。
- 演出: DotGothic16、ADV 風二重枠ウィンドウ、静的な ▼ カーソル / PRESS START ボタン。
  画面全体の CRT 風フィルタ（走査線・ビネット・スクロール）、点滅（カーソル・PRESS START・メニュー ▶）、
  タイプライター表示、小物の上下揺れは、通常設定でもちらつかないように全て撤去する（2026-10-23 変更。
  `prefers-reduced-motion` 時だけ止める方式は取らない）。keyframe アニメーションは定義しない。
- Twitch リンクは `https://www.twitch.tv/boxpketaro`。

## Rollout

1. PR 1（Terraform）を tfaction plan で確認してマージし、apply で Pages project と DNS を作成する。
2. PR 2（アプリ + workflow）をマージし、`deploy-hitohako.yml` で stage へデプロイする。
3. `https://hitohako-stage.b0xp.io` の HTTPS 200 応答、デスクトップ/モバイル表示、主要リンク、画像、
   console エラー無し、noindex を確認する。
4. `b0xp.io` / `www.b0xp.io` / `iikanji.b0xp.io` / `hitohako.b0xp.io`（未作成のまま）が変わっていないことを確認する。
5. PR 3（Access）をマージ・apply し、未認証アクセスが Cloudflare Access のログイン画面へ誘導される（本文・画像を取得できない）こと、
   `boxp-hitohako-stage.pages.dev` 直 URL も同様に保護されることを確認する。本人ログイン後の閲覧確認と他ユーザーの拒否確認は
   本人操作が必要なため、agent は代行せず確認事項として返す。

## Rollback

- アプリ: `apps/hitohako/` の変更を revert して main に push すると前の内容で再デプロイされる。
  緊急時は Cloudflare Pages の deployment を以前のものへ rollback する。
- Terraform: PR 1 を revert してマージすると stage の Pages project / DNS が削除される。
- Access: PR 3 を revert してマージすると Access application / policy が削除され、stage が未認証で閲覧できる状態に戻る。
