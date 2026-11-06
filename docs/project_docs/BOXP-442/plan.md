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
# BOXP-442: portfolio production promotion

- Accepted stage: commit `938fea18ace7d80f1ccc5e617ae6fa2fabcfdba0` (PR #14505, stage Pages deployment `aab1f765`, Actions run 42149962617). Its `apps/portfolio` tree is `20bd35550635deb9cf8c6c2e7244c50a8c82885e`; fetched main was the same commit at investigation time.
- b0xp.io is served by existing Pages project `shanghai` (`shanghai-4t4.pages.dev`); `boxp-portfolio` has no production domain. Keep DNS, domains, Access, stage and other sites unchanged.
- Introduce a separate manually dispatched workflow, fixed to the accepted commit and production build settings, targeting `shanghai`. Never automatically deploy on merge. Preserve the production build's existing public-only diagram policy: lineage is included; architecture and its private thumbnail are excluded. The two-link stage experience cannot be produced by this unchanged production build. Do not use stage secrets in production.
- Before running: confirm the current production deployment UUID and provider rollback support, project production branch, API token permissions and whether this project accepts direct uploads. Configure `portfolio-production` GitHub environment with appropriate required reviewers and main-only deployment policy before enabling the workflow. Provider failures must not be bypassed. A syntactically valid UUID input is an audit record, not proof the deployment exists or is rollback-capable.
- After PR gates and merge, the owner may run `gh workflow run promote-portfolio-production.yml --ref main -f rollback_deployment_id=<UUID>` and monitor `gh run watch <run-id>`. Record the new Pages deployment ID. Verify b0xp.io using the prepared live Playwright checks. Roll back via Cloudflare Pages `shanghai` production deployment history: select the recorded previous successful production deployment and use Rollback to this deployment; verify b0xp.io again. This requires confirming provider capability and credentials before promotion.
- Risk: the existing Pages project may be Git-integrated and reject direct uploads. A rejected deployment is a stop condition. Do not modify DNS, Access or provider settings to work around it.
