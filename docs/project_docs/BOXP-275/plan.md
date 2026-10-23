# BOXP-275: b0xp.io をソフトウェアエンジニアのポートフォリオサイトとして作り直す

チケット: BOXP (Obsidian vault) `Tickets/BOXP-275`
作成日: 2026-10-23（boxp/b0xp.io から移管: 2026-10-23）

## 背景

- 現行 b0xp.io は 2014 年起源の ClojureScript/Om 製 SPA（boxp/shanghai-next）。アイコンリンク 3 つのみで、エンジニアとしての情報が無い。Om 0.x はメンテ不能で依存更新が滞留。
- 配信は Cloudflare Pages（手動作成の `shanghai` プロジェクト、`shanghai-4t4.pages.dev`）。DNS は本リポジトリの Terraform（`terraform/cloudflare/b0xp.io/portfolio/dns.tf`）で CNAME 管理。

## 方針

- サイト本体は boxp/arch モノレポの `apps/portfolio/`（Astro 7 + Tailwind CSS 4、クライアント JS なし）。初期実装は別リポジトリ boxp/b0xp.io（PR #1、merge 済み）で行ったが、本人指示によりモノレポへ移管した。BOXP-276（ひとはこさん）の `apps/hitohako/` と同じ配置・CI 構成。shanghai-next は改修しない。
- Cloudflare Pages プロジェクト（本番 `boxp-portfolio`、stage `boxp-portfolio-stage`）・DNS・カスタムドメイン・Cloudflare Access は `terraform/cloudflare/b0xp.io/portfolio/` で管理し、workflow の `--project-name` と一致させる。
- デプロイは `.github/workflows/deploy-portfolio.yml`（paths フィルタ `apps/portfolio/**`）。PR ではビルド + Lighthouse CI のみ、`main` push / workflow_dispatch で `wrangler pages deploy`（stage のみ）。Actions は SHA pin し `actions.lock` に登録。
- コンテンツは `apps/portfolio/src/content/` の Content Collections で管理し、GitHub / LinkedIn API への実行時依存は持たない。
- 経歴は LinkedIn を正本（source of truth）とし、会社名・役職・在籍期間・担当領域の要約のみを 1 社 1 Markdown に転記する。詳細は LinkedIn へのリンクで案内する。
- 主要プロジェクトは Star 数ではなく最終 push 日を主キーに並べ、最終 push が 2 年以上前のものは「過去の取り組み」として折りたたむ。
- プロフィール画像は GitHub アカウント boxp のアバター（https://github.com/boxp 、 https://avatars.githubusercontent.com/u/1819576?v=4 、原寸 460x460 JPEG）。生成・改変はせず `src/assets/boxp-github-avatar.jpg` に保持し、Astro `<Image>` で 160px / 320px(2x) WebP に変換してヒーローに表示（alt 付き、`rounded-full` + `object-cover`、mobile 112px / desktop 160px）。
- Medium の本人プロフィールは https://medium.com/@boxpketaro 。記事の個別 URL（eureka-engineering publication 配下）は別物なので置換しない。
- 多言語対応は初期スコープ外（日本語ページ + 英語の一言紹介のみ）。

## フェーズ分け（2026-10-23 本人承認）

現フェーズは本番（b0xp.io / www.b0xp.io）を変更せず、独立した stage を実公開して本人が確認するところまで。

- stage: Pages プロジェクト `boxp-portfolio-stage`、カスタムドメイン `portfolio-stage.b0xp.io`（2026-10-23 時点で Terraform・実 DNS ともに未使用を確認して採用）。
- stage ビルドは `SITE_ENV=stage SITE_URL=https://portfolio-stage.b0xp.io`。`<meta name="robots" content="noindex, nofollow">`、robots.txt `Disallow: /`、画面上部に stage バナー。noindex は検索エンジン向けの表示抑制であり秘密保護ではない。
- stage のアクセス制御（本人承認 2026-10-23）: Cloudflare Access の self-hosted application を `portfolio-stage.b0xp.io` と `boxp-portfolio-stage.pages.dev` / `*.boxp-portfolio-stage.pages.dev`（preview を含む迂回経路）に追加。policy は既存アプリと同じ GitHub IdP を再利用しつつ、include を本人の GitHub 公開プロフィールのメールアドレス（github.com/boxp に公開済み、本リポジトリのコミット author と同じ）に限定し、require で GitHub IdP 経由を要求する。既存アプリの policy（`login_method` のみ）は変更しない。公開リポジトリ上のソース・画像は Access で秘密化できないため、機微情報は引き続き置かない。
- `main` push は stage へのみデプロイする。本番プロジェクト `boxp-portfolio` へのデプロイ・本番 DNS 切替・旧サイト / 旧 Pages プロジェクトの削除・shanghai-next / b0xp.io リポジトリの archive は未承認のため行わない。

## Content Collections

| collection | loader | 主なフィールド |
| --- | --- | --- |
| experience | glob `src/content/experience/*.md`（`_` 始まりは除外） | company, title, start, end, location, summary, linkedinSyncedAt |
| skills | file `skills.json` | category, order, items[{name, evidence[]}] |
| projects | file `projects.json` | repo, name, description, language, tags, lastUpdated, stars, archived |
| articles | file `articles.json` | title, url, publishedAt, publisher, summary |
| talks | file `talks.json` | title, url, date, event, category(engineering/hobby) |

profile（名前・ハンドル・一言紹介・SNS リンク）は `src/content/profile.json` を直接 import する。

## 転記元と取得日

