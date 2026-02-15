# Grafana MCP Integration - arch リポジトリ変更計画

## 概要

OpenClawコンテナにGrafana MCP Server (grafana/mcp-grafana v0.10.0) を組み込み、
Claude CodeエージェントがGrafanaのメトリクス・ダッシュボード・ログをコンテキストとして
扱えるようにする。

## 選定結果

### Grafana MCP Server
- **選定**: `grafana/mcp-grafana` (公式Grafana Labs実装)
- **バージョン**: v0.10.0
- **理由**:
  1. Grafana Labs公式の実装で最も成熟・安定
  2. Prometheus PromQL、Lokiログ、ダッシュボード検索、アラート管理など豊富なツール
  3. `--disable-write` フラグで読み取り専用モードが利用可能（セキュリティ）
  4. stdioトランスポートでClaude CodeのMCPサーバーとして直接統合可能

### データフロー設計
```
OpenClaw (Claude Code)
  ↓ stdio MCP Protocol
mcp-grafana (同一Pod内プロセス)
  ↓ HTTP API
Grafana (monitoring namespace, port 3000)
  ↓ Data Source Query
Prometheus (monitoring namespace, port 9090)
```

## 変更内容

### 1. Dockerfile (`docker/openclaw/Dockerfile`)
- go-toolsビルドステージに `mcp-grafana` バイナリのビルドを追加
- `COPY --from=go-tools` で最終イメージに `mcp-grafana` をコピー

### 2. Claude Code設定 (`docker/openclaw/settings.json`)
- `mcpServers.grafana` セクションを追加
- `mcp__grafana__*` をpermissions allowリストに追加
- `--disable-write` で読み取り専用モード（安全性確保）
- 環境変数 `GRAFANA_URL` と `GRAFANA_API_KEY` を参照

## セキュリティ考慮事項
- MCP Serverは `--disable-write` モードで起動（ダッシュボード・アラートの変更を防止）
- Grafana Service Account TokenはAWS SSM Parameter Storeで管理（既存のgrafana_api_keyリソースを利用）
- NetworkPolicyによりOpenClaw → Grafana通信のみ許可（PR #425で設定済み）
