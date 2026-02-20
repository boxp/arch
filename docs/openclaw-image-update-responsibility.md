# OpenClaw イメージ更新 責務分離ルール

## 概要

OpenClaw Docker image の更新責務は、以下のように分離して管理する。

| リポジトリ | 更新対象 | 更新手段 |
|-----------|---------|---------|
| **boxp/arch** (本リポジトリ) | ベースイメージ (`docker/openclaw/Dockerfile` の `FROM ghcr.io/openclaw/openclaw`) | Renovate |
| **boxp/lolice** | デプロイ先イメージタグ (`deployment-openclaw.yaml`) | ArgoCD Image Updater |

## boxp/arch（本リポジトリ）

### Renovate による管理

- `docker/openclaw/Dockerfile` の `FROM ghcr.io/openclaw/openclaw:<tag>` を Renovate が監視
- 上流の新バージョンが検出されるとPRを自動作成（automerge 無効、手動レビュー必須）
- PRマージ後、GitHub Actions (`build-openclaw-image.yml`) がカスタムイメージをビルド・プッシュ:
  - `ghcr.io/boxp/arch/openclaw:YYYYMMDDHHmm`
  - `ghcr.io/boxp/arch/openclaw:sha-<short>`
  - `ghcr.io/boxp/arch/openclaw:latest`

## boxp/lolice

### ArgoCD Image Updater による管理

- `ghcr.io/boxp/arch/openclaw` の新タグを ArgoCD Image Updater が自動検出
- `.argocd-source-openclaw.yaml` を更新し ArgoCD sync でデプロイ
- lolice側では Renovate による OpenClaw イメージ更新は無効化されている

## 更新フロー全体像

```
[openclaw/openclaw 上流リリース]
  ↓ Renovate (boxp/arch)
[boxp/arch: Dockerfile ベースイメージ更新 PR]
  ↓ マージ
[GitHub Actions: ghcr.io/boxp/arch/openclaw ビルド・プッシュ]
  ↓ ArgoCD Image Updater (boxp/lolice)
[lolice: デプロイタグ自動更新 → ArgoCD sync]
```
