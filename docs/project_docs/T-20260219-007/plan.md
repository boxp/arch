# T-20260219-007: OpenClaw v2026.2.17 アップデート

## 概要

OpenClaw のベースイメージを v2026.2.15 から v2026.2.17 にアップデートする。

## 変更対象

### boxp/arch

- `docker/openclaw/Dockerfile`: ベースイメージを `ghcr.io/openclaw/openclaw:2026.2.17` に更新

### boxp/lolice

- configmap 変更不要（後方互換性あり、ArgoCD Image Updater が新ビルドを自動検出）

## v2026.2.17 の主要変更点

### セキュリティ修正（重要）
- OC-09: 環境変数インジェクション経由のクレデンシャル窃取パスを修正
- OC-06: `$include` のパストラバーサルをトップレベル設定ディレクトリに限定

### 新機能
- Anthropic Sonnet 4.6 モデルサポート
- Anthropic 1M コンテキストベータヘッダー opt-in (`params.context1m: true`)
- Z.AI `tool_stream` デフォルト有効化
- `/subagents spawn` コマンド追加
- `tools.loopDetection` 設定追加（デフォルト無効）
- `OPENCLAW_INSTALL_BROWSER` ビルド引数追加

### 破壊的変更の影響評価
- `bootstrapTotalMaxChars` デフォルトが 24000→150000 に変更: 明示指定していないため新デフォルトを受容（トークン消費量が若干増加する可能性）
- Cron webhook 非推奨化: 本環境ではcron未使用のため影響なし
- `$include` パス制限強化: 本環境では `$include` 未使用のため影響なし

## リスク評価

- **低リスク**: 後方互換性のあるアップデート。config schema に破壊的変更なし
- セキュリティ修正が含まれるため、早めの適用が推奨される

## Staging 検証手順

1. **arch リポジトリで PR マージ後、CI が Docker イメージをビルド**
   - GitHub Actions の `build-openclaw-image.yml` が `docker/openclaw/**` の変更でトリガーされる
   - ビルドされたイメージは `ghcr.io/boxp/arch/openclaw:YYYYMMDDHHmm` タグで push される

2. **ArgoCD Image Updater による自動デプロイ**
   - lolice リポジトリの `imageupdaters/openclaw.yaml` の設定により、`newest-build` 戦略で新タグが自動検出される
   - `.argocd-source-openclaw.yaml` が更新され、新イメージへのロールアウトが開始される

3. **デプロイ後の検証チェックリスト**
   - [ ] Pod が正常に起動すること（`kubectl get pods -n openclaw`）
   - [ ] OpenClaw gateway が応答すること（`kubectl logs -n openclaw deployment/openclaw -c openclaw | head -50`）
   - [ ] Discord bot が正常に動作すること（DMで応答テスト）
   - [ ] Telegram bot が正常に動作すること（DMで応答テスト）
   - [ ] LiteLLM proxy 経由のモデル呼び出しが正常に動作すること
   - [ ] DinD サイドカーが正常に動作すること
   - [ ] `openclaw --version` で v2026.2.17 が表示されること
   - [ ] Grafana メトリクスが正常に送信されていること（OTEL endpoint）

4. **ロールバック手順**
   - arch リポジトリの Dockerfile でバージョンを `2026.2.15` に戻す PR を作成しマージ
   - または、lolice の `.argocd-source-openclaw.yaml` で手動で前のイメージタグ `202602170222` を指定
