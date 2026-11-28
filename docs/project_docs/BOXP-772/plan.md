# BOXP-772: コハコの家で通知からのジャンプを一度だけ実行する

## 原因（通常版のコードで確認）

`apps/kohako-studio/web/src/home/inbox.ts` の `initInbox` が

1. URL の `?notification=<eventId>` を `selected` に入れ、URL からは外していなかった（再読み込み・再起動で毎回ジャンプ）。
2. `schedule()` が初回だけでなく `visibilitychange`（タブ切替・PWA 復帰）のたびに `selected` を開き直していた（同じタブの再利用でも再表示。受信箱で選んだ通知も同様）。

## 方針

- 仕様: vault `Projects/kohako-home/notice-jump-spec.md`（spec_feature `kohako-home-notice-jump`）。
- URL のジャンプを `selected` と分離した保留値 `jump` にし、一覧取得が確定した時点で 1 度だけ消費する。消費時に `history.replaceState` で `notification` だけを外す（他パラメータの表記・順序・hash は維持、履歴は増やさない）。
- 取得失敗時は消費せず URL も残す（次の定期更新か表示復帰で再試行）。不正な ID は読み込み時に外す。
- `visibilitychange` は一覧更新のみで、開き直さない。
- 対象通知を開く処理（案内済み・既読の送信）が通信失敗した場合は消費せず URL も残し、次に一覧が取得できた時に開き直す。開き終えてから URL から外す（codex review P1 対応）。
- 案内済み・既読の送信が 2xx 以外（JSON 付きの 500 など）も失敗として扱い、両方受理されるまで受信箱を表示しない（2 回目の codex review P1 対応。既読失敗中に受信箱が開いたまま、閉じた後の更新で再表示される問題も解消）。
- SW の `open-notification`（開いたままの画面）、受信箱からの明示オープン、返信の紐付け（開いている `eventId`）は変更しない。
- Lean モデルは作らない: 状態は保留値 1 個で、消費は 1 回きりの単純な規則のため、例を直接テストする。

## 検証

- vitest: `inbox.test.ts` に BOXP-772 の 6 件（修正前の実装で 6 件とも失敗を確認）。 2 回目の P1 対応後は「案内済み・既読が 500」6 項目を加え PC/Pixel 7 とも 21/21 PASS（修正前ビルドでは追加 6 項目のうち各端末 4 件が失敗）。vitest は追加 3 件が修正前に失敗、修正後 715 件 PASS。
- 実ブラウザ（Playwright 1.56.1 / Chromium、BFF モック）: `verify/home/notice772.mjs`。修正前ビルドでは表示復帰・再読み込みで再表示が再現、修正後は PC/Pixel 7 とも 12/12 PASS。 P1 対応後は「開く途中の失敗」3 項目を加え PC/Pixel 7 とも 15/15 PASS（vitest は追加 1 件が修正前に失敗、修正後 712 件 PASS）。
- 配備後: 通常版で `?notification=` 付き URL を開いて URL から外れること・再読み込みで再表示しないことを確認する。本人端末での通知タップは Owner 確認。
