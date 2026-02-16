# StarRupture専用サーバー 実装設計書

## 概要

本プロジェクトは、lolice Kubernetesクラスター上でStarRupture専用サーバーをホスティングし、Cloudflare Zero Trust（WARP経由）を使用して固定IPでアクセスできる環境を構築します。palserverと同様のアクセス方式を採用します。

## 1. 設計方針

### 1.1 アーキテクチャ概要

```
[Game Client] ─── WARP Client ─── Cloudflare Zero Trust ─── [Home Network 192.168.10.x]
                                                                       │
                                                               ┌───────▼────────┐
                                                               │ lolice k8s     │
                                                               │ cluster        │
                                                               │                │
                                                               │ LoadBalancer   │
                                                               │ 192.168.10.98  │
                                                               │      │         │
                                                               │ StarRupture    │
                                                               │ Server Pod     │
                                                               └────────────────┘
```

### 1.2 アクセス方式

palserverと同様に、LoadBalancer Serviceで固定IPを割り当て、WARP経由でアクセスする方式を採用します。

| 項目 | 設定値 |
|------|--------|
| アクセス方法 | 固定IP（192.168.10.98） |
| プロトコル | UDP |
| 認証 | Cloudflare WARPクライアント接続必須 |
| 参考実装 | palserver（192.168.10.97） |

### 1.3 LoadBalancer IP割り当て状況

| IP | サービス | 状態 |
|----|---------|------|
| 192.168.10.29 | ark-survival-ascended | 使用中 |
| 192.168.10.88 | grafana-lb | 使用中 |
| 192.168.10.96 | kubernetes-dashboard-lb | 使用中 |
| 192.168.10.97 | palserver | 使用中 |
| **192.168.10.98** | **starrupture** | **新規割り当て** |

### 1.4 技術スタック

**インフラ層（boxp/arch）**
- 本プロジェクトではTerraform設定は不要
- 既存のCloudflare Zero Trust Private Network設定を使用

**アプリケーション層（boxp/lolice）**
- **Container**: Docker（`struppinet/starrupture-dedicated-server`）
- **Orchestration**: Kubernetes Deployment
- **Service**: LoadBalancer（kube-vip経由で固定IP割り当て）
- **Storage**: Longhorn PVC（セーブデータ永続化）

## 2. 要件定義

### 2.1 機能要件

1. **ゲームサーバー機能**
   - StarRuptureの専用サーバー実行
   - UDPでのプレイヤー接続受け入れ

2. **アクセス制御**
   - Cloudflare WARPクライアント接続必須
   - 固定IP（192.168.10.98）でのゲームサーバー接続

3. **データ永続化**
   - Longhorn PVCでセーブデータ永続化

### 2.2 非機能要件

1. **可用性**: Pod再起動後も同一IPで接続可能
2. **セキュリティ**: WARP未接続では完全にアクセス不可

## 3. システム設計

### 3.1 リポジトリ別対応内容

| リポジトリ | 対応内容 |
|-----------|---------|
| boxp/arch | designdocの作成のみ（Terraform設定不要） |
| boxp/lolice | Kubernetesマニフェストの作成 |

### 3.2 boxp/arch 対応

Terraform設定は不要です。既存のCloudflare Zero Trust Private Network設定（手動設定済み）を使用します。

### 3.3 boxp/lolice 対応

palserverを参考に、以下のKubernetesマニフェストを作成します。

#### 3.3.1 ディレクトリ構成

```
argoproj/starrupture/
├── application.yaml
├── kustomization.yaml
├── namespace.yaml
├── deployment.yaml
├── service.yaml
└── pvc.yaml
```

