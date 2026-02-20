# T-20260220-017: board.md Web可視化改善計画

## 1. 背景と目的

OpenClawワークスペースのタスク管理はMarkdownベースの `board.md`（Kanbanボード）で運用されている。
現状はテキストエディタまたはCLIでの閲覧に限られ、以下の運用課題がある:

- **閲覧性**: ステータス別の俯瞰ビューが得られない
- **アクセス手段**: SSH/エディタ接続が必要で、モバイルやブラウザからの確認が困難
- **更新反映**: board.md を更新するたびにデプロイが必要な仕組みでは運用コストが高い

本計画では **(1) Cloudflare Access越しで常時閲覧できる運用** と **(2) board.md更新ごとのデプロイ不要で静的表示する方式** の両面を比較検討し、推奨案を提示する。

---

## 2. 現状のboard.md構造分析と正規化方針

### 2.1 現在の構造

```markdown
# Task Board (Kanban)
Last Updated: 2026-02-20

## Pending Approvals (Batch)
- [T-20260220-012] タイトル
  - Impact: Medium / Effort: S / Repo: workspace ops
  - Description: ...
  - Source: https://...
  - Depends: T-XXXXXXXX-XXX

## Inbox / Planned / In Progress / Review / Done / Rejected
```

### 2.2 セマンティクス上の課題

| 課題 | 詳細 | 影響 |
|------|------|------|
| メタデータがリスト項目のネスト | `- Impact: ...` がMarkdownリストとして構造化されておらず、パース困難 | 自動抽出・フィルタリング不可 |
| セクション見出しの不統一 | `Pending Approvals (Batch)` vs `Done` など括弧付きの補足が混在 | heading IDの不安定 |
| 依存関係が文字列 | `Depends: T-XXXXXXXX-XXX` がプレーンテキスト | ガントチャート等への展開不可 |
| ステータスの暗黙表現 | Done内のStatusフィールドとセクション位置でステータスが二重管理 | 矛盾発生リスク |

### 2.3 正規化方針（段階的）

**Phase 0（現状維持）**: 既存フォーマットをそのままレンダリングする。パースは見出しレベルのみ。

**Phase 1（推奨）**: YAML frontmatter + 見出し正規化（frontmatterはファイル先頭に配置）

```markdown
---
last_updated: 2026-02-20
---

# Task Board (Kanban)

## Pending Approvals

- **[T-20260220-012]** Cron/Webhook telemetry Phase 1
  - **Impact**: Medium
  - **Effort**: S
  - **Repo**: workspace ops
  - **Description**: ...
  - **Source**: https://...
  - **Depends**: T-20260219-014
```

Phase 1ではbold強調で構造キーを明示し、正規表現での抽出を容易にする。
Web表示側では `##` 見出しをKanbanカラム、`- **[T-...]**` をカードとしてレンダリングできる。

---

## 3. Access保護付き公開手段の比較

### 3.1 案一覧

| # | 案 | 概要 |
|---|-----|------|
| A | **Cloudflare Workers (read-through)** | Workerがリポジトリ/ストレージからboard.mdを取得しMarkdownレンダリング |
| B | **Cloudflare Pages + GitHub連携** | Pages projectでboard.mdを含むリポジトリをビルド＆デプロイ |
| C | **既存クラスタ内 Read-only Webサーバー** | lolice cluster内にNginx/Caddy Podを追加、Cloudflare Tunnel経由で公開 |
| D | **GitHub Pages + Cloudflare Proxy** | GitHubの静的ホスティング + Cloudflare DNS/Access |

### 3.2 詳細比較

#### 案A: Cloudflare Workers (read-through) — **推奨**

**動作フロー:**
1. ユーザーが `board.b0xp.io` にアクセス
2. Cloudflare Access (GitHub認証) でゲート
3. Worker が GitHub API / R2 から最新の board.md を取得
4. Worker がMarkdownをHTMLにレンダリングして返却
5. TTLベースのキャッシュで負荷軽減（例: 60秒）

**利点:**
- デプロイ不要: board.mdの変更は次回アクセス時に自動反映
- 既存のCloudflare Workers運用ノウハウ（moltworker）を活用
- Terraform管理のAccess設定パターンがそのまま流用可能
- サーバーレスでインフラ管理コストゼロ
- KV/Cacheによるレスポンス高速化が容易

**欠点:**
- Workers無料枠の制約（日10万リクエスト、CPU 10ms/呼出）→ 個人利用なら十分
- Markdownレンダリングライブラリのバンドルサイズ考慮が必要

