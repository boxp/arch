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

## 追加承認後の継続作業計画

- 既mergeのarch #14160、dotfiles #88と実Sol→Terra metadata証拠を維持する。
- #14161のClaude委任方針とfake回帰を引き継ぐ。実CLIの設定読込を対照試行し、名前付きroleの登録と起動可否を区別して記録する。
- 最小の委任helperとrunnerの検証境界を追加する。subscription認証で子を一度だけ起動し、終了・thread相関・session実modelを検証する。失敗/利用不可/不一致/証拠欠落を成功扱いしない。小タスクの免除は明示理由を残す。
- fake integrationと旧版mutationで成功・異常経路を検証し、必須CIへ含める。モデル選択・override・reasoning・他担当の互換性を維持する。
- 独立Terra review、CI、通常mergeと安全配備、新規隔離の成功/異常smokeまで進める。既存runのkill・lock削除、新credential、API fallback、全面的dispatch基盤の追加はしない。
- owner-summaryとチケットNotesへ変更・配備revision・metadataに基づく証拠・限界・戻し方を日本語で記録する。
