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

## 再開（2026-11-13, TD-01: Owner 実利用の4点）
現配備（740209f）の実描画を 8 倍で撮り、面パッチ有無（調査用ローカル build のみ）で比較して原因を切り分けた。
1. **下向き視線でまつげが白くなる**: `rebakeEye` が虹彩層の上半分の透明画素を全て白（ハイライト用）で埋めていた。虹彩上端より上（待機時はまつげに隠れる帯）も白になり、視線を下げるとまつげの下に白帯が出る。パッチ無しでは出ない。→ 同じ列で上に不透明な虹彩がある穴（ハイライト）だけ白、上端より上はその列の最上端の虹彩色（暗い縁）で埋める。
2. **なで中の不自然な半目**: 閉眼が指数補間で中間値（ジト目に見える）に長く留まり、手が頭の矩形の端を出入りするたびに開閉が揺れていた。→ 閉じた後は矩形を 35% 広げて保持（ヒステリシス）、開閉は線形（閉 0.14 秒・開 0.2 秒）＋smoothstep で中間を短く通過。
3. **頬・もみあげのノイズ**: パッチ無しでも出る（モデル層由来）。層別の帰属と実行時アトラスでの除去は次段で行う。
4. **髪飾り先端の欠け**: 原因（メッシュ範囲・テクスチャ・遮蔽）を次段で特定する。
新素材・画像生成・追加 LLM・課金なし。

## 再開 r3（調査途中）
- v11r は `.p2lrt` 内のアトラスと PSD2Live ランタイムで描画する。実描画をメッシュ単位に分離すると、飾りはマスクのない `ArtMeshFrontHair` に含まれ、単独でも先端が欠ける。画面端や他のメッシュの重なりだけが原因ではない。UV の外側にある元絵とメッシュ境界の詳細な照合が必要。
- 左右の髪房 `ArtMeshLayerL/R` のアトラスには輪郭付近に淡色の画素があり、単独描画でも見える。ただし頬周辺の全断片と白縁について、隣の島からの混入、元の画素、補間の寄与をまだ分離できていない。
- 顔や飾りの正当な画素を損なわずに処理する範囲を確定できていないため、実装変更は行っていない。両問題とも未修正。`/home/boxp/verification-artifacts/BOXP-525/r3-td01/` に単独描画、アトラス・UV、実描画を保存した。
