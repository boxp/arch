# BOXP-551: コハコの家 Fable専用使用率の長い小数表示を修正

## 調査結果
- exporter（`docker/codex-workspace/task-board/ai_subscription_usage.bb`）は Claude の `utilization`（0〜1 の割合）を `(* 100 u)` で百分率に変換して `ai_subscription_window_used_percent` に出す。`0.07 * 100 = 7.000000000000001`（IEEE 754 の誤差）。
- BFF はその値をそのまま `usedPercent` として返し、Web（`apps/kohako-studio/web/src/home/`）は `${usedPercent}%` で表示していた。
- よって計測値（7%）・単位（百分率）は正しく、**表示精度だけ**の問題。割算ミスや枠枯渇ではない。

## 方針
- 計測値・BFF 応答・ゲージの幅計算は変えず、表示文字列だけを共通関数 `formatPercent`（小数1桁で丸め、末尾0は省略）に統一する。
- 欠測（null / 非有限）は `—` を返し、0% を捏造しない。既存の欠測判定（未提供・リセット後未観測など）は変更しない。
- 対象: ウィジェットのゲージ、Fable専用などのミニ表示、詳細パネル、ビューアーの利用枠、summaryLine。

## 確認
- vitest に回帰テスト（`0.07*100 → 7%`、`12.5%`、`33.3%`、null/NaN → `—`、expired 窓が `—`）。
- `verify/home/percent551.mjs` で修正前 build の再現と修正後 build の実描画を比較（検証画像は vault 外の `/home/boxp/verification-artifacts/BOXP-551/` に保存）。
