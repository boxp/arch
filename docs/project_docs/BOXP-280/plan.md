# BOXP-280: ひとはこさん stage の hero を大きく躍動感あるイラストへ改善し YouTube 配信アーカイブ章を追加

対象: `apps/hitohako`（stage: hitohako-stage.b0xp.io のみ。本番・共有インフラ・認証 policy は変更しない）

## 方針

1. **Hero**
   - 許可済み参照資料（変身後リファレンス）を元に Nano Banana Pro（`gemini-3-pro-image`, 2K, 3:4）で跳躍・斜め構図の通常イラストを新規生成し、緑背景をソフトクロマキーで透過化（`scripts/make-hero.py`）。ドット絵化・減色・nearest 拡大はしない。
   - 同一性: 黒髪ロング + 左右の三つ編み、碧眼、桜の髪飾り、紫×金の和風衣装（肩当て・帯リボン・指ぬきグローブ・黒×紫ブーツ）、紫金の薙刀。
   - 表示: `<picture>`（WebP 219KB 優先 / PNG 1.38MB fallback）、1220x1600（2x）。desktop は高さ `min(800px, 82dvh)` でキャラを主役に、mobile は `min(560px, 52dvh)` で縦占有を抑える。`fetchpriority=high` + preload で LCP を確保し、width/height 指定でレイアウトシフトを防ぐ。
   - 画面全体の animation / 点滅 / 走査線 / パララックスは復活させない（static のまま）。
2. **配信アーカイブ章（`#archives`）**
   - `src/data/archives.json` に本人チャンネル（links.json 記載の UCS8gl96UiidzwHrn9bugOKg）の公開動画 6 件を明示リストで保持（API key・自動同期なし）。
   - 各動画は RSS（`feeds/videos.xml?channel_id=...`）と oEmbed、watch ページの `playableInEmbed:true` / `isPrivate:false` / `isUnlisted:false` で実在・公開・埋込可を確認。
   - 埋込はクリック再生ファサード: 初期表示はサムネイル（lazy）+ ▶ PLAY ボタンのみ、押下時に `youtube-nocookie.com/embed` iframe（title 付き）へ置換。ページロード時の autoplay / iframe 生成なし。16:9 の領域を `aspect-video` で確保。`YouTube で見る` 外部リンクとチャンネルリンクを常時表示（fallback）。
   - 章順: プロフィール / 活動 / **配信アーカイブ** / リンク / 仲間 / クレジット（仲間はリンクの下を維持）。メニューにも ARCHIVES を追加。
3. **不変更**: 276 の文言 5 点・静的表示・仲間の順・STG 記録・Twitch 確定 URL・本番・認証 policy。

## 検証

- `npm run build` 成功、Playwright 1.58.2（Docker 公式イメージ）で 1280x800 / 1366x768 / 390x844 / 320x568 を確認: 横スクロール無し、console error 0、初期 iframe 0、Enter キーで再生開始・iframe title 設定・16:9 維持。
- 実 stage（Cloudflare Access 本人限定）は agent から本文取得不可のため、deploy 成功までを確認し本人ログイン後の表示確認を依頼する。

## Rollback

PR を `git revert` して main に merge すると旧 hero（立ち絵 `hitohako-stand.png`）とアーカイブ章なしの状態へ戻る。
