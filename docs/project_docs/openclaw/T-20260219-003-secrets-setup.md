# T-20260219-003: Moltworker Secrets 投入手順

**作成日**: 2026-02-19

---

## 前提

- Workers Secrets は `wrangler secret put` で手動設定する（コードに含めない）
- GitHub Actions Secrets は GitHub リポジトリ設定で手動設定する
- 既存の lolice K8s 用シークレット（AWS SSM）とは完全に分離
- **OpenAI サブスクリプションのみ利用想定** のため `ANTHROPIC_API_KEY` は不要
- OpenAI サブスク特典は API キー認証だけでは有効にならない。OpenClaw 起動後の onboarding 認証が必要

---

## 1. GitHub Actions Secrets（CI/CD 用）

リポジトリ設定 → Secrets and variables → Actions で以下を設定:

| Secret 名 | 用途 | 備考 |
|-----------|------|------|
| `CLOUDFLARE_API_TOKEN` | wrangler deploy 用 | 既存の Terraform 用トークンと共用可 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント識別 | `1984a4314b3e75f3bedce97c7a8e0c81` |

### CLOUDFLARE_API_TOKEN の権限要件

Moltworker デプロイに必要な追加権限:
- Workers Scripts: Edit
- Workers Routes: Edit
- R2 Storage: Edit (バケットアクセス)
- Durable Objects: Edit

既存の Terraform 用トークンに上記権限が含まれていない場合、別途 API トークンを作成する。

---

## 2. Workers Secrets（Moltworker ランタイム用）

`docker/moltworker/` ディレクトリから実行:

```bash
# 必須: ゲートウェイトークン（新規生成）
export MOLTBOT_GATEWAY_TOKEN=$(openssl rand -hex 32)
echo "Generated token: $MOLTBOT_GATEWAY_TOKEN"
echo "$MOLTBOT_GATEWAY_TOKEN" | npx wrangler secret put MOLTBOT_GATEWAY_TOKEN

# 任意: OpenAI API キー（直接 API アクセス用。サブスク特典は onboarding 認証で有効化）
npx wrangler secret put OPENAI_API_KEY
# プロンプトに sk-... を入力

# 必須: Cloudflare Access 認証
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
# プロンプトに boxp.cloudflareaccess.com を入力

npx wrangler secret put CF_ACCESS_AUD
# Access Application 作成後に取得される audience tag を入力
# Terraform apply 後、Cloudflare ダッシュボード → Access → Applications で確認

# 推奨: GitHub トークン（gh CLI 用）
npx wrangler secret put GITHUB_TOKEN
# プロンプトに ghp_... を入力

# 推奨: sleepAfter 設定（コスト最適化）
echo "30m" | npx wrangler secret put SANDBOX_SLEEP_AFTER
```

---

## 3. Workers Secrets 一覧

| Secret 名 | 必須/任意 | 用途 |
|-----------|---------|------|
| `MOLTBOT_GATEWAY_TOKEN` | **必須** | ゲートウェイ認証トークン |
| `CF_ACCESS_TEAM_DOMAIN` | **必須** | Cloudflare Access ドメイン |
| `CF_ACCESS_AUD` | **必須** | Access Application audience tag |
| `OPENAI_API_KEY` | 任意 | OpenAI 直接 API アクセス（サブスク特典は onboarding 認証で有効化） |
| `GITHUB_TOKEN` | 推奨 | gh CLI / リポジトリアクセス |
| `SANDBOX_SLEEP_AFTER` | 推奨 | アイドル時の自動スリープ（例: `30m`） |

---

## 4. 設定の確認

```bash
# 設定済み Secrets の一覧確認
npx wrangler secret list

# デプロイ後の動作確認
# ブラウザで https://moltworker.b0xp.io にアクセス
# Cloudflare Access の GitHub 認証を通過
# ?token=<MOLTBOT_GATEWAY_TOKEN> でゲートウェイにアクセス
```

---

## 5. 注意事項

- `CF_ACCESS_AUD` は Terraform で Access Application を apply した後でないと取得できない
- Workers Secrets の値変更は `wrangler secret put` で上書き可能
- シークレットの削除は `wrangler secret delete <NAME>` で実行
- **実際の値はこのドキュメントに記載しないこと**
