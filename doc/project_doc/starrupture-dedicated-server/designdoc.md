# StarRupture専用サーバー 実装設計書

## 概要

本プロジェクトは、lolice Kubernetesクラスター上でStarRupture専用サーバーをホスティングし、Cloudflare Zero Trustを通じてプライベートアクセスを提供することを目的とします。これにより、安全でスケーラブルなゲームサーバー環境を構築します。

## 1. 設計方針

### 1.1 アーキテクチャ概要

```
Game Client + WARP ⟷ Cloudflare Zero Trust ⟷ Private Tunnel ⟷ lolice k8s cluster ⟷ StarRupture Server Pod
```

1. **Dockerイメージ**: `struppinet/starrupture-dedicated-server`を利用
2. **アクセス制御**: Cloudflare Zero Trust（CF ZT）+ WARP Client によるプライベートアクセス
3. **プライベートホスト名**: 公開DNSを使用しない内部専用ホスト名（`starrupture.internal`）
4. **インフラ管理**: boxp/arch（Terraform）+ boxp/lolice（Kubernetes）
5. **シークレット管理**: AWS SSM Parameter Store + External Secrets Operator

### 1.2 技術スタック

**インフラ層（boxp/arch）**
- **Private Hostname**: Cloudflare Private Network（`starrupture.internal`） - 公開DNSなし
- **Tunnel**: Cloudflare Tunnel（プライベートネットワーク用）
- **Access Control**: Cloudflare Zero Trust + WARP Client
- **Secret Management**: AWS SSM Parameter Store

**アプリケーション層（boxp/lolice）**
- **Container**: Docker（`struppinet/starrupture-dedicated-server`）
- **Orchestration**: Kubernetes Deployment
- **Storage**: Persistent Volume（セーブデータ永続化）
- **Secret Sync**: External Secrets Operator

## 2. プライベートホスト名アプローチの特徴

### 2.1 従来のCloudflare Tunnelとの違い

| 項目 | 従来のPublic Hostname | Private Hostname（本設計） |
|------|----------------------|---------------------------|
| DNS設定 | 公開DNSレコード必要（CNAME） | 公開DNSレコード不要 |
| アクセス方法 | ブラウザから直接アクセス可 | WARP Client必須 |
| 可視性 | インターネット上から存在確認可 | 完全プライベート、外部から不可視 |
| 認証方式 | Cloudflare Access認証画面 | WARP Client + Zero Trust統合認証 |
| 用途 | Webアプリケーション向け | 非HTTPアプリケーション、ゲームサーバー向け |
| プロトコル | 主にHTTP/HTTPS | TCP/UDP含む任意のプロトコル |

### 2.2 プライベートホスト名の利点

1. **セキュリティ強化**
   - 公開DNSに存在しないため、攻撃対象として発見されにくい
   - WARP Clientなしではアクセス不可能（ゼロトラスト）
   - 認証済みデバイスのみがホスト名を解決可能

2. **ゲームサーバーに最適**
   - UDP/TCPプロトコルに完全対応
   - ブラウザベースの認証画面が不要
   - 低レイテンシー接続

3. **運用の簡素化**
   - 公開DNSレコード管理が不要
   - ドメイン所有権検証が不要
   - SSL証明書管理が不要（ゲームプロトコルのため）

4. **柔軟な名前空間**
   - `.internal` など任意のTLDを使用可能
   - 組織内部のネーミング規則に従った設計が可能

## 3. 要件定義

### 3.1 機能要件

1. **ゲームサーバー機能**
   - StarRuptureの専用サーバー実行
   - プレイヤー接続の受け入れ
   - ゲームセッションの管理

2. **アクセス制御**
   - Cloudflare Zero Trustによる認証
   - WARP Clientを使用したプライベートネットワークアクセス
   - 承認されたユーザーのみアクセス可能
   - プライベートホスト名による内部専用接続

3. **データ永続化**
   - ゲーム進行データの保存
   - バックアップとリストア機能
   - ログの収集と管理

4. **運用機能**
   - ヘルスチェック
   - メトリクス監視
   - 自動復旧

### 3.2 非機能要件

1. **可用性**: 99%のアップタイム目標
2. **セキュリティ**: プライベートネットワーク内での運用
3. **スケーラビリティ**: 必要に応じたリソース調整
4. **保守性**: GitOpsによる宣言的管理

