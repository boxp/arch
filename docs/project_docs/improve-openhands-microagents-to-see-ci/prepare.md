# OpenHandsマイクロエージェントを活用したGitHubのCI確認機能

## 1. プロジェクト概要

このプロジェクトは、OpenHandsのマイクロエージェント機能を活用して、GitHubのCI（継続的インテグレーション）ステータスと実行結果を確認する機能を実装するための情報をまとめたものです。

### 1.1 目的

- OpenHandsからGitHubのCIステータスを確認できるようにする
- CIの実行結果を詳細に分析し、失敗した場合の対応策を提案できるようにする
- マイクロエージェントの仕組みを活用して、特定のキーワードでCIの確認機能を呼び出せるようにする

## 2. OpenHandsのマイクロエージェントについて

### 2.1 マイクロエージェントの概念

OpenHandsのマイクロエージェントは、特定のドメインに関する専門知識やタスク固有のワークフローをAIエージェントに提供する特殊なプロンプトです。マイクロエージェントを使用することで、AIがより効果的にコード開発をサポートできるようになります。

### 2.2 マイクロエージェントの種類

OpenHandsは以下の2種類のマイクロエージェントをサポートしています：

1. **リポジトリマイクロエージェント**：特定のリポジトリに対する指示や情報を提供
2. **パブリックマイクロエージェント**：特定のキーワードがトリガーになる一般的な指示を提供

### 2.3 重要な制限事項

調査の結果、OpenHandsのマイクロエージェント実装には以下の重要な制限があることがわかりました：

- `.openhands/microagents/`ディレクトリには、現在**複数のファイルを配置すると問題が発生する可能性があります**
- すべてのマイクロエージェント機能は、単一の`repo.md`ファイルに統合する必要があります
- 少なくとも`.openhands/microagents/repo.md`ファイルが必要です

### 2.4 マイクロエージェントのファイル形式

マイクロエージェントはMarkdownファイルで、YAMLフロントマターを持ちます：

```markdown
---
name: <マイクロエージェントの名前>
type: repo
agent: CodeActAgent
triggers:
- <オプション：このマイクロエージェントをトリガーするキーワード>
---

<マークダウン形式の指示内容>
```

### 2.5 マイクロエージェントの配置

リポジトリマイクロエージェントは、リポジトリのルートディレクトリの`.openhands/microagents/`ディレクトリに配置します。

## 3. GitHubのCI機能の基本概念

### 3.1 ステータスチェック

GitHubでは、プルリクエスト(PR)に対して自動チェックを実行できます。これらのチェックは、コードの品質やテストの成功を確認するために使用されます。ステータスチェックには以下の状態があります：

- `completed`: チェックが完了し、結論があります
- `failure`: チェックが失敗
- `in_progress`: チェックが進行中
- `pending`: チェックがキューの先頭にあるが実行待ち
- `queued`: チェックがキューに入っている
- その他：`startup_failure`、`waiting`など

### 3.2 チェックスイートとチェックラン

GitHubのCIシステムでは以下の概念が重要です：

- **チェックスイート(Check Suite)**: PR内の複数のチェックをグループ化したもの
- **チェックラン(Check Run)**: 個々のチェック実行

### 3.3 ワークフローラン

GitHub Actionsを使用する場合、ワークフローの実行はワークフローランとして記録されます。ワークフローランは、設定されたイベントが発生したときに実行されるワークフローのインスタンスです。

## 4. GitHubのCIステータスを確認する方法

### 4.1 RESTful API

GitHubのREST APIを使用して、PRのCIステータスを確認できます。主要なエンドポイントは以下の通りです：

#### 4.1.1 PR情報の取得

```
GET /repos/{owner}/{repo}/pulls/{pull_number}
```

#### 4.1.2 コミットのステータスチェック

```
GET /repos/{owner}/{repo}/commits/{ref}/status
```

#### 4.1.3 チェックスイートとチェックラン

```
GET /repos/{owner}/{repo}/commits/{ref}/check-suites
GET /repos/{owner}/{repo}/check-suites/{check_suite_id}/check-runs
```

#### 4.1.4 ワークフローラン

```
GET /repos/{owner}/{repo}/actions/runs
GET /repos/{owner}/{repo}/actions/runs/{run_id}
GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs
```

### 4.2 GraphQL API

GraphQL APIを使用すると、必要な情報をより効率的に取得できます：

```graphql
query {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR_NUMBER) {
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 100) {
                nodes {
                  ... on CheckRun {
                    name
                    conclusion
                    detailsUrl
                    summary
                    text
                  }
                  ... on StatusContext {
                    context
                    state
                    targetUrl
                    description
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 4.3 GitHub CLI

GitHub CLIを使うと、コマンドラインからCIステータスを簡単に確認できます：

```bash
# PRのチェック状態を確認
gh pr checks PR_NUMBER