#### 案B: Cloudflare Pages + GitHub連携

**動作フロー:**
1. board.mdを含むリポジトリにpush
2. Cloudflare Pagesが自動ビルド・デプロイ
3. Access設定でゲート

**利点:**
- ビルドパイプラインが自動化
- 静的サイトとしてCDN配信

**欠点:**
- **board.md更新のたびにgit push → ビルド → デプロイが必要**（要件の「デプロイ不要」を満たさない）
- ビルド時間（数十秒〜数分）の遅延
- board.mdがopenclaw workspaceにあり、archリポジトリとは別管理

#### 案C: 既存クラスタ内 Read-only Webサーバー

**動作フロー:**
1. lolice cluster内にNginx Pod + ConfigMap/PVでboard.mdをマウント
2. cloudflared tunnel経由で公開
3. Access設定でゲート

**利点:**
- 既存インフラの延長で構築可能
- ファイルシステム直接参照でリアルタイム反映

**欠点:**
- k8sリソース（Pod/Service/Deployment）の追加管理コスト
- board.mdがPod内に存在する必要がある（git-syncサイドカー等が必要）
- クラスタ障害時にボード閲覧不可

#### 案D: GitHub Pages + Cloudflare Proxy

**動作フロー:**
1. board.mdをGitHub Pagesリポジトリに配置
2. Cloudflare DNSでCNAME → GitHub Pages
3. Access設定でゲート

**利点:**
- 無料のホスティング
- GitHubのCDN利用

**欠点:**
- **push → Pages更新が必要**（デプロイ不要を満たさない）
- Cloudflare Access + GitHub PagesのCNAME設定が煩雑
- GitHub Pagesは公開リポジトリ前提（private pagesはEnterprise）

### 3.3 比較表

| 評価軸 | A: Workers (read-through) | B: Pages | C: クラスタ内 | D: GitHub Pages |
|--------|:---:|:---:|:---:|:---:|
| **デプロイ不要** | ✅ | ❌ | △（git-sync要） | ❌ |
| **運用コスト** | 低 | 中 | 高 | 中 |
| **実装難易度** | 低〜中 | 低 | 中〜高 | 低 |
| **更新反映速度** | 〜60秒（キャッシュTTL） | 数分 | リアルタイム | 数分 |
| **セキュリティ** | ✅ Access統合済み | ✅ Access統合済み | ✅ Tunnel + Access | △ CNAME設定注意 |
| **可用性** | 高（Cloudflare Edge） | 高 | クラスタ依存 | 高 |
| **既存パターン流用** | ✅ moltworker類似 | △ portfolio類似 | ✅ lolice既存 | ❌ 新規 |
| **Terraform管理** | ✅ 既存パターン | △ Pages API | ✅ 既存パターン | ❌ |
| **依存関係** | Cloudflare Workers | Cloudflare Pages + Git | K8s + Tunnel + Git | GitHub + Cloudflare |
| **障害時フォールバック** | CLIアクセス（常時可） | CLIアクセス | CLIアクセス | CLIアクセス |
| **データ鮮度SLO** | ≤60秒（TTL） | 数分（ビルド時間） | リアルタイム（git-sync間隔） | 数分（Pages更新） |
| **月次コスト見積** | $0（無料枠内） | $0（無料枠内） | $0（既存クラスタ） | $0（無料枠内） |

---

## 4. 「デプロイ不要」表示方式の重点比較

### 4.1 方式一覧

| # | 方式 | 概要 |
|---|------|------|
| α | **サーバー側レンダリング (Workers)** | Worker内でMarkdownをHTMLに変換して返却 |
| β | **クライアント側レンダリング** | 最小HTMLシェルを配信し、JSがMarkdownを取得・レンダリング |
| γ | **Read-through + CDN Cache** | Workerがソースを取得しHTMLに変換、KV/Cacheに格納 |

### 4.2 詳細比較

#### 方式α: サーバー側レンダリング (Workers)

```
[ブラウザ] → [CF Access] → [Worker: fetch board.md → render HTML] → [レスポンス]
```

- **Markdownソース取得元**: GitHub API (`GET /repos/:owner/:repo/contents/path`) or R2
- **レンダリング**: `marked` / `markdown-it` 等のJSライブラリをWorkerにバンドル + **Workers互換HTMLサニタイザーでサニタイズ（必須）**
- **キャッシュ**: Cache API で TTL 60秒、stale-while-revalidate パターン

