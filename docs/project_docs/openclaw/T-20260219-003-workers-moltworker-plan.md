# T-20260219-003: Cloudflare Workers/Edge での OpenClaw ホスト検証 — 計画書 v2（ソース固定版）

**作成日**: 2026-02-19
**改訂**: v2（前回計画からの全面見直し）
**ステータス**: 計画段階（実装なし）
**対象リポジトリ**: `boxp/arch`（IaC層）+ Moltworker 評価

---

## 今回の前提（ソース付き）

### ソースとなるXポストの要約

**ポスト**: https://x.com/cloudflare/status/2021739474049544648

> "Run your own AI personal assistant on Cloudflare Workers — no Mac Mini required. 🤖
> Introducing Moltworker: self-hosted AI agents at the edge."

リンク先: [Cloudflare Blog: Moltworker](https://blog.cloudflare.com/moltworker-self-hosted-ai-agent/)

**主張の要約**:
1. OpenClaw（旧 Moltbot / Clawdbot）を Cloudflare Workers + Sandbox SDK 上で動作させるPoCが公開された
2. Mac Mini 等の常時起動ハードウェアなしで、月額 $5〜 で AI パーソナルアシスタントを運用可能
3. Cloudflare の Sandbox SDK（Containers 上に構築）を使い、OpenClaw ランタイムをエッジで隔離実行
4. AI Gateway / Browser Rendering / R2 / Zero Trust Access 等の Cloudflare サービスと統合
5. **PoCであり製品ではない** — Cloudflare VP of Engineering は「理想的な方法ではなく、将来的には Agents SDK やネイティブ API を使う方向」と明言

### 前提 1: Cloudflare Moltworker の存在

[cloudflare/moltworker](https://github.com/cloudflare/moltworker) — Cloudflare が公式に公開した、OpenClaw を Workers + Sandbox SDK で動かすためのミドルウェア Worker。

**アーキテクチャ**:
```
[ユーザー] → [Worker (API Router / Admin UI)]
                → [Sandbox Container (OpenClaw ランタイム)]
                     ├── Claude Code CLI / Docker CLI / gh CLI
                     ├── AI Gateway → Anthropic / OpenAI / etc.
                     ├── Browser Rendering → Headless Chromium
                     └── R2 Mount → 永続ストレージ
```

**根拠**: https://blog.cloudflare.com/moltworker-self-hosted-ai-agent/

### 前提 2: Cloudflare Containers（Public Beta）

- **ステータス**: 2025年6月 Public Beta 開始、2026年2月時点でも Beta
- **インスタンスタイプ**: lite (256MiB/1/16 vCPU) 〜 standard-4 (12GiB/4 vCPU)
- **Moltworker 使用タイプ**: standard-1 (4 GiB RAM / 1/2 vCPU / 8 GB Disk)
- **ディスク**: エフェメラル（再起動で消失、R2 マウントで補完）
- **ネットワーク**: HTTP のみ（非HTTP TCP/UDP は不可）
- **アーキテクチャ**: linux/amd64 のみ

**根拠**: https://developers.cloudflare.com/containers/platform-details/limits/

### 前提 3: Cloudflare Sandbox SDK（Beta）

Containers 上に構築された高レベル抽象化。コマンド実行、ファイル操作、バケットマウント、WebSocket ターミナル、サービス公開等のAPIを提供。

**根拠**: https://developers.cloudflare.com/sandbox/

### 前提 4: Terraform Provider の Container 未対応

Cloudflare Terraform Provider v5.17.0（2026年2月時点）に `cloudflare_container` や `cloudflare_sandbox` リソースは**存在しない**。Containers/Sandbox のデプロイは `wrangler deploy` ベース。

**根拠**:
- https://developers.cloudflare.com/changelog/2026-02-12-terraform-v5170-provider/
- Terraform Registry で container 関連リソースが見当たらない（`未検証` — Registry を直接検索していないため断定不可）

### 前提 5: 現行 OpenClaw on lolice K8s との差異

| 項目 | 現行 (lolice K8s) | Moltworker (CF Workers) |
|------|-------------------|------------------------|
| ランタイム | DinD sidecar + OpenClaw Pod | Sandbox Container (linux/amd64) |
| ストレージ | K8s PV (Longhorn) | エフェメラル + R2 マウント |
| シークレット管理 | AWS SSM → ExternalSecret → K8s Secret | Workers Secrets (wrangler secret put) |
| 認証 | Cloudflare Access (GitHub) | Cloudflare Access (同一) |
| LLM ルーティング | LiteLLM Pod → 各プロバイダー | AI Gateway → 各プロバイダー |
| ブラウザ自動化 | なし | Browser Rendering (headless Chromium) |
| カスタムツール | ghq, gwq, mcp-grafana, Babashka, Codex CLI | Moltworker skills + Sandbox SDK exec |
| CPU アーキテクチャ | ARM64 (Orange Pi Zero 3) | x86_64 (linux/amd64) |
| Docker | DinD sidecar | Sandbox 内で `未検証`（Containers 内 Docker は未公開情報） |
| 月額コスト | 電気代 + Cloudflare Free | $5 (Workers Paid) + 使用量 (推定 $30〜35/月 24/7稼働時) |

### 前提 6: boxp/arch リポジトリのスコープ

`boxp/arch` は Terraform IaC リポジトリ。Cloudflare DNS/Tunnel/Access と AWS SSM を管理する。

- Cloudflare Workers スクリプト自体は Terraform `cloudflare_workers_script` で管理可能
- ただし Containers/Sandbox は Terraform 未対応のため、Wrangler プロジェクトとして別管理が必要になる可能性
- Workers Routes, DNS, Access は既存 Terraform で管理可能

**根拠**: `boxp/arch` リポジトリ構成（terraform/cloudflare/b0xp.io/openclaw/ 配下の dns.tf, tunnel.tf, access.tf）

---

## 前回計画からの修正点

### 修正 1: 検証対象の根本的変更

| 前回 | 今回 |
|------|------|
| Workers Gateway（プロキシ型）を推奨候補Aとした | Moltworker（OpenClaw 本体を Sandbox で直接実行）を検証主軸にする |
| 「OpenClaw 本体は K8s に残し Workers をプロキシに」が前提 | Cloudflare 公式 PoC (Moltworker) により「OpenClaw 本体を Workers/Sandbox で動かす」が現実的選択肢に |
| Container Workers は「★☆☆☆☆ 未検証」評価 | Containers は Public Beta で Moltworker が動作実績あり → 評価を引き上げ |

### 修正 2: 前提の根拠不足を解消

| 前回の問題 | 今回の対応 |
|-----------|-----------|
| 「Container Workers は2025年時点でベータ/限定提供。GA状況は未確認」| Containers は2025年6月 Public Beta 開始、2026年2月時点で Beta 継続中。Moltworker で動作実績あり |
| 「DinD が Container Workers 内で可能かは未検証」| Sandbox SDK は `exec` でコマンド実行可能だが、Container 内での Docker デーモン起動は `未検証`。Moltworker は DinD を使わず Sandbox SDK の exec API で代替 |
| 「Terraform provider 未対応の可能性」| v5.17.0 時点で Container/Sandbox リソースは未対応を確認。Wrangler デプロイが前提 |
| Workers Workflows を候補D として検討 | Moltworker が Sandbox SDK を採用しているため、Workflows 評価は不要に |

### 修正 3: 候補構成の整理

前回の4候補（A: Gateway / B: DO+AI / C: Container / D: Workflows）を以下の2軸に再整理:

| 軸 | 内容 | 根拠 |
|----|------|------|
| **軸1: Moltworker ベース** | cloudflare/moltworker を fork/参照し、OpenClaw 本体を Sandbox Container で実行 | https://github.com/cloudflare/moltworker |
| **軸2: Edge Gateway + K8s バックエンド** | Workers を Gateway として配置、OpenClaw 本体は K8s に残す（前回候補A相当） | 前回計画の候補A |

→ **軸1（Moltworker）を主軸に検証**。理由: Cloudflare 公式に動作実績があり、今回のXポストの検証対象そのもの。

### 修正 4: コスト前提の変更

| 前回 | 今回 |
|------|------|
| 「候補A なら追加コストはほぼゼロ（Free 枠内）」 | Moltworker は Workers Paid プラン必須（$5/月）+ 使用量課金。24/7 稼働で推定 $30〜35/月。sleepAfter 設定で削減可能 |

**根拠**: https://developers.cloudflare.com/containers/pricing/ および Moltworker README のコスト試算

### 修正 5: arch リポジトリのスコープ変更

前回は「Workers Gateway の Terraform 定義のみ」だったが、今回は:
- Moltworker は Wrangler ベースのため、arch 内 Terraform とは別に Wrangler プロジェクトが必要
- arch で管理するのは DNS / Access / R2 バケット / AI Gateway 等の **周辺インフラ**
- Workers スクリプト自体の Terraform 管理は Containers 非対応のため現実的ではない

---

## arch 実施計画（Phase 0/1/2）

### Phase 0: Moltworker 評価・ローカル検証（デスクリサーチ + wrangler dev）

**目標**: Moltworker の動作確認と、boxp/arch の OpenClaw カスタマイズとの互換性評価

**タスク**:

| # | タスク | 確認方法 | 判定基準 |
|---|--------|----------|----------|
| 0-1 | Moltworker リポジトリの clone と構成分析 | `git clone https://github.com/cloudflare/moltworker` | Dockerfile, wrangler.jsonc, src/ の構成を把握 |
| 0-2 | boxp/arch の OpenClaw カスタム Dockerfile との差分分析 | diff `docker/openclaw/Dockerfile` vs Moltworker の `Dockerfile` | ghq, gwq, mcp-grafana, Babashka, Codex CLI 等のカスタムツールが Moltworker に含まれるか / 追加可能か |
| 0-3 | Sandbox SDK 上での Docker (DinD) 実行可否調査 | Cloudflare ドキュメント + Community Forum 検索 | Sandbox 内で `dockerd` が起動可能か。不可の場合、sandbox.exec() で代替可能な範囲を特定 |
| 0-4 | CPU アーキテクチャ互換性確認 | 現行が ARM64 (Orange Pi)、Containers は linux/amd64 | 既存の ghcr.io/openclaw/openclaw イメージが amd64 ビルドを提供しているか確認 |
| 0-5 | LiteLLM → AI Gateway 移行の影響調査 | Moltworker は AI Gateway 経由。現行は LiteLLM Pod 経由 | 現行の LiteLLM 設定（モデルルーティング、API キー管理）が AI Gateway で再現可能か |
| 0-6 | R2 マウントによるストレージ永続性の評価 | Moltworker の R2 マウント実装を確認 | ghq/gwq のリポジトリキャッシュ、.claude/ 設定等が R2 上で永続化可能か |
| 0-7 | `wrangler dev` でのローカル動作確認 | Moltworker を手元で起動し、基本的なチャット応答を確認 | Container cold start → OpenClaw 起動 → チャット応答の一連のフローが動作するか |
| 0-8 | Cloudflare Terraform Provider v5 で管理可能な範囲の特定 | Provider ドキュメント精査 | DNS, Access, R2 bucket, AI Gateway は Terraform 管理可。Worker script は Terraform 可だが Container binding は `未検証` |

**arch リポジトリへの変更**: なし
**lolice リポジトリへの変更**: なし

**Done criteria**:
- 全 8 項目に対して「可/不可/制約付き可/未検証」の判定が完了
- Moltworker の `wrangler dev` でローカル動作確認ができた場合のみ Phase 1 に進む
- boxp/arch カスタムツール（ghq, gwq, mcp-grafana, Babashka, Codex CLI）の互換性が評価済み

**中止基準**:
- OpenClaw の基本動作（チャット応答 + ツール実行）が Sandbox 上で動作しない
- amd64 ビルドが提供されておらず、マルチアーキテクチャ対応に過大な労力が必要
- カスタムツールの大半が Sandbox 環境に移植不可能

---

### Phase 1: arch リポジトリでの周辺インフラ定義 + Moltworker 初期デプロイ

**目標**: Moltworker を Cloudflare にデプロイし、boxp/arch のインフラ管理と統合

**タスク**:

| # | タスク | arch での変更 | 根拠 |
|---|--------|--------------|------|
| 1-1 | R2 バケット作成の Terraform 定義 | `terraform/cloudflare/b0xp.io/openclaw/r2.tf` (新規) | Moltworker が永続ストレージに R2 を使用。[R2 Terraform](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/r2_bucket) |
| 1-2 | AI Gateway 設定の Terraform 定義 | `terraform/cloudflare/b0xp.io/openclaw/ai_gateway.tf` (新規) | Moltworker が AI Gateway 経由で LLM 呼び出し。`未検証`: AI Gateway の Terraform リソース対応状況 |
| 1-3 | Cloudflare Access の Moltworker 用設定 | `terraform/cloudflare/b0xp.io/openclaw/access.tf` (更新) | 既存の openclaw.b0xp.io Access に加え、Moltworker 用エンドポイントを追加 |
| 1-4 | DNS レコードの追加（テスト用サブドメイン） | `terraform/cloudflare/b0xp.io/openclaw/dns.tf` (更新) | `moltworker.b0xp.io` 等のテスト用レコード。既存 `openclaw.b0xp.io` は変更しない |
| 1-5 | Moltworker Wrangler プロジェクトの配置方針決定 | `docs/project_docs/T-20260219-003/` (新規) | arch リポジトリ内に `workers/moltworker/` として置くか、別リポジトリにするかの判断。Terraform との統合方法を決定 |
| 1-6 | Moltworker の初期デプロイ（wrangler deploy） | Wrangler プロジェクト（配置先は 1-5 で決定） | `wrangler deploy` + `wrangler secret put` で Workers Secrets 設定 |
| 1-7 | Workers Secrets への既存シークレット移行 | SSM パラメータの一部を Workers Secrets にも設定 | ANTHROPIC_API_KEY, DISCORD_BOT_TOKEN 等。SSM は残し、Workers Secrets に複製 |
| 1-8 | CI/CD パイプライン検討 | `.github/workflows/deploy-moltworker.yml` (新規) | `wrangler deploy` を GitHub Actions で実行。既存の build-openclaw-image.yml を参考 |

**lolice リポジトリへの変更**: なし（既存 K8s 上の OpenClaw は並行稼働を継続）

**Done criteria**:
- Moltworker が `moltworker.b0xp.io`（テスト用サブドメイン）でアクセス可能
- Cloudflare Access による認証が動作
- 基本的なチャット応答が可能（Claude API 経由）
- R2 マウントによるデータ永続化が動作
- 既存の `openclaw.b0xp.io`（K8s版）に影響がないこと

**中止基準**:
- Moltworker のデプロイが失敗し、Cloudflare サポートでも解決不可
- Workers Paid プラン + 使用量コストが月額 $50 を超える見込み
- Cloudflare Access と Moltworker の統合に互換性問題

---

### Phase 2: カスタマイズ + 本番移行評価

**目標**: boxp/arch 固有のカスタムツールを Moltworker に統合し、K8s 版との機能パリティを評価

**タスク**:

| # | タスク | 内容 | 判定基準 |
|---|--------|------|----------|
| 2-1 | カスタムツールの Sandbox 移植 | ghq, gwq, mcp-grafana, Babashka, Codex CLI を Moltworker の Dockerfile に追加 | 各ツールが Sandbox 内で正常動作すること |
| 2-2 | Discord Bot 統合テスト | Moltworker の Discord 連携を設定 | 既存の Discord Bot 機能が Moltworker でも動作すること |
| 2-3 | mcp-grafana 統合テスト | Sandbox 内から mcp-grafana が Grafana API にアクセス可能か | Grafana ダッシュボード参照・メトリクス取得が動作すること |
| 2-4 | DinD 代替手段の検証 | Sandbox SDK の exec API で Docker CLI 相当の操作が可能か | `未検証`: Sandbox 内で `docker build` / `docker run` が実行可能か。不可の場合、Moltworker の exec() で代替できる範囲を特定 |
| 2-5 | パフォーマンス比較 | K8s 版 vs Moltworker 版の応答レイテンシ・安定性を測定 | 応答レイテンシが K8s 版の 2x 以内。24h 連続稼働テスト |
| 2-6 | コスト実測 | 1週間の実稼働でのコスト計測 | 月額換算 $50 以下 |
| 2-7 | 本番移行判定 | Phase 2 の結果を総合評価し、K8s 版からの移行可否を判定 | 機能パリティ 80% 以上 + コスト許容範囲 + 安定性確認 |

**arch リポジトリへの変更**:
- Moltworker Dockerfile の更新（カスタムツール追加）
- 必要に応じて Terraform リソースの追加（Logpush 等）

**lolice リポジトリへの変更**:
- 本番移行決定時: K8s 版 OpenClaw の段階的縮退（ただし本 Phase では判定のみ、実際の縮退は別タスク）

**Done criteria**:
- カスタムツールの 80% 以上が Sandbox 内で動作
- 1 週間の安定稼働確認
- 本番移行の Go/No-Go 判定が文書化

**中止基準**:
- カスタムツールの主要機能（ghq/gwq によるリポジトリ操作、mcp-grafana）が動作不可
- レイテンシが K8s 版の 3x 以上
- 月額コストが $50 を超過
- DinD 代替が見つからず、コード実行サンドボックス機能が大幅に制限される

---

## 「Workers で OpenClaw 本体を直接動かす」前提 vs 「Edge Gateway / 周辺機能を置く」前提の分離評価

### 軸1: OpenClaw 本体を Workers/Sandbox で直接実行（Moltworker 方式）

| 評価項目 | 判定 | 根拠 |
|----------|------|------|
| 技術的実現可能性 | **○ 実証済み** | Cloudflare 公式 Moltworker が動作実績あり |
| boxp/arch カスタムとの互換性 | **△ 要検証** | ghq/gwq/mcp-grafana/Babashka/Codex CLI の Sandbox 互換性は未確認 |
| DinD（Docker サンドボックス） | **△ 未検証** | Sandbox 内での Docker デーモン起動の可否は未公開情報 |
| Terraform 管理 | **× 非対応** | Containers/Sandbox は Terraform provider 未対応。Wrangler デプロイ前提 |
| コスト | **△ 要実測** | 24/7 稼働で推定 $30〜35/月。sleepAfter で削減可能だが実測値なし |
| アーキテクチャ移行コスト | **△ 中程度** | LiteLLM → AI Gateway、SSM → Workers Secrets、PV → R2 の移行が必要 |
| 運用負荷 | **○ 低い** | `wrangler deploy` のみ。K8s/ArgoCD の運用不要 |

### 軸2: Edge Gateway + K8s バックエンド（前回候補A相当）

| 評価項目 | 判定 | 根拠 |
|----------|------|------|
| 技術的実現可能性 | **○ 高い** | Workers → Tunnel fetch() は標準機能 |
| boxp/arch カスタムとの互換性 | **○ 影響なし** | K8s 上の OpenClaw に変更不要 |
| DinD | **○ 既存動作** | K8s DinD sidecar がそのまま使える |
| Terraform 管理 | **○ 対応** | `cloudflare_workers_script` + `cloudflare_workers_route` で管理可能 |
| コスト | **○ Free 枠内** | Workers Free 枠（100,000 req/日）で個人利用は十分 |
| アーキテクチャ移行コスト | **○ 最小** | Workers Gateway の追加のみ。既存構成は維持 |
| 運用負荷 | **△ 二重管理** | Workers + K8s の両方を管理。K8s の運用負荷は残る |

### 総合判定

**今回の検証の主軸は軸1（Moltworker）とする**。理由:

1. Xポスト（https://x.com/cloudflare/status/2021739474049544648）の検証対象がMoltworker であること
2. Cloudflare 公式の動作実績があり、「一般論ベースの推測」ではない
3. K8s クラスター（lolice）のリソース制約からの解放が本来の動機
4. 軸2（Gateway）は従来計画で十分評価済み

ただし、**軸1が不適合と判定された場合のフォールバックとして軸2を維持**する。

---

## Source Links（各判断と 1:1 対応）

| 判断 | 根拠ソース |
|------|-----------|
| Moltworker の存在と動作実績 | https://blog.cloudflare.com/moltworker-self-hosted-ai-agent/ |
| Moltworker リポジトリ | https://github.com/cloudflare/moltworker |
| X ポスト（検証起点） | https://x.com/cloudflare/status/2021739474049544648 |
| Cloudflare Containers ステータス（Public Beta） | https://developers.cloudflare.com/containers/ |
| Containers リソース制限 | https://developers.cloudflare.com/containers/platform-details/limits/ |
| Containers 料金体系 | https://developers.cloudflare.com/containers/pricing/ （`未検証`: 直接確認ではなく WebFetch による間接取得）|
| Containers Get Started（wrangler.toml 構成） | https://developers.cloudflare.com/containers/get-started/ |
| Containers WebSocket 対応 | https://developers.cloudflare.com/containers/examples/websocket/ |
| Containers Blog 発表（2025年4月） | https://blog.cloudflare.com/cloudflare-containers-coming-2025/ |
| Containers Public Beta 発表（2025年6月） | https://blog.cloudflare.com/containers-are-available-in-public-beta-for-simple-global-and-programmable/ |
| Sandbox SDK ドキュメント | https://developers.cloudflare.com/sandbox/ |
| Cloudflare Terraform Provider v5.17.0 | https://developers.cloudflare.com/changelog/2026-02-12-terraform-v5170-provider/ |
| Workers IaC ドキュメント | https://developers.cloudflare.com/workers/platform/infrastructure-as-code/ |
| @cloudflare/containers NPM パッケージ | https://github.com/cloudflare/containers |
| boxp/arch リポジトリ（Cloudflare Terraform） | `terraform/cloudflare/b0xp.io/openclaw/` (dns.tf, tunnel.tf, access.tf) |
| boxp/arch リポジトリ（Docker） | `docker/openclaw/Dockerfile` |
| boxp/arch リポジトリ（AWS SSM） | `terraform/aws/openclaw/ssm.tf` |
| OpenClaw ベースイメージ | `ghcr.io/openclaw/openclaw:2026.2.15` |
| InfoQ 記事（Moltworker 解説） | https://www.infoq.com/news/2026/02/cloudflare-moltworker/ |

### 未検証事項（根拠なし）

| 項目 | 未検証の理由 |
|------|------------|
| Sandbox 内での Docker デーモン（dockerd）起動の可否 | Cloudflare ドキュメントに明記なし。Moltworker も DinD は使っていない |
| AI Gateway の Terraform リソース対応 | Provider v5 ドキュメントを網羅的に確認していない |
| ghcr.io/openclaw/openclaw の amd64 ビルド提供状況 | Docker Hub / GHCR を直接確認していない |
| Containers の GA 時期 | Cloudflare から GA ロードマップの公式発表なし |
| Moltworker と OpenClaw 特定バージョンの互換性 | Moltworker README にバージョンピン情報なし |
| Workers Secrets の上限数 | Cloudflare ドキュメントで確認していない（現行 SSM は 13 パラメータ）|
| R2 FUSE マウントのパフォーマンス特性 | R2 マウントの IOPS / レイテンシは未公開 |
| sleepAfter 設定時のコールドスタート時間 | Moltworker README に「1-2分」の記載あるが実測値なし |

---

## 付録: Moltworker の必要シークレット vs 現行 SSM パラメータの対応

| 現行 SSM パラメータ | Moltworker 対応 | 移行方針 |
|---------------------|----------------|----------|
| ANTHROPIC_API_KEY | ANTHROPIC_API_KEY（または AI Gateway 経由） | Workers Secret に設定 |
| DISCORD_BOT_TOKEN | DISCORD_BOT_TOKEN | Workers Secret に設定 |
| OPENCLAW_GATEWAY_TOKEN | MOLTBOT_GATEWAY_TOKEN（名称変更） | Workers Secret に新規設定 |
| LITELLM_MASTER_KEY | 不要（AI Gateway に置換） | 移行不要 |
| LITELLM_PROXY_KEY | 不要（AI Gateway に置換） | 移行不要 |
| GITHUB_TOKEN | Sandbox 環境変数として注入 | Workers Secret に設定 |
| OPENAI_API_KEY | AI Gateway 経由（または直接） | Workers Secret に設定 |
| GEMINI_API_KEY | AI Gateway 経由（または直接） | Workers Secret に設定 |
| CLAUDE_CODE_OAUTH_TOKEN | Sandbox 環境変数として注入 | Workers Secret に設定 |
| DISCORD_ALLOWED_USER_IDS | Sandbox 環境変数として注入 | Workers Secret に設定 |
| XAI_API_KEY | AI Gateway 経由（または直接） | Workers Secret に設定 |
| GRAFANA_API_KEY | Sandbox 環境変数として注入 | Workers Secret に設定 |
| tunnel-token | 不要（Tunnel は Moltworker では不使用） | 移行不要 |

---

*本計画は実装を含まない。Phase 0 の結果に基づき、Phase 1/2 の実施可否を判断する。*