| セクション | 転記元 | 取得日 | 状態 |
| --- | --- | --- | --- |
| プロフィール画像 | GitHub アバター https://avatars.githubusercontent.com/u/1819576?v=4 | 2026-10-23 | 完了（460x460 JPEG 原寸。`?s=1024` でも原寸以上は配信されない） |
| 経歴（experience） | LinkedIn プロフィール（本人提供の PDF または Data export、vault `Projects/BOXP-275/linkedin/`） | 未提供 | **未着手**。提供後に転記し、`linkedinSyncedAt` に転記日を記録して本人レビューを受ける。それまでセクションは「準備中」表示 |
| スキル（skills） | GitHub 公開リポジトリの言語・内容（`gh repo list boxp`） | 2026-10-23 | 暫定。LinkedIn の Skills と突き合わせて更新する |
| プロジェクト（projects） | `gh repo list boxp --source --no-archived`（fork 除外）の pushedAt / description | 2026-10-23 | 完了 |
| 記事（articles） | 本人 Medium プロフィール https://medium.com/@boxpketaro の RSS（`medium.com/feed/@boxpketaro`、author = BOXP(Keitaro Takeuchi)） | 2026-10-23 | 9 本すべて掲載（2018〜2025、公開先はいずれも eureka-engineering publication）。Lunar レビュー記事は Medium に無く公開 URL 未確認のため未掲載 |
| 登壇（talks） | speakerdeck.com/boxp の各デッキページ（published date） | 2026-10-23 | 完了（13 本。VR/アバター系 6 本は hobby として折りたたみ） |
| SNS リンク | GitHub プロフィール（X `b0xp2`、YouTube `@BOXPKETARO`）、Medium は本人指定 `@boxpketaro` | 2026-10-23 | LinkedIn URL は未提供（`links.linkedin: null`。設定すると自動で表示） |

## 経歴の掲載粒度（既定、本人が変更可）

- 会社名・役職・期間（年月）・担当領域の要約（1〜3 行）のみ。
- 年収・退職理由・社外秘になり得るプロジェクト名は載せない。
- 公開情報から分かっている範囲（参考）: GitHub プロフィールの company は `@eure`、記事は eureka-engineering の Medium publication に掲載。これらは LinkedIn エクスポートで裏取りするまで experience には書かない。

## 作業手順

1. [x] boxp/b0xp.io で Astro + Tailwind 雛形、コンテンツ、OGP / favicon / sitemap / robots.txt、CI（PR #1）
2. [x] arch に Pages プロジェクト `boxp-portfolio`（本番、未使用）と `boxp-portfolio-stage` + `portfolio-stage.b0xp.io` を追加（PR #13821、apply 済み）、arch の workflow_dispatch で stage へ初回デプロイし表示・HTTPS・noindex を確認
3. [x] サイト本体を arch `apps/portfolio/` へ移管し、`deploy-portfolio.yml`（paths フィルタ、PR は build + Lighthouse、main push で stage deploy）へ置き換え。旧 `deploy-portfolio-stage.yml` は削除
4. [x] GitHub アバターをヒーローに採用、Medium プロフィール URL を `@boxpketaro` に修正、本人 Medium RSS で記事一覧を 9 本に更新
5. [x] stage の Cloudflare Access（本人限定、pages.dev 含む）を `access.tf` に追加
6. [ ] merge → tfaction apply → stage 再デプロイ → 未認証で拒否・pages.dev 直 URL も拒否されることを確認（本人ログインでの閲覧確認は本人作業）
7. [ ] LinkedIn エクスポート提供後に experience / skills を転記し本人レビュー
8. [ ] 本番切替 PR（`dns.tf` の CNAME を `cloudflare_pages_project.portfolio.subdomain` へ、`cloudflare_pages_domain` を b0xp.io / www.b0xp.io に追加、本番デプロイ step 追加）。旧 `shanghai` プロジェクトからカスタムドメインを外してから apply
9. [ ] 後片付け: boxp/boxp プロフィール README のリンク確認、shanghai-next / boxp/b0xp.io の archive または README 誘導、旧 Pages プロジェクト `shanghai` の削除可否

## 検証

- `npm run build`（`astro check` 0 errors / 0 warnings）。
- Lighthouse はローカルに Chromium が無いため PR の Lighthouse CI ジョブ（モバイル、3 回計測、Performance / Accessibility / SEO ≥ 0.9 をアサート）で確認する。boxp/b0xp.io PR #1 の計測は Performance / Accessibility / Best Practices / SEO すべて 100。
- stage ビルドで robots.txt が `Disallow: /`、index.html に noindex メタと stage バナー、canonical / sitemap が `https://portfolio-stage.b0xp.io` になることを確認。
- Access 適用後: 未認証で `https://portfolio-stage.b0xp.io/` と `https://boxp-portfolio-stage.pages.dev/` が Cloudflare Access のログインへリダイレクト（302、本文・画像を返さない）されることを curl で確認。本人 GitHub ログイン後の閲覧と他ユーザー拒否は agent が代行できないため本人確認事項。

## 未決事項（本人判断が必要）

- Access policy の include に使ったメールアドレスが、本人が GitHub ログインに使う primary email と一致するか（不一致ならログインできないので、正しいアドレスを vault 側で指示してもらい差し替える）。
- LinkedIn プロフィール URL と経歴エクスポートの提供（vault `Projects/BOXP-275/linkedin/`）。
- メールアドレスを連絡先として載せるか（現状は SNS の DM 案内のみ）。
- shanghai-next / boxp/b0xp.io リポジトリを archive するか。
- Lunar レビュー記事の公開 URL（未公開なら掲載しない）。
- 本番切替（b0xp.io / www.b0xp.io の DNS・カスタムドメイン切替、本番プロジェクトへのデプロイ追加）の承認。
