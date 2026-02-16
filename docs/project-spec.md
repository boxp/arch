# arch & lolice プロジェクト仕様書

## 1. プロジェクト概要

### 1.1 arch プロジェクト

arch プロジェクトは、インフラストラクチャをコードとして管理するためのリポジトリです。Terraform を使用して Cloudflare、AWS、GCP などのクラウドリソースの定義・管理を行い、基盤となるインフラストラクチャを提供します。

**主な目的**：
- インフラストラクチャのコード化（IaC）
- クラウドリソースの自動プロビジョニング
- バージョン管理されたインフラ設定
- 再現性と一貫性の確保

### 1.2 lolice プロジェクト

lolice プロジェクトは、Kubernetes クラスター上のアプリケーションとサービスを管理するためのリポジトリです。Kubernetes マニフェストを使用して、クラスター上にデプロイされるリソースを定義し、Argo CD を通じて GitOps ワークフローで管理します。

**主な目的**：
- Kubernetes リソースのバージョン管理
- GitOps ワークフローによる自動デプロイ
- クラスター上のアプリケーション構成管理
- サービス間の関係性と接続の定義

### 1.3 両プロジェクトの関係性

arch プロジェクトと lolice プロジェクトは密接に連携しており、以下の関係性があります：

1. arch プロジェクトは基盤インフラ（Kubernetes クラスター、ネットワーク、IAM など）を提供
2. lolice プロジェクトはその基盤上にアプリケーションとサービスをデプロイ
3. arch で定義された外部リソース（CloudflareトンネルなどのSSMパラメータ）は lolice の ExternalSecrets で参照
4. 両プロジェクトともにバージョン管理され、CI/CD パイプラインで自動化

## 2. arch プロジェクト詳細

### 2.1 技術スタック

- **言語**: HCL (HashiCorp Configuration Language)
- **ツール**: 
  - Terraform
  - AWS CLI
  - GitHub Actions
  - tfaction (Terraform 自動化ツール)
  - Cloudflare CLI

### 2.2 ディレクトリ構造

```
arch/
├── .github/                  # GitHub Actions ワークフロー定義
│   └── workflows/            # CI/CD パイプライン設定
│       ├── wc-plan.yaml      # terraform plan 用ワークフロー
│       └── ...
├── docs/                     # プロジェクトドキュメント
│   ├── project_docs/         # 各プロジェクトの詳細ドキュメント
│   └── ...
├── terraform/                # Terraform コード
│   ├── aws/                  # AWS リソース定義
│   │   ├── ssm/              # Systems Manager パラメータストア
│   │   └── ...
│   ├── cloudflare/           # Cloudflare リソース定義
│   │   ├── b0xp.io/          # b0xp.io ドメインの設定
│   │   │   ├── argocd/       # ArgoCD 関連の設定
│   │   │   └── ...
│   │   └── ...
│   └── ...
└── ...
```

### 2.3 主要コンポーネント

#### 2.3.1 Terraform モジュール

arch プロジェクトでは、以下のような Terraform モジュールが定義されています：

- **cloudflare**: DNS、Tunnel、Access などの Cloudflare リソース
- **aws**: EC2、RDS、S3、SSM など AWS リソース
- **google**: GCP プロジェクト、GKE クラスター、サービスアカウント

#### 2.3.2 CI/CD パイプライン

GitHub Actions を使用して、以下のような CI/CD パイプラインが実装されています：

- **terraform plan**: コード変更時に実行され、変更内容を検証
- **terraform apply**: 承認後に実行され、変更を適用
- **セキュリティチェック**: terraform-compliance、tfsec などでセキュリティ問題をチェック
- **プロバイダーバリデーション**: 使用される Terraform プロバイダーのホワイトリスト検証

#### 2.3.3 プロバイダーホワイトリスト管理

セキュリティと品質保証のため、使用可能な Terraform プロバイダーは明示的にホワイトリスト化されています：

```yaml
TFPROVIDERCHECK_CONFIG_BODY: |
  providers:
    - name: registry.terraform.io/cloudflare/cloudflare
    - name: registry.terraform.io/hashicorp/aws
    - name: registry.terraform.io/hashicorp/google
    - name: registry.terraform.io/hashicorp/null
    - name: registry.terraform.io/hashicorp/tls
    - name: registry.terraform.io/hashicorp/random
    - name: registry.terraform.io/hashicorp/time
    - name: registry.terraform.io/integrations/github
```

