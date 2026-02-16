# OpenHandsをDocker in Docker (DinD)方式に移行するための設計書

## 1. 背景と目的

### 1.1 現状の課題

現在、loliceクラスタ上のOpenHandsはホストのDocker Socketをマウントする方式（Docker outside of Docker）で実装されており、以下の課題があります：

- ホストのDockerエンジンに直接アクセスするセキュリティリスク
- 特定ノード（golyat-1）に強く依存するアーキテクチャ
- ホストのDockerリソースを直接消費するため、リソース管理が困難

### 1.2 移行の目的

Docker in Docker (DinD)方式に移行することで、以下の改善を目指します：

- ホストのDockerエンジンから分離したコンテナ環境を構築し、セキュリティリスクを低減
- 将来的なスケーラビリティの向上（特定ノードへの依存を減らす準備）
- OpenHandsとそのランタイムのリソース管理を改善

### 1.3 参考情報

[ブログ記事「Kubernetes で OpenHands 動かしてみた」](https://blog.chanyou.app/posts/openhands-on-kubernetes/)で紹介されているDinD方式の実装を参考に、loliceクラスタの実情に合わせた設計を行います。

## 2. 変更概要

### 2.1 主な変更点

1. **Deploymentの再構成**:
   - ホストDocker Socketマウントを排除
   - DinDサイドカーコンテナを追加
   - OpenHandsコンテナの環境変数を更新
   - コンテナ起動順序制御の導入
   
2. **環境変数とネットワーク設定の更新**:
   - `DOCKER_HOST`環境変数の設定
   - hostAliasesの追加
   - hostNetwork設定の見直し

3. **クリーンアップ処理の修正**:
   - Docker Socketに依存するクリーンアップジョブの更新

### 2.2 変更しない点

1. **ストレージ設定**:
   - PVCの基本構成は維持
   
2. **認証とシークレット設定**:
   - ExternalSecretsによるParameter Reader認証情報管理は変更なし
   
3. **Cloudflare関連設定**:
   - トンネル設定は変更なし

## 3. 詳細設計

### 3.1 Deployment修正

ファイルパス: `/home/boxp/program/misc/lolice/argoproj/openhands/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openhands
  namespace: openhands
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: openhands
  template:
    metadata:
      labels:
        app: openhands
    spec:
      containers:
        # dindサイドカーを追加
        - name: dind-daemon
          image: docker:28.0.1-dind
          env:
            - name: DOCKER_TLS_CERTDIR
              value: ""
          securityContext:
            privileged: true
          resources:
            requests:
              memory: "2Gi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
          # ライフサイクルフックで起動順を制御
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
        # OpenHandsコンテナは変更
        - name: openhands
          image: docker.all-hands.dev/all-hands-ai/openhands:0.28
          ports:
            - containerPort: 3000
          env:
            - name: SANDBOX_RUNTIME_CONTAINER_IMAGE
              value: docker.all-hands.dev/all-hands-ai/runtime:0.27-nikolaik
            # DOCKER_HOSTを内部のDinDコンテナに向ける
            - name: DOCKER_HOST
              value: "tcp://localhost:2375"
            - name: WORKSPACE_MOUNT_PATH
              value: /opt/workspace_base
            # AWS Parameter Reader関連の環境変数
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: parameter-reader-credentials
                  key: AWS_ACCESS_KEY_ID
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: parameter-reader-credentials
                  key: AWS_SECRET_ACCESS_KEY
            - name: AWS_REGION
              value: "asia-northeast-1"
            - name: AWS_DEFAULT_REGION
              value: "asia-northeast-1"
            - name: BEDROCK_MODEL_ID
              value: "us.anthropic.claude-3-7-sonnet-20250219-v1:0"
          volumeMounts:
            - name: openhands-state
              mountPath: /.openhands-state
            - name: workspace
              mountPath: /opt/workspace_base
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
      # host.docker.internalの名前解決のためのhostAliases
      hostAliases:
        - ip: "127.0.0.1"
          hostnames:
            - "host.docker.internal"
      volumes:
        - name: openhands-state
          persistentVolumeClaim:
            claimName: openhands-state-pvc
        - name: workspace
          persistentVolumeClaim:
            claimName: openhands-data
      # 当面はノード固定を維持
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

#### 主な変更内容の説明：

1. **DinDサイドカーの追加**:
   - `docker:28.0.1-dind`イメージを使用
   - `DOCKER_TLS_CERTDIR`を空に設定しTLSなしでDockerデーモンを起動
   - `privileged: true`で必要な権限を付与
   - DinDコンテナにはメモリ要求値/制限値ともに2Gi、OpenHandsコンテナには1Giを設定

2. **コンテナ起動順序の制御**:
   - `lifecycle.postStart`フックでDockerデーモンの準備完了を確認
   - `docker info`コマンドのループでデーモン起動を待機

3. **OpenHandsコンテナの変更**:
   - `DOCKER_HOST`環境変数を`tcp://localhost:2375`に設定
   - Docker Socketマウントを削除
   - 他の環境変数と設定は維持

4. **hostAliases設定の追加**:
   - `host.docker.internal`を`127.0.0.1`として定義

5. **golyat-1ノード固定は維持**:
   - 当面は既存ノード固定を維持し、移行後の安定性を確認

### 3.2 クリーンアップCronJobの修正

ファイルパス: `/home/boxp/program/misc/lolice/argoproj/openhands/docker-cleanup-cronjob.yaml`

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: docker-cleanup
  namespace: openhands
spec:
  schedule: "0 0 * * *"  # 毎日午前0時に実行
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: docker-cleanup
            image: docker:cli
            command:
            - /bin/sh
            - -c
            - |
              echo "Starting Docker cleanup for OpenHands DinD container"
              # DinDコンテナ内部の未使用Dockerリソースを削除
              # OpenHandsポッドの名前を動的に取得
              OPENHANDS_POD=$(kubectl get pods -n openhands -l app=openhands -o jsonpath='{.items[0].metadata.name}')
              if [ -n "$OPENHANDS_POD" ]; then
                echo "Found OpenHands pod: $OPENHANDS_POD"
                kubectl exec -n openhands $OPENHANDS_POD -c dind-daemon -- docker system prune -af --volumes
                echo "Docker cleanup completed for pod $OPENHANDS_POD"
              else
                echo "No OpenHands pod found"
              fi
          serviceAccountName: docker-cleanup-sa  # 追加：クリーンアップ用のサービスアカウント
          restartPolicy: OnFailure
```

#### 主な変更内容の説明：

1. **クリーンアップ処理の変更**:
   - ホストのDocker Socketではなく、DinDコンテナ内のDockerリソースをクリーンアップ
   - `kubectl exec`を使用してDinDコンテナ内で`docker system prune`コマンドを実行

2. **サービスアカウントの追加**:
   - CronJobがkubectl execコマンドを実行できるようにサービスアカウントを設定

### 3.3 サービスアカウント設定（新規追加）

ファイルパス: `/home/boxp/program/misc/lolice/argoproj/openhands/rbac.yaml`

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: docker-cleanup-sa
  namespace: openhands
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-exec-role
  namespace: openhands
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["pods/exec"]
  verbs: ["create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-exec-rolebinding
  namespace: openhands
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-exec-role
subjects:
- kind: ServiceAccount
  name: docker-cleanup-sa
  namespace: openhands
```

## 4. 移行計画

### 4.1 実施手順

1. **バックアップ**:
   - 最新のOpenHandsマニフェスト一式をバックアップ
   - 必要に応じて永続データのバックアップも検討

2. **テスト環境での検証**:
   - 可能であれば、別の名前空間でDinD方式のテストデプロイを実施
   - 動作確認と問題点の特定

3. **本番環境への適用**:
   - rbac.yamlを先に適用してサービスアカウントを設定
   - 修正したdeployment.yamlとdocker-cleanup-cronjob.yamlを適用

4. **動作確認**:
   - OpenHandsの基本機能確認
   - Runtime起動の確認
   - 次のCronJob実行後のクリーンアップ確認

### 4.2 リスク対策

1. **ダウンタイム**:
   - `strategy: { type: Recreate }`により一時的なダウンタイムが発生
   - 利用者に事前通知することを推奨

2. **リソース消費**:
   - DinDはオーバーヘッドがあるため、リソース制限値の調整が必要になる可能性あり
   - 移行後のリソース使用状況をモニタリング

3. **互換性問題**:
   - OpenHandsとRuntime間の通信に問題が発生する可能性
   - ログを注意深く監視し、必要に応じて`SANDBOX_LOCAL_RUNTIME_URL`等の環境変数調整

4. **ロールバック計画**:
   - 問題発生時のロールバック手順を事前に準備
   - バックアップしたマニフェストを即時適用できるよう準備

## 5. 将来的な改善検討事項

1. **セキュリティ強化**:
   - `privileged: true`が必要な点は引き続きセキュリティリスク
   - 将来のOpenHands/Dockerバージョンでより安全な運用方法があるか監視

2. **スケーラビリティ向上**:
   - ノード固定を解除するための条件を検討
   - 水平スケーリングの可能性を検討

3. **リソース最適化**:
   - DinDとOpenHandsのリソース配分調整
   - 状況に応じてリソース制限値の最適化

4. **マルチクラスタ展開**:
   - 安定性確保後、複数のクラスタや環境への展開可能性を検討

## 6. 結論

本設計により、loliceクラスタのOpenHandsをDocker in Docker方式に移行し、より安全で管理しやすい構成を実現します。DinD方式への移行はセキュリティ向上という明確なメリットがある一方、パフォーマンスオーバーヘッドの増加というトレードオフも伴います。慎重な実装と十分な動作検証を行うことで、これらのリスクを最小化しながら移行を成功させることを目指します。
