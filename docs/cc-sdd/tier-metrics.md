# cc-sdd Tier指標 実装仕様書

本ドキュメントはT-20260220-001で定義したTier 1〜3指標を、Phase 2（計測スクリプト整備）で実装可能なレベルに具体化する。

## Tier 1: 開発速度指標（Four Keys準拠）

### 1.1 デプロイ頻度

| 項目 | 内容 |
|------|------|
| 定義 | mainブランチへのマージ回数/日 |
| データソース | GitHub API: `GET /repos/{owner}/{repo}/pulls?state=closed&base=main` |
| 算出ロジック | `merged_at` が非nullのPR数を日別に集計 |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/deploy-frequency.json` |
| 目標 | 現状比+20%（ベースライン確定後に絶対値を設定） |

**API呼び出し例:**

```bash
gh pr list --repo boxp/arch --state merged --base main --limit 100 \
  --json mergedAt \
  --jq "[.[] | select(.mergedAt > \"${SINCE}\")] | length"
```

### 1.2 変更リードタイム

| 項目 | 内容 |
|------|------|
| 定義 | Issue作成〜対応PRのmainマージまでの時間（時間単位） |
| データソース | GitHub API: Issue `created_at` + PR `merged_at`（PRのClosing referenceでIssueとPRを紐付け） |
| 算出ロジック | `merged_at - issue.created_at`。Issueに紐付かないPRは `pr.created_at` を起点とする |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/lead-time.json` |
| 目標 | 現状比-15% |

**API呼び出し例:**

```bash
# PR一覧取得（直近マージ分）
gh pr list --repo boxp/arch --state merged --limit 20 \
  --json number,createdAt,mergedAt,closingIssuesReferences

# 各PRについてリードタイム算出
# closingIssuesReferencesが空の場合はPR作成日を起点とする
```

### 1.3 変更失敗率

| 項目 | 内容 |
|------|------|
| 定義 | 計測期間内にマージされたPRのうち、マージ後30日以内にrevertまたはhotfix PRが作成された率 |
| データソース | GitHub API: PRタイトル/ブランチ名に `revert` または `hotfix` を含むPR。revert PRの本文またはタイトルから元PRを特定 |
| 算出ロジック | 1. 計測期間内の全マージPRを取得 2. revert/hotfix PRを取得し、タイトルの `Revert "..."` パターンまたはブランチ名から元PRを特定 3. 元PRのマージ後30日以内に作成されたrevert/hotfix PRのみカウント 4. 同一元PRに複数のrevert/hotfixがある場合は元PRを1件としてカウント（ユニーク化） 5. `(revert/hotfixが紐づいた元PRのユニーク件数) / (全マージPR数) * 100` |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 月次 |
| 保持先 | `metrics/monthly/{YYYY-MM}/change-failure-rate.json` |
| 目標 | <5% |

**API呼び出し例:**

```bash
# revert/hotfix PR検索
gh pr list --repo boxp/arch --state merged --limit 100 \
  --json title,mergedAt \
  --jq '[.[] | select(.title | test("revert|hotfix"; "i"))] | length'
```

### 1.4 復旧時間

| 項目 | 内容 |
|------|------|
| 定義 | 本番影響インシデント検出〜修正マージまでの時間 |
| データソース | GitHub Issues（`bug` + `critical` ラベル）の `created_at` と対応PRの `merged_at` |
| 算出ロジック | `fix_pr.merged_at - incident_issue.created_at`（時間単位） |
| 検出時刻の確定ルール | Issueの `created_at` を暫定検出時刻とする。Grafanaアラート発火時刻がIssue本文に記載されている場合はそちらを優先 |
| 紐付け方法 | Issueをクローズする修正PRの `closingIssuesReferences` で紐付け。紐付けがない場合は、Issue番号をPRタイトルまたはブランチ名に含むPRを検索 |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | インシデント発生時（月次レポートに集約） |
| 保持先 | `metrics/monthly/{YYYY-MM}/recovery-time.json` |
| 目標 | <2h |

**API呼び出し例:**

```bash
# critical bugのIssue一覧
gh issue list --repo boxp/arch --label "bug,critical" --state closed \
  --json number,createdAt,closedAt

# IssueをクローズしたPRの特定
gh api "repos/boxp/arch/issues/{issue_number}/timeline" \
  --jq '[.[] | select(.event == "cross-referenced" and .source.issue.pull_request)] | .[0].source.issue.number'

# 該当PRのmerged_at取得
gh pr view --repo boxp/arch {pr_number} --json mergedAt --jq '.mergedAt'
```

## Tier 2: AI支援品質指標

### 2.1 レビュー時間

| 項目 | 内容 |
|------|------|
| 定義 | PR作成〜最初のApproveレビューまでの時間（時間単位） |
| データソース | GitHub API: PR `created_at` + Reviews API `submitted_at`（state=APPROVED） |
| 算出ロジック | `first_approve.submitted_at - pr.created_at` |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/review-time.json` |
| 目標 | 現状比-25% |

**API呼び出し例:**

```bash
gh api "repos/boxp/arch/pulls/{pr_number}/reviews" \
  --jq '[.[] | select(.state == "APPROVED")][0].submitted_at'