**利点**: SEO対応、初回表示が速い、JSなしで動作
**欠点**: Workerのバンドルサイズ増加（marked: ~40KB gzip）

#### 方式β: クライアント側レンダリング

```
[ブラウザ] → [CF Access] → [Worker: 静的HTMLシェル返却]
                              ↓
              [ブラウザJS: fetch board.md → marked.js → DOM更新]
```

- **HTMLシェル**: 最小のHTML + CSS + `<script>` タグ
- **Markdownソース**: Worker経由のプロキシAPI (`/api/board.md`) or 直接GitHub raw

**利点**: Workerのバンドルサイズ最小、リッチなUI（フィルタ・検索）を後から追加しやすい
**欠点**: JSが必須、初回表示にラウンドトリップ追加

#### 方式γ: Read-through + CDN Cache（αの最適化版）

```
[ブラウザ] → [CF Access] → [CF Cache] → HIT: キャッシュHTML返却
                                       → MISS: [Worker: fetch → render → sanitize → cache store → 返却]
```

- αと同じレンダリングだが、CDN EdgeキャッシュまたはKVを活用
- Cache-Control: `public, max-age=60, stale-while-revalidate=300`
- Webhook (GitHub → Worker) でキャッシュパージも可能（将来拡張）

**利点**: 最小レイテンシ、Worker CPU消費最小化、スケーラビリティ
**欠点**: キャッシュ整合性の考慮が必要（TTLで十分に緩和可能）

### 4.3 方式比較表

| 評価軸 | α: サーバー側 | β: クライアント側 | γ: Read-through Cache |
|--------|:---:|:---:|:---:|
| **初回表示速度** | 速い | やや遅い | 最速 |
| **Worker CPU負荷** | 中 | 低 | 低（キャッシュHIT時ゼロ） |
| **バンドルサイズ** | 〜50KB | 〜5KB | 〜50KB |
| **JS不要** | ✅ | ❌ | ✅ |
| **UI拡張性** | 低 | 高 | 低 |
| **実装難易度** | 低 | 低 | 中 |
| **キャッシュ制御** | 基本的（Cache-Controlヘッダ） | ブラウザ任せ | 精密制御可（Cache API + KV） |

---

## 5. Markdownソースの取得方式

board.mdは現在 `/home/node/.openclaw/workspace/tasks/board.md` に存在し、gitリポジトリには直接含まれていない。ソース取得には以下の選択肢がある:

| # | 方式 | 概要 | 遅延 | 依存 |
|---|------|------|------|------|
| I | **GitHub API** | board.mdをgitリポジトリに同期し、GitHub Contents APIで取得 | 低 | GitHub API rate limit |
| II | **R2 Storage** | openclaw cronがboard.mdをR2にアップロード、Workerが参照 | 最低 | R2バケット（既存: moltbot-data） |
| III | **KV Storage** | 同上だがCloudflare KVに格納 | 最低 | KV namespace |

**推奨: 方式II (R2 Storage)**

理由:
- 既存の `moltbot-data` R2バケットを活用可能
- openclawのcronジョブで `board.md` をR2に定期アップロードする仕組みが自然
- GitHub APIのrate limit問題を回避
- R2はWorkerから直接バインディングでアクセスでき、高速

### 5.2 更新トリガ設計

board.md更新からWeb表示への反映経路は以下の2段階:

| トリガ | 方式 | 反映遅延 | 実装Phase |
|--------|------|----------|-----------|
| **手動** | `wrangler r2 object put` コマンド実行 | 即時（＋キャッシュTTL） | Phase 1 |
| **cronジョブ連動** | openclaw cronの後処理でR2にPUT | cron間隔（例: 5分） | Phase 2 |
| **イベント駆動** | board.md書き込みフック（inotify/post-save hook）でR2にPUT | 即時 | Phase 2（オプション） |

Phase 1ではboard.md更新後に手動で `wrangler r2 object put` を実行する運用とする。
Phase 2でcronジョブ連動またはイベント駆動を導入し、更新即時性を向上させる。

---

## 6. 推奨案

### 総合推奨: 案A + 方式γ + ソースII

**Cloudflare Workers (read-through) + CDN Cache + R2 Storage**

```
[openclaw cron] → board.md → [R2: moltbot-data/board.md]
                                    ↓
[ブラウザ] → [CF Access (GitHub認証)] → [CF Cache]
                                          ↓ MISS
                                    [Worker: R2から取得 → marked.jsでHTML変換 → HTMLサニタイズ → CSPヘッダ付与 → Cache格納 → 返却]
```

