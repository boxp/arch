# OpenClaw カスタムコンテナイメージ計画

## Context

OpenClawのDeploymentに `gh` CLI を追加したいが、現在4つのinit containerが溜まっていて煩雑。
カスタムコンテナイメージをboxp/arch上でビルドしてGHCRでホストし、ツール類をプリインストールすることで
init containerを大幅に削減する。合わせてClaude Codeのファイル編集権限用の `~/.claude/config.json` も焼き込む。

## 現状の init containers (lolice `feat/openclaw-heartbeat`)

| # | 名前 | イメージ | 役割 | 削除可能 |
|---|------|---------|------|---------|
| 1 | init-docker-cli | docker:27-cli | Docker CLIバイナリコピー | YES |
| 2 | init-claude-code | ghcr.io/openclaw/openclaw:latest | Claude Code CLIインストール | YES |
| 3 | init-codex-cli | ghcr.io/openclaw/openclaw:latest | Codex CLIインストール | YES |
| 4 | init-config | ghcr.io/openclaw/openclaw:latest | ConfigMap→PVCコピー | NO (残す) |

## 変更概要

### arch リポジトリ (Wave 1)

1. **`docker/openclaw/Dockerfile`** — カスタムイメージ定義
2. **`.github/workflows/build-openclaw-image.yml`** — GHCR へのビルド&プッシュ
3. **`docs/project_docs/openclaw-custom-image/plan.md`** — 本計画

> Renovate設定の追加は不要。既存の `config:recommended` がDockerfileの `FROM` を自動検出する。

### lolice リポジトリ (Wave 2)

4. **`argoproj/openclaw/deployment-openclaw.yaml`** — init container削減 + イメージ変更

---

## Wave 1: arch リポジトリ

### 1.1 Dockerfile (`docker/openclaw/Dockerfile`)

- multi-stage build で docker CLI をコピー
- ベースは `ghcr.io/openclaw/openclaw:2026.2.9` (バージョン固定、Renovateで自動更新)
- root でシステムパッケージ (gh CLI) → node ユーザーで Claude Code
- `~/.claude/config.json` をイメージに焼き込み
- Codex CLI をグローバルインストール

### 1.2 GitHub Actions (`.github/workflows/build-openclaw-image.yml`)

- `docker/openclaw/**` パス変更でのみトリガー
- PR時はビルドのみ（pushしない）、mainマージ時にpush
- actions は SHA でピン留め（既存パターン準拠）
- `linux/amd64` のみ（lolice の nodeSelector に合わせる）
- タグ: `YYYYMMDD` (日付)、`sha-<7char>`、`latest`

### 1.3 Renovate設定

追加設定不要。既存の `config:recommended` がDockerfileの `FROM` 指令を自動検出する。

---

## Wave 2: lolice リポジトリ

### 2.1 Deployment変更 (`argoproj/openclaw/deployment-openclaw.yaml`)

**削除するもの**:
- `init-docker-cli` init container（全体）
- `init-claude-code` init container（全体）
- `init-codex-cli` init container（全体）
- `shared-bin` emptyDir volume + volumeMount
- `shared-npm` emptyDir volume + volumeMount
- `PATH` 環境変数のオーバーライド

**変更するもの**:
- メインコンテナのイメージ: `ghcr.io/openclaw/openclaw:latest` → `ghcr.io/boxp/arch/openclaw:YYYYMMDD`
- `init-config` のイメージ: 同上

**残すもの**:
- `init-config` init container（ConfigMap→PVCコピーはランタイム依存）
- DinD sidecar（変更なし）
- その他の env vars, volumeMounts, securityContext

### 2.2 タグ管理方針

- CIが `YYYYMMDD`、`sha-<7char>`、`latest` の3つのタグを生成
- lolice側では `YYYYMMDD` タグで固定（mutableな `latest` は使わない）
- 日付タグはRenovateが自然に順序比較できるため、自動更新PRが生成される

---

## 検証手順

```bash
# 1. GHCR にイメージが存在するか確認
docker pull ghcr.io/boxp/arch/openclaw:latest

# 2. ローカルでツール確認
docker run --rm ghcr.io/boxp/arch/openclaw:latest docker --version
docker run --rm ghcr.io/boxp/arch/openclaw:latest gh --version
docker run --rm ghcr.io/boxp/arch/openclaw:latest claude --version
docker run --rm ghcr.io/boxp/arch/openclaw:latest codex --version
docker run --rm ghcr.io/boxp/arch/openclaw:latest cat /home/node/.claude/config.json

# 3. Pod起動確認 (Wave 2 マージ後)
kubectl get pods -n openclaw
kubectl describe pod -n openclaw -l app.kubernetes.io/name=openclaw

# 4. コンテナ内ツール動作確認
kubectl exec -n openclaw deployment/openclaw -c openclaw -- gh --version
kubectl exec -n openclaw deployment/openclaw -c openclaw -- cat /home/node/.claude/config.json
```
