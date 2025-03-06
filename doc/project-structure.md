# ディレクトリ構造

```
/
├── .git/                # Gitリポジトリのバージョン管理情報を格納
├── .github/             # GitHub関連の設定ファイル（ワークフローなど）
├── aqua/                # Aquaツールの設定と関連ファイル
│   ├── aqua-checksums.json # Aquaのチェックサム情報
│   ├── aqua.yaml           # Aquaの設定ファイル
│   └── imports/            # Aquaのインポート設定
├── policy/              # ポリシー関連の設定ファイル
├── templates/           # テンプレートファイルを格納
├── terraform/           # Terraformの設定ファイル
│   ├── aws/             # AWS関連のTerraform設定
│   ├── cloudflare/      # Cloudflare関連のTerraform設定
│   │   ├── boxp.tk/     # boxp.tkドメインの設定
│   │   └── b0xp.io/     # b0xp.ioドメインの設定
│   │       ├── argocd/  # ArgoCD関連の設定
│   │       ├── hitohub/ # Hitohub関連の設定
│   │       ├── k8s/     # Kubernetes関連の設定
│   │       │   ├── .terraform.lock.hcl # Terraformのロックファイル
│   │       │   ├── .tfaction/          # TFActions関連の設定
│   │       │   ├── .tflint.hcl         # TFLintの設定ファイル
│   │       │   ├── aqua/               # Aqua関連の設定
│   │       │   ├── access.tf           # アクセス制御の設定
│   │       │   ├── backend.tf          # バックエンドの設定
│   │       │   ├── dns.tf              # DNS設定
│   │       │   ├── provider.tf         # プロバイダーの設定
│   │       │   ├── tfaction.yaml       # TFActionsの設定
│   │       │   ├── .tfmigrate.hcl      # TFMigrateの設定
│   │       │   ├── tunnel.tf           # トンネル設定
│   │       │   └── variables.tf        # 変数定義
│   │       ├── longhorn/               # Longhorn関連の設定
│   │       ├── portfolio/              # ポートフォリオ関連の設定
│   │       └── prometheus-operator/    # Prometheus Operator関連の設定
│   └── gcp/             # GCP関連のTerraform設定
├── .gitignore           # Gitで無視するファイルのリスト
├── LICENSE              # ライセンス情報
├── README.md            # プロジェクトの概要説明
├── renovate.json5       # Renovateの設定ファイル
└── tfaction-root.yaml   # TFActionsのルート設定ファイル
``` 