**ドメイン**: `board.b0xp.io`

**選定理由:**
1. **デプロイ不要**: board.mdの更新はR2へのアップロードのみ。Worker自体の再デプロイは不要
2. **運用コスト最小**: サーバーレス、既存R2バケット活用、Cloudflare無料枠内
3. **セキュリティ**: Cloudflare Access (GitHub認証) + DOMPurifyサニタイズ + CSPヘッダによる多層防御
4. **既存ノウハウ活用**: moltworkerのTerraform/wrangler設定パターンを流用
5. **段階的拡張**: 将来的にKanbanビューやフィルタ機能をWorker/クライアントJSで追加可能

---

## 7. 段階導入計画 (Phase)

### Phase 1: 最小実装（MVP）— 目安 1-2日

**ゴール**: board.mdをブラウザで閲覧可能にする

1. **Terraform**: `terraform/cloudflare/b0xp.io/board/` ディレクトリ作成
   - `access.tf`: Access Application + GitHub認証ポリシー
   - `tunnel.tf`: 不要（Workers直接公開）
   - `dns.tf`: `board.b0xp.io` → Workers route
   - `r2.tf`: 既存 `moltbot-data` バケットへのWorkerバインディング（新規バケット不要）
   - `provider.tf`, `backend.tf`, `variables.tf`: 既存パターン踏襲

2. **Worker実装**: `docker/board-viewer/`
   - `wrangler.jsonc`: route `board.b0xp.io/*`, R2バインディング
   - `src/index.ts`: R2からboard.md取得 → `marked` でHTML変換 → **HTMLサニタイズ** → レスポンス
   - **HTMLサニタイズ（必須）**: `marked` はデフォルトでサニタイズを行わないため、Workers互換のHTMLサニタイザーをWorker側で適用する。board.mdに混入しうるHTML/scriptタグによるXSSを防止する
     - **ライブラリ選定**: Cloudflare Workers ランタイムでは `jsdom` が動作しないため、以下のいずれかを採用（Phase 1実装時にWorkers互換検証を通過したものを選定）:
       - `sanitize-html`（Workers互換、ホワイトリスト方式、軽量）
       - `dompurify` + `linkedom`（`jsdom` の代替として `linkedom` を使用、Workers互換のDOM実装）
       - HTMLRewriter API（Cloudflare Workers ネイティブ、タグフィルタリングに適用可能）
     - 許可タグ方針: Markdown由来の標準HTML要素のみ（`<h1>`〜`<h6>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<table>`, `<a>`, `<code>`, `<pre>`, `<strong>`, `<em>`, `<blockquote>`, `<img>` 等）
     - 禁止: `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `on*` イベント属性, `javascript:` URI
     - `<a href>` は `https:` / `http:` / 相対パスのみ許可（`javascript:`, `data:` スキーム禁止）
     - `<img src>` は `https:` のみ許可（`data:` URI禁止、外部トラッキング/情報漏洩リスク低減のため）
   - **CSP（Content Security Policy）ヘッダ**: レスポンスに以下を付与
     - `Content-Security-Policy: default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
     - `script-src 'none'`: スクリプト実行の明示的禁止
     - `frame-ancestors 'none'`: clickjacking対策（iframe埋め込み禁止）
     - `img-src https:`: 外部画像は HTTPS のみ許可（`data:` 禁止でSVG/HTML経由の攻撃を防止）
   - 最小CSS（GitHub Markdown風スタイル）をインライン埋め込み
   - Cache-Control ヘッダでCDNキャッシュ（TTL 60秒）

3. **R2アップロード**: openclaw側のcronジョブまたは手動スクリプトでboard.mdをR2にPUT
   - `wrangler r2 object put moltbot-data/board.md --file=board.md`

4. **CI**: 既存のTFAction CIで `terraform plan/apply` + wrangler deploy

### Phase 2: 運用安定化 — 目安 1週間後

1. **自動同期**: openclaw cronジョブにR2アップロードステップを追加
2. **キャッシュパージ**: R2アップロード後にCache APIでパージ（即時反映）
3. **エラーハンドリング**: R2取得失敗時のフォールバック表示
4. **モニタリング**: Worker呼び出し回数・エラー率をGrafanaダッシュボードに追加

### Phase 3: UI強化（オプション）— 将来

1. **Kanbanビュー**: クライアントJSでカラムレイアウト表示
2. **フィルタ・検索**: タスクID、Impact、Repoでのフィルタリング
3. **board.md正規化**: Phase 1形式への移行、構造化パース
4. **履歴表示**: R2のバージョニングで過去のboard状態を閲覧

