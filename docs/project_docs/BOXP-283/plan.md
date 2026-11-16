# BOXP-283: ひとはこさん hero を自然な開口の柔らかい表情で描き直し、画像未反映も解消

対象: `apps/hitohako`（stage: hitohako-stage.b0xp.io のみ。本番・共有インフラ・認証 policy は変更しない）

## 背景

BOXP-281 の hero について Owner から 2 点のレビューが入った。

1. ページ上で画像が差し替わって見えない。
2. 原画がまだひとはこさんらしくない。自然に口を開いた柔らかい表情に描き直してほしい。

## 方針

### 1. 絵の描き直し

- 「小さく口を開いた温かな笑顔」を評価項目にし、口だけでなく目元・眉・頬・顔の輪郭を原典に合わせて描き直す（口の線だけの修正や既存候補の差し替えはしない）。
- 評価軸: 優しさ・育ちの良さ・包容力。大口の叫び / 歯を食いしばる顔 / 誇張した笑い / 無表情にしない。戦闘的・男性的な印象に戻さず、体形誇張・露出増・幼児化で代替しない。
- 同一性・衣装は原典どおり: 黒髪ロング + 左右の三つ編み、碧眼、桜の髪飾り、桜柄と金縁の紫着物トップス、肩当て、帯リボンと長いサッシュ、指ぬきグローブ、黒×紫ブーツ。薙刀は傍らに立てて添える程度。
- 大きい通常イラスト・髪/袖/帯の軽やかな動き・静的表示は維持。表示サイズ CSS は変更しない。
- 制作: Nano Banana Pro（`gemini-3-pro-image`, 2K, 3:4, 緑背景）で複数候補を生成し、顔アップ・全身・PC/mobile 実表示で比較して採用。`scripts/make-hero.py` で透過化。

### 2. 表示未反映の切り分けと再発防止

- cache と断定せず、main の実画像 → build 成果物 → deploy run の upload log → HTML の `<picture>` / preload → 配信ファイル、の順に検証する。
- 再発防止として hero を内容ハッシュ付きファイル名 `illust/hitohako-hero-<sha256 先頭 10 桁>.{png,webp}` に変更し、`src/lib/hero.ts` が build 時に 1 件だけ存在することを検証してファイル名を解決する。`<picture>` の WebP / PNG と `<link rel="preload">` は同じ revision を参照する。
- `public/_headers` で HTML と非ハッシュ asset は `Cache-Control: public, max-age=0, must-revalidate`、`/_astro/*` と `illust/hitohako-hero-*` は `immutable` を明示する。
- 認証 302 だけを実画像反映の確認にしない。agent は Cloudflare Access を迂回できないため、配備 artifact とデプロイログで確認し、本人確認の最小点を明示する。

### 3. 不変更

配信アーカイブ 6 件・章順・既反映文言・STG 記録・仲間・他キャラ・静的表示（点滅/走査線/動的演出なし）・本番・認証 policy・他インフラ。

## 検証

- `npm run build` で `dist/index.html` の `<picture>` と preload がハッシュ付き URL を指すこと。
- Playwright（公式 Docker イメージ、外部リクエスト遮断）で 1280x800 / 1366x768 / 390x844 / 320x568 の hero 表示、横スクロール無し、page error 0、初期 iframe 0、アーカイブカード 6 件、章順不変。
- 旧ファイル名 `hitohako-hero.{png,webp}` への参照が残っていないこと。

## Rollback

PR を `git revert` して main に merge すると BOXP-281 の hero（f33fbd06 相当、固定ファイル名）に戻る。
