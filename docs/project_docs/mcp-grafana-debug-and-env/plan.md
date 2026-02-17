# mcp-grafana MCP Server 認証・起動修正

## 課題

Claude Code CLI の `-p` (pipe) モードでは `settings.json` に定義された MCPサーバーが自動起動されない。
OpenClaw が Claude CLI を `claude -p --output-format json --dangerously-skip-permissions` で起動する際、
`--mcp-config` 引数が渡されていないため、mcp-grafana MCPサーバーが起動されずツールが利用不可能になっている。

## 根本原因

1. **Claude Code CLI の `-p` モードでの MCP 挙動**: デバッグログでは `MCP configs loaded in 34ms` と出力されるが、
   MCPサーバープロセスの spawn ログが一切存在しない。`settings.json` の `mcpServers` 定義はインタラクティブモードでは
   自動読み込みされるが、`-p` モードでは `--mcp-config` による明示的指定が必要と推定される。

2. **OpenClaw CLIランナーの設定不足**: `cli-backends.ts` の `DEFAULT_CLAUDE_BACKEND` の `args` に MCP 関連の引数がなく、
   `buildCliArgs()` にも MCP パラメータを渡す仕組みがない。

3. **環境変数・認証は正常**: `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `GRAFANA_API_KEY` はすべて正しく注入されており、
   Grafana APIへの接続・認証は成功する（curl および docker run での直接テストで確認済み）。

## 修正内容

### archリポジトリ (boxp/arch)

1. **`docker/openclaw/mcp-config.json` 新規作成**
   - `--mcp-config` 引数で渡すための MCP サーバー定義ファイル
   - `settings.json` と同じ `mcpServers` セクションを含む

2. **`docker/openclaw/Dockerfile` 修正**
   - `mcp-config.json` を `/home/node/.claude/mcp-config.json` にコピー

### loliceリポジトリ (boxp/lolice)

3. **`argoproj/openclaw/configmap-openclaw.yaml` 修正**
   - `agents.defaults.cliBackends.claude-cli.args` に `--mcp-config /home/node/.claude/mcp-config.json` を追加
   - OpenClaw の CLIバックエンド設定オーバーライド機能を利用して、デフォルト引数に MCP 設定を追加

## 検証確認事項

- [ ] Docker イメージビルドが成功すること
- [ ] mcp-grafana ツール（`mcp__grafana__*`）がツールリストに表示されること
- [ ] 少なくとも1つの mcp-grafana ツール呼び出しが成功すること