# ワークフローの実行を一覧表示
gh run list --limit 10

# 特定のワークフローランの詳細を表示
gh run view RUN_ID

# ワークフローログをダウンロード
gh run download RUN_ID
```

## 5. CIチェッカーマイクロエージェントの実装

### 5.1 マイクロエージェントの定義

以下は、CIチェッカーマイクロエージェントのYAMLフロントマターの例です：

```yaml
---
name: ci-checker
type: repo
agent: CodeActAgent
triggers:
- ci
- workflow
- github actions
- pull request
- PR
- check
- test
- build
---
```

### 5.2 役割と責任

このマイクロエージェントには以下の役割があります：

1. プルリクエストのCIステータスの確認
2. CI実行結果の詳細情報へのアクセスと分析
3. 失敗したCIチェックの分析と問題解決の提案
4. CIステータスに基づく次のアクションの提案

### 5.3 呼び出し方

以下のような表現で呼び出すことができます：

- "CIの状態を確認して"
- "このPRのテスト結果を見せて"
- "ワークフローの実行結果を教えて"
- "CI失敗の原因を分析して"

### 5.4 CIステータス確認の手順

1. 現在のリポジトリとブランチを確認する
2. プルリクエスト番号を特定する（アクティブなPR、または指定されたPR）
3. PRの最新コミットを取得する
4. そのコミットのCIステータスとチェック結果を取得する
5. ステータスを分析して結果を報告する
6. 失敗している場合は、詳細なログを取得して問題を分析する

### 5.5 コマンド例

GitHub CLIを使用する場合:
```bash
# PRの一覧を表示
gh pr list

# 特定のPRの詳細を表示
gh pr view {PR_NUMBER}

# CIステータスの確認
gh pr checks {PR_NUMBER}

# ワークフロー実行の一覧
gh run list --limit 10

# 特定のワークフロー実行の詳細
gh run view {RUN_ID}

# ワークフロー実行のログをダウンロード
gh run download {RUN_ID}
```

curlを使用してAPIを直接呼び出す場合:
```bash
# PRのステータスを取得
curl -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}"

# コミットのチェック結果を取得
curl -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/{OWNER}/{REPO}/commits/{COMMIT_SHA}/check-runs"
```

### 5.6 CI失敗時の対応

一般的なCI失敗の種類と対応:

1. **テスト失敗**:
   - 失敗したテストケースを特定
   - テストコードとテスト対象のコードを確認
   - 修正提案を行う

2. **ビルド失敗**:
   - コンパイルエラーや構文エラーを特定
   - 依存関係の問題を確認
   - 環境の違いによる問題を検討

3. **リント/フォーマットエラー**:
   - コーディングスタイルの問題を特定
   - 自動修正コマンドの提案

4. **依存関係の問題**:
   - バージョン不一致や欠落パッケージを確認
   - 依存関係グラフの整合性を検証

### 5.7 実装例

以下は、PRのCIステータスを確認するためのPythonコードの例です：

```python
import requests
import os
import json

def check_pr_ci_status(repo_owner, repo_name, pr_number, github_token):
    """
    PRのCIステータスを確認する関数
    
    Args:
        repo_owner (str): リポジトリのオーナー
        repo_name (str): リポジトリ名
        pr_number (int): PR番号
        github_token (str): GitHub API トークン
        
    Returns:
        dict: CIステータスの情報
    """
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
    }
    
    # 1. PRの情報を取得
    pr_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/pulls/{pr_number}"
    pr_response = requests.get(pr_url, headers=headers)
    pr_data = pr_response.json()
    
    if pr_response.status_code != 200:
        return {"error": f"PR情報の取得に失敗しました: {pr_data.get('message', '不明なエラー')}"}
    
    # 2. PRの最新コミットのSHAを取得
    head_sha = pr_data["head"]["sha"]
    
    # 3. コミットのステータスを取得
    status_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/commits/{head_sha}/status"
    status_response = requests.get(status_url, headers=headers)
    status_data = status_response.json()
    
    # 4. チェックスイートを取得
    check_suites_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/commits/{head_sha}/check-suites"
    check_suites_response = requests.get(check_suites_url, headers=headers)
    check_suites_data = check_suites_response.json()
    
    # 結果をまとめる
    result = {
        "pr_url": pr_data["html_url"],
        "status": status_data["state"],
        "total_count": status_data["total_count"],
        "statuses": status_data["statuses"],
        "check_suites": []
    }
    
    # 5. 各チェックスイートに対してチェックランを取得
    for suite in check_suites_data.get("check_suites", []):
        suite_id = suite["id"]
        check_runs_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/check-suites/{suite_id}/check-runs"
        check_runs_response = requests.get(check_runs_url, headers=headers)
        check_runs_data = check_runs_response.json()
        
        suite_info = {
            "id": suite_id,
            "app": suite.get("app", {}).get("name", "不明"),
            "status": suite["status"],
            "conclusion": suite["conclusion"],
            "check_runs": check_runs_data.get("check_runs", [])
        }
        result["check_suites"].append(suite_info)
    
    # 6. 失敗したチェックがあれば詳細を取得
    failed_checks = []
    for status in status_data["statuses"]:
        if status["state"] != "success":
            failed_checks.append({
                "context": status["context"],
                "state": status["state"],
                "description": status["description"],
                "target_url": status["target_url"]
            })
    
    for suite in result["check_suites"]:
        for run in suite["check_runs"]:
            if run["conclusion"] != "success":
                failed_checks.append({
                    "name": run["name"],
                    "status": run["status"],
                    "conclusion": run["conclusion"],
                    "details_url": run["details_url"]
                })
    
    result["failed_checks"] = failed_checks
    
    return result