## 4. システム設計

### 4.1 アーキテクチャ詳細

```
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│   Game Client   │    │ Cloudflare Zero     │    │ lolice cluster  │
│   + WARP Client │────│ Trust Network       │────│                 │
└─────────────────┘    │ (Private Hostname)  │    └─────────────────┘
                       └─────────────────────┘              │
                                 │                           │
                          ┌──────▼──────┐            ┌──────▼──────┐
                          │ CF Tunnel   │            │ StarRupture │
                          │ (Private)   │◄───────────│    Pod      │
                          └─────────────┘            │ UDP:7777    │
                                                     └─────────────┘

接続フロー:
1. ユーザーがWARP Clientを起動しCloudflare ZTに接続
2. プライベートホスト名 starrupture.internal を解決
3. Cloudflare Tunnelを経由してlolice cluster内のStarRuptureサーバーに接続
4. UDP 7777ポートでゲームセッションを確立
```

### 4.2 Terraform設定（boxp/arch）

#### 4.2.1 プライベートネットワーク設定 (terraform/cloudflare/b0xp.io/starrupture/)

**注意**: プライベートホスト名を使用するため、公開DNS（cloudflare_record）は作成しません。
代わりに、Cloudflare Zero TrustのSplit Tunnelとローカル名前解決を使用します。

#### 4.2.2 Tunnel設定（プライベートネットワーク用）

**tunnel.tf**
```hcl
# StarRupture専用プライベートトンネル
resource "cloudflare_zero_trust_tunnel_cloudflared" "starrupture_tunnel" {
  account_id = var.account_id
  name       = "starrupture-private-network"
  config_src = "cloudflare"
  secret     = base64encode(random_password.starrupture_tunnel_secret.result)
}

resource "random_password" "starrupture_tunnel_secret" {
  length  = 32
  special = false
}

# プライベートホスト名ルート設定
# このリソースがプライベートホスト名をトンネルにルーティングする鍵
resource "cloudflare_zero_trust_network_hostname_route" "starrupture_hostname" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.starrupture_tunnel.id
  hostname   = "starrupture.internal"
  comment    = "StarRupture dedicated server private hostname"
}

# トンネルIDとシークレットをSSMに保存
resource "aws_ssm_parameter" "starrupture_tunnel_id" {
  name        = "/starrupture/tunnel-id"
  description = "Cloudflare tunnel ID for StarRupture server"
  type        = "String"
  value       = cloudflare_zero_trust_tunnel_cloudflared.starrupture_tunnel.id

  tags = {
    Environment = "production"
    Application = "starrupture"
    ManagedBy   = "terraform"
  }
}

resource "aws_ssm_parameter" "starrupture_tunnel_secret" {
  name        = "/starrupture/tunnel-secret"
  description = "Cloudflare tunnel secret for StarRupture server"
  type        = "SecureString"
  value       = sensitive(random_password.starrupture_tunnel_secret.result)

  tags = {
    Environment = "production"
    Application = "starrupture"
    ManagedBy   = "terraform"
  }
}
```

**注意事項**:
- `cloudflare_zero_trust_tunnel_cloudflared` でトンネルを作成
- `cloudflare_zero_trust_network_hostname_route` でプライベートホスト名(`starrupture.internal`)をトンネルにルーティング
- プライベートホスト名では `cloudflare_tunnel_config` の ingress_rule は不要
- トンネルへのトラフィックは hostname route 経由で自動的にルーティングされます

#### 4.2.3 Zero Trust設定（プライベートネットワーク用）

**zero-trust.tf**
```hcl
# WARP Client設定（Gateway Proxyを有効化）
resource "cloudflare_zero_trust_device_settings" "starrupture_warp" {
  account_id                 = var.account_id
  gateway_proxy_enabled      = true
  gateway_udp_proxy_enabled  = true
  use_zt_virtual_ip          = true
}

# Gateway DNS Policy（プライベートホスト名へのアクセス制御）
resource "cloudflare_zero_trust_gateway_policy" "starrupture_dns_policy" {
  account_id  = var.account_id
  name        = "Allow StarRupture Private Hostname"
  description = "Allow DNS resolution for starrupture.internal via WARP"
  action      = "allow"
  precedence  = 1000
  enabled     = true
  filters     = ["dns"]

  # DNS query matching
  traffic = "dns.domains == \"starrupture.internal\""

  # 認証されたユーザーのみアクセス可能
  # identity = "any(identity.groups.name[*] in {\"authorized-users\"})"
}

# Gateway Network Policy（UDP トラフィック制御）
resource "cloudflare_zero_trust_gateway_policy" "starrupture_network_policy" {
  account_id  = var.account_id
  name        = "Allow StarRupture Game Traffic"
  description = "Allow UDP traffic to StarRupture server"
  action      = "allow"
  precedence  = 1001
  enabled     = true
  filters     = ["l4"]

  # Network traffic matching (UDP port 7777)
  traffic = "net.dst.ip == starrupture.internal and net.dst.port == 7777"
}
```

