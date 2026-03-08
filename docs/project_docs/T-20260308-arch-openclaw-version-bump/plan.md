# T-20260308: OpenClaw Dockerfile バージョン更新

## 目的
boxp/arch 内の OpenClaw ベースイメージを最新安定版へ更新する。

## 変更内容
- **対象ファイル**: `docker/openclaw/Dockerfile`
- **更新前**: `ghcr.io/openclaw/openclaw:2026.3.2@sha256:d60f848db7d5019336dfa17412588881a42774ad34a3429f03dd06d0a71c2848`
- **更新後**: `ghcr.io/openclaw/openclaw:2026.3.7@sha256:70c5677580a958f704eb27297a62661b501534c3b2b9dec7a61e5ed5aa0c24cf`

## 実装方針
- Dockerfile の FROM 行のタグとダイジェストのみを最小差分で更新
- パッチ (issue #10640) は upstream でクローズ済みだが、新バージョンでの動作確認が必要なため今回は変更しない

## 備考
- OpenClaw v2026.3.7 は 2026-03-08 リリースの最新安定版
- issue #10640 (tool call ID sanitization) は 2026-02-25 にクローズ済み。パッチ除去は別タスクで検討
