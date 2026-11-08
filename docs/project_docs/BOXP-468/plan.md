# BOXP-468: Task Board 進展記録と停滞時 Fable 独立レビュー（試行）

## 目的
反復しても受入条件へ近づかない局所修正の繰り返しを早めに見つけ、独立した視点（claude-fable）で方式・前提を一度だけ見直す。複雑な停滞検出エンジンや新 cron は追加せず、実 runner のプロンプトと最小限の runner 補助で試行する。

## 変更（docker/codex-workspace/task-board/task_board_runner.bb）
1. 進展記録: implement / review-fix / blocked-retry の prompt に `TASK_BOARD_PROGRESS: 段階=…; 進展=…; 根拠=…; 次=…` を最終メッセージへ 1 行書く契約を追加。runner はこの行（600 文字上限）を `summary.edn` の `:progress` と終了 Note（` 進展記録: …`）へ転記し、次 run の `Previous run summaries` で比較できるようにする。
2. 停滞確認（依頼側）: 停滞候補（同じ未解決問題で比較上の改善なし、不採用の反復、同じ仮説の微修正、局所指標のみ改善）と、停滞ではないもの（独立工程の進行、Owner/外部待ち、実 quota/権限/費用不足、正当な CI 再実行、run 数・継続上限）を区別して提示。候補なら既存 `task-board.bb create` で `assignee claude-fable` の Ready 票を `stagnation-review-of:: <元票>` 付きで一度だけ起票し、元票に依頼を記録して continue する。
3. レビュー側: `stagnation-review-of::` を持つ票には reviewer 契約を出す（読取/小さい隔離再現のみ、元 repo/PR/担当/claim を変更しない、票の起票・再レビュー依頼禁止＝再帰防止、推奨/理由/再利用範囲/次の最小試験/必要判断を日本語で返し、元票へ `停滞レビュー結果` を append-note）。
4. 受領: 元票の prompt に連携レビューの状態（open / done received / NOT-YET-RECEIVED）を表示し、未受領なら `停滞レビュー受領: <ID>` の記録と承認範囲内での反映を指示。
5. 重複・競合防止: 連携レビューが Ready/In Progress の間は元票の implement / review-fix を開始しない（provider quota hold と同型。カード・担当・claim・予算は不変、Note は marker ごとに 1 回）。Owner の blocked-retry とレビュー票自身は保留しない。
6. quota: Fable route の最新 quota 判定を 1 行表示。hold なら依頼しない。unknown を余裕とみなさない。既存の provider quota hold がレビュー票の開始も制御する。

## 守ること
- レビューは追加課金・有料 API・画像生成・新権限・未承認の方式変更・本番操作・予算/再試行 reset を承認しない。
- 既存の CI / P0P1 gate、失敗予算、継続上限は変更しない。

## 検証
- runner self-test に fixture 10 件（正常進展 / 同仮説改善なし / quota・外部待ち / 重複・再帰 / 結果返却・受領 / 予算・担当不変）。
- CI（test-codex-task-board-runner）、image build、lolice の image 更新による配備後、Pod 内 runner の prompt 生成を読み戻し、有限の隔離票で依頼→Fable 受領→返却→元担当受領を確認する。

## 戻し方
本 PR を revert して image を再ビルドし、image updater で配備する。既存票に残る `stagnation-review-of::` 行や `:progress` は旧 runner から無視される。
