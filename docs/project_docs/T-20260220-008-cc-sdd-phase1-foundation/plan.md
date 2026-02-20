# T-20260220-008: cc-sdd Phase 1 基盤整備

## 概要

T-20260220-001で策定したcc-sddガイドライン導入計画のPhase 1（基盤整備）を実施する。
Tier指標の定義を実装観点で具体化し、計測対象・責務分担・記録フォーマットを運用可能な状態にする。

## スコープ

### スコープ内

1. Tier指標（1〜3）の実装仕様書作成（`docs/cc-sdd/tier-metrics.md`）
2. 計測対象の確定（データソース・頻度・保持先）
3. 責務分担の明文化（RACI matrix形式）
4. 記録フォーマット（週次レポート・指標ログテンプレート）の作成

### スコープ外

- 計測スクリプトの実装（Phase 2）
- Grafanaダッシュボード構築（Phase 3）
- cc-sddコマンド体系の整備（Phase 4）

## 実装計画

### 新規ファイル

| ファイル | 内容 |
|---------|------|
| `docs/cc-sdd/tier-metrics.md` | Tier 1〜3 指標の実装仕様（データソース・算出ロジック・頻度・保持先を含む） |
| `docs/cc-sdd/responsibility-matrix.md` | 責務分担RACI matrix |
| `docs/cc-sdd/templates/weekly-report.md` | 週次レポートテンプレート |
| `docs/cc-sdd/templates/monthly-report.md` | 月次レポートテンプレート |
| `docs/cc-sdd/templates/metric-log.md` | 指標ログテンプレート |

### 編集ファイル

なし（全て新規追加）

## リスク

| リスク | 影響度 | 対策 |
|--------|--------|------|
| 指標定義が抽象的すぎて計測スクリプト（Phase 2）に接続できない | 中 | 各指標にデータソースとAPI呼び出し例を明記 |
| 責務分担が現実の運用と乖離 | 低 | 四半期レビューで見直し前提の暫定版として運用開始 |