---

## 8. セキュリティ: 脅威モデルと対策

### 8.1 脅威モデル

board.mdはMarkdownファイルだが、以下の経路でHTML/scriptが混入する可能性がある:

| 脅威 | 混入経路 | 影響 |
|------|----------|------|
| **Stored XSS** | board.mdに `<script>` タグやイベント属性（`onerror` 等）が手動編集で混入 | Access配下の閲覧者のブラウザでスクリプト実行 |
| **Markdown経由XSS** | Markdownの画像構文やリンク構文に `javascript:` URIを埋め込み | クリック時にスクリプト実行 |
| **外部由来テキスト取り込み** | openclawが外部ソース（GitHub Issues等）からテキストを取り込みboard.mdに反映する際、サニタイズ漏れ | 間接的なスクリプト注入 |
| **外部リソース読み込み** | board.mdに外部URLを参照する `<img>` タグや Markdown画像構文が含まれる場合 | 閲覧者のIP・UA等が外部サーバーに送信される（トラッキング/情報漏洩） |

### 8.2 多層防御戦略（Phase 1で全て実装）

| 層 | 対策 | 実装 |
|----|------|------|
| **L1: サーバー側サニタイズ** | `marked` 変換後のHTMLをWorkers互換サニタイザーで浄化 | Worker内で `marked(md)` → サニタイズ（`sanitize-html` / `dompurify+linkedom` / HTMLRewriter のいずれか、Workers互換検証済みのもの） |
| **L2: 許可タグ方針** | ホワイトリスト方式で許可する要素・属性を限定 | `ALLOWED_TAGS`: 標準Markdownで生成されるHTML要素のみ。`FORBID_TAGS`: `script`, `iframe`, `object`, `embed`, `form`。`FORBID_ATTR`: `on*` イベント属性 |
| **L3: URIスキーム制限** | `<a href>`, `<img src>` の許可スキームを限定 | `<a href>`: `https:` / `http:` / 相対パスのみ。`<img src>`: `https:` のみ。`javascript:`, `data:` スキームは全て禁止 |
| **L4: CSPヘッダ** | ブラウザ側でのスクリプト実行・iframe埋め込みを完全禁止 | `Content-Security-Policy: default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |

L1〜L4の多層防御により、仮にDOMPurifyにバイパス脆弱性が発見されてもCSPで防御、CSP未対応ブラウザでもDOMPurifyで防御するフェイルセーフ構造とする。

---

## 9. リスクと緩和策

| リスク | 影響度 | 緩和策 |
|--------|--------|--------|
| Workers無料枠超過 | 低 | 個人利用で日10万req超は想定外。モニタリングで監視 |
| R2からの取得遅延 | 低 | CDNキャッシュで軽減。TTL 60秒で十分 |
| board.md形式変更でパース失敗 | 中 | Phase 1はMarkdown全体をそのままHTMLレンダリングするため影響なし |
| GitHub認証のCloudflare Access障害 | 低 | Cloudflare SLA 99.9%。代替手段としてCLIアクセスは常時可能 |
| board.mdへのHTML/script混入によるXSS | 高 | **Phase 1で必須対策**: (1) DOMPurifyによるサーバー側HTMLサニタイズ（許可タグのホワイトリスト方式）、(2) CSPヘッダでscript実行を完全禁止（`default-src 'none'`）、(3) `<a>` hrefのスキーム制限。外部由来テキスト取り込みや手動編集による混入を想定 |
| marked.jsの脆弱性 | 中 | DOMPurifyによる多層防御で緩和。定期的なdependency update（Renovate）。marked自体のXSS bypassが発見された場合もDOMPurify + CSPで防御 |

---

## 10. 非スコープの確認

以下は本計画では実施しない:

- ❌ 本番実装・デプロイ（計画書作成のみ）
- ❌ board.md全件の自動変換実装
- ❌ Kanbanビュー等のリッチUI実装（Phase 3として計画のみ）
- ❌ openclaw側のcronジョブ変更（Phase 2として計画記載のみ。実装は別タスクで実施）

---

## 11. 次のアクション

1. 本計画のレビュー・承認
2. Phase 1実装タスクをboard.mdのInboxに追加
3. `terraform/cloudflare/b0xp.io/board/` のTerraform実装開始
4. Worker実装 (`docker/board-viewer/`)
5. R2アップロードスクリプト作成
