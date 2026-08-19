# BOXP-175 実装計画

1. Task Board runner のBlocked遷移経路（agent結果、PR gate、retry上限、例外）と既存テストを確認する。
2. ブロッカーの理由をサニタイズし、ticket/run/action/時刻/成果物参照をNotesへ安全に記録する共通処理を実装する。
3. Notes記録が成功した場合だけBlockedへ遷移し、失敗時はrun summary・runnerログに残して現在のレーンを保持する。
4. Codex/Fable、PR URL欠落、PR gate失敗、runner例外、Notes書込み失敗の回帰テストを追加し、runner black-box testを実行する。
5. 変更をコミットしてPRを作成し、CIとレビュー結果を確認する。

## 追加レビュー対応

- [x] Blocked遷移のカード/frontmatter更新が成功するまでsummaryを`:blocked`へ確定しないようにする。
- [x] 後段更新失敗でレーンを復元した場合、summaryが`:blocked`ではないことを黒箱テストで確認する。
