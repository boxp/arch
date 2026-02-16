# openhands.b0xp.io ホスティング準備

## 概要

このドキュメントでは、lolice k8sクラスターに新しくopenhandsをホスティングするための準備情報をまとめています。

## 1. Cloudflare上でのホスティング設定

### 1.1 DNSレコードの作成

Cloudflareの`b0xp.io`ドメイン内に`openhands.b0xp.io`サブドメインを作成します。これはCloudflare Tunnelのレコードを指し示すCNAMEレコードとして設定します。

参考実装（他のサービスの例）:
```hcl
resource "cloudflare_record" "openhands" {
  zone_id = var.zone_id
  name    = "openhands"
  value   = cloudflare_tunnel.openhands_tunnel.cname
  type    = "CNAME"
  proxied = true
}
```

### 1.2 Cloudflare Tunnelの設定

K8sクラスターへの接続はCloudflare Tunnelを使用して行います。これにより外部からの直接アクセスを遮断しながら、Cloudflareを経由したセキュアなアクセスが可能になります。

参考実装:
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

### 1.3 cloudflaredの設定

Cloudflare Tunnelを実際に利用するには、Kubernetes内にcloudflaredを実行するDeploymentが必要です。外部シークレットからトークンを取得してTunnelに接続します。

#### 1.3.1 ExternalSecret定義

AWS SSM ParameterにあるTunnelトークンをKubernetes Secretに取得します。

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

#### 1.3.2 cloudflared Deployment定義

トークンをマウントしてCloudflare Tunnelを実行します。

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

## 2. Cloudflare Accessによる認証設定

Cloudflare Accessを使用してGitHub認証を設定します。これにより、特定のGitHubユーザーのみがopenhandsにアクセスできるようになります。

参考実装:
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

## 3. K8sクラスターへのArgo Projectとしての追加

### 3.1 Application定義の作成

openhandsをArgo CDプロジェクトとして追加するためのApplication定義を作成します。

参考実装：
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: openhands
  namespace: argocd
spec:
  project: default
  sources:
    - chart: [OPENHANDS_CHART_NAME]
      repoURL: [OPENHANDS_CHART_REPO_URL]
      targetRevision: [VERSION]
      helm:
        values: |
          # ここにHelmチャートの値を設定
    - path: argoproj/openhands
      repoURL: https://github.com/boxp/lolice
      targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: openhands
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
      - Replace=true
      - ServerSideApply=true
```

### 3.2 リポジトリ構造

loliceリポジトリに以下のディレクトリ構造を作成します：

```
/lolice/
└── argoproj/
    └── openhands/
        ├── application.yaml     # Argo CDアプリケーション定義
        └── values.yaml          # Helmチャートの値
```

## 4. 永続ストレージの設定

openhandsには5GBのpersistent storageを割り当てます。K8sクラスターのストレージにはLonghornを使用します。

### 4.1 PersistentVolumeClaim定義

参考実装:
```yaml
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

### 4.2 Deployment/StatefulSetにおけるボリュームマウント

参考実装:
```yaml
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: openhands-data
volumeMounts:
  - name: data
    mountPath: /data
```

## 5. OpenHandsの導入方法の詳細

### 5.1 OpenHandsの概要とその歴史

OpenHands（以前の名称：OpenDevin）は、AIを活用したソフトウェア開発支援プラットフォームです。これにより、コードの作成、修正、コマンドの実行、ウェブの閲覧、APIの呼び出しなど、人間の開発者と同様のタスクを自動化できます。

#### OpenDevinからOpenHandsへの名称変更

プロジェクトは当初「OpenDevin」という名前で2024年初頭に公開されましたが、その後「OpenHands」に改名されました。公式GitHub リポジトリのREADMEによると、現在は「OpenHands (formerly OpenDevin)」と記載されています。この名称変更は、プロジェクトの方向性やブランドを再定義するために行われたものと考えられます。

