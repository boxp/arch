# 事前リサーチ情報

## OpenHandsをKubernetesで動かす方法のまとめ

[ブログ記事「Kubernetes で OpenHands 動かしてみた」](https://blog.chanyou.app/posts/openhands-on-kubernetes/)の内容を以下にまとめます。

### 概要
- OpenHandsを自宅のKubernetesクラスタで動かす方法と構成について解説
- 自宅の趣味用クラスタでの運用例として共有

### 主要なポイント

#### 1. Docker in Docker (DinD) 構成の採用
- 従来のDocker outside of Docker方式ではなく、Docker in Docker方式を採用
- Kubernetesノードの環境を汚さないように配慮
- `docker:28.0.1-dind`イメージをサイドカーコンテナとして使用

#### 2. コンテナの起動順序制御
- dindサイドカーが完全に起動してからOpenHandsを起動するように制御
- `postStart`ライフサイクルフックを使用して起動順を制御
- Dockerデーモンの準備が整ってからOpenHandsコンテナを起動

#### 3. ホスト名解決の設定
- `host.docker.internal`をhostAliasesとして定義
- ローカルのRuntimeコンテナとの通信を確保
- Docker Desktop環境と同様の設定を再現

#### 4. 状態の永続化
- `.openhands-state`ディレクトリをPersistentVolumeClaimで永続化
- API TokenやChat履歴などが保持されるよう設定
- Longhornなどのストレージバックエンドを活用

#### 5. アクセス制御
- OpenHandsには標準で認証機能がないため追加の認証層が必要
- OAuth2 Proxyなどを使用して認証を実装
- 不正アクセスによるAPIトークンの過剰使用を防止

### 実装例
記事には完全なKubernetes YAMLマニフェストが含まれており、以下のリソースが定義されています：
- Namespace
- Deployment (OpenHandsとdindコンテナを含む)
- PersistentVolumeClaim
- Service
- Ingress (認証設定付き)

### 考慮点
- privileged: true が必要な点はセキュリティリスクとして認識
- 趣味利用なら良いが、本番環境では代替手段も検討すべき
- Devinなどのクラウドサービスとのコスト比較も検討材料
- ローカルLLMの利用も選択肢のひとつ

### 結論
自宅Kubernetesクラスタは新しい技術の検証に適しており、OpenHandsのようなAIツールの試用に役立つ環境となっている。

## lolice クラスタでのOpenHandsの実際の構成（最新）

loliceリポジトリの`/argoproj/openhands/`ディレクトリに含まれるマニフェストから、実際のOpenHands構成は以下のようになっています：

### システム構成

- **デプロイ方法**: ArgoCDによるGitOpsワークフロー管理
- **コンテナ構成**: 
  - Docker in Dockerではなく、引き続きホストのDocker Socketをマウントする方式を採用
  - 特定ノード（golyat-1）にのみスケジュールされるよう制約
  - hostNetworkを使用したネットワーク構成
  - `strategy: { type: Recreate }` で更新時にはPodを完全に再作成
- **ストレージ**: 
  - Longhornストレージクラスを使用したPVC
  - `openhands-state-pvc` (5Gi)と`openhands-data` (5Gi)の2つのボリュームを使用
- **リソース管理**: 
  - CPU: 要求500m、上限1000m
  - メモリ: 要求1Gi、上限1Gi
- **外部接続**: AWS Parameter Readerを使用

### ネットワーク構成

- **Cloudflare Tunnel**: 専用のcloudflaredコンテナでトンネル接続
- **ホスト分離**: OpenHandsはgolyat-1ノードに、cloudflaredは他のノードにスケジュール
- **ポート公開**: ポート3000でサービス提供

### 認証とシークレット

- **ExternalSecrets**: 
  - AWS SSM Parameter Storeから以下のシークレットを取得
    - Cloudflareトンネルトークン
    - AWS Parameter Reader認証情報（アクセスキーIDとシークレットアクセスキー）
- **リージョン設定**: AWS Parameter Readerは `asia-northeast-1` リージョンを使用
- **モデル設定**: `us.anthropic.claude-3-7-sonnet-20250219-v1:0` を使用

### 主な変更点（前回からの更新）

1. **シークレット名の変更**:
   - シークレット名が`bedrock-credentials`から`parameter-reader-credentials`に変更
   - パラメータストアのキー名も対応して変更

2. **AWSリージョンの変更**:
   - リージョンが`us-west-2`から`asia-northeast-1`に変更

3. **Deployment戦略の明示化**:
   - `strategy: { type: Recreate }`を追加し、ローリングアップデートではなく再作成による更新を指定

4. **Runtime環境の更新**:
   - `SANDBOX_RUNTIME_CONTAINER_IMAGE`が`docker.all-hands.dev/all-hands-ai/runtime:0.27-nikolaik`を使用（0.28から0.27へのダウングレードの可能性）

### 運用管理

- **クリーンアップ**: 毎日午前0時に実行されるCronJobで未使用のDockerリソースを削除
  ```
  docker system prune -af --volumes
  ```
- **ノード固定**: すべてのOpenHands関連コンポーネントはgolyat-1ノードに固定
- **トラブルシューティング**: `host.docker.internal`の解決に関する対策が講じられている

### 実装上の考慮点

現在のloliceクラスタではDocker in Docker (DinD)方式ではなくDockerソケットマウント方式を採用しているため、以下の点を考慮する必要があります：

1. **セキュリティリスク**:
   - ホストのDockerエンジンに直接アクセスするため、コンテナが特権昇格の可能性を持つ
   - ノード固定でリスクを限定的にしている

2. **スケーラビリティの制限**:
   - 単一ノードに固定されているため水平スケーリングが困難
   - リソース制限も比較的厳しく設定されている

3. **DinD方式への移行検討**:
   - ブログ記事のDinD方式を参考に、より安全な構成に移行できる可能性
   - ただし、DinD方式ではパフォーマンスオーバーヘッドが増加する可能性も考慮が必要

### アーキテクチャ上の特徴

1. **Docker in Dockerではなく、ホストのDockerを使用**
   - `/var/run/docker.sock`をマウントして直接ホストのDockerエンジンを利用
   - セキュリティリスクは存在するが、DinDよりも設定が簡素

2. **ノード固定による安定性確保**
   - OpenHands関連コンポーネントはgolyat-1ノードに固定
   - クラスタ内の他のワークロードとの分離

3. **AWS Bedrock連携**
   - Claude 3.7 Sonnetモデルを使用
   - 必要な認証情報はExternalSecretsで管理

4. **定期的なリソースクリーンアップ**
   - DockerコンテナやボリュームのCronJobによる自動クリーンアップ
   - リソース不足の防止

### 課題と考慮点

- ホストのDocker Socketを直接使用するセキュリティリスク
- 特定ノードへの依存性によるスケーラビリティの制限
- 定期的なクリーンアップが必要

## 実装詳細と具体的なコード例

ブログ記事で紹介されているOpenHandsのKubernetesデプロイに関する詳細なコード例と実装ポイントは以下の通りです：

### Docker in Docker (DinD) の具体的な実装

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openhands
  namespace: openhands
  labels:
    app: openhands
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
        # dind-daemon の postStart が完了してから openhands-app を起動する
        - name: dind-daemon
          image: docker:28.0.1-dind
          env:
            - name: DOCKER_TLS_CERTDIR
              value: ""
          securityContext:
            privileged: true
          lifecycle:
            postStart:
              exec:
                command:
                  - "sh"
                  - "-c"
                  - |
                    echo "Waiting for Docker daemon to be ready..."
                    until docker info; do
                      echo "Docker daemon not ready yet, sleeping..."
                      sleep 1
                    done
                    echo "Docker daemon is ready."
        - name: openhands-app
          image: docker.all-hands.dev/all-hands-ai/openhands:0.28
          env:
            - name: SANDBOX_RUNTIME_CONTAINER_IMAGE
              value: "docker.all-hands.dev/all-hands-ai/runtime:0.28-nikolaik"
            - name: LOG_ALL_EVENTS
              value: "true"
            - name: DOCKER_HOST
              value: "tcp://localhost:2375"
          ports:
            - containerPort: 3000
          volumeMounts:
            - name: openhands-state
              mountPath: /.openhands-state
```

#### DinDの実装ポイント

- `docker:28.0.1-dind`イメージをサイドカーとして利用
- `DOCKER_TLS_CERTDIR`を空に設定し、TLSなしでDockerデーモンを起動
- `privileged: true`でDockerデーモンに必要な権限を付与
- OpenHandsコンテナから`DOCKER_HOST`環境変数で内部のDockerデーモンに接続

### コンテナ起動順制御の具体的な実装

```yaml
lifecycle:
  postStart:
    exec:
      command:
        - "sh"
        - "-c"
        - |
          echo "Waiting for Docker daemon to be ready..."
          until docker info; do
            echo "Docker daemon not ready yet, sleeping..."
            sleep 1
          done
          echo "Docker daemon is ready."
```

#### 起動順制御のポイント

- `lifecycle.postStart`フックを使用して起動順序を制御
- `docker info`コマンドを使用してDockerデーモンの準備が整うまで待機
- ループ処理でDockerデーモンの状態を継続的に確認
- ここでの設定がOpenHands起動の安定性に大きく影響

### hostAliasesの設定

```yaml
hostAliases:
  - ip: "127.0.0.1"
    hostnames:
      - "host.docker.internal"
```

#### hostAliasesのポイント

- ホスト解決のためにPod内の`/etc/hosts`ファイルに`host.docker.internal`を127.0.0.1として追加
- OpenHandsがローカルのRuntimeコンテナを操作するために必要
- Docker Desktop環境の`--add-host host.docker.internal:host-gateway`設定を再現

### 永続ストレージの設定

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: openhands-state
  namespace: openhands
spec:
  storageClassName: longhorn
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

#### 永続ストレージのポイント

- Longhornストレージクラスを使用
- `ReadWriteOnce`アクセスモードで単一Podからのみアクセス可能
- 1GBの容量を割り当て
- `.openhands-state`ディレクトリをマウントして設定や会話履歴を保持

### 認証機能の実装

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: openhands-ingress
  namespace: openhands
  labels:
    app: openhands
  annotations:
    kubernetes.io/ingress.class: "nginx"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/auth-url: "https://oauth2-proxy.example.com/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-signin: "https://oauth2-proxy.example.com/oauth2/start?rd=https://openhands.example.com"
spec:
  rules:
    - host: openhands.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: openhands
                port:
                  name: http
  tls:
    - hosts:
        - openhands.example.com
      secretName: openhands-tls
```

#### 認証機能のポイント

- Nginx Ingressを使用
- Cert-managerによるTLS証明書の自動取得
- OAuth2 Proxyとの連携による外部認証
  - `auth-url`: 認証確認用エンドポイント
  - `auth-signin`: 認証リダイレクト用エンドポイント
- TLS設定によるHTTPS通信

### 記事の主な考察ポイント

- DinDパターンはKubernetesにおける重要なテクニック
- `postStart`ライフサイクルフックは起動順序の制御に有効
- privileged: trueの使用はセキュリティリスクとなるため、運用環境では注意が必要
- 個人利用では便利だが、本番環境ではDevinなどのクラウドサービスも検討すべき
- 構成の安定性とセキュリティのバランスが重要

### 実装上の注意点

- Docker in Dockerはパフォーマンスオーバーヘッドがある
- dindコンテナの起動が遅い場合、OpenHandsの起動も遅延する
- privileged権限はクラスタ全体のセキュリティリスクになりうる
- ストレージのサイズは使用状況に合わせて調整が必要
- OAuth2 Proxyの設定はクラスタ環境によってカスタマイズが必要

この構成は、自宅の趣味用クラスタでの運用を想定したもので、記事の著者はこの構成でOpenHandsを安定して動作させることに成功しています。ただし、セキュリティ面や運用面での考慮点もあるため、本番環境での利用は慎重に検討する必要があります。