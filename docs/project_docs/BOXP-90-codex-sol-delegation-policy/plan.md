# BOXP-90: codex-sol 委譲方針プロンプト

## 目的

高コストの `codex-sol` および `codex-full` を Task Board の入口として実行する際、低コストな `codex` への適切な委譲を促す方針をプロンプトへ注入する。

## 実施計画

1. `fable-policy-prompt` と同じ位置に `codex-sol-policy-prompt` を追加する。
2. `codex-sol` と `codex-full` の実行時にのみ、共通プロンプトへ方針を追加する。
3. `codex-sol` のプロンプトに方針が含まれ、通常どおり完了処理されることをシェルテストで確認する。
4. Babashka のユニットテストとシェル統合テストを実行し、PR を作成する。
