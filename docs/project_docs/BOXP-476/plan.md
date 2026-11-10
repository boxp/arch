# BOXP-476: Studio の表情・動作の拡充

Web リグ（kohako-full-v11r）に、発話内容に合わせた表情と腕・体の動作を足す。

- 受入済みの通常表示は変えず、`?acting=1` のときだけ有効にする比較版として配備する。
- OpenAmika の制御（文単位の感情適用、再生開始での同期、flush による割込み）は考え方のみ移植する。Pixi / Cubism の描画系は流用しない。
- 感情判定は応答文のルールベース。別 LLM や第二の記憶は追加しない。
- 新規画像生成・追加費用はなし。既存リグの頂点出力を描画直前に変形する（`src/live2d/gesture.ts`）。

## 手順
1. 手動比較（`/kohako/live2d.html?acting=1`）で表情・動作を確認する。
2. Studio（`/kohako/studio.html?acting=1`）で実 Hermes 会話に連動させ、遷移・停止・割込みを試験する。
3. 本人確認のあと、既定への反映を別途判断する。

## 既知の限界
- 腕が 1 mesh のため肘の折り曲げに皺が残る。解消には腕層の分割（再 rig）が要る。
- 実機 GPU の見え方は未検証。

## TD-08: 試作ごとの候補追加（2026-11-10）

- 目的: 通常版 v11r と `?acting=1` を上書きせず、試作ごとに固定 ID の候補を足して本人が Studio から選んで操作できるようにする。
- 方式: 各試作 commit をタグ `kohako-studio-candidate/<id>` で固定し、CI でその版の `web/` だけを取り出して `/kohako/candidates/<id>/` に個別ビルド。モデル・runtime は同一 blob を検証して共用、API は nginx で通常の `/kohako/api/` へ。認証（Cloudflare Access + BFF の JWT）は変更なし。
- 掲載: arm-4980edd（配備中の比較版）、arm-47d8734（#14733）、arm-band-4601716 / arm-band-3e388e8（#14735）。状態と問題点を一覧に表示。
- 腕のコードは main に入れない（候補は固定タグからビルドするだけ）。