**注意事項**:
- `cloudflare_zero_trust_device_settings` でWARP ClientのGateway Proxyを有効化
- `gateway_udp_proxy_enabled = true` でUDPトラフィックのプロキシを有効化（ゲームサーバーに必須）
- `cloudflare_zero_trust_gateway_policy` でDNS解決とネットワークトラフィックを制御
- プライベートホスト名は自動的にWARP Client経由でのみ解決可能になります

#### 4.2.4 Variables設定

**variables.tf**
```hcl
variable "zone_id" {
  description = "Cloudflare zone ID for b0xp.io"
  type        = string
}

variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}
```

#### 4.2.5 TFAction設定

**tfaction.yaml**
```yaml
target:
  - "**"
terraform_plan_config:
  changed_files:
    - "**/*.tf"
    - "**/*.tfvars"
terraform_apply_config:
  changed_files:
    - "**/*.tf"  
    - "**/*.tfvars"
env:
  AWS_REGION: ap-northeast-1
```

**backend.tf**
```hcl
terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "terraform/cloudflare/b0xp.io/starrupture/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.15"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "cloudflare" {}
provider "aws" {
  region = "ap-northeast-1"
}
```

### 4.3 Kubernetes設定（boxp/lolice）

#### 4.3.1 External Secret設定

**external-secret.yaml**
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: starrupture-tunnel-credentials
  namespace: starrupture
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: starrupture-tunnel-credentials
    creationPolicy: Owner
  data:
  - secretKey: tunnel-id
    remoteRef:
      key: /starrupture/tunnel-id
  - secretKey: tunnel-secret
    remoteRef:
      key: /starrupture/tunnel-secret
```

#### 4.3.2 StarRupture Server Deployment

**starrupture-deployment.yaml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: starrupture-server
  namespace: starrupture
  labels:
    app: starrupture-server
spec:
  replicas: 1
  strategy:
    type: Recreate  # データ整合性のため単一インスタンス
  selector:
    matchLabels:
      app: starrupture-server
  template:
    metadata:
      labels:
        app: starrupture-server
    spec:
      containers:
      - name: starrupture-server
        image: struppinet/starrupture-dedicated-server:latest
        ports:
        - name: game-port
          containerPort: 7777
          protocol: UDP
        - name: query-port  
          containerPort: 27015
          protocol: UDP
        env:
        - name: STARRUPTURE_PORT
          value: "7777"
        - name: STARRUPTURE_QUERY_PORT
          value: "27015"
        - name: STARRUPTURE_MAX_PLAYERS
          value: "8"
        - name: STARRUPTURE_SERVER_NAME
          value: "boxp's StarRupture Server"
        volumeMounts:
        - name: starrupture-data
          mountPath: /home/steam/.steam/SteamApps/common/StarRupture/save
        - name: starrupture-config
          mountPath: /home/steam/.steam/SteamApps/common/StarRupture/config
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 2000m
            memory: 4Gi
        livenessProbe:
          tcpSocket:
            port: 7777
          initialDelaySeconds: 60
          periodSeconds: 30
        readinessProbe:
          tcpSocket:
            port: 7777
          initialDelaySeconds: 30
          periodSeconds: 10
      volumes:
      - name: starrupture-data
        persistentVolumeClaim:
          claimName: starrupture-data-pvc
      - name: starrupture-config
        configMap:
          name: starrupture-config
```

#### 4.3.3 Persistent Volume設定

**pvc.yaml**
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: starrupture-data-pvc
  namespace: starrupture
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: longhorn
  resources:
    requests:
      storage: 10Gi
