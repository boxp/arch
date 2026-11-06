# BOXP-442: 配色テーマメニュー

## 方針

- 常時表示の3ボタンをアイコン1つとライト・ダーク・システムの小さなメニューに変更する。既存の配色とコンテンツは維持する。
- 描画前のテーマ適用、保存値の優先、システム追従、ストレージ拒否時と JavaScript 無効時のフォールバックを維持する。
- menu / menuitemradio と選択状態を公開し、キーボード、フォーカス復帰、外側クリック、タッチに対応する。依存は追加しない。

## 検証

- `npm run build` / `npm run build:stage`: 成功。各 `astro check` は 0 errors / 0 warnings / 0 hints。
- `npm ci` の監査: 0 vulnerabilities。
- Playwright の Chromium（headless、ローカル開発サーバー）でデスクトップ 1280×800・モバイル 390×844、light / dark の各組み合わせを確認。閉じた状態・開いた状態のスクリーンショットをリポジトリ外に保存。
- Enter / Space、上下矢印、Home / End、Escape、Tab、選択後のフォーカス復帰、外側のボタンクリック時のフォーカス、モバイルのタップを確認。ライト・ダークの保存と再読み込み、システム選択による保存削除と OS 配色変更への追従を確認。
- localStorage が例外を投げる場合も選択可能。JavaScript 無効時は UI が非表示で、OS の dark 設定が CSS に反映されることを確認。
- Lighthouse はローカルでは未計測。PR の既存 CI で確認する。
