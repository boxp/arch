# T-20260220-006: OpenClaw Docker image 更新責務分離

## 目的

OpenClaw Docker image更新の責務を整理し、boxp/lolice は ArgoCD Image Updater に一本化、boxp/arch は Renovate で自動更新できる構成にする。

## 変更内容（boxp/arch）

1. **renovate.json5**: OpenClawベースイメージ(`ghcr.io/openclaw/openclaw`)向けpackageRuleを追加
   - automerge無効（手動レビュー必須）
   - ラベル: `openclaw`, `base-image`
2. **docs/openclaw-image-update-responsibility.md**: 責務分離ルールドキュメントを新規追加

## 更新フロー

```
[openclaw/openclaw 上流リリース]
  ↓ Renovate (boxp/arch)
[boxp/arch: Dockerfile ベースイメージ更新 PR]
  ↓ マージ
[GitHub Actions: ghcr.io/boxp/arch/openclaw ビルド・プッシュ]
  ↓ ArgoCD Image Updater (boxp/lolice)
[lolice: デプロイタグ自動更新 → ArgoCD sync]
```
