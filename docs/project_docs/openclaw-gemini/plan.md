# OpenClaw Gemini 2.5 Flash / Pro 追加計画

## Context

openclawは現在LiteLLMプロキシ経由でAnthropic Claude（Sonnet 4.5 / Opus 4.6）のみを使用している。
Gemini 2.5 FlashとGemini 2.5 Proを追加し、prompt cacheを有効化する。

## 方針

- **Google AI Studio API** を使用（`gemini/` プレフィックス）— Vertex AIより設定がシンプル
- **prompt cache**: `cache_control_injection_points` でsystemメッセージへの自動キャッシュ注入 + Gemini 2.5の暗黙的キャッシングもデフォルトで有効
- 安定版モデルID: `gemini-2.5-flash`, `gemini-2.5-pro`
- セキュリティモデル: GEMINI_API_KEYはLiteLLM Podのみが保持（Anthropic API Keyと同じ隔離パターン）

## 変更対象

### 1. arch リポジトリ（本リポジトリ）

#### `terraform/aws/openclaw/ssm.tf`
GEMINI_API_KEY用のSSMパラメータを追加:

```hcl
resource "aws_ssm_parameter" "gemini_api_key" {
  name        = "/lolice/openclaw/GEMINI_API_KEY"
  description = "Google AI Studio API Key for LiteLLM proxy (Gemini models)"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}
```

### 2. lolice リポジトリ

#### `argoproj/openclaw/configmap-litellm.yaml`
Geminiモデルを追加（cache_control_injection_points付き）:

```yaml
model_list:
  # --- 既存 ---
  - model_name: "anthropic/claude-sonnet-4-5-20250929"
    litellm_params:
      model: "claude-sonnet-4-5-20250929"
      api_key: "os.environ/ANTHROPIC_API_KEY"
  - model_name: "anthropic/claude-opus-4-6"
    litellm_params:
      model: "claude-opus-4-6"
      api_key: "os.environ/ANTHROPIC_API_KEY"
  # --- 新規: Gemini ---
  - model_name: "google/gemini-2.5-flash"
    litellm_params:
      model: "gemini/gemini-2.5-flash"
      api_key: "os.environ/GEMINI_API_KEY"
      cache_control_injection_points:
        - location: message
          role: system
  - model_name: "google/gemini-2.5-pro"
    litellm_params:
      model: "gemini/gemini-2.5-pro"
      api_key: "os.environ/GEMINI_API_KEY"
      cache_control_injection_points:
        - location: message
          role: system
```

#### `argoproj/openclaw/external-secret-litellm.yaml`
GEMINI_API_KEYのSSM同期を追加:

```yaml
data:
  # --- 既存 ---
  - secretKey: ANTHROPIC_API_KEY
    remoteRef:
      key: /lolice/openclaw/ANTHROPIC_API_KEY
  - secretKey: LITELLM_MASTER_KEY
    remoteRef:
      key: /lolice/openclaw/LITELLM_MASTER_KEY
  # --- 新規 ---
  - secretKey: GEMINI_API_KEY
    remoteRef:
      conversionStrategy: Default
      decodingStrategy: None
      key: /lolice/openclaw/GEMINI_API_KEY
      metadataPolicy: None
```

#### `argoproj/openclaw/deployment-litellm.yaml`
GEMINI_API_KEY環境変数を追加:

```yaml
env:
  # --- 既存 ---
  - name: CONFIG_FILE_PATH
    value: /app/config.yaml
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
  # --- 新規 ---
  - name: GEMINI_API_KEY
    valueFrom:
      secretKeyRef:
        name: litellm-credentials
        key: GEMINI_API_KEY
```

#### `argoproj/openclaw/configmap-openclaw.yaml`
OpenClawのモデル一覧にGeminiを追加:

```json
{
  "models": {
    "providers": {
      "litellm": {
        "models": [
          // --- 既存のClaude models ---
          {
            "id": "google/gemini-2.5-flash",
            "name": "Gemini 2.5 Flash",
            "reasoning": true,
            "input": ["text", "image"],
            "contextWindow": 1048576,
            "maxTokens": 65536
          },
          {
            "id": "google/gemini-2.5-pro",
            "name": "Gemini 2.5 Pro",
            "reasoning": true,
            "input": ["text", "image"],
            "contextWindow": 1048576,
            "maxTokens": 65536
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "models": {
        // --- 既存 ---
        "litellm/google/gemini-2.5-flash": {
          "alias": "flash"
        },
        "litellm/google/gemini-2.5-pro": {
          "alias": "gemini-pro"
        }
      }
    }
  }
}
```

## 実装順序

### Wave A: arch リポジトリ（SSMパラメータ追加）
1. worktree作成 → `terraform/aws/openclaw/ssm.tf` にGEMINI_API_KEYパラメータ追加
2. `terraform fmt && terraform validate && tflint`
3. codex CLIレビュー → PR作成

### Wave B: lolice リポジトリ（K8s設定更新）— Wave A PRマージ後
1. worktree作成 → 4ファイル変更
2. codex CLIレビュー → PR作成

### Wave C: 手動セットアップ — Wave A PRマージ＆apply後
1. SSMパラメータ `/lolice/openclaw/GEMINI_API_KEY` に実際のGoogle AI Studio APIキーを設定

### Wave D: 検証 — Wave B PRマージ＆ArgoCD Sync後
1. LiteLLM Podが起動することを確認
2. OpenClawからGeminiモデルが選択可能であることを確認
3. プロンプトキャッシュが動作していることをLiteLLMログで確認

## 検証手順

```bash
# Terraform検証 (arch)
cd terraform/aws/openclaw && terraform fmt && terraform validate && tflint

# Kubernetes検証 (lolice) - PRマージ後
kubectl get pods -n openclaw  # LiteLLM Podが Running であること
kubectl logs -n openclaw deployment/litellm | grep -i gemini  # Geminiモデルが登録されていること

# 機能検証
# OpenClaw Web UI or Discord DM でモデルを gemini-flash / gemini-pro に切り替えてチャット
```
