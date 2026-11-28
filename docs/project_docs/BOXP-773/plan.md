# BOXP-773: コハコの家の会話入力欄へファイルを貼り付けて添付する

## 方針
- `textarea#message` の `paste` で、イベントが渡す `clipboardData` だけを読む（クリップボード API を自分から呼ばない）。
- 判定は `web/src/home/attachments.ts` の純関数 `pastedAttachment`（仕様: Obsidian `Projects/kohako-home/attachment-paste-spec.md`）。
  1. `text/plain` に文字 → 文字の貼り付け（Excel/Word が添える表画像は添付しない）
  2. ファイル本体が取れる → 既存の `addFiles`（📎/ドロップと同じ検証・アップロード・チップ）へ。送信はしない
  3. ファイルがあると示されるのに本体なし → 📎 への案内。文字を入れない
  4. それ以外 → ブラウザ既定
- BFF・形式・容量・認証は BOXP-517/677 のまま変更しない。

## 検証
- unit test（仕様の決まり 1〜4 と例の表から期待値を作成し、先に失敗を確認）
- `verify/home/paste773.mjs`: PC / Pixel 7 相当で本物のクリップボード（文字・PNG）と合成 paste（PDF・未対応・超過・Excel 型・本体なし）、📎 選択との併用と本人送信、会話無効時も入力欄へフォーカスして貼り付けで添付待ちへ入ること（レビュー指摘への対応。入力欄は無効化されず送信ボタンだけ無効）
- merge → 通常配備 → 配備物で同スクリプト

## Lean
- 対象外: 状態機械ではなく入力 1 つで決まる決定表の純関数で、直接テストで網羅できるため。
