# BOXP-516: kohako-home に Studio 同様のマウス位置に応じたモデル追従を追加する

## 調査結果
- Studio の既存機構: `apps/kohako-studio/web/src/live2d/main.ts`（live2d.html）の canvas `pointermove` → `player.lookAt(...lookFor(model, x, y))`、`pointerleave` で状態の視線へ戻す。`lookAt` は p2l runtime の LOOK behavior で、`ParamAngleX/Y`・`ParamEyeBallX/Y`・`ParamBodyAngleX` を動かす。`lookFor` は v11r で倍率 0.3。
- 家（`src/home/main.ts`）は状態ごとの視線（考え中は右上など）を `lookAt` するだけで、カーソル追従はない。505 のなで追従は acting stage の `setPetOffset`＋待機クリップ保持（`clipHold`）。
- 実測（SwiftShader・最終描画の瞳の重心）: 家の v11r では Studio 倍率 0.3 だと瞳の移動が約 ±2px で、待機クリップの揺れ（AngleX ±10° 程度）に埋もれて見えない。`lookAt` ±0.5 で約 ±5.5px（待機中でも左右の差 8〜10px）と見て分かり、髪・輪郭の破綻もない。±1 では髪が伸びる。

## 方針
1. 既存の runtime `lookAt`（Studio と同じ機構）を再利用し、家専用の小モジュール `src/home/lookfollow.ts` に座標の換算・補間を純関数で置く。CSS で全体を動かしたり、数値だけ更新したりはしない。
2. 顔（頭メッシュ）の中心を原点に、顔から画面端までの距離の 6 割（最低 160px）で向ききる。角は円に収め、`lookAt` の上限は左右 0.5・上下 0.45。顔の上の小さな揺れは不感帯で消し、指数補間（0.22 秒）で急な首振り・震えを防ぐ。顔の中心は 0.5 秒ごと（リサイズ時は即時）に取り直し、頭が動くと中心も動いて揺れ返す自己フィードバックを避ける。
3. `window` の `pointermove`（mouse/pen のみ、passive）で座標を控えるだけにし、反映は既存の描画ループで行う。touch は対象外にして、hover を要求せず、タップ・スクロール・なでの既存操作に触れない。通信・Hermes・LLM 呼出しはしない。
4. 窓の外へ出る（mouseout で relatedTarget なし）・blur・非表示で中立へ滑らかに戻す。戻り切ったら状態の視線を一度だけ置き直し、以後は既存の演技（`actingPose`/`applyPose`）に任せる。
5. 優先度: なで中・離して戻る途中・ふれあいや演技の身振り中は追従を退かせ、505 の頭の傾きや身振りの頭の角度と二重に上書きしない。考え中など状態が独自の視線を持つ間は追従を 35% に弱めて混ぜる。
6. 設定「カーソルを目で追う」（既定 ON）を既存の設定保存（`kohako-home-prefs`）へ後方互換で追加する。OFF・動きを減らす・OS の reduced-motion では止め、「反応を控えめにする」では 6 割にする。

## 検証
- unit（`lookfollow.test.ts`）: 換算・角の制限・端での過敏さ・不感帯・フレームレートに依存しない補間・無効条件・状態の視線との混ぜ方・設定の後方互換。
- 実描画（`verify/home/lookfollow516.mjs`）: PC・横長・幅 820 で左右／上下の瞳の差、四隅、反対側へ急に動かしたときの向き直り時間、窓の外・blur からの復帰、なで中の優先、リサイズ、OFF・reduced-motion、Pixel 7 のタップ・スクロール・なで。505 の `petvisible.mjs` で非退行。
- 通常 CI・codex review（P0/P1）→ merge → 既存 GitOps で配備 → 配備版で PC 実マウスの左右上下・四隅・離脱復帰・設定 OFF・reduced-motion・スマホの非退行を連続フレームで確認し、結果を Projects/kohako-home へ残す。

## 範囲外
新しい画像生成・課金・権限、Studio 側の挙動変更、BFF/API の変更。
