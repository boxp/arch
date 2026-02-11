# OpenClaw on lolice k8s cluster デプロイ計画

## Context

[記事](https://dev.classmethod.jp/articles/openclaw-closed-loop/)のアプローチを参考に、lolice k8sクラスター上にOpenClawを設置する。
Discordをフロントエンドとした汎用AIアシスタントとして運用し、Web UIはCloudflare Tunnel経由で公開する。

**過去のインシデント教訓**: AI Agent（Claude Code）がARKサーバーのPVCをArgoCDプロジェクトごと削除し、ゲームデータが完全消失した事故がある。
この教訓を踏まえ、**多層防御によるセキュリティ設計を最優先**とする。

**不要な機能**: TTS / Telegram / Twilio（電話連携）
**LLM**: Anthropic Claude のみ + Codex CLI利用可能
**コンテナ**: 公式Helm chart（Debian bookworm-slim ベース）
**シークレット保護**: LiteLLMプロキシでAPIキーをOpenClawから隔離

## 変更対象リポジトリ

| リポジトリ | 変更内容 |
|---|---|
| `boxp/arch`（本リポジトリ） | Terraform: AWS SSM / Cloudflare Tunnel・DNS・Access Policy |
| `boxp/lolice` | Kubernetes: ArgoCD Application / Helm chart / ExternalSecret / NetworkPolicy |

---

## Phase 1: arch リポジトリ — AWS インフラ

### 1.1 `terraform/aws/openclaw/` の作成

既存の `terraform/aws/ark-discord-bot/` パターンに準拠。

#### ファイル構成
```
terraform/aws/openclaw/
├── provider.tf        # AWS provider (ap-northeast-1)
├── backend.tf         # S3 backend (key: terraform/aws/openclaw/v1/terraform.tfstate)
├── variables.tf       # aws_account_id = "839695154978"
├── ssm.tf             # SSM Parameter Store
├── tfaction.yaml      # {} (空)
└── aqua/
    └── aqua.yaml      # aqua-registry v4.465.0
```

#### SSM パラメータ (`ssm.tf`)

| パラメータ名 | Type | 用途 | アクセス元 |
|---|---|---|---|
| `/lolice/openclaw/ANTHROPIC_API_KEY` | SecureString | LLMプロバイダー | **LiteLLMのみ**（OpenClawからは不可視） |
| `/lolice/openclaw/DISCORD_BOT_TOKEN` | SecureString | Discord Bot認証 | OpenClaw gateway |
| `/lolice/openclaw/OPENCLAW_GATEWAY_TOKEN` | SecureString | Gateway認証トークン | OpenClaw gateway |
| `/lolice/openclaw/LITELLM_MASTER_KEY` | SecureString | LiteLLM管理用マスターキー | LiteLLM Podのみ（管理API用） |
| `/lolice/openclaw/LITELLM_PROXY_KEY` | SecureString | LiteLLMプロキシ利用キー | OpenClaw → LiteLLM（推論リクエスト用） |
| `/lolice/openclaw/GITHUB_TOKEN` | SecureString | GitHub PAT (repo scope) | OpenClaw (git push/PR作成用) |
| `/lolice/openclaw/OPENAI_API_KEY` | SecureString | Codex CLI用 OpenAI API | OpenClaw (codex ツール) |

各パラメータは `lifecycle { ignore_changes = [value] }` で手動更新を許可。
初期値は `"dummy"` とし、apply後に手動で実際の値を設定。

> **Note**: ECR/IAMは不要。公式Helm chartの公式イメージをそのまま使用。
> OPENAI_API_KEYはCodex CLI用に別途OpenAI APIキーを用意。
> **ANTHROPIC_API_KEYはLiteLLM Podのみが保持し、OpenClaw Podには渡さない。**

---

## Phase 2: arch リポジトリ — Cloudflare インフラ

### 2.1 `terraform/cloudflare/b0xp.io/openclaw/` の作成

既存の `hitohub/stage/` (GitHub認証) パターンに準拠。

#### ファイル構成
```
terraform/cloudflare/b0xp.io/openclaw/
├── provider.tf        # cloudflare + aws + random providers
├── backend.tf         # S3 backend (key: terraform/cloudflare/b0xp.io/openclaw/v1/terraform.tfstate)
├── variables.tf       # account_id, zone_id
├── dns.tf             # openclaw.b0xp.io CNAME
├── tunnel.tf          # Cloudflare Tunnel + SSM token保存
├── access.tf          # Cloudflare Access (GitHub認証)
├── tfaction.yaml      # {} (空)
└── aqua/
    └── aqua.yaml
```

#### Terraformプロバイダーバージョン（既存パターン準拠）
- `cloudflare/cloudflare` = `~> 4.52`
- `hashicorp/aws` = `~> 6.0`
- `hashicorp/random` = `3.8.1`
- `required_version` = `>= 1.0`

#### DNS (`dns.tf`)
- `openclaw.b0xp.io` → Tunnel CNAME (proxied)

#### Tunnel (`tunnel.tf`)
- Tunnel名: `cloudflare openclaw tunnel`
- Ingress: `openclaw.b0xp.io` → `http://openclaw.openclaw.svc.cluster.local:18789`
- デフォルト: `http_status:404`
- トンネルトークンを SSM `/lolice/openclaw/tunnel-token` に保存

#### Access Policy (`access.tf`)
- Application: `Access application for openclaw.b0xp.io`
- Session duration: `24h`
- Policy: GitHub login 認証 (`cloudflare_access_identity_provider.github`)
  - 既存のGitHub認証グループは管理者（1名）のみに制限済み

---

## Phase 3: lolice リポジトリ — Kubernetes デプロイ

### 3.1 ArgoCD Application (umbrella chart パターン)

[Helm chartブログ](https://serhanekici.com/openclaw-helm.html)に準拠し、umbrella chartパターンで構成。

#### ファイル構成
```
argoproj/openclaw/
├── Chart.yaml                    # openclaw helm chart dependency
├── values.yaml                   # OpenClaw設定 + セキュリティ設定
├── templates/
│   ├── namespace.yaml            # openclaw namespace
│   ├── externalsecret.yaml       # SSM → K8s Secret同期 (OpenClaw用)
│   ├── externalsecret-litellm.yaml # SSM → K8s Secret同期 (LiteLLM用)
│   ├── litellm-deployment.yaml   # LiteLLM プロキシ Deployment
│   ├── litellm-service.yaml      # LiteLLM Service
│   ├── litellm-configmap.yaml    # LiteLLM 設定
│   ├── cloudflared.yaml          # Cloudflare Tunnel クライアント
│   └── networkpolicy.yaml        # Ingress/Egress 制限
└── .argocd-source-openclaw.yaml  # ArgoCD Application
```

#### Chart.yaml
```yaml
apiVersion: v2
name: openclaw
version: 1.0.0
dependencies:
  - name: openclaw
    version: "1.3.7"  # 最新版を確認して使用
    repository: https://serhanekicii.github.io/openclaw-helm
```

### 3.2 LiteLLM プロキシ構成

**目的**: ANTHROPIC_API_KEYをOpenClawから完全に隔離し、APIキー漏洩リスクを排除。

#### アーキテクチャ
```
┌─────────────────────────────────────────┐
│            openclaw namespace            │
│                                         │
│  ┌──────────────┐    ┌──────────────┐   │
│  │  OpenClaw    │    │  LiteLLM     │   │
│  │  Pod         │───▶│  Pod         │   │
│  │              │    │              │   │
│  │ - Discord    │    │ - ANTHROPIC_ │   │
│  │   Token      │    │   API_KEY    │   │
│  │ - Gateway    │    │ - Rate limit │   │
│  │   Token      │    │ - Cost ctrl  │   │
│  │ - LiteLLM    │    │              │   │
│  │   Proxy Key  │    │              │   │
│  │   (軽量キー)  │    │              │   │
│  └──────────────┘    └──────────────┘   │
│        ↓ NetworkPolicy           ↓      │
│   外部: Discord API,      外部: Anthropic│
│   Web (HTTPS only)        API (HTTPS)   │
│   内部: LiteLLM Pod のみ                  │
│   RFC1918: ブロック                       │
└─────────────────────────────────────────┘
```

#### LiteLLM ConfigMap (`litellm-configmap.yaml`)
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: litellm-config
  namespace: openclaw
data:
  config.yaml: |
    model_list:
      - model_name: "anthropic/claude-sonnet-4-5-20250929"
        litellm_params:
          model: "claude-sonnet-4-5-20250929"
          api_key: "os.environ/ANTHROPIC_API_KEY"
      - model_name: "anthropic/claude-opus-4-6"
        litellm_params:
          model: "claude-opus-4-6"
          api_key: "os.environ/ANTHROPIC_API_KEY"
    general_settings:
      master_key: "os.environ/LITELLM_MASTER_KEY"
    litellm_settings:
      # Claude Max Plan ($100/月) に加入済みのため、
      # プランの上限に委ねてLiteLLM側のbudget制限は設けない
      drop_params: true
```

#### LiteLLM Deployment (`litellm-deployment.yaml`)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: litellm
  namespace: openclaw
  labels:
    app: litellm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: litellm
  template:
    metadata:
      labels:
        app: litellm
    spec:
      automountServiceAccountToken: false  # K8s API悪用防止
      containers:
        - name: litellm
          image: ghcr.io/berriai/litellm:main-v1.63.2  # 特定バージョンをピン留め（latest回避）
          ports:
            - containerPort: 4000
          env:
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: litellm-credentials
                  key: ANTHROPIC_API_KEY
            - name: LITELLM_MASTER_KEY
              valueFrom:
                secretKeyRef:
                  name: litellm-credentials
                  key: LITELLM_MASTER_KEY
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          securityContext:
            runAsNonRoot: true
            allowPrivilegeEscalation: false
          volumeMounts:
            - name: config
              mountPath: /app/config.yaml
              subPath: config.yaml
      volumes:
        - name: config
          configMap:
            name: litellm-config
```

#### LiteLLM ExternalSecret (`externalsecret-litellm.yaml`)
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: litellm-es
  namespace: openclaw
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: litellm-credentials
    creationPolicy: Owner
  data:
    - secretKey: ANTHROPIC_API_KEY
      remoteRef:
        key: /lolice/openclaw/ANTHROPIC_API_KEY
    - secretKey: LITELLM_MASTER_KEY
      remoteRef:
        key: /lolice/openclaw/LITELLM_MASTER_KEY
```

### 3.3 values.yaml 主要設定

**シークレット隔離設計**:
- **Anthropic API Key** → LiteLLMで完全隔離（LLMコンテキストウィンドウへの漏洩も防止）
- **その他のシークレット** → sandbox `"all"` でシェルアクセスから保護

```yaml
openclaw:
  app-template:
    controllers:
      main:
        containers:
          main:
            env:
              # Anthropic API Key は意図的に含めない（LiteLLM経由）
              # 以下のシークレットは sandbox "all" でシェルアクセスから保護
              - name: DISCORD_BOT_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: openclaw-credentials
                    key: DISCORD_BOT_TOKEN
              - name: OPENCLAW_GATEWAY_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: openclaw-credentials
                    key: OPENCLAW_GATEWAY_TOKEN
              - name: GITHUB_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: openclaw-credentials
                    key: GITHUB_TOKEN
              - name: GH_TOKEN
                valueFrom:
                  secretKeyRef:
                    name: openclaw-credentials
                    key: GITHUB_TOKEN
              # LiteLLM Proxy Key (OpenClawがLiteLLMに認証するためのキー)
              - name: LITELLM_PROXY_KEY
                valueFrom:
                  secretKeyRef:
                    name: openclaw-credentials
                    key: LITELLM_PROXY_KEY
              # Codex CLI (OpenAI API)
              - name: OPENAI_API_KEY
                valueFrom:
                  secretKeyRef:
                    name: openclaw-credentials
                    key: OPENAI_API_KEY
              # Docker (DinDサイドカー接続)
              - name: DOCKER_HOST
                value: "tcp://localhost:2376"
              - name: DOCKER_TLS_VERIFY
                value: "1"
              - name: DOCKER_CERT_PATH
                value: "/certs/client"
            volumeMounts:
              - name: docker-certs
                mountPath: /certs/client
                subPath: client
                readOnly: true
            resources:
              requests:
                cpu: 500m
                memory: 1Gi
              limits:
                cpu: 2000m
                memory: 4Gi
            securityContext:
              runAsUser: 1000
              runAsGroup: 1000
              runAsNonRoot: true
              readOnlyRootFilesystem: false  # OpenClawはファイル書込が必要
              allowPrivilegeEscalation: false
          # Docker-in-Docker サイドカー (sandbox + Docker利用)
          # 注意: DinDはinitContainerではなくcontainersに配置（ライフサイクル全体で稼働必須）
          # ⚠️ privileged: true はコンテナ脱出リスクがある。軽減策:
          #   - NetworkPolicyでRFC1918ブロック → ノード侵害してもクラスター内移動不可
          #   - automountServiceAccountToken: false → K8s API悪用不可
          #   - 専用ノードまたはtaint/tolerationでブラストレディアス制限を検討
          dind:
            image: docker:27-dind  # mutableタグ回避（特定メジャーバージョンをピン留め）
            securityContext:
              privileged: true  # DinDに必須（Sysbox等のrootless代替を将来検討）
            env:
              - name: DOCKER_TLS_CERTDIR
                value: /certs
            volumeMounts:
              - name: docker-certs
                mountPath: /certs
              - name: docker-data
                mountPath: /var/lib/docker
            resources:
              requests:
                cpu: 250m
                memory: 512Mi
              limits:
                cpu: 1000m
                memory: 2Gi
        initContainers:
          # ツールインストール (Codex CLI, gh CLI)
          install-tools:
            image: node:22-bookworm-slim
            command:
              - sh
              - -c
              - |
                npm install -g @openai/codex@0.98.0  # バージョン固定
                cp -r /usr/local/lib/node_modules/@openai /shared-tools/
                apt-get update && apt-get install -y gh git
                cp /usr/bin/gh /shared-tools/
                cp /usr/bin/git /shared-tools/
            volumeMounts:
              - name: shared-tools
                mountPath: /shared-tools

        pod:
          automountServiceAccountToken: false  # K8s API悪用防止
          nodeSelector:
            kubernetes.io/arch: amd64  # x86ワーカーノードで実行

    # ネットワークポリシー（Helm chart内蔵のものは無効化、カスタムを使用）
    networkpolicies:
      main:
        enabled: false  # templates/networkpolicy.yaml で独自定義

    # 永続ストレージ (Longhornベース)
    persistence:
      data:
        enabled: true
        size: 10Gi
        accessMode: ReadWriteOnce
        storageClass: longhorn

  # OpenClaw設定 (ConfigMap → openclaw.json)
  configMode: overwrite  # GitOps宣言型
  config:
    agent:
      model:
        # LiteLLMプロキシ経由のモデル名を指定（直接anthropic/を指定しない）
        primary: "sonnet"
        fallbacks:
          - "opus"
      models:
        providers:
          litellm:
            baseUrl: "http://litellm.openclaw.svc.cluster.local:4000"
            apiKey: "${LITELLM_PROXY_KEY}"  # LiteLLM proxy key（master keyとは別の推論専用キー）
            api: "openai-chat"  # LiteLLMはOpenAI互換API
        # LiteLLM上のモデル名にマッピング
        "sonnet":
          provider: "litellm"
          model: "anthropic/claude-sonnet-4-5-20250929"
          alias: "Sonnet"
        "opus":
          provider: "litellm"
          model: "anthropic/claude-opus-4-6"
          alias: "Opus"
      elevated:
        enabled: true  # 信頼ユーザーがOpus等に切替可能
    channels:
      discord:
        enabled: true
        dm:
          policy: "allowlist"
      telegram:
        enabled: false
      whatsapp:
        enabled: false
    gateway:
      auth:
        mode: "token"
    agents:
      defaults:
        sandbox:
          mode: "all"       # 全セッションをDockerサンドボックスで実行
          scope: "agent"    # エージェント間のアクセス分離
          workspaceAccess: "rw"  # ワークスペースへのアクセスは許可
          docker:
            image: "openclaw-sandbox:bookworm-slim"
            network: "bridge"  # サンドボックスからのネットワークアクセスを許可
                               # (Web検索、git clone等に必要)
            user: "1000:1000"
        elevated:
          enabled: true  # 信頼ユーザーのDMセッションはホストアクセス可能
                         # → git commit/push, credential store へのアクセスが可能
                         # → 非elevated セッションではcredentialファイルが見えない
```

**シークレット隔離サマリー**:

| 攻撃ベクトル | 通常セッション (sandbox) | elevated DM | 理由 |
|---|---|---|---|
| `printenv` / `env` | sandbox環境のみ | ホスト環境が見える | sandbox隔離 |
| `cat /proc/1/environ` | sandbox PID 1のみ | ホストPID 1が見える | sandbox隔離 |
| LLMコンテキストにAPIキー | **含まれない** | **含まれない** | LiteLLMでAPIキー隔離 |
| Anthropic API Key取得 | **不可能** | **不可能** | LiteLLM Podのみが保持 |

**セキュリティモデル (簡素化版)**:
- **Anthropic API Key**: LiteLLMで完全隔離。LLMコンテキストウィンドウにも含まれない。どのセッションからも**絶対にアクセス不可**
- **通常セッション (sandbox: all)**: 全シェル実行がDockerコンテナ(DinD)内。ホストの環境変数・ファイルにアクセス不可
- **elevated DM (信頼ユーザーのみ)**: ホストアクセス可能。git commit/push等のインフラ操作が可能
- **GitHub PAT**: Fine-grained（特定リポジトリ+最小権限）で影響範囲を限定
- **Discord Bot Token**: 再生成が容易

**sandbox vs elevated の境界整理**:
| 操作 | 通常セッション (sandbox) | elevated DM |
|---|---|---|
| シェルコマンド実行 | DinDコンテナ内 | ホストコンテナ内 |
| 環境変数 (`printenv`) | sandbox環境のみ | ホストの`DISCORD_BOT_TOKEN`, `GITHUB_TOKEN`等が見える |
| ファイルシステム | sandbox `/workspace` のみ | ホスト全体（git repo含む） |
| git commit/push | 不可（credentialなし） | 可能（GITHUB_TOKEN利用） |
| Anthropic API Key | **不可能**（LiteLLMで隔離） | **不可能**（LiteLLMで隔離） |
| LiteLLM Proxy Key | sandbox環境からは不可視 | 環境変数から参照可能 |
| codex CLI | sandbox内にインストール済みなら可 | 可能（OPENAI_API_KEY利用） |
| kubectl/helm | 不可（sandbox隔離+NetworkPolicy） | **SOUL.mdで禁止**（万一の場合もNetworkPolicyでブロック） |

> **注意**: elevated DMでもSOUL.mdポリシーによりkubectl等のインフラ操作は禁止されている。
> 万が一ポリシーを無視した場合も、NetworkPolicyによりRFC1918がブロックされるため、
> クラスター内サービスへの直接アクセスは技術的に不可能。

### 3.4 ExternalSecret — OpenClaw用 (`templates/externalsecret.yaml`)

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: openclaw-es
  namespace: openclaw
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: openclaw-credentials
    creationPolicy: Owner
  data:
    # 注意: ANTHROPIC_API_KEY は意図的に含めない（LiteLLM Podのみが保持）
    - secretKey: DISCORD_BOT_TOKEN
      remoteRef:
        key: /lolice/openclaw/DISCORD_BOT_TOKEN
    - secretKey: OPENCLAW_GATEWAY_TOKEN
      remoteRef:
        key: /lolice/openclaw/OPENCLAW_GATEWAY_TOKEN
    - secretKey: GITHUB_TOKEN
      remoteRef:
        key: /lolice/openclaw/GITHUB_TOKEN
    - secretKey: OPENAI_API_KEY
      remoteRef:
        key: /lolice/openclaw/OPENAI_API_KEY
    - secretKey: LITELLM_PROXY_KEY
      remoteRef:
        key: /lolice/openclaw/LITELLM_PROXY_KEY
    - secretKey: TUNNEL_TOKEN
      remoteRef:
        key: /lolice/openclaw/tunnel-token
```

> sandbox `"all"` により、エージェントのシェル実行はDinDコンテナ内で行われるため、
> ホストコンテナの環境変数にアクセスできない。
> ANTHROPIC_API_KEY は LiteLLM Pod のみが保持し、LLMコンテキストウィンドウにも含まれない。

### 3.5 cloudflared Deployment (`templates/cloudflared.yaml`)

Cloudflare TunnelのクライアントPodとして、TUNNEL_TOKENを使用してトンネル接続を維持する。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
  namespace: openclaw
  labels:
    app: cloudflared
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloudflared
  template:
    metadata:
      labels:
        app: cloudflared
    spec:
      automountServiceAccountToken: false  # K8s API悪用防止
      containers:
        - name: cloudflared
          image: cloudflare/cloudflared:2024.12.2  # 特定バージョンをピン留め（latest回避）
          args:
            - tunnel
            - --no-autoupdate
            - run
          env:
            # TUNNEL_TOKENは環境変数経由で渡す（プロセス引数だと/proc/*/cmdlineで露出するため）
            - name: TUNNEL_TOKEN
              valueFrom:
                secretKeyRef:
                  name: openclaw-credentials
                  key: TUNNEL_TOKEN
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          securityContext:
            runAsNonRoot: true
            allowPrivilegeEscalation: false
```

> TUNNEL_TOKENはcloudflared Podが使用し、Cloudflare Tunnelを通じて
> `openclaw.b0xp.io` へのトラフィックをOpenClaw Pod (port 18789) にルーティングする。

### 3.6 NetworkPolicy (`templates/networkpolicy.yaml`)

**全Pod対象: デフォルト拒否 + 明示的許可**

**多層防御の要: エグレス制限**

#### OpenClaw Pod 用 NetworkPolicy
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: openclaw-network
  namespace: openclaw
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: openclaw
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # cloudflared (Cloudflare Tunnel) からの Web UI アクセスのみ許可
    - from:
        - podSelector:
            matchLabels:
              app: cloudflared
      ports:
        - protocol: TCP
          port: 18789
  egress:
    # DNS (kube-system経由)
    # 注: NodeLocal DNSCache (169.254.20.10等) を使用している場合は
    # 169.254.0.0/16のブロックを解除するか、ipBlock で 169.254.20.10/32 を追加すること
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # LiteLLM プロキシへの通信（namespace内のみ許可）
    - to:
        - podSelector:
            matchLabels:
              app: litellm
      ports:
        - protocol: TCP
          port: 4000
    # 外部 HTTPS のみ (Discord API, Web検索, GitHub)
    # RFC1918 + IPv6リンクローカルをブロックしてクラスター内サービスへのアクセスを防止
    # port 80 (HTTP) は意図的に除外 — データ流出経路を最小化
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.0.0/16
      ports:
        - protocol: TCP
          port: 443
    # IPv6 外部アクセス（RFC4193/リンクローカル除外）
    - to:
        - ipBlock:
            cidr: ::/0
            except:
              - fc00::/7      # IPv6 ULA (RFC4193)
              - fe80::/10     # IPv6 リンクローカル
      ports:
        - protocol: TCP
          port: 443
```

#### LiteLLM Pod 用 NetworkPolicy
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: litellm-network
  namespace: openclaw
spec:
  podSelector:
    matchLabels:
      app: litellm
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # OpenClaw Podからのみ受信を許可
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: openclaw
      ports:
        - protocol: TCP
          port: 4000
  egress:
    # DNS
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # Anthropic API のみ (HTTPS) — RFC1918 + IPv6除外
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.0.0/16
      ports:
        - protocol: TCP
          port: 443
    - to:
        - ipBlock:
            cidr: ::/0
            except:
              - fc00::/7
              - fe80::/10
      ports:
        - protocol: TCP
          port: 443
```

#### cloudflared Pod 用 NetworkPolicy
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: cloudflared-network
  namespace: openclaw
spec:
  podSelector:
    matchLabels:
      app: cloudflared
  policyTypes:
    - Ingress
    - Egress
  ingress: []  # cloudflaredはインバウンド不要（Cloudflareへアウトバウンド接続のみ）
  egress:
    # DNS
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # OpenClaw Pod への転送（Tunnel ingress）
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: openclaw
      ports:
        - protocol: TCP
          port: 18789
    # Cloudflare Edge への接続 (HTTPS)
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.0.0/16
      ports:
        - protocol: TCP
          port: 443
    - to:
        - ipBlock:
            cidr: ::/0
            except:
              - fc00::/7
              - fe80::/10
      ports:
        - protocol: TCP
          port: 443
```

**重要**:
- OpenClaw Pod → RFC1918ブロック + LiteLLMのみ例外 → クラスター内の他サービス（ArgoCD、Grafana等）にアクセス不可
- LiteLLM Pod → OpenClawからのインバウンドのみ受信 + エグレスはHTTPS(Anthropic API)のみ
- **過去のARKデータ消失インシデントの再発を防ぐ最も重要な防衛ライン**

> **注意: Pod/Service CIDR確認**
> lolice クラスターの Pod CIDR / Service CIDR が RFC1918 外（例: `100.64.0.0/10` Carrier-grade NAT）の場合、
> NetworkPolicy の `except` リストに追加が必要。実装前に以下で確認すること:
> ```bash
> kubectl cluster-info dump | grep -m 1 -E "cluster-cidr|service-cluster-ip-range"
> ```

---

## Phase 4: Codex CLI ツール設定

OpenClawのスキル機能でcodex CLIをツールとして登録する。

### SKILL.md (`~/.openclaw/workspace/skills/codex-review/SKILL.md`)
```markdown
---
name: codex-review
description: Git管理下のコードをcodex CLIでレビュー
tools:
  - shell
---

# codex-review

指定されたファイルまたはGitリポジトリのコードをcodex CLIでレビューします。

## 使い方
ユーザーが「コードレビューして」「このPRをレビュー」等と依頼した場合に使用。

## 実行方法
```bash
codex --approval-mode full-auto -q "以下のコードをレビューしてください: $(cat <target_file>)"
```

## 注意事項
- codex CLI は OpenAI API を使用します (OPENAI_API_KEY)
- レビュー結果はユーザーにそのまま報告してください
```

> codex CLIはsandbox内で実行される。OPENAI_API_KEYがsandbox環境に渡されるかは
> OpenClawのsandbox設定による。sandbox内でAPIキーが利用できない場合は、
> elevatedセッション（信頼ユーザーDM）でのみcodexが使用可能となる。

---

## Phase 5a: セキュリティ設計 — SOUL.md ポリシー

記事のアプローチ + 過去インシデントの教訓に基づくエージェント行動制約。

### SOUL.md（ワークスペースに配置）

```markdown
# 鉄則（絶対に破ってはならないルール）

1. **インフラストラクチャー直接操作禁止**: kubectl, helm, terraform apply, ansible等のインフラ変更ツールを直接実行してはならない
2. **クレデンシャル直接読み取り禁止**: 環境変数やファイルからAPIキー・トークンを読み取って表示してはならない
3. **外部送信禁止**: クレデンシャル、内部情報をDiscordチャネルやWebに公開してはならない
4. **破壊的コマンド禁止**: `rm -rf /`, `dd`, `mkfs`, `:(){ :|:& };:` 等の破壊的コマンドを実行してはならない
5. **ネットワーク攻撃禁止**: ポートスキャン、ブルートフォース、DoS等のネットワーク攻撃を行ってはならない
6. **Git force push禁止**: `git push --force` を絶対に実行してはならない
7. **main/masterブランチへの直接push禁止**: 必ずfeatureブランチからPRを作成すること
8. **プライベートリポジトリのコード公開禁止**: privateリポジトリのコードを外部に公開してはならない

# Git/GitHub操作ルール

- **許可される操作**: ブランチ作成、commit、push(featureブランチのみ)、PR作成、PRレビュー
- **禁止される操作**: force push、main/masterへの直接push、リポジトリ削除、Webhook変更
- **コード変更のフロー（Terraform・K8s共通）**:
  1. featureブランチを作成
  2. 設定ファイルを編集
  3. `terraform fmt` と `terraform validate` で検証（Terraformの場合）
  4. **codex CLIレビューループ**（PR作成前に必須）:
     - `codex` でレビュー依頼
     - 指摘事項があれば修正
     - 再度 `codex` でレビュー依頼
     - **指摘が0件になるまで繰り返す**
  5. commit & push
  6. `gh pr create` でPR作成
  7. CIが自動で検証を実行（TFAction等）
  8. **ユーザーがレビュー・マージ** (エージェントはマージしない)
  9. マージ後に自動適用
- PRのタイトルには変更内容を明確に記載すること
- GitHub PAT (Fine-grained) の推奨スコープ:
  - Repository access: boxp/arch, boxp/lolice のみ
  - Permissions: Contents (Read/Write), Pull requests (Read/Write), Metadata (Read)

# 行動指針

- 不明確な指示に対しては、確認を取ってから行動する
- ファイル操作は必要最小限に留める
- 外部API呼び出しは目的に合致したもののみ
- エラーが発生した場合は報告し、自動リトライは3回まで
```

---

## Phase 5b: セキュリティ対策まとめ

### 多層防御構造

| レイヤー | 対策 | 防ぐリスク |
|---|---|---|
| **LiteLLMプロキシ** | APIキーをOpenClawから完全隔離 + LLMコンテキスト漏洩防止 | APIキー漏洩・不正利用 |
| **Docker sandbox (mode: all)** | 全セッションをDinDサンドボックスで実行 | シェル経由のcredentialアクセス + ツール実行隔離 |
| **elevated mode** | 信頼ユーザーDMのみホストアクセス許可 | git操作とsandbox保護の両立 |
| **Kubernetes NetworkPolicy** | RFC1918ブロック + LiteLLMのみ例外 | クラスター内サービスへの不正アクセス（ARK事故の再発防止） |
| **Cloudflare Access** | GitHub認証必須 | Web UI への不正アクセス |
| **OpenClaw DM Policy** | allowlist制限 | 不正なDiscordユーザーからの操作 |
| **OpenClaw Gateway Auth** | token認証 | Gateway APIへの不正アクセス |
| **SOUL.md ポリシー** | kubectl等のインフラ操作禁止 + credential読取禁止 | エージェントのハルシネーションによる破壊的操作 |
| **Git/TFAction フロー** | PR必須、mainへの直接push禁止 | インフラ変更の人間レビューを強制 |
| **GitHub PAT (Fine-grained)** | 特定リポジトリのみ、最小権限 | GitHub資格情報の影響範囲を限定 |
| **Container Security** | non-root, no privilege escalation（DinDサイドカーのみprivileged必須、他は厳格制限） | コンテナエスケープ |
| **Resource Limits** | CPU 2core / Memory 4Gi | リソース枯渇によるクラスター影響 |
| **Health Probes** | liveness/readiness probe設定（下記参照） | Pod異常時の自動復旧 |
| **Longhorn Backup** | 既存のS3自動バックアップ体制 | データ消失時のリカバリ |

### 可用性設計

**Health Probes** (LiteLLM Deployment):
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 4000
  initialDelaySeconds: 15
  periodSeconds: 30
readinessProbe:
  httpGet:
    path: /health
    port: 4000
  initialDelaySeconds: 5
  periodSeconds: 10
```

**Health Probes** (cloudflared Deployment):
```yaml
livenessProbe:
  exec:
    command: ["cloudflared", "tunnel", "info"]
  initialDelaySeconds: 10
  periodSeconds: 30
```

> **注意**: 個人利用のため PDB / HPA は現時点では不要。
> レプリカ数は全Deployment=1で十分。障害時はArgoCDの自動Syncで復旧。

---

## 実装順序（並行実装計画）

### Wave 1: Terraform インフラ（並行）

gwq worktree を使って arch リポジトリ内で2つのworktreeを同時作業。

**PR作成前 Codex CLIレビューループ（全Waveで必須）**:
```
┌─────────────────────────────────────────┐
│ 実装完了 → terraform fmt/validate       │
│          ↓                              │
│ codex CLI にレビュー依頼                 │
│          ↓                              │
│ 指摘事項あり? ── No ──→ PR作成          │
│          │                              │
│         Yes                             │
│          ↓                              │
│ 指摘事項を修正                           │
│          ↓                              │
│ codex CLI に再レビュー依頼（ループ）      │
└─────────────────────────────────────────┘
```
> 指摘が0件になるまでレビュー→修正を繰り返し、
> 隙のない実装になってからPRを作成する。

```
┌─────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Agent A: AWS SSM                    │  │ Agent B: Cloudflare Tunnel           │
│ worktree: feature/openclaw-aws      │  │ worktree: feature/openclaw-cf        │
│                                     │  │                                      │
│ 1. terraform/aws/openclaw/          │  │ 1. terraform/cloudflare/b0xp.io/     │
│    - provider.tf                    │  │    openclaw/                         │
│    - backend.tf                     │  │    - provider.tf                     │
│    - variables.tf                   │  │    - backend.tf                      │
│    - ssm.tf                         │  │    - variables.tf                    │
│    - tfaction.yaml                  │  │    - dns.tf                          │
│    - aqua/aqua.yaml                 │  │    - tunnel.tf                       │
│ 2. terraform fmt && validate        │  │    - access.tf                       │
│ 3. codex CLIでレビュー               │  │    - tfaction.yaml                   │
│ 4. レビュー指摘修正                   │  │    - aqua/aqua.yaml                  │
│ 5. PR作成                            │  │ 2. terraform fmt && validate         │
│                                     │  │ 3. codex CLIでレビュー                │
│ 依存: なし                           │  │ 4. レビュー指摘修正                    │
│                                     │  │ 5. PR作成                             │
│                                     │  │                                      │
│                                     │  │ 依存: なし                            │
└─────────────────────────────────────┘  └──────────────────────────────────────┘
```

### Wave 2: 手動セットアップ（Wave 1 の PR マージ後）

以下は並行して実施可能:
- SSMパラメータに実際のシークレット値を設定（AWS Console or CLI）
- Discord Developer Portalで Bot作成、トークン取得
- GitHub Fine-grained PAT作成
- OpenAI API Key取得

**前提条件確認**:
- lolice クラスターに `ClusterSecretStore` (名前: `parameterstore`) が既に存在すること
  - 確認: `kubectl get clustersecretstore parameterstore`
  - 存在しない場合は Wave 3 の前に設定が必要

### Wave 3: Kubernetes デプロイ（Wave 2 完了後）

lolice リポジトリで作業。arch repo とは別リポジトリのため、multi-repo-dev で並行開発。

```
┌──────────────────────────────────────────┐
│ Agent C: lolice - K8s デプロイ            │
│ worktree: feature/openclaw               │
│                                          │
│ 1. argoproj/openclaw/                    │
│    - Chart.yaml                          │
│    - values.yaml                         │
│    - templates/namespace.yaml            │
│    - templates/externalsecret.yaml       │
│    - templates/externalsecret-litellm.yaml│
│    - templates/litellm-deployment.yaml   │
│    - templates/litellm-service.yaml      │
│    - templates/litellm-configmap.yaml    │
│    - templates/cloudflared.yaml          │
│    - templates/networkpolicy.yaml        │
│ 2. helm template dry-run                 │
│ 3. codex CLIでレビュー                    │
│ 4. レビュー指摘修正                        │
│ 5. PR作成                                 │
│                                          │
│ 依存: Wave 1 (SSM, Tunnel が存在する事)   │
└──────────────────────────────────────────┘
```

### Wave 4: 設定・検証（Wave 3 の PR マージ + ArgoCD Sync 後）

```
┌──────────────────────────────────────────┐
│ 1. ArgoCD Sync → Pod起動確認             │
│ 2. openclaw.b0xp.io でGitHub認証確認      │
│ 3. Discord Bot ペアリング・接続確認        │
│ 4. SOUL.md / codex skill 設定            │
│ 5. NetworkPolicy 疎通テスト               │
│    - 外部API接続確認                      │
│    - クラスター内アクセスブロック確認       │
└──────────────────────────────────────────┘
```

### 並行実装まとめ

| Wave | 作業 | 並行度 | ブロッカー |
|---|---|---|---|
| Wave 1 | Terraform (AWS + Cloudflare) | **2並行** (worktree) | なし |
| Wave 2 | 手動セットアップ | **4並行** | Wave 1 PRマージ |
| Wave 3 | K8s デプロイ (lolice) | 1 | Wave 2 完了 |
| Wave 4 | 設定・検証 | 1 | Wave 3 PRマージ + Sync |

---

## 検証手順

### Terraform検証 (arch repo)
```bash
# AWS
cd terraform/aws/openclaw && terraform fmt && terraform validate && tflint

# Cloudflare
cd terraform/cloudflare/b0xp.io/openclaw && terraform fmt && terraform validate && tflint
```

### Kubernetes検証 (lolice repo)
```bash
# Helm template dry-run
helm template openclaw argoproj/openclaw/ --namespace openclaw

# Pod起動確認
kubectl get pods -n openclaw
kubectl logs -n openclaw deployment/openclaw

# NetworkPolicy確認（Pod内からの接続テスト）
kubectl exec -n openclaw deployment/openclaw -- curl -s https://discord.com  # 外部HTTPS: 成功するべき
kubectl exec -n openclaw deployment/openclaw -- curl -s http://argocd-server.argocd.svc.cluster.local  # クラスター内: ブロックされるべき
# 注: OpenClawからapi.anthropic.comへのHTTPS接続自体はNetworkPolicyで通る（パブリックIP）
# ただしANTHROPIC_API_KEYがOpenClaw Podに存在しないため、認証不可（LiteLLMによるキー隔離）
kubectl exec -n openclaw deployment/litellm -- curl -s https://api.anthropic.com  # LiteLLMからAnthropic: 成功するべき
```

### 機能検証
1. `openclaw.b0xp.io` にアクセス → GitHub認証 → Web UIが表示
2. Discord DM → Botが応答
3. Codex CLI → `kubectl exec` でコンテナ内から `codex --version` 確認

---

## 実装結果（2026-02-11 時点）

### 全体ステータス

| Wave | ステータス | 備考 |
|---|---|---|
| Wave 1 | **完了** | Terraform (AWS SSM + Cloudflare Tunnel/DNS/Access) |
| Wave 2 | **完了** | SSMパラメータ手動設定、Discord Bot作成、GitHub PAT作成 |
| Wave 3 | **完了** | K8sデプロイ（多数のイテレーション修正を経て稼働） |
| Wave 4 | **一部完了** | Web UI + Discord チャット動作確認済み。SOUL.md/NetworkPolicyテスト等は未実施 |

### Wave 3 の計画と実装の差分

#### 構成の変更: Helm chart → プレーンマニフェスト

計画ではumbrella chart + Helm chartパターンだったが、実装ではプレーンKubernetesマニフェストを採用。

**実際のファイル構成**:
```
argoproj/openclaw/
├── configmap-litellm.yaml      # LiteLLM設定
├── configmap-openclaw.yaml     # OpenClaw設定 (openclaw.json)
├── deployment-litellm.yaml     # LiteLLM Deployment
├── deployment-openclaw.yaml    # OpenClaw Deployment (init containers + DinD sidecar)
├── externalsecret-litellm.yaml # LiteLLM用シークレット
├── externalsecret.yaml         # OpenClaw用シークレット
├── deployment-cloudflared.yaml # Cloudflare Tunnel
├── namespace.yaml              # openclaw namespace
├── networkpolicy.yaml          # 全Pod用NetworkPolicy
├── pvc.yaml                    # OpenClaw永続ボリューム
├── service-litellm.yaml        # LiteLLM Service
└── service-openclaw.yaml       # OpenClaw Service
```

#### OpenClaw Config Schema（計画 vs 実際）

計画のconfig構造は古いスキーマに基づいていた。実際のOpenClawが要求するトップレベルキー:

| 計画のキー | 実際のキー | 備考 |
|---|---|---|
| `agent.model` | `agents.defaults.model` | `agents.defaults`配下に移動 |
| `agent.models.providers` | `models.providers` | トップレベル`models`に分離 |
| `agent.elevated` | `tools.elevated` | `tools`配下に移動 |
| (なし) | `plugins.entries.discord.enabled` | チャンネル設定とは別にプラグイン有効化が必要 |
| `gateway.auth.mode: "token"` | `gateway.mode: "local"` + `gateway.auth.token` | non-dev環境では`mode: "local"`が必須 |
| (なし) | `gateway.controlUi.allowInsecureAuth` | Cloudflare Access背後ではデバイスペアリングをスキップ |
| `api: "openai-chat"` | `api: "openai-completions"` | 正しいenum値 |
| モデル名のみ | `models`配列（id, name, reasoning等） | プロバイダー内にモデル定義が必要 |

#### LiteLLM Deployment の修正点

| 項目 | 計画 | 実際 |
|---|---|---|
| メモリ制限 | 512Mi | **1Gi**（512Miでは OOMKilled） |
| メモリリクエスト | 256Mi | **512Mi** |
| config読み込み | (暗黙的) | **`CONFIG_FILE_PATH=/app/config.yaml`** env var が必須 |
| イメージ | `ghcr.io/berriai/litellm:main-v1.63.2` | `ghcr.io/berriai/litellm:v1.81.3-stable` |

#### LITELLM_PROXY_KEY の設計変更

計画では `LITELLM_PROXY_KEY` と `LITELLM_MASTER_KEY` を別々のキーとして管理する想定だったが、
LiteLLMの仮想キー機能にはPostgreSQLが必要で、DB無しの構成ではマスターキーのみで認証する。

**実際の実装**: OpenClawの `LITELLM_PROXY_KEY` env varは `litellm-credentials.LITELLM_MASTER_KEY` を参照。

```yaml
# deployment-openclaw.yaml
- name: LITELLM_PROXY_KEY
  valueFrom:
    secretKeyRef:
      name: litellm-credentials  # openclaw-credentials ではなく litellm-credentials
      key: LITELLM_MASTER_KEY    # LITELLM_PROXY_KEY ではなく LITELLM_MASTER_KEY
```

#### OpenClaw Deployment のinit containers

計画の `install-tools` init container（node:22-bookworm-slim + npm install codex）は不採用。
代わりに以下の構成:

1. **`init-docker-cli`**: `docker:27-cli`イメージからDockerバイナリをコピー（shared-bin emptyDir経由）
2. **`init-config`**: ConfigMapからPVCにopenclaw.jsonをコピー（sedによる環境変数置換は不要 — OpenClawがメモリ上で`${VAR_NAME}`を解決）

#### NetworkPolicy の変更

OpenClaw Podのegressに **port 80 (HTTP)** を追加。サンドボックスコンテナ内でapt-getを実行するため。

### 修正PR一覧（Wave 3 イテレーション）

| PR | 内容 | 根本原因 |
|---|---|---|
| #375 | Config schema修正: `agent.*` → `agents.defaults.*` | レガシーキー使用 |
| #376 | Config schema修正: api値、modelsアレイ、aliases | 不正なenum値、構造の差異 |
| #377 | `gateway.mode: "local"` 追加 | non-dev環境では必須 |
| #378 | `gateway.controlUi.allowInsecureAuth: true` 追加 | Cloudflare Access背後でのペアリングスキップ |
| #379 | Discord plugin有効化 + Docker CLI注入 | channels設定だけでなくplugins有効化も必要 |
| #380 | init-docker-cli を docker:27-cli に変更 + NetworkPolicy port 80追加 | apt-getがNetworkPolicyでブロックされた |
| #381 | LiteLLM メモリ 512Mi → 1Gi + init-config sed削除 | OOMKilled (Exit Code 137) |
| #382 | LITELLM_PROXY_KEY → litellm-credentials.LITELLM_MASTER_KEY | 認証キー不一致 (400 Bad Request) |
| #383 | `CONFIG_FILE_PATH=/app/config.yaml` env var追加 | LiteLLMがconfigを読み込んでいなかった |

### 得られた教訓

1. **OpenClawのconfig schemaはドキュメントだけでなく実際のバリデーションエラーから確認する** — 公式ドキュメントと実際のスキーマに差異があった
2. **OpenClawは`${VAR_NAME}`をメモリ上で解決する** — config fileにはテンプレートのまま残してよい。sedによる事前置換は不要
3. **OpenClawのchannelsとpluginsは別概念** — `channels.discord.enabled: true` だけでなく `plugins.entries.discord.enabled: true` も必要
4. **LiteLLMはDB無しではmaster_keyのみで認証** — 仮想キー（別のproxy key）を使うにはPostgreSQLが必要
5. **LiteLLMのconfigは明示的に指定が必要** — ファイルをマウントしただけでは読み込まれない（`CONFIG_FILE_PATH` or `--config`）
6. **LiteLLMのメモリは最低1Gi必要** — Pythonアプリケーションのモジュールロードで512Miでは不足
7. **fact checkしてから実装する** — 仮説で実装するのではなく、ドキュメントを確認してから修正

### 現在の状態と残作業

**動作確認済み**:
- Web UI (openclaw.b0xp.io) — Cloudflare Access認証 → チャット動作
- Discord Bot — ログイン成功、チャット応答動作
- LiteLLM → Anthropic API — 認証・推論成功（クレジット補充後）

**未実施（Wave 4 残り）**:
- SOUL.md ポリシー配置
- NetworkPolicy 疎通テスト（クラスター内アクセスブロック確認）
- Codex CLI セットアップ・動作確認
- サンドボックスコンテナの`/home/node`問題の修正（ツール実行に影響、基本チャットには影響なし）

---

>>>>>>> dadb4b51 (docs(openclaw): update plan with implementation results and lessons learned)
## 参考ソース
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw Helm chart](https://serhanekici.com/openclaw-helm.html)
- [記事: OpenClaw closed-loop](https://dev.classmethod.jp/articles/openclaw-closed-loop/)
- [OpenClaw Docker公式ドキュメント](https://docs.openclaw.ai/install/docker)
- [OpenClaw Security](https://docs.openclaw.ai/gateway/security)
- [OpenClaw Security Best Practices](https://www.hostinger.com/tutorials/openclaw-security)