```

#### 4.3.4 Service設定

**service.yaml**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: starrupture-server
  namespace: starrupture
spec:
  selector:
    app: starrupture-server
  ports:
  - name: game-port
    port: 7777
    targetPort: 7777
    protocol: TCP
  - name: query-port
    port: 27015
    targetPort: 27015
    protocol: UDP
  type: ClusterIP
```

#### 4.3.5 cloudflared Deployment

**cloudflared-deployment.yaml**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: starrupture-cloudflared
  namespace: starrupture
  labels:
    app: starrupture-cloudflared
spec:
  replicas: 1
  selector:
    matchLabels:
      app: starrupture-cloudflared
  template:
    metadata:
      labels:
        app: starrupture-cloudflared
    spec:
      containers:
      - name: cloudflared
        image: docker.io/cloudflare/cloudflared:latest
        args:
        - tunnel
        - --metrics
        - 0.0.0.0:2000
        - run
        - $(TUNNEL_ID)
        ports:
        - name: metrics
          containerPort: 2000
        env:
        - name: TUNNEL_ID
          valueFrom:
            secretKeyRef:
              name: starrupture-tunnel-credentials
              key: tunnel-id
        - name: TUNNEL_TOKEN
          valueFrom:
            secretKeyRef:
              name: starrupture-tunnel-credentials
              key: tunnel-secret
        livenessProbe:
          httpGet:
            path: /ready
            port: 2000
          failureThreshold: 1
          initialDelaySeconds: 10
          periodSeconds: 10
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
```

#### 4.3.6 ConfigMap設定

**configmap.yaml**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: starrupture-config
  namespace: starrupture
data:
  server.cfg: |
    # StarRupture Server Configuration
    hostname "boxp's StarRupture Server"
    maxplayers 8
    sv_password ""
    sv_public 0
    sv_region 255
  
  game.ini: |
    [Server]
    bDisableSeasonalEvents=False
    DifficultyOffset=0.200000
    OverrideDayTimeSpeedScale=False
    DayTimeSpeedScale=1.000000
```

#### 4.3.7 Namespace設定

**namespace.yaml**
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: starrupture
  labels:
    name: starrupture
    app: starrupture-server
```

### 4.4 アプリケーション設定

**kustomization.yaml**
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: starrupture

resources:
- namespace.yaml
- external-secret.yaml
- starrupture-deployment.yaml
- cloudflared-deployment.yaml
- service.yaml
- pvc.yaml
- configmap.yaml

images:
- name: struppinet/starrupture-dedicated-server
  newTag: latest

patchesStrategicMerge:
- overlays/resource-limits.yaml

configMapGenerator:
- name: starrupture-config
  files:
  - config/server.cfg
  - config/game.ini
```

## 5. 実装手順

### 5.1 Phase 1: Terraform実装（boxp/arch）

1. **Cloudflare Private Network設定作成**
   - プライベートトンネル、Split Tunnel、Gateway Policy設定をTerraformで定義
   - 公開DNSレコードは作成しない（プライベートホスト名のみ）
   - GitOpsにより自動的にplan/apply実行

2. **AWS SSMパラメータ確認**
   - トンネルトークンがSSMに正常に保存されることを確認

3. **Zero Trust設定確認**
   - Cloudflare Zero TrustダッシュボードでSplit Tunnel設定を確認
   - `starrupture.internal` がプライベートホスト名として登録されていることを確認

### 5.2 Phase 2: Kubernetes実装（boxp/lolice）

1. **Kubernetesマニフェスト作成**
   - Namespace、Deployment、Service等のマニフェストを定義
   - GitOpsによりクラスターへの自動反映

2. **デプロイ状況確認**
   - ArgoCD経由でのデプロイ状況監視
   - ポッドとサービスの動作確認

### 5.3 Phase 3: WARP Client設定とアクセステスト

1. **WARP Client設定**
   - Cloudflare WARP Clientをクライアント端末にインストール
   - GitHub認証でCloudflare Zero Trustにログイン
   - WARP接続を有効化

2. **プライベートホスト名解決確認**
   - `nslookup starrupture.internal` または `ping starrupture.internal` でDNS解決を確認
   - Cloudflare Tunnelを経由してlolice clusterに到達することを確認

3. **ゲーム接続テスト**
   - StarRuptureクライアントから `starrupture.internal:7777` に接続
   - サーバーリスト表示確認
   - ゲームセッション確立確認

