# T-20260219-012: Dockerfile upstream差分監査

## 概要

`docker/openclaw/Dockerfile` を `cloudflare/moltworker` upstream をベースに再構築した際の差分一覧と採用理由。

- **Upstream**: https://github.com/cloudflare/moltworker/blob/main/Dockerfile
- **ベースイメージ**: `docker.io/cloudflare/sandbox:0.7.0`
- **日付**: 2026-02-19

## 旧構成との主な違い

旧Dockerfileは `ghcr.io/openclaw/openclaw:2026.2.15` （upstreamビルド済みイメージ）をベースにしていたため、upstream内部の構造（Node.jsインストール、rclone、pnpm、openclawインストール、ディレクトリ作成等）がブラックボックスだった。新構成ではupstream Dockerfileを明示的に取り込むことで、将来のupstream追従が容易になった。

## upstream Dockerfile（そのまま採用）

以下の部分はupstreamからverbatimで取り込み。変更箇所は openclaw バージョンのみ。

| 項目 | upstream値 | boxp値 | 変更理由 |
|------|-----------|--------|---------|
| ベースイメージ | `cloudflare/sandbox:0.7.0` | 同左 | そのまま |
| NODE_VERSION | `22.13.1` | 同左 | そのまま |
| 追加パッケージ | `xz-utils`, `ca-certificates`, `rclone` | 同左 | そのまま |
| pnpm | `npm install -g pnpm` | 同左 | そのまま |
| openclaw | `@2026.2.3` | **`@2026.2.15`** | 本番で使用中のバージョンに合わせて更新 |
| ディレクトリ | `/root/.openclaw`, `/root/clawd`, `/root/clawd/skills` | 同左 | そのまま |
| start-openclaw.sh | upstreamコピー | 同左 | そのまま |
| skills/ | `cloudflare-browser` スキル | 同左 | そのまま |
| WORKDIR | `/root/clawd` | 同左 | そのまま |
| EXPOSE | `18789` | 同左 | そのまま |

## boxp固有カスタマイズ（upstream後に追加）

### 必須差分

| カテゴリ | 追加内容 | 理由 | 分類 |
|---------|---------|------|------|
| **マルチステージビルド** | `docker:29-cli` ステージ | Docker CLI バイナリ取得用 | 必須 |
| | `golang:1.26` ステージ | ghq/gwq/mcp-grafana ビルド用 | 必須 |
| | `debian:bookworm-slim` ステージ | Babashka ダウンロード用 | 必須 |
| **パッケージ** | `gh` (GitHub CLI) | GitHub操作（PR作成、issue管理等）に必須 | 必須 |
| | `jq` | JSON処理スクリプトに必須 | 必須 |
| | `gpg`, `curl` | gh CLIインストールに必要 | 必須（gh依存） |
| **バイナリツール** | `docker` CLI | コンテナ操作に必須 | 必須 |
| | `ghq` v1.8.1 | リポジトリ管理に必須 | 必須 |
| | `gwq` v0.0.13 | worktree管理に必須 | 必須 |
| | `mcp-grafana` v0.10.0 | Grafana MCP Server（メトリクスコンテキスト提供） | 必須 |
| | `bb` (Babashka) v1.12.214 | Clojureスクリプト実行に必須 | 必須 |
| **npm グローバル** | `@openai/codex` | AIコードレビュー | 必須 |
| **ユーザーレベル** | Claude Code CLI | AI開発支援（`/home/node/.local/bin`にインストール） | 必須 |
| **設定ファイル** | `settings.json` → `/home/node/.claude/settings.json` | Claude Code権限設定 | 必須 |
| | `mcp-config.json` → `/home/node/.claude/mcp-config.json` | MCP Server設定（Grafana） | 必須 |
| | `config.json` (trustedWorkspaces) | Claude Codeワークスペース信頼設定 | 必須 |
| **セキュリティ** | `USER node` | 非rootユーザーで実行 | 必須 |
| **環境変数** | `PATH="/home/node/.local/bin:${PATH}"` | Claude Code CLIパス追加 | 必須 |

### 不採用項目

なし。旧Dockerfileの全差分はboxp運用に必要なものであり、すべて採用。

## upstream追従時の注意点

1. **upstream Dockerfile更新時**: `--- BEGIN: upstream moltworker Dockerfile (verbatim) ---` と `--- END ---` の間を更新
2. **openclaw バージョン**: boxpでは独自にバージョン管理。upstreamのバージョンアップ時は動作確認後に追従
3. **cloudflare/sandbox バージョン**: upstream が sandbox のバージョンを上げた場合はboxpカスタマイズとの互換性を確認
4. **start-openclaw.sh**: upstreamの変更をそのまま取り込むことが可能（boxp固有の変更なし）
5. **skills/**: upstreamの変更をそのまま取り込むことが可能（boxp固有の変更なし）

## ファイル構成

```
docker/openclaw/
├── Dockerfile           # upstream + boxpカスタマイズ
├── mcp-config.json      # Claude Code MCP Server設定（boxp固有）
├── settings.json        # Claude Code権限設定（boxp固有）
├── start-openclaw.sh    # upstreamからコピー
└── skills/              # upstreamからコピー
    └── cloudflare-browser/
        ├── SKILL.md
        └── scripts/
            ├── cdp-client.js
            ├── screenshot.js
            └── video.js
```
