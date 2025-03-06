# OpenHands on lolice Kubernetes クラスター設計ドキュメント

## 1. 概要

このドキュメントでは、lolice Kubernetesクラスターに新しくOpenHandsをホスティングするための詳細な設計と実装計画を提供します。OpenHandsは、AIを活用したソフトウェア開発支援プラットフォームで、開発者が効率的にコードを作成・修正できるようサポートします。

## 2. アーキテクチャ概要

OpenHandsのホスティングは以下のコンポーネントで構成されます：

1. **CloudflareのDNSとTunnel**: `openhands.b0xp.io`ドメインでのアクセス提供
2. **Cloudflare Access**: GitHub認証による安全なアクセス制御
3. **Kubernetes上のOpenHandsデプロイメント**: 専用のNamespaceでの実行
4. **永続ストレージ**: Longhornを使用したデータ永続化
5. **Dockerソケット連携**: サンドボックス環境のための特別なノード構成

### 2.1 システム構成図

```
[ユーザー] --> [Cloudflare (DNS/Access)] --> [Cloudflare Tunnel] --> [lolice K8s Cluster]
                                                                       |
                                                                       |--> [Namespace: openhands]
                                                                            |
                                                                            |--> [OpenHands Deployment]
                                                                            |    |
                                                                            |    |--> [Volume: Docker Socket]
                                                                            |    |--> [Volume: State Data]
                                                                            |    |--> [Volume: Workspace Data]
                                                                            |
                                                                            |--> [cloudflared Deployment]
```

## 3. Cloudflareの設定

### 3.1 DNSレコードの設定

Cloudflareの`b0xp.io`ドメイン内に`openhands.b0xp.io`サブドメインを作成し、Cloudflare Tunnelを指し示すCNAMEレコードとして設定します。

```hcl
resource "cloudflare_record" "openhands" {
  zone_id = var.zone_id
  name    = "openhands"
  value   = cloudflare_tunnel.openhands_tunnel.cname
  type    = "CNAME"
  proxied = true
}
```

### 3.2 Cloudflare Tunnelの設定

安全なトンネル接続のためのCloudflare Tunnelを設定します。

```hcl
resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_tunnel" "openhands_tunnel" {
  account_id = var.account_id
  name       = "cloudflare openhands tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_tunnel_config" "openhands_tunnel" {
  tunnel_id  = cloudflare_tunnel.openhands_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.openhands.hostname
      service  = "http://openhands-service.openhands.svc.cluster.local:80"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# トークンをAWS Systems Managerパラメータストアに保存
resource "aws_ssm_parameter" "openhands_tunnel_token" {
  name        = "openhands-tunnel-token"
  description = "for openhands tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.openhands_tunnel.tunnel_token)
}
```

### 3.3 Cloudflare Accessの認証設定

GitHub認証を用いたCloudflare Accessを設定し、特定の認証済みユーザーのみがサービスにアクセスできるようにします。

```hcl
resource "cloudflare_access_application" "openhands" {
  zone_id          = var.zone_id
  name             = "Access application for openhands.b0xp.io"
  domain           = "openhands.b0xp.io"
  session_duration = "24h"
}

data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

resource "cloudflare_access_policy" "openhands_policy" {
  application_id = cloudflare_access_application.openhands.id
  zone_id        = var.zone_id
  name           = "policy for openhands.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}
```

## 4. Kubernetesリソース設計

### 4.1 Namespace

OpenHandsには専用のNamespaceを使用します：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: openhands
```

### 4.2 Persistent Volume Claims

OpenHandsには２つのPVCが必要です：
1. State Data用（OpenHandsの状態データ）
2. Workspace Data用（ユーザーのワークスペースデータ）

```yaml
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: openhands-state-pvc
  namespace: openhands
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: longhorn
  resources:
    requests:
      storage: 5Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: openhands-data
  namespace: openhands
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: longhorn
  resources:
    requests:
      storage: 5Gi
