# BOXP-525: コハコの家でなでられている間は心地よさそうに目を閉じ、離すと自然に戻す

## 現状（調査結果）
- 家（`apps/kohako-studio/web/src/home/main.ts`）の描画ループ `rigTick` は、頭の hit area を押したまま 6px 以上動かした状態（`isPetting`、BOXP-505）で `petFollow` の頭追従を行う。hover・頭の tap・手の tap では成立しない。ふれあい OFF / 確認待ち / 失敗 / オフライン / 録音中（`touchBlocked`）と reduced-motion では `isPetting` は false。
- v11r の演技ステージ（`src/live2d/gesture.ts` `createActingStage`）には既に `smileClosed`（閉じ目の笑顔）用の閉眼経路 `eyeClosed` があり、自動まばたきの評価（`baseUpdate`）の後に `ParamEyeLOpen/ROpen = 1 - eyeClosed` を上書きしている。v11r の閉眼素材（v45 以降の半開き素材を含む）をそのまま使える。新規画像生成は不要。
- 離したとき（pointerup）は `touchReact` が smile / shy 等の表情と身振りを出し、2.2〜3.2 秒後に状態の演技へ戻す。

## 方針
1. `petfollow.ts` に `petEyesWanted(track, options)` を追加: `isPetting` かつ直近の手の位置が頭の矩形内にあるときだけ true（押したまま頭の外へ手が出たら開く）。
2. `gesture.ts` の stage に `setPetEyes(on: boolean)` を追加。閉眼量 = `max(表情由来の閉眼, なで閉眼)`。なで閉眼は柔らかく（閉じ約 0.25 秒・開き約 0.35 秒の指数補間）、表情の閉眼補間と別の変数で持ち、表情の切替でパチつかないようにする。
   - 途中の値では自動まばたきの値と `min` を取り、まばたき途中の目が一瞬開く逆戻りを防ぐ。
   - 口形（母音）・頭追従・眉・赤面は変更しない（原画の顔立ちを維持し、睡眠・しかめ顔で代用しない）。
3. `main.ts` の `rigTick` で毎フレーム `stage.setPetEyes(petEyesWanted(...))`（端末内のみ、通信・LLM 呼出しなし）。pointerup / pointercancel / lostpointercapture / 画面外 release / 非表示で track が null になると自然に開く。
4. 優先順位: 確認待ち・失敗・オフライン・録音中・ふれあい OFF・reduced-motion では `isPetting` 自体が false なので閉眼しない（既存の頭追従と同じ抑止）。読み上げ中のなでは閉眼 + 口形継続。
5. 非 v11r モデル（fallback stage）は `setPetEyes` を持たず何もしない。

## 検証
- vitest: `petEyesWanted`（hover/tap/手/OFF/reduced/頭外で false、なで中 true）と閉眼補間の純関数（閉じる・開く・まばたき min・表情 smileClosed との max）。修正前に失敗→修正後に成功。
- 実描画 `verify/home/peteyes525.mjs`（Playwright 1.56.1 docker、BFF 完全モック）: PC 実マウス / Pixel 7 touch で、なで前・なで中・離して 0.4/1.5 秒の連続フレームで青い瞳の画素数（variants510 と同じ指標）を測り、なで中に大きく減り離すと戻ること、反復・pointercancel・頭外への逸脱で開くこと、hover・手 tap・ふれあい OFF・reduced-motion では閉じないこと、頭追従（petvisible）と口形（mouthpet）の非退行を確認。main（修正前）では失敗、本修正で成功。
- CI / codex review（P0/P1 なし）→ merge → 配備（image-updater）→ 配備物で同検査と連続フレーム目視。

## 範囲外
- 新規画像生成・課金・新権限・追加 LLM 呼出し・新設定項目。
- 521（胸）/522（読み上げ）/524（音声入力）の担当領域。gesture.ts は 521 と同じファイルのため、merge 時に競合を確認して小さく保つ。
