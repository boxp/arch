# StarRupture専用サーバー 実装設計書

## 概要

本プロジェクトは、lolice Kubernetesクラスター上でStarRupture専用サーバーをホスティングし、Cloudflare Zero Trustを通じてプライベートアクセスを提供することを目的とします。これにより、安全でスケーラブルなゲームサーバー環境を構築します。

## 1. 設計方針

### 1.1 アーキテクチャ概要

```
GitHub ⟷ Cloudflare Tunnel ⟷ lolice k8s cluster ⟷ StarRupture Server Pod
```

1. **Dockerイメージ**: `struppinet/starrupture-dedicated-server`を利用
2. **アクセス制御**: Cloudflare Zero Trust（CF ZT）によるプライベートアクセス
3. **インフラ管理**: boxp/arch（Terraform）+ boxp/lolice（Kubernetes）
4. **シークレット管理**: AWS SSM Parameter Store + External Secrets Operator

### 1.2 技術スタック

**インフラ層（boxp/arch）**
- **DNS**: Cloudflare DNS（`starrupture.b0xp.io`）
- **Tunnel**: Cloudflare Tunnel（プライベートアクセス用）
- **Access Control**: Cloudflare Zero Trust Access
- **Secret Management**: AWS SSM Parameter Store

**アプリケーション層（boxp/lolice）**
- **Container**: Docker（`struppinet/starrupture-dedicated-server`）
- **Orchestration**: Kubernetes Deployment
- **Storage**: Persistent Volume（セーブデータ永続化）
- **Secret Sync**: External Secrets Operator

## 2. 要件定義

### 2.1 機能要件

1. **ゲームサーバー機能**
   - StarRuptureの専用サーバー実行
   - プレイヤー接続の受け入れ
   - ゲームセッションの管理

2. **アクセス制御**
   - Cloudflare Zero Trustによる認証
   - 承認されたユーザーのみアクセス可能
   - VPNレス接続

3. **データ永続化**
   - ゲーム進行データの保存
   - バックアップとリストア機能
   - ログの収集と管理

4. **運用機能**
   - ヘルスチェック
   - メトリクス監視
   - 自動復旧

### 2.2 非機能要件

1. **可用性**: 99%のアップタイム目標
2. **セキュリティ**: プライベートネットワーク内での運用
3. **スケーラビリティ**: 必要に応じたリソース調整
4. **保守性**: GitOpsによる宣言的管理

## 3. システム設計

### 3.1 アーキテクチャ詳細

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Game Client   │────│ Cloudflare ZT   │────│ lolice cluster  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                         │
                              │                         │
                        ┌─────▼─────┐            ┌─────▼─────┐
                        │  CF Tunnel │            │StarRupture│
                        │    DNS     │            │   Pod     │
                        └───────────┘            └───────────┘
```

### 3.2 Terraform設定（boxp/arch）

#### 3.2.1 DNS設定 (terraform/cloudflare/b0xp.io/starrupture/)

**dns.tf**
```hcl
resource "cloudflare_record" "starrupture_server" {
  zone_id = var.zone_id
  name    = "starrupture"
  value   = cloudflare_tunnel.starrupture_tunnel.cname
  type    = "CNAME"
  proxied = true

  comment = "StarRupture dedicated server endpoint"
}
```

#### 3.2.2 Tunnel設定

**tunnel.tf**
```hcl
# StarRupture専用トンネル
resource "cloudflare_tunnel" "starrupture_tunnel" {
  account_id = var.account_id
  name       = "starrupture-dedicated-server"
  secret     = sensitive(base64sha256(random_password.starrupture_tunnel_secret.result))
}

resource "random_password" "starrupture_tunnel_secret" {
  length = 32
}