```

### 4.3 Deployment

OpenHandsのデプロイメント設定では、Docker Socketを使用するため特定のノード（golyat-1）に限定します。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openhands
  namespace: openhands
spec:
  replicas: 1
  selector:
    matchLabels:
      app: openhands
  template:
    metadata:
      labels:
        app: openhands
    spec:
      containers:
      - name: openhands
        image: docker.all-hands.dev/all-hands-ai/openhands:0.27
        ports:
        - containerPort: 3000
        env:
        - name: SANDBOX_RUNTIME_CONTAINER_IMAGE
          value: docker.all-hands.dev/all-hands-ai/runtime:0.27-nikolaik
        - name: WORKSPACE_MOUNT_PATH
          value: /opt/workspace_base
        volumeMounts:
        - name: docker-sock
          mountPath: /var/run/docker.sock
        - name: openhands-state
          mountPath: /.openhands-state
        - name: workspace
          mountPath: /opt/workspace_base
        resources:
          requests:
            memory: "2Gi"
            cpu: "500m"
          limits:
            memory: "4Gi"
            cpu: "1000m"
      volumes:
      - name: docker-sock
        hostPath:
          path: /var/run/docker.sock
          type: Socket
      - name: openhands-state
        persistentVolumeClaim:
          claimName: openhands-state-pvc
      - name: workspace
        persistentVolumeClaim:
          claimName: openhands-data
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: kubernetes.io/hostname
                operator: In
                values:
                - golyat-1
```

### 4.4 Service

OpenHandsサービスの定義：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: openhands-service
  namespace: openhands
spec:
  selector:
    app: openhands
  ports:
  - port: 80
    targetPort: 3000
```

### 4.5 cloudflared Deployment

Cloudflare Tunnelを使用するためのcloudflaredデプロイメント：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
  namespace: openhands
spec:
  selector:
    matchLabels:
      app: cloudflared
  replicas: 1
  template:
    metadata:
      labels:
        app: cloudflared
    spec:
      containers:
      - name: cloudflared
        image: docker.io/cloudflare/cloudflared:latest
        ports:
          - name: metrics
            containerPort: 2000
        args:
        - tunnel
        - --metrics
        - 0.0.0.0:2000
        - run
        - --token
        - $(TUNNEL_TOKEN)
        livenessProbe:
          httpGet:
            path: /ready
            port: 2000
          failureThreshold: 1
          initialDelaySeconds: 10
          periodSeconds: 10
        env:
          - name: TUNNEL_TOKEN
            valueFrom:
              secretKeyRef:
                name: tunnel-credentials
                key: tunnel-token
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: kubernetes.io/hostname
                operator: NotIn
                values:
                - golyat-1  # golyat-1ノードはOpenHandsに使用するため、cloudflaredは他のノードにスケジュールする
```

### 4.6 External Secret

Cloudflare Tunnelトークンを取得するためのExternal Secret定義：

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: external-secret
  namespace: openhands
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: tunnel-credentials
    creationPolicy: Owner
  data:
  - secretKey: tunnel-token
    remoteRef:
      conversionStrategy: Default	
      decodingStrategy: None	
      key: openhands-tunnel-token
      metadataPolicy: None
```

### 4.7 (オプション) Priority Class

## 5. Docker Socket セキュリティとリソース管理

### 5.1 セキュリティ上の懸念点

OpenHandsはDockerソケットを利用するため、以下のセキュリティリスクがあります：

1. **特権昇格のリスク**: Dockerソケットアクセスによる潜在的なホストノードへの特権アクセス
2. **Kubernetes抽象化のバイパス**: Kubernetesスケジューラ管理外のコンテナ起動
3. **リソース管理の問題**: ディスク容量の過剰使用

### 5.2 golyat-1ノードの専用利用

セキュリティ上の理由から、すでにDocker Socket操作を許可しているgolyat-1ノードを使用します。このノードはすでにpalserverプロジェクトに使用されており、Docker Socket操作が必要なワークロードを集約することでセキュリティ管理が容易になります。

### 5.3 リソース共有の考慮事項

golyat-1ノードではすでにpalserverが以下のリソースを使用しています：

```yaml
resources:
  limits:
    cpu: 3500m
    memory: 24Gi
  requests: 
    cpu: 1000m
    memory: 8Gi