## 6. テスト計画

### 5.1 機能テスト

1. **インフラテスト**
   - WARP Client経由のプライベートホスト名解決確認
   - Cloudflare Tunnel接続確認
   - Zero Trust認証テスト（GitHub OAuth）

2. **アプリケーションテスト**
   - ゲームサーバー起動確認
   - プレイヤー接続テスト（WARP Client経由）
   - UDP 7777ポート接続確認
   - セーブデータ永続化確認

3. **セキュリティテスト**
   - WARP Clientなしでのアクセス拒否確認
   - 未認証ユーザーのアクセス拒否確認
   - プライベートホスト名の外部からの不可視性確認
   - 不正アクセス試行の検出

### 6.2 運用テスト

1. **高可用性テスト**
   - Pod再起動テスト
   - ノード障害時の挙動確認
   - データ復旧テスト

2. **パフォーマンステスト**
   - 複数プレイヤー同時接続
   - レスポンス時間測定
   - リソース使用量監視

## 7. 運用計画

### 7.1 監視

1. **インフラ監視**
   - Cloudflare Tunnel接続状態
   - Kubernetes Pod健全性
   - リソース使用率

2. **アプリケーション監視**
   - ゲームサーバープロセス状態
   - プレイヤー接続数
   - エラーログ監視

### 7.2 バックアップ・復旧

1. **セーブデータバックアップ**
   - 日次自動バックアップ
   - Longhornスナップショット活用
   - S3への定期バックアップ

2. **設定バックアップ**
   - Kubernetesマニフェストのバージョン管理
   - Terraform状態ファイルバックアップ

### 7.3 メンテナンス

1. **定期更新**
   - Dockerイメージ更新
   - ゲームクライアント互換性確認
   - セキュリティパッチ適用

2. **スケールアウト**
   - 利用状況に応じたリソース調整
   - 複数インスタンスの検討
   - ロードバランサー導入検討

## 8. リスク管理

| リスク | 影響度 | 対策 |
|--------|--------|------|
| Dockerイメージ更新停止 | 高 | 代替イメージの検討、自作イメージビルド |
| Cloudflare障害 | 中 | 代替アクセス手段の準備 |
| ストレージ障害 | 高 | 定期バックアップとレプリケーション |
| 不正アクセス | 中 | アクセス制御とログ監視強化 |

## 9. 将来拡張計画

### 9.1 短期拡張（3ヶ月以内）

1. **マルチサーバー対応**
   - 複数のゲームモード用サーバー
   - ロードバランサー統合

2. **監視ダッシュボード**
   - Grafanaダッシュボード構築
   - アラート設定

### 9.2 中期拡張（6ヶ月以内）

1. **自動スケーリング**
   - プレイヤー数に応じた自動スケールアウト
   - コスト最適化

2. **バックアップ自動化**
   - セーブデータの自動バックアップ・復元
   - Point-in-time recovery

### 9.3 長期拡張（1年以内）

1. **マルチクラウド対応**
   - 複数クラウドでの冗長化
   - ディザスターリカバリ

2. **コミュニティ機能**
   - Web管理画面
   - プレイヤー統計
   - イベント管理

## 10. まとめ

本設計により、StarRupture専用サーバーをセキュアかつスケーラブルに運用できる環境が構築されます。

### 主な特徴

1. **プライベートホスト名によるセキュリティ強化**
   - 公開DNSに存在しない完全プライベートな接続
   - WARP Clientによるゼロトラスト認証
   - インターネットからの直接アクセスを完全にブロック

2. **ゲームサーバーに最適化されたアーキテクチャ**
   - UDP/TCPプロトコルの完全サポート
   - 低レイテンシー接続
   - Cloudflare Tunnelによる安全なトラフィック転送

3. **運用の簡素化**
   - GitOpsによる宣言的インフラ管理
   - Kubernetesによる自動復旧と高可用性
   - 公開DNSやSSL証明書の管理が不要

4. **段階的な実装と検証**
   - Phase 1: Terraform設定によるインフラ構築
   - Phase 2: Kubernetes設定によるアプリケーションデプロイ
   - Phase 3: WARP Clientによるアクセステスト

実装は段階的に行い、各フェーズでの動作確認を徹底することで、安定したゲーム環境を提供します。