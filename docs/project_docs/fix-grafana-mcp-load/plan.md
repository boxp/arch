# fix: Grafana MCP Server ロード問題の修正

## 概要

PR #6934 でマージされた Grafana MCP Server 統合が、OpenClaw コンテナ内で
機能しない問題を修正する。

## 根本原因

### 1. Agent SDK が `mcpServers` 設定を無視する

OpenClaw は `@mariozechner/pi-coding-agent` v0.52.9 を埋め込み Agent SDK として
使用している。この SDK の `SettingsManager` は `~/.claude/settings.json` の
`mcpServers` フィールドを認識・処理しない。そのため、`settings.json` に
`mcpServers.grafana` を設定しても MCP サーバーは起動されない。

### 2. OAuth トークンのスコープ不足

Claude Code CLI がサブプロセスとして実行された場合でも、
`CLAUDE_CODE_OAUTH_TOKEN` に `user:mcp_servers` スコープが含まれておらず
（`user:inference` のみ）、MCP サーバーの起動がブロックされる。

デバッグログの証拠:
```
[claudeai-mcp] Missing user:mcp_servers scope (scopes=user:inference)
```

## 修正内容

### アプローチ: MCP Server を Claude Code スキルに置き換え

MCP プロトコル経由の統合が Agent SDK モードで不可能なため、
Grafana HTTP API を直接叩く Claude Code スキルを作成する。

### 変更 1: Dockerfile から mcp-grafana を削除
- `go install github.com/grafana/mcp-grafana/cmd/mcp-grafana@v0.10.0` を削除
- `COPY --from=go-tools /go/bin/mcp-grafana /usr/local/bin/mcp-grafana` を削除
- **効果**: ビルド時間短縮、イメージサイズ削減

### 変更 2: settings.json から mcpServers を削除
- `mcpServers` セクションを削除
- `mcp__grafana__*` パーミッションを削除
- **効果**: 不要な設定の除去、起動時の無駄な処理を排除

### 変更 3: dotfiles に Grafana クエリスキルを追加（別リポジトリ）
- `boxp/dotfiles` リポジトリの `.claude/skills/grafana-query/` に新スキルを追加
- `curl` + `jq` ベースで Grafana HTTP API を直接呼び出し
- `python3` の approval 問題を回避するため純粋 Bash 実装
- 環境変数 `GRAFANA_URL`, `GRAFANA_API_KEY` は Pod に既に設定済み

## セキュリティ考慮事項
- Grafana API 呼び出しは `GRAFANA_API_KEY` で認証（既存の Secret 管理を流用）
- NetworkPolicy による通信制限はそのまま維持
- スキルは読み取り専用操作のみ（PromQL クエリ、ダッシュボード検索、アラート確認）
