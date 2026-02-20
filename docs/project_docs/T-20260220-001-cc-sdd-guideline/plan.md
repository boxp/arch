# T-20260220-001: AI活用ガイドラインの仕様駆動化（cc-sddベンチマーク）導入計画

## 概要

OpenClaw運用におけるAI活用を体系化し、Timee社のcc-sdd（Spec-Driven Development）事例を参考に、仕様駆動開発のワークフローと観測指標を定義する。現在のOpenClawは`AGENTS.md`と`CONTRIBUTING.md`で開発プロセスを規定しているが、AI活用の効果測定が未整備であり、仕様から実装への一貫した品質管理フローが欠けている。本計画はこれらを補完し、継続的な改善サイクルを確立する。

## 背景・動機

### 現状の課題

1. **効果測定の不在**: AI支援による開発の生産性向上が定量的に把握できていない
2. **仕様と実装の乖離**: タスクの要件定義から実装までの品質ゲートが暗黙的
3. **ナレッジの属人化**: AI活用のベストプラクティスが個人レベルに留まっている

### Timee社の事例から得た教訓

Timee社はAI活用を3段階で進化させた:

| 段階 | 内容 | 結果 |
|------|------|------|
| 個人最適化 | 各自がAIツールを自由に利用 | ナレッジ共有が進まず |
| AI開発標準v1.0 | 抽象的なガイドライン策定 | 具体性不足で定着せず |
| SDD導入 | cc-sddフレームワーク適用 | 設計〜レビュー効率化に成功 |

**重要な知見**: 抽象的なガイドラインだけでは機能せず、Why/What/Howの全てを具体化する必要がある。

## 適用範囲

### スコープ内

- OpenClaw本体リポジトリ（`openclaw/openclaw`）のAI支援開発フロー
- OpenClawエージェント（OpenClaw上で動くClaude Codeエージェント）のタスク実行品質
- CI/CDパイプラインとの統合指標
- 仕様駆動開発ワークフローの定義

### スコープ外

- 外部コントリビューターへの強制適用（推奨に留める）
- プロダクションデプロイの運用手順変更
- 既存テストカバレッジ閾値（70%）の変更

## 観測指標の定義

### Tier 1: 開発速度指標（Four Keys準拠）

| 指標 | 定義 | 計測方法 | 目標 |
|------|------|----------|------|
| デプロイ頻度 | mainへのマージ回数/日 | GitHub API (`gh api`) | 現状比+20% |
| 変更リードタイム | Issue作成〜mainマージまでの時間 | GitHub Issue/PR タイムスタンプ | 現状比-15% |
| 変更失敗率 | マージ後のrevert/hotfix率 | Git履歴分析 | <5% |
| 復旧時間 | 本番影響インシデント（Grafanaアラート発火 or GitHub Issue `bug` + `critical` ラベル付与）の検出〜修正マージまでの時間 | Grafana + GitHub連携 | <2h |

### Tier 2: AI支援品質指標

| 指標 | 定義 | 計測方法 | 目標 |
|------|------|----------|------|
| レビュー時間 | PR作成〜最初のapproveまでの時間 | GitHub PR API（`reviews` エンドポイント） | 現状比-25% |
| CI成功率 | PR CIの初回成功率（成功数/実行総数） | GitHub Actions API | >85% |
| 仕様カバレッジ | 新規機能PRのうち `docs/project_docs/` に対応するplan.mdが存在し、かつ「概要」「実装計画」「リスク」セクションを含む率 | スクリプトによる構造チェック | >80%（新規機能） |
| Codexレビュー通過率 | Codex初回レビューOK率 | Codexログ解析 | >60% |

### Tier 3: プロセス健全性指標

| 指標 | 定義 | 計測方法 | 目標 |
|------|------|----------|------|
| PRサイズ | 変更行数の中央値 | GitHub PR API | <300行 |
| タスク完了率 | 計画タスクの完了率 | progress.md解析 | >90% |
| ステアリング鮮度 | AGENTS.md最終更新からの経過日数 | Git log | <30日 |

## ガイドライン草案