#### 3.3.2 namespace.yaml

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: starrupture
```

#### 3.3.3 deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: starrupture
  namespace: starrupture
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: starrupture
  template:
    metadata:
      labels:
        app: starrupture
    spec:
      containers:
      - name: starrupture
        image: struppinet/starrupture-dedicated-server:latest
        ports:
        - containerPort: 7777
          protocol: UDP
        volumeMounts:
        - name: saved-volume
          mountPath: /home/steam/starrupture/saves
        resources:
          limits:
            cpu: 2000m
            memory: 4Gi
          requests:
            cpu: 500m
            memory: 2Gi
      volumes:
      - name: saved-volume
        persistentVolumeClaim:
          claimName: starrupture-saved-claim
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

#### 3.3.4 service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: starrupture
  namespace: starrupture
spec:
  type: LoadBalancer
  loadBalancerIP: 192.168.10.98
  selector:
    app: starrupture
  ports:
  - protocol: UDP
    port: 7777
    targetPort: 7777
```

#### 3.3.5 pvc.yaml

```yaml
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: starrupture-saved-claim
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: longhorn
  resources:
    requests:
      storage: 5Gi
```

#### 3.3.6 kustomization.yaml

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
- application.yaml
- namespace.yaml
- pvc.yaml
- deployment.yaml
- service.yaml
```

#### 3.3.7 application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: starrupture
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/boxp/lolice.git
    targetRevision: main
    path: argoproj/starrupture
  destination:
    server: 'https://kubernetes.default.svc'
    namespace: starrupture
  syncPolicy:
    automated:
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
```

## 4. 実装手順

### 4.1 Phase 1: boxp/arch対応

1. 本designdocをPRで作成・マージ

### 4.2 Phase 2: boxp/lolice対応

1. `argoproj/starrupture/` ディレクトリを作成
2. Kubernetesマニフェストを作成（上記3.3参照）
3. PRを作成し、ArgoCD経由でデプロイ

### 4.3 Phase 3: 動作確認

1. WARPクライアントで接続
2. 固定IP（192.168.10.98:7777）でゲームサーバーに接続確認

## 5. テスト計画

### 5.1 インフラテスト

1. **Pod起動確認**
   ```bash
   kubectl get pods -n starrupture
   ```

2. **Service確認**
   ```bash
   kubectl get svc -n starrupture
   ```
   - LoadBalancer IPが192.168.10.98に割り当てられていることを確認

### 5.2 接続テスト

1. **WARPクライアント接続状態で接続**
   - ゲームクライアントから192.168.10.98:7777に接続
   - サーバーに接続できることを確認

2. **WARP未接続時のアクセス拒否確認**
   - WARPクライアント未接続では接続不可

## 6. 運用計画

### 6.1 監視

- StarRupture Server Podの健全性監視
- PVCの使用量監視

### 6.2 バックアップ

- Longhorn PVCのスナップショット機能でセーブデータバックアップ

### 6.3 トラブルシューティング

| 症状 | 確認ポイント | 対処法 |
|------|-------------|--------|
| サーバーに接続できない | WARPクライアント接続状態 | WARPに再接続 |
| | Pod状態 | `kubectl logs -n starrupture` で確認 |
| | Service状態 | LoadBalancer IP割り当て確認 |
| セーブデータ消失 | PVC状態 | スナップショットからリストア |

## 7. 接続方法（ユーザー向け）

### 7.1 事前準備

1. Cloudflare WARPクライアントをインストール
2. Zero Trust組織に参加
3. WARPクライアントで接続

### 7.2 ゲーム接続

1. WARPクライアントが「接続済み」になっていることを確認
2. StarRuptureを起動
3. サーバー接続画面で以下を入力:
   - IP: `192.168.10.98`
   - Port: `7777`
4. 接続

## 8. 備考

- LoadBalancer IP（192.168.10.98）はkube-vipにより提供
- ポート番号（7777）は一般的なゲームサーバーのデフォルト値、実際のDockerイメージの仕様に合わせて調整が必要
- リソース要件（CPU/メモリ）はゲームサーバーの負荷に応じて調整
- セーブデータのマウントパスは実際のDockerイメージの仕様に合わせて調整が必要
