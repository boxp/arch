# ディレクトリ構造

## archプロジェクト

`arch`プロジェクトは、個人的なインフラストラクチャを宣言的に管理するためのプロジェクトです。主にTerraformとGitHubActionsを活用したTFActionを使用して、クラウドリソースとネットワーク設定を管理しています。

```
/
├── .git/                # Gitリポジトリのバージョン管理情報を格納
├── .github/             # GitHub関連の設定ファイル（ワークフローなど）
│   └── workflows/       # GitHubActions用のワークフロー定義ファイル
├── aqua/                # Aquaツールの設定と関連ファイル（ツール依存関係管理）
│   ├── aqua-checksums.json # Aquaのチェックサム情報（インストールされたツールの整合性確認用）
│   ├── aqua.yaml           # Aquaの主設定ファイル（使用ツールバージョンなどを定義）
│   └── imports/            # Aquaのインポート設定（外部ツール定義ファイル）
├── policy/              # ポリシー関連の設定ファイル
│   └── terraform/       # Terraformに関するポリシー設定（OpenPolicyAgent用）
│       ├── github_issue_label_description.md       # GitHubイシューラベルポリシーの説明
│       ├── github_issue_label_description.rego     # GitHubイシューラベルポリシーのRegoルール
│       ├── github_issue_label_description_test.rego # GitHubイシューラベルポリシーのテスト
│       └── util.rego                               # 共通ユーティリティ関数
├── templates/           # 新しいインフラコンポーネント作成用のテンプレートファイル
│   ├── aws/             # AWS関連のテンプレート
│   │   ├── .tflint.hcl         # TFLint設定
│   │   ├── .tfmigrate.hcl      # TFMigrate設定
│   │   ├── aqua/               # AWS環境用Aqua設定
│   │   │   ├── aqua.yaml       # AWS用ツール定義
│   │   │   └── imports/        # AWS固有ツールのインポート設定
│   │   ├── backend.tf          # AWSバックエンド設定テンプレート
│   │   └── provider.tf         # AWSプロバイダー設定テンプレート
│   └── cloudflare/      # Cloudflare関連のテンプレート
│       ├── .tflint.hcl         # TFLint設定
│       ├── .tfmigrate.hcl      # TFMigrate設定
│       ├── aqua/               # Cloudflare環境用Aqua設定
│       ├── backend.tf          # Cloudflareバックエンド設定テンプレート
│       └── provider.tf         # Cloudflareプロバイダー設定テンプレート
├── terraform/           # Terraformの設定ファイル（実際のインフラ定義）
│   ├── aws/             # AWS関連のTerraform設定
│   │   ├── external-secrets-operator/ # 外部シークレット操作オペレーターの設定
│   │   ├── hitohub/                   # Hitohubアプリケーション用設定
│   │   ├── k8s-ecr-token-updater/     # K8s用ECRトークン更新設定
│   │   ├── palserver/                 # Palworldサーバー設定
│   │   ├── tfaction/                  # TFAction用インフラ設定
│   │   └── users/                     # AWSユーザー管理設定
│   ├── cloudflare/      # Cloudflare関連のTerraform設定
│   │   ├── boxp.tk/     # boxp.tkドメインの設定
│   │   └── b0xp.io/     # b0xp.ioドメインの設定
│   │       ├── argocd/  # ArgoCD関連の設定（DNSレコード、アクセス制御など）
│   │       ├── hitohub/ # Hitohub関連の設定（DNSレコード、アクセス制御など）
│   │       ├── k8s/     # Kubernetes関連の設定（CLoudflare Tunnel、DNSなど）
│   │       │   ├── .terraform.lock.hcl # Terraformのロックファイル（依存関係バージョン固定）
│   │       │   ├── .tfaction/          # TFActions関連の設定（自動生成ファイル）
│   │       │   ├── .tflint.hcl         # TFLintの設定ファイル（静的解析ツール設定）
│   │       │   ├── aqua/               # Aqua関連の設定（このディレクトリ固有）
│   │       │   ├── access.tf           # Cloudflare Accessポリシー設定
│   │       │   ├── backend.tf          # Terraformステート管理用バックエンド設定
│   │       │   ├── dns.tf              # DNSレコード設定
│   │       │   ├── provider.tf         # Cloudflareプロバイダー設定
│   │       │   ├── tfaction.yaml       # TFActionsの設定（CI/CD用）
│   │       │   ├── .tfmigrate.hcl      # TFMigrateの設定（状態移行用）
│   │       │   ├── tunnel.tf           # Cloudflare Tunnel設定（外部公開用）
│   │       │   └── variables.tf        # 変数定義ファイル
│   │       ├── longhorn/               # Longhorn関連の設定（ストレージシステム）
│   │       ├── portfolio/              # ポートフォリオサイト関連の設定
│   │       └── prometheus-operator/    # Prometheus Operator関連の設定（監視システム）
│   └── gcp/             # GCP関連のTerraform設定
│       └── boxp-tk/     # boxp.tk関連のGCPリソース設定
├── .gitignore           # Gitで無視するファイルのリスト
├── .openhands/          # openhandsに関する重要な指示が記載されたマイクロエージェントファイルが含まれるディレクトリ。特に、.openhands/microagentsに記載された指示は必ず読んでください。

（注: .openhands/microagents/repo.mdは、openhandsに強制的に読ませるドキュメントです）
├── LICENSE              # ライセンス情報
├── README.md            # プロジェクトの概要説明
├── renovate.json5       # Renovateの設定ファイル（依存関係自動更新ツール）
└── tfaction-root.yaml   # TFActionsのルート設定ファイル（GitHubActions CI/CD全体設定）
```

