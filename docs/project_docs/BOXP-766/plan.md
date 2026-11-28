# BOXP-766: 採用済みのAI人形と新モデルの人形をコハコの家に表示する

現行仕様: Obsidian `Projects/kohako-home/model-dolls-home-spec.md`（企画 BOXP-757、絵 BOXP-760 の採用 9 案）。

## やること
1. 絵: 候補 `dolls-00f8173` の 9 枚（896x1200 JPEG）を幅 240px の透過 WebP（各 9〜12KB）にして通常版へ入れる。
2. BFF: `/status` の tasks に `dolls`（In Progress の票を担当名 → 実行モデル（見込み）→ 系列 → 人形でまとめたもの）を足す。Notes は載せない。
   人形を押した時だけ `GET /kohako/api/v1/status/tickets/<BOXP-N>`（owner・verifier だけ、g2・notifier は 403、In Progress 以外は 404）で投影の最新 Notes と状況を返す。
3. 家の画面: 札（`#status-widget`）のすぐ上に人形を並べ（PC 5 体・スマホ縦 3 体＋「+N」）、押すとカード。札と同じ時に隠れる。動きなし。
4. 新モデル: 同じ系列（版上げ・推論段・別名）は同じ絵、絵の無い系列・未知の担当は無地。`verify/home/check-dolls.sh` がカタログ・runner の表との食い違いを CI で見る（絵の無い系列は一覧だけ）。

## しないこと
- 実際に動いている run の実行モデル・Notes 3 件への拡張（投影側 boxp/lolice の変更が要る）。
- 新しい絵の生成（採用済み 9 案だけ使う）、追加課金。

## 確認
- 単体: BFF 396・web 702 テスト（仕様の例から）、typecheck・biome。
- 実ブラウザ: `verify/home/dolls766.mjs` を手元 build（見本 API）と配備版（検証用 token）で PC 1440x900・スマホ 390x844。
