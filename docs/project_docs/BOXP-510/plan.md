# BOXP-510: kohako-home の入力・時系列・状態表示・Markdown 改善

正本: Obsidian `Projects/kohako-home/usability-and-missing-variants-request.md`

## 今回の PR
1. 入力: Enter=改行、Shift+Enter=送信（IME 変換中は送信しない）。判定は `src/home/keys.ts` の純関数。
2. 時系列: 受信箱・履歴を古い→新しいの昇順に。受信箱はクライアント側で `receivedAt`→`eventId` の安定ソートと重複除去、BFF も昇順で返す。再取得時はスクロール位置を保ち、最下部にいるときだけ追従。
3. 状態表示: 吹き出し等のメッセージ表示中は利用枠・進行中ウィジェットを隠す（取得は継続、承認・停止・エラー導線は不変）。
4. Markdown: 依存なしの DOM 構築（innerHTML 不使用）で会話・受信箱詳細・履歴を描画。http/https/mailto 以外のリンクは無効、画像は読み込まずリンク表示。読み上げは記号を除いた文。
5. 背景アニメーション（TD-01）: 既存の花びらと回路を CSS で穏やかに動かす（花びらがゆっくり漂い、回路の点線が流れ、ノードは明滅せず緩やかに濃淡）。設定に「背景を動かす」を追加。prefers-reduced-motion と「動きを減らす」設定で静止、非表示タブで停止。

## 後続
- TD-02 腕の左右端の見切れ: 再現・切り分け後に別 PR。
- 未制作の差分: 棚卸し `Projects/kohako-home/missing-variants-inventory-510.md`。生成が必要なものは Owner 確認後。

## 検証
vitest（キー判定・昇順・表示状態・Markdown 安全性）、typecheck、build、CI/P0P1 → merge → 配備 → PC/mobile 実ブラウザ確認。

## TD-03 PWA
- 既存のコハコ画像から各サイズのアイコンを再現可能な手順で生成する。
- 家の HTML と manifest を整備し、既存の Push Service Worker を家の読み込み時に登録する。
- SW はネットワーク優先の画面遷移と自己完結したオフライン画面のみを扱い、API・認証応答・会話をキャッシュしない。進行中の会話を守るため skipWaiting しない。
- PC とモバイルでインストール可能性、オフライン・復帰、キャッシュと Push ハンドラを検証する。
