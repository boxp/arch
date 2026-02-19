# Moltworker: 上流 Dockerfile ビルド済みイメージを base にする

## Context

現在の overlay Dockerfile は `cloudflare/sandbox:0.7.4` をベースに Node.js やパッケージを独自にインストールしている。しかし上流 `cloudflare/moltworker` リポジトリの Dockerfile が正しい構成（`sandbox:0.7.0` ベース、Node.js 22.13.1、rclone、pnpm、openclaw@2026.2.3）を定義しており、コンテナが正しく動作するにはこの上流 Dockerfile でビルドされたイメージをベースにすべき。

GHA で上流 Dockerfile を事前ビルドして GHCR にプッシュし、overlay Dockerfile の FROM をそのイメージに変更する。

## 上流 Dockerfile の内容（コミット ee5006ae）

- `FROM cloudflare/sandbox:0.7.0`
- Node.js 22.13.1 バイナリインストール
- apt: xz-utils, ca-certificates, rclone
- npm install -g pnpm, openclaw@2026.2.3
- mkdir /root/.openclaw, /root/clawd, /root/clawd/skills
- COPY start-openclaw.sh, skills/
- WORKDIR /root/clawd, EXPOSE 18789

## 変更内容

### 1. `.github/workflows/build-moltworker-base-image.yml` を新規作成

上流リポジトリを UPSTREAM_REF で pinned SHA にクローンし、その Dockerfile をビルドして GHCR にプッシュ。

- **トリガー**: `docker/moltworker/UPSTREAM_REF` 変更 + `workflow_dispatch`
- **処理**:
  1. arch リポジトリをチェックアウト
  2. UPSTREAM_REF を読み取り、上流を /tmp にクローン & チェックアウト
  3. docker/build-push-action で上流の Dockerfile をビルド
- **イメージ名**: `ghcr.io/boxp/arch/moltworker-base`
- **タグ**: `YYYYMMDDHHMI` (main), `sha-XXXXXXX` (PR/main), `latest` (main)
- **プラットフォーム**: `linux/amd64`
- GHA actions は既存の `build-openclaw-image.yml` と同じバージョン・ピンを使用

### 2. `docker/moltworker/overlay/Dockerfile` を修正

FROM を GHCR の上流ビルド済みイメージに変更。Node.js/rclone/pnpm/openclaw のインストールは削除し、boxp 固有の追加（git, jq, curl, gh CLI）のみ残す。

```dockerfile
FROM ghcr.io/boxp/arch/moltworker-base:latest

# boxp additions: git, jq, curl, gh CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git jq \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=...] https://cli.github.com/packages stable main" \
     > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Override upstream files with boxp versions (from build context)
COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
RUN chmod +x /usr/local/bin/start-openclaw.sh
COPY skills/ /root/clawd/skills/

WORKDIR /root/clawd
EXPOSE 18789
CMD ["/usr/local/bin/start-openclaw.sh"]
```

### 3. `.github/workflows/deploy-moltworker.yml` のパス修正

UPSTREAM_REF 変更で deploy が不要に走らないよう除外：

```yaml
paths:
  - 'docker/moltworker/**'
  - '!docker/moltworker/UPSTREAM_REF'
```

## 対象ファイル

| ファイル | 操作 |
|---------|------|
| `.github/workflows/build-moltworker-base-image.yml` | 新規作成 |
| `docker/moltworker/overlay/Dockerfile` | FROM 行変更、重複インストール削除 |
| `.github/workflows/deploy-moltworker.yml` | paths 除外追加 |

## 注意事項

- GHCR パッケージを **public** にする必要あり（Cloudflare ビルドシステムが pull するため）
- UPSTREAM_REF 更新時のフロー: base image ビルド → 完了確認 → overlay 再デプロイ
- 上流のベースは sandbox:0.7.0（overlay で使っていた 0.7.4 ではない）

## 検証

1. base image ビルドワークフローが PR で正常にビルドされることを確認
2. main マージ後 GHCR にイメージがプッシュされることを確認
3. GHCR パッケージを public に設定
4. overlay の `wrangler deploy --dry-run` が成功することを確認
5. main マージ後、実際のデプロイが正常に完了することを確認
