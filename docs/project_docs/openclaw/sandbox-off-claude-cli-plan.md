# OpenClaw: Sandbox無効化 + Claude Code CLI有効化

## Context

OpenClawのsandboxモードが実運用で有効に機能していない:
- elevatedモードでの作業が多く、環境変数にcredentialsが露出する状態で使っていた
- OpenClawからdockerを直接呼び出したいケースがある
- Max Planが有効なClaude Code CLIをツールとして使いたい

## 変更対象ファイル

| リポジトリ | ファイル | 変更 |
|---|---|---|
| arch | `terraform/aws/openclaw/ssm.tf` | CLAUDE_CODE_OAUTH_TOKEN SSMパラメータ追加 |
| lolice | `argoproj/openclaw/configmap-openclaw.yaml` | sandbox mode → "off", tools.elevated削除 |
| lolice | `argoproj/openclaw/deployment-openclaw.yaml` | init container追加(claude CLI), env追加 |
| lolice | `argoproj/openclaw/external-secret.yaml` | CLAUDE_CODE_OAUTH_TOKEN追加 |

## Step 1: arch — SSMパラメータ追加

`terraform/aws/openclaw/ssm.tf` に `CLAUDE_CODE_OAUTH_TOKEN` パラメータを追加。

## Step 2: 手動 — SSMにOAuthトークン設定

ローカルで `claude login` 後、`~/.claude/.credentials.json` から `claudeAiOauth.accessToken` を取得してSSMに設定。

## Step 3: lolice — ConfigMap変更

sandbox設定を `"mode": "off"` に変更、`tools.elevated` セクションを削除。

## Step 4: lolice — ExternalSecret変更

`CLAUDE_CODE_OAUTH_TOKEN` エントリを追加。

## Step 5: lolice — Deployment変更

- init container `init-claude-code` 追加（Claude Code CLIインストール）
- メインコンテナに `CLAUDE_CODE_OAUTH_TOKEN` 環境変数追加

## 検証手順

```bash
# Claude Code CLI動作確認
kubectl exec -n openclaw deploy/openclaw -c openclaw -- claude --version

# Claude Code Max Plan認証確認
kubectl exec -n openclaw deploy/openclaw -c openclaw -- claude --print "hello"

# Docker動作確認（DinD維持の確認）
kubectl exec -n openclaw deploy/openclaw -c openclaw -- docker ps
```