```

### 2.2 CI成功率

| 項目 | 内容 |
|------|------|
| 定義 | PRに対するCI実行の全体成功率（全run中のsuccess率） |
| データソース | GitHub Actions API: `GET /repos/{owner}/{repo}/actions/runs` |
| 算出ロジック | `(conclusion == "success" のrun数) / (全run数) * 100`（PR起因のrunのみ対象） |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/ci-success-rate.json` |
| 目標 | >85% |

**API呼び出し例:**

```bash
gh run list --repo boxp/arch --workflow ci.yml --limit 50 \
  --json conclusion \
  --jq '{total: length, success: [.[] | select(.conclusion == "success")] | length}'
```

### 2.3 仕様カバレッジ

| 項目 | 内容 |
|------|------|
| 定義 | 新規機能PRのうち `docs/project_docs/` に対応する plan.md が存在し、「概要」「実装計画」「リスク」セクションを含む率 |
| データソース | PRの変更ファイル一覧 + リポジトリ内 `docs/project_docs/` ディレクトリ |
| 算出ロジック | PRブランチ名またはタイトルからチケット番号を抽出 → `docs/project_docs/{ticket}/plan.md` の存在と必須セクション有無をチェック |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/spec-coverage.json` |
| 目標 | >80%（新規機能PRのみ。バグ修正・dependabot PRは除外） |

**検証ロジック:**

```bash
# plan.mdの必須セクション確認
required_sections=("## 概要" "## 実装計画" "## リスク")
for section in "${required_sections[@]}"; do
  grep -q "$section" "docs/project_docs/${TICKET}/plan.md"
done
```

### 2.4 Codexレビュー通過率

| 項目 | 内容 |
|------|------|
| 定義 | Codexレビューの初回OK率（修正なしで通過した割合） |
| データソース | OpenClaw進捗ファイル（`progress/*.md`）内のCodexレビュー結果記録 |
| 算出ロジック | `(初回OK数) / (全レビュー実行数) * 100` |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/codex-pass-rate.json` |
| 目標 | >60% |

**データ収集方法:**

進捗ファイルからCodexレビュー結果を構造化抽出する。Phase 2でパーサースクリプトを実装予定。

## Tier 3: プロセス健全性指標

### 3.1 PRサイズ

| 項目 | 内容 |
|------|------|
| 定義 | PRの変更行数（additions + deletions）の中央値 |
| データソース | GitHub API: `GET /repos/{owner}/{repo}/pulls/{number}` の `additions`, `deletions` |
| 算出ロジック | 直近マージPR群の `additions + deletions` を昇順ソートし中央値を算出 |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/pr-size.json` |
| 目標 | 中央値 <300行 |

**API呼び出し例:**

```bash
gh pr list --repo boxp/arch --state merged --limit 20 \
  --json number,additions,deletions \
  --jq '[.[] | .additions + .deletions] | sort | .[length/2]'
```

### 3.2 タスク完了率

| 項目 | 内容 |
|------|------|
| 定義 | OpenClawが計画したタスクのうち完了に至った率 |
| データソース | OpenClaw進捗ファイル（`progress/*.md`）の完了マーカー（`.completed/*.done`） |
| 算出ロジック | `(完了タスク数) / (全計画タスク数) * 100` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/task-completion.json` |
| 目標 | >90% |

**データ収集方法:**

```bash
# 完了タスク数
completed=$(ls -1 .openclaw/workspace/.completed/*.done 2>/dev/null | wc -l)

# 全タスク数（requirements.mdファイルの数）
total=$(ls -1 .openclaw/workspace/T-*.md 2>/dev/null | wc -l)
```

### 3.3 ステアリング鮮度

| 項目 | 内容 |
|------|------|
| 定義 | AGENTS.md の最終更新からの経過日数 |
| データソース | Git log: `AGENTS.md` の最終コミット日時 |
| 算出ロジック | `today - last_commit_date(AGENTS.md)` |
| 対象リポジトリ | `boxp/arch`, `openclaw/openclaw` |
| 計測頻度 | 週次 |
| 保持先 | `metrics/weekly/{YYYY-WW}/steering-freshness.json` |
| 目標 | <30日 |

**API呼び出し例:**

```bash
git log -1 --format="%ci" -- AGENTS.md
```

## メトリクス保持先の構造

```text
metrics/
├── weekly/
│   └── {YYYY-WW}/          # ISO週番号
│       ├── deploy-frequency.json
│       ├── lead-time.json
│       ├── review-time.json
│       ├── ci-success-rate.json
│       ├── spec-coverage.json
│       ├── codex-pass-rate.json
│       ├── pr-size.json
│       ├── task-completion.json
│       ├── steering-freshness.json
│       └── weekly-report.md
└── monthly/
    └── {YYYY-MM}/
        ├── change-failure-rate.json
        ├── recovery-time.json
        └── monthly-report.md
```

### JSON形式（共通スキーマ）

```json
{
  "metric": "deploy-frequency",
  "tier": 1,
  "period": "2026-W08",
  "repositories": {
    "boxp/arch": { "value": 15, "unit": "merges" },
    "openclaw/openclaw": { "value": 8, "unit": "merges" }
  },
  "aggregated": { "value": 23, "unit": "merges" },
  "target": "+20% from baseline",
  "baseline": null,
  "collected_at": "2026-02-20T00:00:00Z",
  "collector": "manual"
}
```
