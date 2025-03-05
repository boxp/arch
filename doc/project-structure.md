# ディレクトリ構造

```
/
├── .git/                # Gitリポジトリのバージョン管理情報を格納
├── .github/             # GitHub関連の設定ファイル
│   └── workflows/       # GitHub Actionsのワークフロー定義ファイル
│       ├── actionlint.yaml             # Actionsの構文チェック
│       ├── apply.yaml                  # Terraformの適用ワークフロー
│       ├── release-module.yaml         # モジュールのリリース
│       ├── scaffold-module.yaml        # モジュールの雛形作成
│       ├── scaffold-tfmigrate.yaml     # Terraform移行の雛形作成
│       ├── scaffold-working-directory.yaml  # 作業ディレクトリの雛形作成
│       ├── schedule-create-drift-issues.yaml  # ドリフト検出時のissue作成
│       ├── schedule-detect-drifts.yaml  # 定期的なドリフト検出
│       ├── sync-drift-issue-description.yaml  # ドリフトissueの説明更新
│       ├── test.yaml                   # テスト実行
│       ├── wc-*.yaml                   # ワークフロー制御関連ファイル
├── .cursor/             # Cursor IDE関連の設定ファイル
├── aqua/                # Aquaツールの設定と関連ファイル
│   ├── aqua-checksums.json  # Aquaのチェックサム情報
│   ├── aqua.yaml            # Aquaの設定ファイル
│   └── imports/             # Aquaのインポート設定
│       ├── actionlint.yaml      # actionlintツールの設定
│       ├── ci-info.yaml         # CI情報ツールの設定
│       ├── conftest.yaml        # conftestツールの設定
│       ├── gh.yaml              # GitHub CLIの設定
│       ├── ghalint.yaml         # GitHub Actions linterの設定
│       ├── ghcp.yaml            # GitHub Content Publisherの設定
│       ├── github-comment.yaml  # GitHub commentツールの設定
│       ├── opa.yaml             # Open Policy Agentの設定
│       ├── reviewdog.yaml       # ReviewDogの設定
│       ├── shellcheck.yaml      # ShellCheckの設定
│       ├── terraform-docs.yaml  # Terraform Docsの設定
│       ├── tfaction-go.yaml     # TFAction Goの設定
│       ├── tfcmt.yaml           # Terraform Commentの設定
│       ├── tfmigrate.yaml       # Terraform Migrateの設定
│       └── tfprovidercheck.yaml # Terraform Providerチェックの設定
├── doc/                 # ドキュメント関連ファイル
│   ├── migrate-to-zero-trust/  # ゼロトラスト移行に関するドキュメント
│   └── project-structure.md    # プロジェクト構造の説明（本ファイル）
├── policy/              # ポリシー関連の設定ファイル
│   └── terraform/       # Terraformポリシー設定
│       ├── github_issue_label_description.md         # Issue Label説明のポリシー（マークダウン）
│       ├── github_issue_label_description.rego       # Issue Label説明のポリシー（Rego）
│       ├── github_issue_label_description_test.rego  # Issue Label説明ポリシーのテスト
│       └── util.rego                                 # ユーティリティ関数
├── templates/           # テンプレートファイル
│   ├── aws/             # AWS関連のテンプレート
│   └── cloudflare/      # Cloudflare関連のテンプレート
├── terraform/           # Terraformの設定ファイル
│   ├── aws/             # AWS関連のTerraform設定
│   ├── cloudflare/      # Cloudflare関連のTerraform設定
│   │   ├── boxp.tk/     # boxp.tkドメインの設定
│   │   └── b0xp.io/     # b0xp.ioドメインの設定
│   │       ├── argocd/            # ArgoCD関連の設定
│   │       ├── hitohub/           # Hitohub関連の設定
│   │       ├── k8s/               # Kubernetes関連の設定
│   │       │   ├── .terraform.lock.hcl  # Terraformのロックファイル
│   │       │   ├── .tfaction/           # TFActions関連の設定
│   │       │   ├── .tflint.hcl          # TFLintの設定ファイル
│   │       │   ├── aqua/                # Aqua関連の設定
│   │       │   ├── access.tf            # アクセス制御の設定
│   │       │   ├── backend.tf           # バックエンドの設定
│   │       │   ├── dns.tf               # DNS設定
│   │       │   ├── provider.tf          # プロバイダーの設定
│   │       │   ├── tfaction.yaml        # TFActionsの設定
│   │       │   ├── .tfmigrate.hcl       # TFMigrateの設定
│   │       │   ├── tunnel.tf            # トンネル設定
│   │       │   └── variables.tf         # 変数定義
│   │       ├── longhorn/          # Longhorn関連の設定
│   │       ├── portfolio/         # ポートフォリオ関連の設定
│   │       └── prometheus-operator/  # Prometheus Operator関連の設定
│   └── gcp/             # GCP関連のTerraform設定
├── .gitignore           # Gitで無視するファイルのリスト
├── LICENSE              # ライセンス情報
├── README.md            # プロジェクトの概要説明
├── renovate.json5       # Renovateの設定ファイル
└── tfaction-root.yaml   # TFActionsのルート設定ファイル
```

## 主要コンポーネントの説明

### インフラストラクチャ管理
- **terraform/**: インフラをコードとして管理するためのTerraform設定ファイル群
  - 複数のクラウドプロバイダー（AWS、GCP、Cloudflare）に対応
  - 各ドメイン（boxp.tk、b0xp.io）ごとに設定を分離

### CI/CD
- **.github/workflows/**: GitHub Actionsで実装されたCI/CDパイプライン
  - Terraformの計画と適用
  - ドリフト検出と修正
  - コード品質チェック

### ツール管理
- **aqua/**: 開発・運用ツールのバージョン管理
  - 一貫したツールチェインの提供
  - 各種リンター、フォーマッター、検証ツールの設定

### ポリシー管理
- **policy/**: インフラ構成に対するポリシーの定義
  - Open Policy Agent (OPA) を使用したポリシーの検証

### ドキュメント
- **doc/**: プロジェクトに関するドキュメント
  - 構造説明、移行計画などの技術文書 