```

OpenHandsとpalserverが共存できるよう、OpenHandsには以下のリソース制限を設定します：

```yaml
resources:
  requests:
    cpu: 500m
    memory: 2Gi
  limits:
    cpu: 1000m
    memory: 4Gi
```

### 5.4 追加のセキュリティ対策オプション

1. **Docker Socket Proxy**: 限定的なAPIアクセスのみを許可するプロキシの検討
2. **Pod Security Policy/Admission**: OpenHandsポッドのみにDocker Socketアクセスを許可
3. **リソースモニタリング**: golyat-1ノードのリソース使用状況の継続的な監視

## 6. Argo CDによる管理

### 6.1 Application定義

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: openhands
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/boxp/lolice
    targetRevision: main
    path: argoproj/openhands
  destination:
    server: https://kubernetes.default.svc
    namespace: openhands
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
      - Replace=true
      - ServerSideApply=true
```

### 6.2 リポジトリ構造

```
/lolice/
└── argoproj/
    └── openhands/
        ├── namespace.yaml
        ├── pvc.yaml
        ├── deployment.yaml
        ├── service.yaml
        ├── external-secret.yaml
        ├── cloudflared-deployment.yaml
        └── priorityclass.yaml (オプション)
```

## 7. OpenHandsの詳細

### 7.1 システム概要

OpenHands（以前の名称：OpenDevin）は、AIを活用したソフトウェア開発支援プラットフォームです。コードの作成、修正、コマンド実行、ウェブ閲覧、API呼び出しなど、開発者のタスクを自動化します。

### 7.2 システム要件

- モダンなプロセッサ
- 最低4GB RAM
- Docker環境

### 7.3 機能と特徴

- AIによるコード作成・修正支援
- サンドボックス環境での安全な実行
- 様々なLLMプロバイダーとの統合
- ウェブブラウジング機能
- API呼び出し機能

## 8. 運用上の考慮事項

### 8.1 バックアップ戦略

- PVCデータの定期バックアップ
- 重要設定のバックアップ

### 8.2 モニタリングとロギング

- golyat-1ノードのリソース使用状況の監視
- OpenHandsコンテナのログ監視
- Docker操作のセキュリティ監査

### 8.3 アップデート管理

- OpenHandsイメージの更新手順
- 設定変更の管理方法

## 9. 実装計画

### 9.1 フェーズ1: インフラ準備

1. Terraformコードを作成してCloudflare設定を実装
2. AWS SSM Parameterの設定

### 9.2 フェーズ2: Kubernetes リソース作成

1. 各Kubernetesマニフェストファイルの作成
2. loliceリポジトリへの追加

### 9.3 フェーズ3: デプロイとテスト

1. Argo CD経由でのデプロイ
2. アクセスのテスト
3. OpenHandsの初期設定

### 9.4 フェーズ4: 監視と運用開始

1. モニタリングの設定
2. バックアップの設定
3. 運用ドキュメントの更新

## 10. セキュリティ考慮事項

1. Docker Socketアクセスの限定と監視
2. GitHub認証によるアクセス制御
3. ノード分離によるセキュリティ境界の確立
4. 定期的なセキュリティレビュー

## 11. 結論

このドキュメントはOpenHandsをlolice Kubernetesクラスターに安全かつ効率的にホスティングするための設計と実装計画を提供します。Docker Socketを使用する特殊性を考慮し、専用ノードでの運用とリソース管理に重点を置いた設計となっています。

## 付録: 参考リソース

- [OpenHands GitHub リポジトリ](https://github.com/All-Hands-AI/OpenHands)
- [Cloudflare Tunnel ドキュメント](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Kubernetes Security Best Practices](https://kubernetes.io/docs/concepts/security/security-best-practices/)