> 出典：[GitHub - All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)

リポジトリの所有者も「All-Hands-AI」であり、名称変更と組織変更が同時に行われたことが伺えます。「All-Hands」（全ての手）という組織名とプロジェクト名の「OpenHands」（開かれた手）の一貫性から、ブランディングの統一を図ったと考えられます。

### 5.2 システム要件

OpenHandsを実行するための最小システム要件：
- モダンなプロセッサ
- 最低4GB RAM
- Dockerがインストールされた環境
  - Linux（Ubuntu 22.04でテスト済み）
  - MacOS
  - Windows with WSL2

### 5.3 Kubernetes上での展開方法

OpenDevin/OpenHandsは公式にはDockerでの実行方法のみが提供されていますが、以下の方法でKubernetesクラスターにデプロイすることが可能です：

#### 5.3.1 Docker Compose YAMLからKubernetesマニフェストへの変換

OpenHandsの公式リポジトリにあるdocker-compose.ymlファイルを基に、Komposeツールを使用してKubernetesマニフェストに変換することができます：

```yaml
# OpenHandsのDocker Compose定義（参考）
services:
  openhands:
    build:
      context: ./
      dockerfile: ./containers/app/Dockerfile
    image: docker.all-hands.dev/all-hands-ai/openhands:0.27
    container_name: openhands-app
    environment:
      - SANDBOX_RUNTIME_CONTAINER_IMAGE=docker.all-hands.dev/all-hands-ai/runtime:0.27-nikolaik
      - WORKSPACE_MOUNT_PATH=/opt/workspace_base
    ports:
      - "3000:3000"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ~/.openhands-state:/.openhands-state
      - ${WORKSPACE_BASE:-$PWD/workspace}:/opt/workspace_base
    stdin_open: true
    tty: true
```