### 1. 仕様駆動開発ワークフロー

cc-sddの概念をOpenClawの既存プロセスに適合させた7ステップ:

```text
Step 1: Steering（コンテキスト構築）
  AGENTS.md + CONTRIBUTING.md を最新化
  ↓
Step 2: Spec Initiation（仕様初期化）
  docs/project_docs/{ticket}/plan.md を作成
  ↓
Step 3: Requirements（要件定義）
  plan.md に概要・スコープ・観測指標・リスクを記述
  ↓
Step 4: Design（技術設計）
  plan.md に実装計画（新規/編集ファイル一覧）を記述
  ↓
Step 5: Implementation（実装）
  worktree上で実装 → Codexレビュー → CI通過
  ↓
Step 6: Quality Gate（品質検証）
  CI pass + Codexレビュー OK + PR作成
  ↓
Step 7: Human Review（人間レビュー・最終承認）
  レビュアーがPRを確認 → approve → merge
```

### 2. 責務分担

| ロール | 責務 |
|--------|------|
| タスク起案者 | 要件定義（タスク指示書の作成）、完了条件の明記。AIエージェントはこれを元に `plan.md` を作成する |
| AIエージェント | plan.md作成、実装、Codexレビュー対応、CI通過、PR作成 |
| レビュアー（人間） | PR最終承認（Step 7）、アーキテクチャ判断、セキュリティ確認 |
| Codex | 自動レビュー（コード品質・パターン準拠チェック） |
| CI | ビルド・テスト・lint・型チェック・シークレット検出 |

### 3. 計測方法

#### 自動計測（推奨）

GitHub ActionsとGrafanaダッシュボードを組み合わせた自動計測:

```yaml
# .github/workflows/metrics.yml（将来実装）
# - PRマージ時にFour Keys指標を計算
# - Grafanaへメトリクスをpush
# - 週次サマリをIssueとして自動生成
```

#### 手動計測（Phase 1）

導入初期はスクリプトベースの手動計測:

```bash
# deploy頻度: 直近30日のmainマージ数
SINCE=$(date -d '30 days ago' +%Y-%m-%dT00:00:00Z)
gh pr list --state merged --base main --limit 100 \
  --json mergedAt --jq "[.[] | select(.mergedAt > \"${SINCE}\")] | length"

# レビュー時間: PR作成〜最初のapproveまでの平均時間（時間単位）
gh pr list --state merged --limit 20 \
  --json number,createdAt \
  --jq '.[] | "\(.number) \(.createdAt)"' | while read -r pr created; do
  approved_at=$(gh api "repos/{owner}/{repo}/pulls/${pr}/reviews" \
    --jq '[.[] | select(.state == "APPROVED")][0].submitted_at // empty')
  if [ -n "$approved_at" ]; then
    created_epoch=$(date -d "$created" +%s)
    approved_epoch=$(date -d "$approved_at" +%s)
    echo "$(( (approved_epoch - created_epoch) / 3600 ))"
  fi
done | awk '{ sum += $1; n++ } END { if (n>0) printf "平均レビュー時間: %.1f h\n", sum/n }'

# CI成功率: 実際の取得件数を分母として率を算出
RUNS=$(gh run list --workflow ci.yml --limit 50 \
  --json conclusion --jq '.')
ACTUAL_TOTAL=$(echo "$RUNS" | jq 'length')
SUCCESS=$(echo "$RUNS" | jq '[.[] | select(.conclusion == "success")] | length')
echo "CI成功率: $((SUCCESS * 100 / ACTUAL_TOTAL))% (${SUCCESS}/${ACTUAL_TOTAL})"
```

### 4. 更新フロー

```text
四半期サイクル:
  Month 1: 指標計測・ベースライン確定
  Month 2: ガイドライン運用・データ蓄積
  Month 3: 振り返り・ガイドライン改訂

継続的更新トリガー:
  - CI成功率が80%を下回った場合 → ステアリングドキュメント見直し
  - 変更失敗率が10%を超えた場合 → 品質ゲート強化
  - 新しいAIツール/機能の導入時 → ガイドライン追記
```