新しいプロバイダーを使用する場合は、このホワイトリストに追加する必要があります。

### 2.4 ワークフロー

#### 2.4.1 リソース追加・変更ワークフロー

1. 新しいリソースまたは変更の要件定義
2. Terraformコードの作成または修正
3. PRの作成と `terraform plan` の実行
4. コードレビューと承認
5. マージと `terraform apply` の自動実行
6. リソースの検証

#### 2.4.2 シークレット管理

AWS Systems Manager Parameter Store を使用してシークレットを管理しています：

- API トークン
- サービスアカウント認証情報
- 証明書と秘密鍵
- Cloudflare Tunnel トークン

これらのシークレットは lolice プロジェクトの ExternalSecrets によって Kubernetes Secrets に同期されます。

## 3. lolice プロジェクト詳細

### 3.1 技術スタック

- **言語**: YAML (Kubernetes マニフェスト)
- **ツール**:
  - kubectl
  - kustomize
  - Argo CD
  - External Secrets Operator
  - GitHub Actions

### 3.2 ディレクトリ構造

```
lolice/
├── .github/                  # GitHub Actions ワークフロー定義
│   └── workflows/            # CI/CD パイプライン設定
│       ├── argocd-diff.yaml  # ArgoCD diff 用ワークフロー
│       └── ...
├── argoproj/                 # Argo CD アプリケーション定義
│   ├── argocd/               # Argo CD 自体の設定
│   │   ├── base/             # 基本リソース
│   │   │   ├── cloudflared-api.yaml        # Cloudflared Deployment
│   │   │   ├── external-secrets.yaml       # ExternalSecret 定義
│   │   │   ├── github-actions-rbac.yaml    # GitHub Actions 用 RBAC
│   │   │   ├── network-policy.yaml         # ネットワークポリシー
│   │   │   └── ...
│   │   ├── overlays/         # カスタマイズオーバーレイ
│   │   └── kustomization.yaml # Kustomize 設定
│   ├── [アプリケーション名]/  # 各アプリケーションのディレクトリ
│   └── ...
└── ...
```

### 3.3 主要コンポーネント

#### 3.3.1 Argo CD Applications

lolice プロジェクトでは、各サービスやアプリケーションが Argo CD Application リソースとして定義されています。主なアプリケーションには：

- argocd: Argo CD 自体の設定
- external-secrets: ExternalSecrets Operator の設定
- prometheus: モニタリングシステム
- その他のアプリケーション

#### 3.3.2 Kustomize による設定管理

Kustomize を使用して、異なる環境や要件に対応する構成管理を行っています：

- **base**: 基本的なリソース定義
- **overlays**: 環境ごとの上書き設定
- **kustomization.yaml**: リソースとパッチの定義

#### 3.3.3 External Secrets

AWS Systems Manager Parameter Store から Kubernetes Secrets へシークレットを同期するための ExternalSecrets が定義されています：

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: argocd-api-tunnel-es
  namespace: argocd
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: argocd-api-tunnel-credentials
    creationPolicy: Owner
  data:
  - secretKey: tunnel-token
    remoteRef:
      key: argocd-api-tunnel-token