# トンネル設定
resource "cloudflare_tunnel_config" "starrupture_tunnel" {
  tunnel_id  = cloudflare_tunnel.starrupture_tunnel.id
  account_id = var.account_id

  config {
    ingress_rule {
      hostname = cloudflare_record.starrupture_server.hostname
      service  = "tcp://starrupture-server:7777"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# トンネルトークンをSSMに保存
resource "aws_ssm_parameter" "starrupture_tunnel_token" {
  name        = "/starrupture/tunnel-token"
  description = "Cloudflare tunnel token for StarRupture server"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.starrupture_tunnel.tunnel_token)
  
  tags = {
    Environment = "production"
    Application = "starrupture"
    ManagedBy   = "terraform"
  }
}
```

#### 3.2.3 アクセス制御設定

**access.tf**
```hcl
# StarRupture用のアクセスアプリケーション
resource "cloudflare_access_application" "starrupture_server" {
  zone_id          = var.zone_id
  name             = "StarRupture Dedicated Server"
  domain           = "starrupture.b0xp.io"
  session_duration = "24h"
  
  tags = ["starrupture", "gaming", "private"]
}

# 承認されたユーザーのみアクセス可能
resource "cloudflare_access_policy" "starrupture_users" {
  application_id = cloudflare_access_application.starrupture_server.id
  zone_id        = var.zone_id
  name           = "StarRupture Authorized Users"
  precedence     = "1"
  decision       = "allow"

  include {
    email = ["boxp@users.noreply.github.com"]
  }
  
  # 必要に応じて追加ユーザーを定義
  include {
    group = [cloudflare_access_group.starrupture_players.id]
  }
}

# プレイヤーグループの定義
resource "cloudflare_access_group" "starrupture_players" {
  zone_id = var.zone_id
  name    = "StarRupture Players"
  
  include {
    email_domain = ["trusted-friends.com"]
  }
}
```

#### 3.2.4 Variables設定

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

#### 3.2.5 TFAction設定

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
      version = "= 4.52.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.7.1"
    }
  }
}

provider "cloudflare" {}
provider "aws" {
  region = "ap-northeast-1"
}
```

### 3.3 Kubernetes設定（boxp/lolice）

#### 3.3.1 External Secret設定

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
  - secretKey: tunnel-token
    remoteRef:
      key: /starrupture/tunnel-token
```

#### 3.3.2 StarRupture Server Deployment

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
          protocol: TCP
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

#### 3.3.3 Persistent Volume設定

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

#### 3.3.4 Service設定

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

#### 3.3.5 cloudflared Deployment

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
        - --token
        - $(TUNNEL_TOKEN)
        ports:
        - name: metrics
          containerPort: 2000
        env:
        - name: TUNNEL_TOKEN
          valueFrom:
            secretKeyRef:
              name: starrupture-tunnel-credentials
              key: tunnel-token
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

#### 3.3.6 ConfigMap設定

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

#### 3.3.7 Namespace設定

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

### 3.4 アプリケーション設定

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

## 4. 実装手順

### 4.1 Phase 1: Terraform実装（boxp/arch）

1. **Cloudflare設定作成**
   ```bash
   cd terraform/cloudflare/b0xp.io/starrupture
   # DNS、Tunnel、Access設定の実装
   terraform init
   terraform plan
   terraform apply
   ```

2. **AWS SSMパラメータ確認**
   ```bash
   aws ssm get-parameter --name "/starrupture/tunnel-token" --with-decryption
   ```

### 4.2 Phase 2: Kubernetes実装（boxp/lolice）

1. **Namespace作成**
   ```bash
   kubectl create namespace starrupture
   ```

2. **External Secrets適用**
   ```bash
   kubectl apply -f external-secret.yaml
   kubectl get secret starrupture-tunnel-credentials -n starrupture
   ```

3. **StarRuptureサーバーデプロイ**
   ```bash
   kubectl apply -k .
   ```

4. **デプロイ状況確認**
   ```bash
   kubectl get pods -n starrupture
   kubectl logs -f deployment/starrupture-server -n starrupture
   ```

### 4.3 Phase 3: アクセステスト

1. **Cloudflare Accessログイン**
   - https://starrupture.b0xp.io にアクセス
   - Cloudflare Zero Trust認証を通過

2. **ゲーム接続テスト**
   - StarRuptureクライアントから接続
   - サーバーリスト表示確認

## 5. テスト計画

### 5.1 機能テスト

1. **インフラテスト**
   - DNS解決確認
   - Tunnel接続確認
   - Access認証テスト

2. **アプリケーションテスト**
   - ゲームサーバー起動確認
   - プレイヤー接続テスト
   - セーブデータ永続化確認

3. **セキュリティテスト**
   - 未認証アクセスの拒否確認
   - VPNなしアクセステスト
   - 不正アクセス試行の検出

### 5.2 運用テスト

1. **高可用性テスト**
   - Pod再起動テスト
   - ノード障害時の挙動確認
   - データ復旧テスト

2. **パフォーマンステスト**
   - 複数プレイヤー同時接続
   - レスポンス時間測定
   - リソース使用量監視

## 6. 運用計画

### 6.1 監視

1. **インフラ監視**
   - Cloudflare Tunnel接続状態
   - Kubernetes Pod健全性
   - リソース使用率

2. **アプリケーション監視**
   - ゲームサーバープロセス状態
   - プレイヤー接続数
   - エラーログ監視

### 6.2 バックアップ・復旧

1. **セーブデータバックアップ**
   - 日次自動バックアップ
   - Longhornスナップショット活用
   - S3への定期バックアップ

2. **設定バックアップ**
   - Kubernetesマニフェストのバージョン管理
   - Terraform状態ファイルバックアップ

### 6.3 メンテナンス

1. **定期更新**
   - Dockerイメージ更新
   - ゲームクライアント互換性確認
   - セキュリティパッチ適用

2. **スケールアウト**
   - 利用状況に応じたリソース調整
   - 複数インスタンスの検討
   - ロードバランサー導入検討

## 7. リスク管理

| リスク | 影響度 | 対策 |
|--------|--------|------|
| Dockerイメージ更新停止 | 高 | 代替イメージの検討、自作イメージビルド |
| Cloudflare障害 | 中 | 代替アクセス手段の準備 |
| ストレージ障害 | 高 | 定期バックアップとレプリケーション |
| 不正アクセス | 中 | アクセス制御とログ監視強化 |

## 8. 将来拡張計画

### 8.1 短期拡張（3ヶ月以内）

1. **マルチサーバー対応**
   - 複数のゲームモード用サーバー
   - ロードバランサー統合

2. **監視ダッシュボード**
   - Grafanaダッシュボード構築
   - アラート設定

### 8.2 中期拡張（6ヶ月以内）

1. **自動スケーリング**
   - プレイヤー数に応じた自動スケールアウト
   - コスト最適化

2. **バックアップ自動化**
   - セーブデータの自動バックアップ・復元
   - Point-in-time recovery

### 8.3 長期拡張（1年以内）

1. **マルチクラウド対応**
   - 複数クラウドでの冗長化
   - ディザスターリカバリ

2. **コミュニティ機能**
   - Web管理画面
   - プレイヤー統計
   - イベント管理

## 9. まとめ

本設計により、StarRupture専用サーバーをセキュアかつスケーラブルに運用できる環境が構築されます。Cloudflare Zero Trustによるプライベートアクセスと、Kubernetesによる高可用性を実現し、継続的な運用とメンテナンスを可能にします。

実装は段階的に行い、各フェーズでの動作確認を徹底することで、安定したゲーム環境を提供します。