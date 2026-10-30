# BOXP-368: 放置 PR/票の週次 read-only 棚卸し

## 目的

Task Board と関連 repo に滞留した open PR / issue / 未完票を、週 1 回 read-only で棚卸しする。
年齢だけで閉じず、現在の必要性・代替・承認・依存と実状態を照合して分類し、Owner には意味のある差分だけを提示する。

## 方針

- 起動経路は既存の Codex Cron（vault の `Infrastructure/Codex Cron/jobs.edn` を resident scheduler sidecar が読む）を使う。Kubernetes CronJob や Hermes cron は追加しない。
- job: `weekly-stale-pr-audit`、`0 11 * * 0`（Asia/Tokyo）、runner `claude`。
- 機械処理（全件取得・ページネーション・dedupe・totalCount 照合・fingerprint 差分）は Babashka collector が行い、LLM は差分項目の判断だけを行う。
- collector・runbook・台帳の正本は vault の `Projects/stale-pr-audit/`（既存の日次セキュリティ診断 helper と同じ配置方針）。scheduler 本体（`docker/codex-workspace/cron/`）の変更は不要。
- 既存の定期 job（日次セキュリティ診断、recurring events、Task Board 監視、Task Board → Hermes webhook）とは役割を分け、run 起動・lane 移動・外部通知は行わない。

## 分類

category（既承認で継続漏れ / 技術阻害 / Owner 入力待ち / 意図的 hold・外部待ち / 代替済み・重複・対象廃止 / 要再評価 / 実完了だが票 PR 不整合 / 進行中 / 未知）と disposition（保持 / 再検証 / 既承認継続 / Close 候補 / 要確認）を分けて付ける。7/14/30/90 日の idle は探索優先度のみで、自動 Close の根拠にしない。bot の rebase・コメントは有意更新として扱わない。

## 静音

- 差分なしの週は実行台帳に 1 行残すのみで、報告・Notes を書かない。
- bot PR の head 更新だけ・updatedAt だけの変化は差分にしない。
- 取得失敗 repo の前回項目は「未確認」として残し、閉じたと誤報しない。
- 提示済みの判断依頼は fingerprint が変わるまで再掲しない。

## 検証

1. 隔離 fixture 試験（分類ヒント / dedupe / totalCount 不一致 / 差分 / 静音 / 部分失敗 / 判定引継ぎ / 実行台帳の重複・同時実行防止）。
2. 実データで初回 inventory を取得し、全件台帳と Owner 向け入口を作成。
3. job 登録後に `show` で schedule / enabled / prompt を readback し、次回予定（日曜 11:00 JST）を確認。
4. 手動 `run` で cron 経路の実行を確認（同一週 dedupe により日曜の自然発火は 2 回目以降の週で差分処理となる）。

## 承認 scope 外（行わない）

PR/issue の close・merge・rebase・branch 削除、票の一括 Done/削除、hold 解除・再 queue、本番 apply、外部通知。必要な処置は根拠付きで Owner に提示する。
