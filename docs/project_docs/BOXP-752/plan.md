# BOXP-752: コハコの家の 1 タップ通知を Android スマホと Windows 11 PC で試す

現行仕様: Obsidian `Projects/kohako-device-delegation/trial-spec.md`（spec_feature: `kohako-device-trial`）。設計の背景は BOXP-750 の `Projects/kohako-device-delegation/design.md` §7 試験 1。

## 範囲

- 起点は本人（Access owner）の試験ページのボタンだけ。Hermes には道具を足さない。
- 定型は「地図で開く」1 つ。行き先は固定の公開施設 4 件（既定: 東京都庁）から選ぶだけ。任意 URL・コマンドなし。
- 既存の家の Web Push（同じ VAPID 鍵・購読）で全端末に送る。既存の通知・認証は変えない。
- 端末への新規アプリ・権限・外部公開・課金なし。

## 作るもの

1. BFF `src/device-trial.ts`: 依頼（待ち→開いた/期限切れ/取消）、期限 2 分、1 件 1 回、待ちは 1 件まで、1 時間 10 件、停止スイッチ（永続）、履歴 50 件。
2. BFF `push.ts` に `sendDevice`（静かな時間帯を効かせない、TTL=120 秒、最小表示設定は守る）。
3. BFF `app.ts` に `/kohako/api/v1/device-trial`・`/requests`・`/requests/:id/open|cancel`・`/stop`（owner 以外 403）。
4. web `public/kohako/sw.js`: 試験の通知のタップで BFF に開封を問い合わせ、`https://www.google.com/maps/search/` だけを開く。失敗時は試験ページ。
5. web `device-trial.html`: 送る・止める・待ちから開く・履歴・短い手順。
6. Lean モデル `bff/contract/device-trial-model/` と CI、生成した並びを実装に流すテスト。

## 確認

- 担当: BFF/web の unit test、Lean の証明と並びの照合、配備後に本番の API で期限・停止の応答を確認。
- 本人: Fold と PC で通知 → タップ → 地図（1 タップか 2 タップか）、開封済み・期限切れ・停止の表示。

## 戻し方

PR の revert。端末側には何も残らない（`device-trial.json` は BFF のデータディレクトリにだけ残る）。
