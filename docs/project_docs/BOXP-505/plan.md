# BOXP-505: kohako-home の母音口形と、なでる手に合わせた頭の動き

## 調査結果
- 画面は `apps/kohako-studio/web`（`home.html` / `studio.html`）、リグは `kohako-full-v11r`（p2lrt runtime）。
- 口は `speechMouth`（sin 波）による開閉のみ。`lipSync` は `ParamMouthOpenY` で、v11r では既存の口画像を段階的に opacity 切替する。
- `gesture.ts` の acting stage が毎フレーム口メッシュの幅/口角を変形し、`ParamAngleX/Y/Z` を補間している。
- 読み上げはブラウザ内蔵 `speechSynthesis` のみ。phoneme/viseme の時刻情報は無い。取れるのは文ごとの開始/終了と、端末によっては `boundary`（文字位置）だけ。

## 方針
1. 母音口形（近似）: 読み上げ文のかなから母音列（あ/い/う/え/お/ん/っ/ー/句読点）を推定し、文開始時刻からの経過と `boundary` で同期する。既存の口画像の開き段階 × 口メッシュ幅の小変形で形を区別する。漢字は読みが分からないので中間形で近似し、音素認識とは称さない。無音・文の終了・停止・割込み・再接続では口を閉じる。
2. なで追従: 頭の hit area で押下したまま実際に動かしている間だけ、手の位置/方向へ頭を小さく傾ける/寄せる（角度に上限を設け、指数平滑で補間）。離す・キャンセル・外で release・非表示になったら滑らかに戻す。ふれあい OFF と reduced motion では無効、控えめ設定では半分。処理は端末内だけで行い、pointer move ごとの通信/LLM 呼出しはしない。既存の接触イベント送信（集約 1 回）はそのまま。
3. 検証: unit test / typecheck / build、モック BFF のブラウザで口形と追従値を確認 → PR・CI → merge → 配備版で PC/mobile を確認。

## 範囲外
新しい画像生成、課金、新しい権限。素材が足りない場合は相談する。
