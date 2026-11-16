# BOXP-293: ひとはこ Hero を指定の完成画像に合わせて再レイアウトし、肩書を「変身ヒロインVTuber」へ

対象: `apps/hitohako`（stage: hitohako-stage.b0xp.io のみ。本番・共有インフラ・認証 policy は変更しない）

## 背景

本人から、Hero に使う完成画像（背景込みの横長イラスト 2560x1428）と、肩書を「変身ヒロインVTuber」にする依頼があった。これまでの透過立ち絵（生成・局所修正の積み重ね）は使わず、指定画像をそのまま主役にした Hero へ刷新する。

## 方針

- 画像は納品された完成絵をそのまま採用する。描き直し・生成補完・顔/髪/衣装の修正・反転・背景の切り抜きはしない。許可される加工は縮小と WebP 変換のみ。
- `scripts/make-hero.py` を JPEG 原本向けに書き換える。`hitohako-hero-<hash>.jpg` は原本と同一バイト（`<img src>` fallback）、`hitohako-hero-<hash>-{960,1440,2560}w.webp` は LANCZOS 縮小のみの `srcset` 候補。`<hash>` は原本 JPEG の SHA-256 先頭 10 桁（`dabaed482e`）で、公開ファイル名から納品原本との同一性を照合できる。旧 `hitohako-hero-01acf16ac5.{png,webp}` は削除し、URL が変わるので旧絵が cache に残っても表示されない。`_headers` の immutable ルール（`/illust/hitohako-hero-*`）はそのまま一致する。
- `src/lib/hero.ts` は JPEG + WebP 候補を build 時に解決し、JPEG の SOF から寸法を読む。`TitleScreen` の `<picture>`（`sizes="100vw"`）と `Layout` の `<link rel="preload" imagesrcset imagesizes>` が同じ候補を参照する（LCP 対策、巨大原本の無差別配信や過剰 preload なし）。
- レイアウト（`TitleScreen.astro` / `global.css`）
  - lg（1024px）以上: 絵を全幅表示（アスペクト比維持、`max-height: 100dvh`、`object-position: 50% 0%` で縦長画面では下端だけ cover クロップされ顔は常に残る）。右上の明るい空の余白（x ≥ 約 69%、y 6〜50%）に半透明プラムの RPG ウィンドウで名前 / HITOHAKO ⛩ PORTFOLIO / 肩書 / 既存 ABOUT 冒頭の一文 / PRESS START を配置。顔・目・衣装の上に文字を置かず、人物を暗くする全面 overlay やアニメーションは使わない。鳥居・桜のドット絵小物は Hero から外す（絵自体に背景があるため）。
  - lg 未満: 縦積み（絵 → タイトルウィンドウ）。sm（640px）〜lg は絵の全体を表示、sm 未満は 4:3 枠に `object-position: 24% 50%` で人物と薙刀全体が入るように framing（単純 center-cover で顔や薙刀を切らない）。
  - stage では固定 STAGE バナーが絵の上端（顔）に被らないよう `body:has(.stage-banner) .hero` に上余白を付ける（本番は影響なし）。
- 肩書: `profile.json` の `title`、`TitleScreen` の表示、`Layout` の `<title>` / description / OG を「変身ヒロインVTuber」に揃える。ABOUT 本文や仲間の紹介文など他キャラ・他章の文言、経歴や所属などの設定は追加・変更しない。

## 不変更

配信アーカイブ 6 件とクリック時埋め込み・自動再生なし、章順、プロフィールの他文言、仲間 / STG / リンク、静的表示（アニメーション 0）、本番・認証 policy・他インフラ。

## 検証

- 原本: vault 保全原本の SHA-256 が `dabaed482ef66979ac78cd0db09d98cc6ab97a0375ae9047b12ca6f38154350c`（依頼票記載と一致）、`public/illust/hitohako-hero-dabaed482e.jpg` と `cmp` 一致。
- `npm run build`: `dist/index.html` の preload / srcset / src が `hitohako-hero-dabaed482e*` だけを参照し、旧 `01acf16ac5` 参照 0 件。
- Playwright 1.58.2 Chromium（公式 Docker イメージ、Google Fonts 以外の外部リクエストは遮断）で 1920x1080 / 1440x900 / 1280x800 / 1024x768 / 768x1024 / 390x844 / 320x568: 横スクロール無し、page error 0、顔領域が枠内かつタイトルウィンドウと非交差、人物 + 薙刀が枠内、PRESS START が初期表示内でクリック後に `#menu` が先頭へ、初期 iframe 0、アーカイブカード 6、`document.getAnimations()` 0、肩書表示とプロフィール CLASS が「変身ヒロインVTuber」。

## Rollback

この PR の squash commit を `git revert` して main に merge すると BOXP-284 の hero（`hitohako-hero-01acf16ac5`、肩書「変身ヒロイン」）に戻り、deploy-hitohako.yml が stage を自動更新する。
