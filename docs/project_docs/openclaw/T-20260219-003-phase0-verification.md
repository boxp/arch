# T-20260219-003 Phase 0: Moltworker 検証メモ

**作成日**: 2026-02-19
**ステータス**: 検証結果記録

---

## 検証項目と結果

### 0-1: Moltworker リポジトリの構成分析

**結果**: 可

[cloudflare/moltworker](https://github.com/cloudflare/moltworker) の構成:

```
moltworker/
├── src/index.ts          # Hono ベースの Worker (API Router / Admin UI)
├── Dockerfile            # cloudflare/sandbox:0.7.0 ベース、openclaw@2026.2.3 をインストール
├── wrangler.jsonc        # Workers + Containers + Durable Objects + R2 設定
├── package.json          # 依存関係 (@cloudflare/sandbox, hono, etc.)
├── start-openclaw.sh     # コンテナ内起動スクリプト
├── skills/               # openclaw スキルファイル
└── dist/client/          # React SPA (Static Assets)
```

**アーキテクチャ**:
```
[ユーザー] → [Worker (Hono API Router + Static Assets)]
                → [Durable Object (Sandbox クラス)]
                     → [Cloudflare Container (standard-1)]
                          ├── openclaw@2026.2.3 (ポート 18789)
                          ├── rclone (R2 同期)
                          └── Node.js 22.13.1
```

### 0-2: 最小構成の特定

**結果**: 可（制約付き）

PoC に必要な最小構成:
- **必須**: Workers Paid ($5/月), Containers, Durable Objects
- **必須シークレット**: `ANTHROPIC_API_KEY`, `MOLTBOT_GATEWAY_TOKEN`
- **本番必須**: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` (Cloudflare Access 認証)
- **推奨**: R2 バケット (永続ストレージ)、`OPENAI_API_KEY` (OpenAI-Codex サブスク利用)

不要な機能:
- Discord/Telegram/Slack 連携 → Phase 2 以降
- Browser Rendering (CDP) → 不要
- AI Gateway → 直接 API キー利用で代替可

### 0-3: CPU アーキテクチャ互換性

**結果**: 可（リスク低）

- Cloudflare Containers: linux/amd64 のみ
- Moltworker Dockerfile: `cloudflare/sandbox:0.7.0` (amd64)
- openclaw npm パッケージ: Node.js ベースのため amd64/arm64 両対応
- 既存 lolice worker node: amd64

→ アーキテクチャ互換性の問題なし。

### 0-4: wrangler dev でのローカル動作確認

**結果**: 未検証（Phase 1 のデプロイで代替）

`wrangler dev` はローカル Docker 環境を必要とし、Containers のローカルエミュレーションに制約がある。
Phase 1 で直接 Cloudflare にデプロイして動作確認する方針とする。

### 0-5: Cold Start 時間

**結果**: 未検証（Phase 1 で実測予定）

Moltworker README の記載: 1-2分（推定）。
`sleepAfter` 設定後の Cold Start 時間は Phase 1 で実測する。

### 0-6: sleepAfter 設定の動作確認

**結果**: 未検証（Phase 1 で確認予定）

wrangler.jsonc の `containers[].sleepAfter` パラメータで設定。
値の例: `"10m"`, `"30m"`
Phase 1 で実際に設定・動作確認する。

---

## Phase 1 進行判定

| 項目 | 判定 |
|------|------|
| 0-1 構成分析 | 可 |
| 0-2 最小構成 | 可（制約付き） |
| 0-3 アーキテクチャ | 可 |
| 0-4 ローカル動作 | 未検証（Phase 1 で代替） |
| 0-5 Cold Start | 未検証（Phase 1 で実測） |
| 0-6 sleepAfter | 未検証（Phase 1 で確認） |

**判定: Phase 1 に進行可能**

中止基準に該当する重大な問題は発見されず。
ローカル動作確認（0-4〜0-6）は Phase 1 のデプロイ後に実環境で確認する。

---

## Phase 1 実装方針

### Terraform で管理するもの
- DNS レコード (`moltworker-poc.b0xp.io` → Workers Route)
- Cloudflare Access (PoC 用の別ポリシー)
- R2 バケット (`moltworker-poc-data`)

### Terraform で管理しないもの（wrangler deploy）
- Workers スクリプト本体
- Containers 設定 (Terraform Provider 未対応)
- Durable Objects
- Workers Secrets

### CI/CD
- GitHub Actions ワークフローで `wrangler deploy` を自動化
- Terraform は既存の tfaction フローに乗せる
- クレデンシャルは `wrangler secret put` で手動設定

### ディレクトリ構成
```
terraform/cloudflare/b0xp.io/moltworker-poc/   # Terraform IaC (DNS, Access, R2)
docker/moltworker-poc/                          # wrangler.jsonc + デプロイ設定
.github/workflows/deploy-moltworker-poc.yml     # CI/CD ワークフロー
```
