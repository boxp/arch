# BOXP-325: Task Board の GPT-6.1 Terra 対応

## 方針

`codex` と `codex-terra` の既定モデルだけを、正規 ID `gpt-6.1-terra` に更新する。明示的な `CODEX_TASK_BOARD_MODEL` 上書き、Sol/Astra/Luna の各ルート、既存の reasoning suffix の受理範囲は変更しない。

## 実施

1. 稼働 Pod の runner revision、CLI 版、認証方式、モデル上書きを秘密値を読まずに確認する。
2. 公開済みの正規モデル ID と reasoning 対応を公式 OpenAI Docs で照合し、隔離した read-only 試行で当該 CLI がリクエストを受理して完走することを確認する。
3. runner のモデル表、委譲方針文、組み込みテスト、shell 回帰期待値を整合させる。
4. focused test と runner 自己テストを実行し、PR/CI 後に正規 image 配備と稼働 Pod の隔離試行を確認する。

## 戻し方

問題時はこの変更コミットを revert し、image の通常配備を待つ。緊急の一時回避が必要な場合だけ、既存の `CODEX_TASK_BOARD_MODEL=gpt-5.6-terra` を明示する（秘密値・新規認証・API key は追加しない）。