> 出典：[OpenHands Docker Compose定義](https://github.com/All-Hands-AI/OpenHands/blob/main/docker-compose.yml)

このDocker Compose定義から以下のKubernetesマニフェストを作成します：

#### 5.3.2 Deployment定義

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
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
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
```

#### 5.3.3 Service定義

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

#### 5.3.4 PersistentVolumeClaim定義（状態データ用）

```yaml
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
```

### 5.4 注意事項と制限

1. **Docker内Docker（DinD）の扱い**:
   - OpenHandsはDockerを使用してサンドボックス環境を作成します。K8s環境では、ホストのDocker socketをマウントする方法が必要です。
   - セキュリティの観点から、専用のノードプールとNodeSelectorを使用して、OpenHands用のノードを分離することを推奨します。

2. **マルチテナント非対応**:
   - 公式ドキュメントによると、OpenHandsは単一ユーザーのローカルワークステーションでの使用を想定しており、マルチテナント環境での使用は推奨されていません。
   - マルチテナント環境が必要な場合は、ユーザーごとに個別のインスタンスを用意するか、商用サポートに問い合わせることが推奨されています。

   > 出典：[OpenHands Quick Start Guide](https://github.com/All-Hands-AI/OpenHands#quick-start)

3. **リソース要件**:
   - OpenHandsはCPUとメモリを消費します。Kubernetes環境では適切なリソース制限を設定することが重要です。
   - 最低でも4GBのRAMが推奨されています。

### 5.5 Docker Socket のセキュリティリスクと対策

OpenHandsはDockerソケット（`/var/run/docker.sock`）を使用してサンドボックス環境を作成します。Kubernetes環境でDockerソケットをマウントすることには、以下のような重大なセキュリティリスクがあります：

1. **特権昇格のリスク**:
   - Dockerソケットにアクセスできるコンテナは、実質的にホストノード上でroot権限を持つことができます。
   - これにより、コンテナのエスケープやクラスター全体への攻撃が可能になる可能性があります。

2. **Kubernetes抽象化のバイパス**:
   - Dockerソケットを経由して起動されたコンテナはKubernetesスケジューラーの管理外にあります。
   - これにより、クラスターの信頼性やパフォーマンスに悪影響を与える可能性があります。

   > 出典：[Red Hat Statement on Docker Socket Usage](https://stackoverflow.com/questions/48475616/option-for-securing-docker-socket)（Red Hatの声明）:
   > 「コンテナにDockerソケットをボリュームマウントすることはRed Hatではサポートされていません。これは完全に可能ですが（他のボリュームマウントと同様に）、Red Hatはこの設定を使用した構成、この設定が原因で発生した問題、またはこの設定に関するセキュリティの影響/懸念については支援できません。」

3. **リソース管理の問題**:
   - Kubernetesはホストパスボリュームの使用をエフェメラルストレージとして扱いません。
   - Dockerソケットを通じて作成された多数のイメージにより、ノードのディスク容量が圧迫される可能性があります。

#### Docker Socketを安全に扱うためのgolyat-1ノードの使用

現在、クラスター内の`golyat-1`ノードは、すでにpalserverプロジェクトによってDocker Socket操作が必要なワークロードに専用で使用されています。パフォーマンスとセキュリティ上の理由から、OpenHandsも同じノードを使用するべきです。palserverのデプロイメント設定を参考に、以下のような`nodeAffinity`設定を追加します：

```yaml
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

この設定により、OpenHandsポッドは必ずgolyat-1ノード上でスケジュールされ、他のノードへの潜在的なセキュリティリスクを限定することができます。また、Docker Socket操作が必要なワークロードを単一ノードに集約することで、セキュリティ監視とリソース管理が容易になります。

#### golyat-1ノード上でのリソース考慮事項

golyat-1ノードは現在、palserverワークロードに使用されています。palserverの設定では、以下のようなリソース要件が指定されています：

```yaml
resources:
  limits:
    cpu: 3500m
    memory: 24Gi
  requests: 
    cpu: 1000m
    memory: 8Gi
```

OpenHandsをgolyat-1ノードに展開する際は、palserverとのリソース競合を避けるために、以下の点に注意する必要があります：

1. **リソース要件の調整**：
   - OpenHandsのリソース要件を適切に設定し、golyat-1ノードの残りのリソースを超過しないようにします。
   - 例えば、初期の設定としては以下のようなリソース制限が適切かもしれません：

   ```yaml
   resources:
     requests:
       cpu: 500m
       memory: 2Gi
     limits:
       cpu: 1000m
       memory: 4Gi
   ```

2. **リソースの監視**：
   - golyat-1ノード上のリソース使用状況を定期的に監視し、必要に応じて調整します。
   - 特に、Docker操作が多い場合はCPU使用率が急増する可能性があるため、注意が必要です。

3. **スケジューリングの優先順位**：
   - palserverが高い優先度で実行されるように、PriorityClassを適切に設定します。
   - これにより、リソース競合時にもpalserverのパフォーマンスが維持されます。

#### その他の対策オプション

1. **Docker Socket Proxy**:
   - 直接Dockerソケットをマウントする代わりに、制限付きのAPIアクセスのみを提供するプロキシを使用します。
   - [Docker Socket Proxy](https://github.com/Tecnativa/docker-socket-proxy)などのツールが利用可能です。

   ```yaml
   # Docker Socket Proxyの構成例
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: docker-socket-proxy
     namespace: openhands
   spec:
     replicas: 1
     selector:
       matchLabels:
         app: docker-socket-proxy
     template:
       metadata:
         labels:
           app: docker-socket-proxy
       spec:
         containers:
         - name: docker-socket-proxy
           image: tecnativa/docker-socket-proxy
           env:
           - name: CONTAINERS
             value: "1"  # コンテナ操作を許可
           - name: IMAGES
             value: "1"  # イメージ操作を許可
           - name: NETWORKS
             value: "0"  # ネットワーク操作を禁止
           - name: POST
             value: "1"  # POST操作を許可
           ports:
           - containerPort: 2375
           volumeMounts:
           - name: docker-sock
             mountPath: /var/run/docker.sock
         volumes:
         - name: docker-sock
           hostPath:
             path: /var/run/docker.sock
             type: Socket
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

   そして、OpenHandsコンテナはDocker Socket Proxyを使用するように設定します：

   ```yaml
   env:
   - name: DOCKER_HOST
     value: "tcp://docker-socket-proxy:2375"
   ```

2. **PodSecurityPolicy (PSP)またはPod Security Admission (PSA)**:
   - PSPまたはPSAを使用して、OpenHandsポッドのみがDockerソケットにアクセスできるように制限します。
   - 他のポッドが同様の権限を持つことを防ぎます。

3. **Kaniko、BuildKit、BuildahなどのDockerless代替手段の検討**:
   - OpenHandsの要件に応じて、Docker socketが不要なコンテナイメージビルドツールの使用を検討します。
   - ただし、OpenHands自体が現状Dockerを必要とするため、実現可能性を検証する必要があります。

   > 出典：[Kubernetes Issue #1806](https://github.com/kubernetes/kubernetes/issues/1806) - Kubernetes公式Issueでの議論

### 5.6 Kubernetesマニフェストファイルの準備

OpenHandsをKubernetes上に展開するために、以下のマニフェストファイルを用意します。これらのファイルはloliceリポジトリの`argoproj/openhands/`ディレクトリに配置します。

#### 5.6.1 namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: openhands
```

#### 5.6.2 deployment.yaml

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

#### 5.6.3 service.yaml

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

#### 5.6.4 pvc.yaml

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

#### 5.6.5 priorityclass.yaml（オプション）

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: openhands-priority
value: 1000
globalDefault: false
description: "Priority class for OpenHands (lower than palserver)"
```

#### 5.6.6 external-secret.yaml

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

#### 5.6.7 cloudflared-deployment.yaml

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

#### 5.6.8 application.yaml（ArgoCD用）

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

## 6. その他の考慮事項

- openhandsサービスのリソース要件（CPU/メモリ制限）
- バックアップ戦略
- ヘルスチェック設定
- ロギングとモニタリングの統合
- LLMプロバイダーのAPI Keyの安全な管理（Kubernetes Secret経由）
- ネットワークポリシーによるPod間通信の制限
- 定期的なセキュリティ監査と脆弱性スキャン

## 7. 実装ステップ

1. Terraformコードを作成して、Cloudflare DNS、Tunnel、Accessの設定を行う
   a. tunnelトークンをAWS SSM Parameterに保存
2. Docker Socket Proxyの構成を検討し、必要に応じて実装する
3. golyat-1ノードのリソース使用状況を確認し、OpenHandsとpalserverが共存できることを検証する
4. OpenHands用の各Kubernetesマニフェストファイル（Deployment, Service, PVC等）を作成し、golyat-1ノードで実行されるように設定
5. loliceリポジトリに`argoproj/openhands/`ディレクトリを作成し、必要なマニフェストファイルを追加
6. Cloudflareとの接続に必要なExternalSecretとcloudflared Deploymentを作成
7. ArgoCD Application定義を作成し、アプリケーションをArgoCD管理下に置く
8. golyat-1ノード上でのリソース競合を避けるため、適切なリソース制限を設定
9. ネットワークポリシーを定義して、OpenHandsポッドの通信を制限する
10. ArgoCD経由でデプロイし、動作確認
11. GitHub認証を設定し、アクセスをテスト
12. OpenHandsの設定ページでLLMプロバイダーとモデルを構成
13. 定期的なバックアップジョブを設定
14. モニタリングとロギングを設定して、システムの健全性を監視する
15. golyat-1ノード上のリソース使用状況を継続的に監視し、必要に応じて調整する