```

#### 3.3.4 Network Policies

セキュリティを強化するため、Kubernetes NetworkPolicy リソースを使用したポッド間通信の制限が定義されています。

### 3.4 ワークフロー

#### 3.4.1 アプリケーションデプロイワークフロー

1. アプリケーションマニフェストの作成または修正
2. PRの作成と GitHub Actions による検証
3. ArgoCD Diff による実際の適用差分の確認
4. コードレビューと承認
5. マージ後、Argo CD による自動同期
6. アプリケーションの検証

#### 3.4.2 GitOps による継続的デプロイ

Argo CD を使用した GitOps ワークフローにより、Git リポジトリがシステム状態の単一の信頼できる情報源（SSOT）となります：

1. Git リポジトリにコードをコミット
2. Argo CD がリポジトリの変更を検出
3. 現在のクラスター状態と目標状態の差分を計算
4. クラスターを目標状態に同期

## 4. クロスプロジェクト機能

### 4.1 外部アクセス管理

両プロジェクトが連携して、外部からのアクセスを以下のように管理しています：

1. **arch プロジェクト**:
   - Cloudflare DNS レコードの管理
   - Cloudflare Tunnel の作成と設定
   - Cloudflare Access による認証・認可
   - トークンと認証情報の AWS SSM Parameter Store への保存

2. **lolice プロジェクト**:
   - External Secrets による認証情報の取得
   - cloudflared Deployment による Tunnel 接続
   - Network Policy によるアクセス制限
   - Kubernetes Service と Pod の管理

### 4.2 CI/CD パイプラインの連携

arch プロジェクトと lolice プロジェクト間で CI/CD パイプラインが連携しています：

1. arch プロジェクトでの Terraform 変更を適用
2. パラメータストアに保存されたシークレットを lolice プロジェクトが利用
3. 両方のリポジトリの変更を検出してテストと検証を実行
4. 変更を安全かつ自動的に本番環境に適用

### 4.3 Argo CD API アクセス例

この連携の具体例として、最近実装された Argo CD API アクセスでは：

1. arch プロジェクトで:
   - argocd-api.b0xp.io の DNS レコード作成
   - API 用の Cloudflare Tunnel と Access 設定
   - GitHub Action 用のサービストークン発行と保存

2. lolice プロジェクトで:
   - トークンを取得するための ExternalSecret 設定
   - cloudflared API 用の Deployment 作成
   - GitHub Action からの接続を許可する Network Policy 設定
   - PR 時に差分を表示する GitHub Action ワークフロー

## 5. ベストプラクティスとガイドライン

### 5.1 共通ベストプラクティス

- **Infrastructure as Code (IaC)**: すべてのインフラストラクチャとアプリケーション構成をコードとして管理
- **バージョン管理**: すべての変更を Git でトラッキング
- **CI/CD**: 自動化されたテスト、検証、デプロイ
- **最小権限の原則**: 必要最小限の権限のみを付与
- **セキュリティ中心設計**: すべての段階でセキュリティを考慮

### 5.2 arch プロジェクト固有のガイドライン

- **モジュール化**: 再利用可能な Terraform モジュールの作成
- **状態管理**: Terraform 状態ファイルの適切な管理
- **プロバイダーホワイトリスト**: 承認されたプロバイダーのみ使用
- **リソース命名規則**: 一貫した命名規則の使用
- **コードレビュー**: すべての変更に対する厳格なレビュー

### 5.3 lolice プロジェクト固有のガイドライン

- **Kustomize の適切な使用**: 共通部分は base に、環境固有の設定は overlays に
- **リソース制限**: すべてのコンテナに適切なリソース制限を設定
- **Network Policy**: デフォルト拒否、必要な通信のみ許可
- **ヘルスチェック**: すべてのサービスに適切なヘルスチェックを設定
- **ラベルとアノテーション**: 一貫したラベリング戦略の使用

## 6. トラブルシューティングとデバッグ

### 6.1 arch プロジェクトのトラブルシューティング

- **Terraform 計画失敗**:
  - プロバイダーホワイトリストの確認
  - 依存関係の確認
  - 認証情報の確認

- **リソース作成失敗**:
  - クラウドプロバイダーのクォータ確認
  - エラーメッセージの分析
  - 手動での状態確認

### 6.2 lolice プロジェクトのトラブルシューティング

- **Argo CD 同期失敗**:
  - マニフェストの妥当性確認
  - リソース依存関係の確認
  - Kubernetes イベントログの確認

- **Pod 起動失敗**:
  - コンテナログの確認
  - リソース制限の確認
  - Network Policy の確認
  - シークレットとコンフィグマップの確認

## 7. セキュリティ考慮事項

### 7.1 シークレット管理

- AWS Systems Manager Parameter Store による安全なシークレット保存
- External Secrets による安全なシークレットの同期
- GitHub リポジトリシークレットの適切な使用
- 定期的なシークレットローテーション

### 7.2 アクセス制御

- Cloudflare Access による外部アクセスの保護
- Kubernetes RBAC による内部アクセス制御
- Network Policy による Pod 間通信の制限
- 最小特権原則に基づいた権限設定

### 7.3 脆弱性管理

- 定期的なセキュリティスキャン
- 依存関係の更新
- セキュリティパッチの適用
- インシデント対応計画の策定
