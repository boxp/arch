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

## 本番昇格（Owner承認後）

- Ownerの「概ねよい」をstageの概括的受入として記録。個別項目をOwnerが確認したとは扱わない。本番反映・両図カードと受入済みサムネイルの公開はTD-01で明示承認済み。
- 対象はPR #14505のmerge `938fea18ace7d80f1ccc5e617ae6fa2fabcfdba0`、stage配備 `aab1f765`（run 42149962617）。apps/portfolio tree `20bd35550635deb9cf8c6c2e7244c50a8c82885e`。調査時mainも同commit。
- 既存本番b0xp.ioのPagesプロジェクトshanghaiへ正規wrangler経路で手動配備する。DNS/domain/Access/stage/他siteの変更は行わない。将来用boxp-portfolioへのドメイン移行は不要。
- 手動workflowは既定inspect（read-only）で現在の本番deployment UUID・production branch・復元先の成功状態を記録。promote時は記録したUUIDと現在の本番の一致を必須とし、更新競合を拒否する。rollback操作は同projectの成功したproduction deploymentだけを指定可能。
- 固定commitをcheckoutし、唯一のoverlayで既存architectureカードのproduction表示制約を解除する。デザイン・経歴・図本体の変更はない。production URL/SEOは本番設定でbuildしstageバナー/noindexを含めない。
- 既存main限定environment portfolio-stage-privateのgateとsecretをそのまま利用。stageへ配備しない。受入済みサムネイルをdistへ復元し、stage runのSHA256 `9a080a742651e5e48a31db717f53f28a4ea56922daf39289b2e1827a32d7af51`に一致しない場合は拒否。原資料やdistのartifact公開はしない。
- PRの現headに対するCI/P0P1 review・ruleset・最新TODOを確認後merge。inspect→promote→公開実URLをChromiumのPC/mobileで検証する。重大回帰時は記録した旧正常版へ限定rollbackし実URLを再検証する。
- コマンド: `gh workflow run promote-portfolio-production.yml --ref main -f operation=inspect`、その後 `-f operation=promote -f rollback_deployment_id=<inspectのUUID>`。復元は `-f operation=rollback -f rollback_deployment_id=<旧UUID>`。providerの拒否は迂回しない。
