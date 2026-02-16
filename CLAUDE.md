# CLAUDE.md

このファイルは、このリポジトリでClaude Code (claude.ai/code)がコードを扱う際のガイダンスを提供します。

## 概要

これは `arch` リポジトリです - 複数のクラウドプロバイダー（AWS、Cloudflare、GCP）にわたってTerraformとTFActionを使用した宣言的なインフラストラクチャー・アズ・コードの個人インフラストラクチャー管理プロジェクトです。`lolice`という名前の姉妹Kubernetesリポジトリをサポートするインフラストラクチャー基盤を管理しています。

## 主要コマンド

### ツール管理 (Aqua)
- `aqua install` - プロジェクトに必要なすべてのツールをインストール
- `aqua list` - 利用可能なすべてのツールとバージョンを一覧表示
- ツールはプロジェクトルートでグローバルに管理され、`aqua/aqua.yaml`ファイルを通じてディレクトリごとに管理されます

### Terraform操作
- **最初に特定のterraformディレクトリに移動** (例: `cd terraform/aws/users/` または `cd terraform/cloudflare/b0xp.io/k8s/`)
- `terraform init` - 作業ディレクトリでterraformを初期化
- `terraform plan` - terraform変更を計画
- `terraform apply` - terraform変更を適用
- `terraform validate` - terraform設定を検証
- `terraform fmt` - terraformファイルをフォーマット

### リンティングと検証
- `tflint` - terraformファイルをリント（terraformワーキングディレクトリから実行）
- `conftest verify --policy policy/terraform` - OPAポリシーに対して検証
- `trivy config .` - terraform設定のセキュリティスキャン
- `actionlint` - GitHub Actionsワークフローをリント
- `ghalint run` - GitHub Actionsワークフローリンティング
- `cd ansible && uv run ansible-lint` - Ansibleプレイブック/ロールをリント

### コミット前の必須チェック
**重要**: コミット前に必ず以下のlintチェックを実行してください：
- Terraformの場合: `terraform fmt && terraform validate && tflint`
- Ansibleの場合: `cd ansible && uv run ansible-lint`
- GitHub Actionsの場合: `actionlint && ghalint run`
- 全体的なセキュリティチェック: `trivy config .`

### Ansible Moleculeテスト
- **ローカル環境**: `cd ansible/roles/[role_name] && molecule test` (x86_64環境で実行)
- **ARM64シミュレーション**: `MOLECULE_DOCKER_PLATFORM=linux/arm64 molecule test` (Orange Pi Zero 3環境をエミュレート)
- CIでは自動的にARM64プラットフォームが使用されます

### TFActionワークフロー
- TFActionはGitHub Actions経由でterraform操作を自動処理
- グローバル設定には`tfaction-root.yaml`を使用
- 各terraformディレクトリには特定の設定用の独自の`tfaction.yaml`があります
- 適切なIAMロール引き受けによる自動化されたplan/applyワークフローをサポート

## アーキテクチャ

### プロジェクト構造
- **`terraform/`** - プロバイダーごとに整理されたメインのterraform設定
  - `aws/` - AWSリソース（IAM、ECR、SSM Parameter Storeなど）
  - `cloudflare/` - Cloudflareリソース（DNS、トンネル、アクセスポリシー）
  - 管理対象ドメイン: `b0xp.io` と `boxp.tk`
- **`policy/terraform/`** - ガバナンス用のOpen Policy Agent (OPA)ポリシー
- **`templates/`** - 新しいコンポーネント用のTerraformモジュールテンプレート
- **`aqua/`** - ツール依存関係管理設定

### 技術スタック
- **Terraform** - Infrastructure as Code
- **TFAction** - GitHub Actions経由のTerraform自動化
- **Aqua** - ツールバージョン管理
- **Open Policy Agent** - ポリシー実行
- **AWS** - クラウドサービス（主にIAM、ECR、SSM）
- **Cloudflare** - DNS、トンネル、アクセス管理
- **Renovate** - 自動依存関係更新

### `lolice`プロジェクトとの関係
`arch`プロジェクトは`lolice` Kubernetesリポジトリが基盤とするインフラストラクチャー基盤を提供します：
- `arch`はクラウドリソース、DNS、トンネル、アクセスポリシーを定義
- `lolice`はインフラストラクチャーを使用してKubernetesクラスター上にアプリケーションをデプロイ
- AWS SSM Parameter Store (arch)で管理されるシークレットは`lolice`のExternal Secretsによって消費されます
- `arch`で定義されたCloudflareトンネルは`lolice`サービスへの安全な外部アクセスを提供
- `lolice`プロジェクトは git@github.com:boxp/lolice.git に存在します

### TFAction CI/CDフロー
1. terraformファイルの変更がGitHub Actionsをトリガー
2. PRで`terraform plan`が自動実行
3. 承認とマージ後、`terraform apply`が自動実行
4. 状態は適切なIAMロール引き受けによりS3に保存
5. 検証時にOPA conftestによってポリシーが実行

### セキュリティとコンプライアンス
- すべてのterraformプロバイダーはCI/CDで明示的にホワイトリスト化
- OPAポリシーが命名規則とセキュリティ標準を実行
- GitHub Actions用の最小権限のAWS IAMロール
- AWS SSM Parameter Store経由のシークレット管理
- Renovateによる定期的な依存関係更新

## 重要な注意事項

### Terraformでの作業
- 常に適切な作業ディレクトリからterraformコマンドを実行
- 各terraformディレクトリは独自の状態で独立して管理
- 正しいツールバージョンを確保するために`aqua install`を使用
- ポリシー検証は自動実行されますが、conftestでローカルテスト可能

### 新しいインフラストラクチャーの追加
1. 開始点として`templates/`ディレクトリのテンプレートを使用
2. 既存の命名規則とディレクトリ構造に従う
3. 新しいterraformプロバイダーが承認されたホワイトリストに追加されていることを確認
4. PRを作成する前に`terraform plan`でテスト

### Cursor Rules統合
リポジトリにはタスク実行前にプロジェクトドキュメントファイルの読み取りを必要とするCursor IDEルールが含まれています：
- `@docs/project-structure.md` - 詳細なディレクトリ構造
- `@docs/project-spec.md` - 完全なプロジェクト仕様とワークフロー