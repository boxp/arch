# T-20260219-016: Moltworker endpoint 522 timeout 調査・修正

## 状況

デプロイ済み Moltworker (`moltworker.b0xp.io`) で `/` は応答するが `/api*` と `/_admin*` が 522 timeout になる。

## 調査結果

### 現行アーキテクチャ（main ブランチ）

- boxp/arch は upstream `cloudflare/moltworker` (SHA: `ee5006ae`) を `prepare.sh` で clone
- `overlay/` で `wrangler.jsonc` と `Dockerfile` を上書きしてデプロイ
- `start-openclaw.sh` は **upstream のものがそのまま使われている**（overlay になし）

### リクエストフロー

```
全リクエスト → ログ → Sandbox初期化 → publicRoutes (マッチしなければ次へ)
  → 環境変数バリデーション → CF Access JWT 認証
  → /api (api routes) → /_admin (adminUi) → /debug → catch-all (containerFetch)
```

### 根本原因: `start-openclaw.sh` の `openclaw onboard` 失敗で Gateway 未起動

upstream の `start-openclaw.sh` は `set -e` で実行される。初回起動時（config 未存在）に `openclaw onboard` が呼ばれるが、**API キーが環境変数として設定されていない場合に onboard が失敗し、`set -e` によりスクリプト全体が停止する**。結果、`openclaw gateway` が実行されず、ポート 18789 が listen されない。

### `/` が「応答する」ように見える理由

```
リクエスト → catch-all app.all('*') → findExistingMoltbotProcess → Gateway 未起動
  → acceptsHtml = true (ブラウザ) → loading page を即時返却
  → waitUntil で ensureMoltbotGateway をバックグラウンド実行（タイムアウトしても影響なし）
```

**`/` の応答は loading page であり、実際には Gateway は応答していない。**

### `/api*` が 522 になる理由

```
リクエスト → catch-all app.all('*') → findExistingMoltbotProcess → Gateway 未起動
  → acceptsHtml = false (API リクエスト) → await ensureMoltbotGateway() を同期的に 180 秒待つ
  → Gateway がポート 18789 を listen しない → タイムアウト → Cloudflare Edge が 522 を返す
```

### `/_admin/*` が 522 になる理由

`/_admin/*` は `adminUi` ルートにマッチし、`c.env.ASSETS.fetch()` で Admin SPA を返すため Gateway とは無関係。しかし、その前に **CF Access 認証ミドルウェア** と **環境変数バリデーション** を通過する。

- `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` が Worker Secret として未設定の場合 → 500 エラー
- `MOLTBOT_GATEWAY_TOKEN` が未設定の場合 → 503 エラー
- JWT 検証の JWKS fetch がタイムアウトする場合 → 522

### Gateway 起動が失敗する考えられる原因

1. **`start-openclaw.sh` 内の `openclaw onboard` 失敗**: `set -e` でスクリプト全体が停止
2. **Node.js config パッチスクリプトの失敗**: `node << 'EOFPATCH'` 内のスクリプトが失敗
3. **rclone の問題**: R2 部分設定（一部の変数のみ設定）でエラー
4. **コンテナの cold start 遅延**: `standard-1` インスタンスの起動が 180 秒を超える

## 修正内容

### 1. `overlay/start-openclaw.sh` の追加（主要修正）

upstream の 329 行の複雑な `start-openclaw.sh` を、boxp 環境に最適化された簡略版で上書き:

- **`openclaw onboard` の失敗を非致命的にする**: `if ... ; then ... else echo WARNING; fi` で失敗時もスクリプトを続行し、`--allow-unconfigured` で Gateway を起動
- **R2 backup/restore を省略**: Worker 側の `ensureRcloneConfig()` が TypeScript で処理するため、シェルスクリプトでの重複処理は不要
- **バックグラウンド sync ループを省略**: 同上
- **config パッチは最小限**: Gateway auth と trusted proxies のみ（チャンネル設定は不要）

### 2. 必須 Secret の設定ガイダンス（運用面）

以下の Worker Secret が `wrangler secret put` で設定されていることを確認:

| Secret | 必須/推奨 | 説明 |
|--------|----------|------|
| `MOLTBOT_GATEWAY_TOKEN` | 必須 | Gateway 認証トークン |
| `CF_ACCESS_TEAM_DOMAIN` | 必須 | Cloudflare Access チームドメイン |
| `CF_ACCESS_AUD` | 必須 | Access Application の AUD タグ |
| `OPENAI_API_KEY` | 必須* | OpenAI API キー（*いずれか 1 つ） |
| `ANTHROPIC_API_KEY` | 必須* | Anthropic API キー（*いずれか 1 つ） |

## 再検証手順

1. `wrangler secret put` で必須 Secret を設定
2. デプロイ後、`wrangler tail` でリアルタイムログを監視
3. `/` → Gateway UI が表示される（loading page ではなく）
4. `/api/status` → `{"ok": true, "status": "running"}`
5. `/_admin/` → Admin SPA が表示される