def analyze_ci_failures(failures):
    """
    CI失敗の分析と対応策を提案する関数
    
    Args:
        failures (list): 失敗したチェックのリスト
        
    Returns:
        list: 分析結果と対応策
    """
    analysis = []
    
    for failure in failures:
        check_name = failure.get("context") or failure.get("name")
        state = failure.get("state") or failure.get("conclusion")
        description = failure.get("description", "")
        url = failure.get("target_url") or failure.get("details_url")
        
        analysis_item = {
            "check_name": check_name,
            "state": state,
            "description": description,
            "url": url,
            "possible_fixes": []
        }
        
        # チェック名に基づいて対応策を提案
        if "test" in check_name.lower():
            analysis_item["possible_fixes"].append("失敗したテストのログを確認し、テストが失敗した原因を特定してください")
            analysis_item["possible_fixes"].append("テストが期待する動作と実際の動作の違いを確認してください")
        
        elif "lint" in check_name.lower() or "style" in check_name.lower():
            analysis_item["possible_fixes"].append("コードスタイルやフォーマットの問題を修正してください")
            analysis_item["possible_fixes"].append("プロジェクトのリンターやフォーマッターを実行してください")
        
        elif "build" in check_name.lower():
            analysis_item["possible_fixes"].append("ビルドエラーのログを確認してください")
            analysis_item["possible_fixes"].append("依存関係が正しくインストールされているか確認してください")
            analysis_item["possible_fixes"].append("コンパイルエラーを修正してください")
        
        else:
            analysis_item["possible_fixes"].append("詳細なログを確認して失敗の原因を特定してください")
        
        analysis.append(analysis_item)
    
    return analysis
```

## 6. 実装手順

### 6.1 ディレクトリ作成とファイルの設置

1. リポジトリのルートディレクトリに`.openhands`ディレクトリを作成
   ```bash
   mkdir -p .openhands/microagents
   ```

2. `repo.md`ファイルを作成
   ```bash
   touch .openhands/microagents/repo.md
   ```

3. マイクロエージェントの定義を記述
   - 上記で示したYAMLフロントマターと役割・責任、呼び出し方、API情報などを含める

4. 変更をコミットしてリポジトリにプッシュ
   ```bash
   git add .openhands/microagents/repo.md
   git commit -m "Add CI checker microagent for OpenHands"
   git push
   ```

### 6.2 使用方法

マイクロエージェントを実装したら、OpenHandsのチャットインターフェースでトリガーワードを含むメッセージを入力することで呼び出せます：

- "CIの状態を確認して"
- "このPRのテスト結果を見せて"
- "ワークフローの実行結果を教えて"
- "CI失敗の原因を分析して"

### 6.3 トラブルシューティング

- マイクロエージェントが動作しない場合は、`repo.md`ファイルの形式と内容を確認
- フロントマターの構文が正しいことを確認
- 複数のファイルを`.openhands/microagents/`ディレクトリに配置している場合は、それらを単一の`repo.md`ファイルに統合
- GitHubトークンが適切に設定されているか確認

## 7. 注意事項

- GitHubトークンが必要です。環境変数やOpenHandsの設定で適切に構成してください。
- APIレート制限に注意してください。不必要なAPI呼び出しを避けてください。
- ログファイルは大きい場合があります。必要な部分だけを取得・分析することを検討してください。
- 異なるCIシステム（GitHub Actions, CircleCI, Jenkinsなど）に応じて対応を調整してください。

## 8. 参考資料

- [OpenHands Microagents Overview](https://docs.all-hands.dev/modules/usage/prompting/microagents-overview)
- [Repository Microagents](https://docs.all-hands.dev/modules/usage/prompting/microagents-repo)
- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [GitHub GraphQL API Documentation](https://docs.github.com/en/graphql)