## 実装ロードマップ

### Phase 1: 基盤整備（本PR）

- **担当**: AIエージェント + レビュアー
- **期限**: 本チケット完了時
- **完了条件**: plan.md がPRとしてマージされ、Codexレビュー OK + CI pass

| タスク | 状態 |
|--------|------|
| 観測指標の定義 | 完了 |
| ガイドライン草案の作成 | 完了 |
| 計画書の`docs/project_docs/`への配置 | 完了 |

### Phase 2: 計測スクリプト整備（次チケット）

- **担当**: AIエージェント + レビュアー
- **期限**: Phase 1完了後 約1ヶ月
- **完了条件**: `scripts/metrics/` にスクリプトが配置され、手動実行で全Tier 1指標のベースラインが取得可能

| タスク | 状態 |
|--------|------|
| `scripts/metrics/` にFour Keys計測スクリプトを配置 | 未着手 |
| GitHub Actions workflowで週次計測を自動化 | 未着手 |
| ベースライン値の確定 | 未着手 |

### Phase 3: ダッシュボード構築（将来）

- **担当**: インフラ担当 + AIエージェント
- **期限**: Phase 2完了後 約1四半期
- **完了条件**: Grafanaダッシュボードで全指標が可視化され、閾値超過時にアラートが発火する

| タスク | 状態 |
|--------|------|
| Grafanaダッシュボードにメトリクス可視化 | 未着手 |
| アラート設定（閾値超過時の通知） | 未着手 |
| チームへの定期報告自動化 | 未着手 |

### Phase 4: ワークフロー統合（将来）

- **担当**: AIエージェント + レビュアー
- **期限**: Phase 3完了後 約1四半期
- **完了条件**: cc-sddコマンド体系のOpenClaw適合版が動作し、plan.mdテンプレートからの自動生成が可能

| タスク | 状態 |
|--------|------|
| cc-sddコマンド体系のOpenClaw適合版を整備 | 未着手 |
| `docs/project_docs/` テンプレートの標準化 | 未着手 |
| Codexレビュー結果のメトリクス連携 | 未着手 |

## リスク

| リスク | 発生確率 | 影響度 | 検知方法 | 対策 | オーナー | エスカレーション |
|--------|----------|--------|----------|------|----------|----------------|
| 指標計測のオーバーヘッド | 中 | 中 | 計測作業に1h/週以上かかる場合 | Phase 1は手動計測、Phase 2で自動化。自動化完了まで計測頻度を隔週に緩和 | AIエージェント | 計測作業が2h/週を超過した場合、計測項目の削減を検討 |
| ガイドラインの形骸化 | 高 | 高 | 仕様カバレッジが50%を下回った場合 | 四半期レビューサイクルで継続的に改訂。レトロスペクティブで形骸化チェック | レビュアー | 2四半期連続で仕様カバレッジ50%未満の場合、ガイドライン全体見直し |
| 過度なプロセス化による開発速度低下 | 中 | 中 | 変更リードタイムが悪化傾向の場合 | 仕様書作成を新規機能のみに限定、バグ修正・hotfixは免除 | タスク起案者 | リードタイムがベースラインの1.5倍を超えた場合、プロセス簡素化を実施 |
| ベースライン不在での目標設定 | 高 | 中 | Phase 1完了時にベースラインが未確定 | Phase 1で1ヶ月計測後に目標値を確定。確定まで目標値は暫定扱いとし、Phase 2開始時に見直す | AIエージェント | Phase 2開始時点でもベースライン未確定の場合、目標値設定を一時凍結しデータ収集に専念 |

## 参考資料

- Timee社 SDD実践事例: AI開発標準の失敗からcc-sdd導入に至る経緯
- cc-sdd (gotalab/cc-sdd): 仕様駆動開発フレームワーク（11コマンド体系）
- DORA Four Keys: デプロイ頻度、変更リードタイム、変更失敗率、復旧時間
- OpenClaw既存ガイドライン: `AGENTS.md`, `CONTRIBUTING.md`, `docs/ci.md`