### 主要コンポーネントの説明

- **Terraform**: 複数のクラウドプロバイダー（AWS、Cloudflare、GCP）にまたがるインフラを管理
  - AWS: 自宅Kubernetesクラスタ連携サービス（ECR、IAM、Secret Managerなど）
  - Cloudflare: DNS、トンネル、アクセス制御などのネットワーク設定
  - GCP: 一部のウェブサービスホスティング

- **TFAction**: GitHubActionsで実行されるTerraformワークフロー自動化システム
  - 設定変更のPR作成、計画実行、適用などを自動化
  - `tfaction-root.yaml`で全体設定を管理

- **Aqua**: ツール依存関係の一貫した管理
  - プロジェクト全体およびサブディレクトリごとに必要なツールとバージョンを定義
  - terraform, tflint, tfmigrate などのバージョン管理

- **ポリシー設定**: OpenPolicyAgentで設定されたインフラコード標準の検証ルール
  - GitHubイシューラベルやTerraformコード規約を強制

# 関連プロジェクト: lolice

`lolice`プロジェクトは、自宅Kubernetesクラスタのマニフェストを管理するリポジトリです。`arch`プロジェクトがインフラストラクチャを定義しているのに対し、`lolice`プロジェクトはそのインフラストラクチャ上で動作するKubernetesリソースの定義を管理しています。

```
/lolice/
├── .git/                # Gitリポジトリのバージョン管理情報を格納
├── .github/             # GitHub関連の設定ファイル（ワークフローなど）
├── argoproj/            # ArgoCDで管理されるアプリケーション定義
│   ├── argocd/                      # ArgoCD自体の設定
│   ├── argocd-image-updater/        # イメージ自動更新ツールの設定
│   ├── calico/                      # Calicoネットワークプラグインの設定
│   ├── descheduler/                 # ポッド再スケジューラの設定
│   ├── external-secrets-operator/   # 外部シークレット操作ツールの設定
│   ├── hitohub/                     # Hitohubアプリケーションの設定
│   ├── k8s/                         # クラスター全体の設定
│   ├── k8s-ecr-token-updater/       # AWS ECRトークン更新ツールの設定
│   ├── kubernetes-dashboard/        # Kubernetesダッシュボードの設定
│   ├── local-volume-provisioner/    # ローカルボリュームプロビジョナーの設定
│   ├── longhorn/                    # Longhornストレージシステムの設定
│   ├── obsidian-self-live-sync/     # Obsidian同期アプリケーションの設定
│   ├── palserver/                   # Palworldサーバーの設定
│   ├── prometheus-operator/         # Prometheusオペレーターの設定
│   ├── prometheus-operator-crd/     # PrometheusオペレーターのCRD
│   ├── reloader/                    # 設定変更時の自動リロードツールの設定
│   └── tidb-operator/               # TiDBデータベースオペレーターの設定
├── k8s/                 # クラスター基本コンポーネントの設定
│   └── calico/          # Calicoネットワークプラグインの基本設定
├── docs/                # プロジェクトのドキュメント
├── .gitignore           # Gitで無視するファイルのリスト
├── .openhands/          # openhandsに関する重要な指示が記載されたファイルを含むディレクトリ。特に、.openhands/microagentsに記載された指示は必ず読んでください。
├── LICENSE              # ライセンス情報
├── README.md            # プロジェクトの概要説明
├── cluster.jpg          # クラスターの物理的な構成図
└── renovate.json        # Renovateの設定ファイル
```

## archとloliceの関係

- **arch**: インフラストラクチャ層を定義（Cloudflare、DNS、トンネル、ネットワーク、AWS/GCPリソースなど）
  - TerraformとTFActionでインフラを宣言的に管理
  - Cloudflareを通じた自宅クラスタへの安全なアクセスを提供
  - AWS/GCPの各種リソースを管理
  - 継続的インテグレーション/デリバリーパイプライン設定

- **lolice**: 自宅Kubernetesクラスタ上のアプリケーション層を定義
  - ArgoCDを使用してGitOpsワークフローで管理
  - クラスタ上で動作する各種サービスやアプリケーションのマニフェストを格納
  - 監視、ストレージ、ネットワーク、アプリケーションなどの設定を管理 


