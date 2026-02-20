# T-20260220-017: board.md Web可視化改善計画

## 1. 背景と目的

OpenClawワークスペースのタスク管理はMarkdownベースの `board.md`（Kanbanボード）で運用されている。
現状はテキストエディタまたはCLIでの閲覧に限られ、以下の運用課題がある:

- **閲覧性**: ステータス別の俯瞰ビューが得られない
- **アクセス手段**: SSH/エディタ接続が必要で、モバイルやブラウザからの確認が困難
- **更新反映ラグ**: board.mdの実態と表示にラグがあるとボードとしての意味を失う

### 1.1 更新反映SLO（Service Level Objective）

board.mdの変更がWebビューに反映されるまでの許容遅延を以下の通り定義する:

| SLOレベル | 反映遅延 | 許容条件 |
|-----------|----------|----------|
| **P0（必須）** | **≤ 10秒** | ファイルシステム上のboard.md変更がWeb表示に反映されるまで |
| P1（推奨） | ≤ 3秒 | ブラウザの手動リロード時に最新内容が表示されること |
| P2（理想） | リアルタイム | ファイル変更を検知し自動的にWebビューが更新される（WebSocket等） |

**選定根拠**: R2/KV等の中間ストレージを経由する方式では、同期cron間隔 + CDN TTLで数分のラグが発生し、P0を満たせない。ファイルシステム直接参照が必須。

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

### 2.2 正規化方針（段階的）

> **注**: 以下の「正規化ステップ」は導入Phase（セクション6）とは別の概念である。

**正規化ステップ0（現状維持）**: 既存フォーマットをそのままレンダリングする。パースは見出しレベルのみ。

**正規化ステップ1（将来）**: YAML frontmatter + 見出し正規化（ステップ0が安定してから）

---

## 3. アーキテクチャ比較

### 3.1 案一覧

| # | 案 | 概要 | ラグ |
|---|-----|------|------|
| **E** | **OpenClawコンテナ直接配信（推奨）** | openclawコンテナまたはサイドカーがPV上のboard.mdを直接読み取り、Tunnel経由で配信。フロント側でHTML化 | **≤ 3秒** |
| A | Cloudflare Workers (read-through) | WorkerがR2/GitHub APIからboard.mdを取得しMarkdownレンダリング | 数十秒〜数分 |
| B | Cloudflare Pages + GitHub連携 | Pages projectでboard.mdを含むリポジトリをビルド＆デプロイ | 数分 |
| C | クラスタ内 Read-only Webサーバー (別Pod) | lolice cluster内に別Podを追加、Tunnel経由で公開 | ≤ 10秒 |
| **F** | **GitHub Projects移行** | board.md運用を廃止し、GitHub Projectsに移行 | **0秒（SaaS）** |

### 3.2 推奨案: 案E — OpenClawコンテナ直接配信

**推奨理由**: オーナーレビュー（PR #7112）で指摘の通り、board.mdの実態と表示のラグを最小化するために、ファイルシステム直接参照が最適。

#### 既存インフラとの整合性

| 項目 | 現状 | 案Eでの変更 |
|------|------|------------|
| PVC `openclaw-data` | `/home/node/.openclaw` にマウント | そのまま利用（board.mdはこのPV内） |
| board.mdパス | `/home/node/.openclaw/workspace/tasks/board.md` | 変更なし |
| Cloudflare Tunnel | `openclaw.b0xp.io` → `openclaw:18789` | 同一tunnel上で配信 or 新ingress rule追加 |
| Cloudflare Access | GitHub認証でゲート済み | 既存設定をそのまま流用 |
| サイドカーパターン | config-manager, dind, docker-gc | 必要に応じてboard-server サイドカー追加 |

#### 動作フロー

```
[ブラウザ] → [CF Access (GitHub認証)] → [CF Tunnel]
                                           ↓
    [openclaw Pod / サイドカー: PVからboard.md読み取り → raw MD返却]
                                           ↓
    [ブラウザ JS: marked.js でMarkdown→HTML変換 → DOM描画]
```

#### 実装パターン

**パターンE-1: OpenClawにHTTPエンドポイント追加**

openclawのgatewayサーバー（ポート18789）に `/board` エンドポイントを追加し、board.mdの内容をレスポンスとして返す。

- 利点: 追加コンテナ不要、tunnel ingress変更なし
- 欠点: openclaw本体への変更が必要

**パターンE-2: サイドカーでboard-serverを追加**

openclawと同一PVをマウントする軽量HTTPサーバー（例: nginx, caddy, またはNode.js）をサイドカーとして追加し、board.mdを配信。

- 利点: openclaw本体への変更不要、関心の分離
- 欠点: サイドカー追加 + tunnel ingress rule追加が必要
- **注意**: PVCが `ReadWriteOnce` のためサイドカーは同一Pod内に限定（別Podでのマウント不可）

**推奨: パターンE-2（サイドカー方式）**

理由: openclaw本体のコードベースに手を入れずに実現でき、board配信のライフサイクルを独立管理できる。

#### セキュリティ

- **HTMLサニタイズはフロント側で実施**: `marked.js` でのMarkdown→HTML変換後、`DOMPurify`でサニタイズしてからDOMに挿入
- **CSPヘッダ**: サイドカーのレスポンスに `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src https:; frame-ancestors 'none'` を付与（marked.js / DOMPurifyはCDNではなくConfigMap経由でNginxにセルフホストし、`script-src 'self'` と整合させる）
- **Cloudflare Access**: 既存のGitHub認証ポリシーで未認証アクセスをブロック
- **URIスキーム制限**: DOMPurifyの設定で `javascript:`, `data:` スキームを禁止

### 3.3 代替案: 案F — GitHub Projects移行

board.md運用を廃止し、GitHub Projects V2（Kanbanビュー）に移行する案。

#### 利点

| 観点 | 説明 |
|------|------|
| **ラグゼロ** | SaaSのため更新は即座に全ユーザーに反映 |
| **GUI操作** | ドラッグ&ドロップでカードを直感的に移動可能 |
| **Issue/PR連携** | Issue/PRのクローズで自動的にステータス変更 |
| **複数ビュー** | Board/Table/Roadmap等の切り替えが標準機能 |
| **インフラ管理不要** | GitHub SaaSにホスティング |
| **外部公開** | Visibilityを「Public」に設定すれば閲覧可能 |

#### 欠点

| 観点 | 説明 |
|------|------|
| **Git追跡性の喪失** | タスク状態変更の履歴がGitリポジトリに残らない |
| **GitHubロックイン** | プラットフォーム依存、データポータビリティが低い |
| **オフライン利用不可** | ネットワーク接続必須 |
| **API複雑性** | GraphQL APIのみ対応。REST APIは非対応 |
| **openclaw自動化との統合コスト** | 既存のboard.md操作スクリプトをGraphQL API呼び出しに全面書き換え |
| **アイテム数制限** | 無料プランで1,200件/プロジェクト |
| **iframeでの埋め込み不可** | カスタムドメインでの閲覧UIを自前構築する場合は別途API連携が必要 |

#### gh CLIでの操作例

```bash
# プロジェクト一覧表示
gh project list --owner boxp

# アイテム一覧
gh project item-list NUMBER --owner boxp

# Draft Issueとしてタスク追加
gh project item-create NUMBER --title "タスク名" --owner boxp

# ステータス変更（カラム移動）
gh project item-edit --project-id PROJECT_ID --id ITEM_ID \
  --field-id STATUS_FIELD_ID --single-select-option-id OPTION_ID
```

### 3.4 比較表

| 評価軸 | E: OpenClaw直接配信 | A: Workers+R2 | F: GitHub Projects |
|--------|:---:|:---:|:---:|
| **更新反映SLO (P0 ≤10秒)** | **✅ ≤3秒** | ❌ 数十秒〜数分 | **✅ 即時** |
| **board.mdとのラグ** | **最小** | 中（sync間隔+TTL） | N/A（board.md廃止） |
| **追加インフラ** | サイドカー1個 | Workers+R2+cron | なし（SaaS） |
| **運用コスト** | 低 | 中 | 低 |
| **実装難易度** | 低 | 中 | 中（移行コスト） |
| **既存自動化との互換性** | **✅ 完全互換** | △ sync仕組み要 | ❌ 全面書き換え |
| **Git追跡性** | ✅（board.mdがGit管理可能） | ✅ | ❌ |
| **オフライン利用** | ✅（CLI） | ✅（CLI） | ❌ |
| **GUI操作** | ❌ | ❌ | ✅ |
| **Issue/PR連携** | ❌ | ❌ | ✅ |
| **セキュリティ** | ✅ Access+DOMPurify+CSP | ✅ Access+サニタイズ+CSP | ✅（GitHub管理） |
| **月次コスト** | $0 | $0 | $0（無料枠内） |

### 3.5 意思決定基準

board.md継続（案E）とGitHub Projects移行（案F）の選択は以下の基準で判断する:

| 基準 | 案E（board.md継続）を選ぶ場合 | 案F（GitHub Projects移行）を選ぶ場合 |
|------|------|------|
| **openclaw自動化との整合性** | 既存のboard.md読み書きスクリプトをそのまま活用したい | openclaw側をGraphQL API統合に全面移行する覚悟がある |
| **変更追跡** | タスク移動・追加のGit履歴が運用上重要 | Git履歴は不要、最新状態が見えれば十分 |
| **GUI操作の必要性** | エンジニア1人運用でCLI/エディタで十分 | 複数メンバーやGUIドラッグ&ドロップが必要 |
| **実装コスト** | サイドカー追加のみで済ませたい | 移行コストを許容し、長期的なSaaS運用に投資したい |
| **プラットフォーム依存** | GitHub以外への移行可能性を残したい | GitHubエコシステムに統合し切りたい |

**現時点の推奨: 案E（OpenClaw直接配信）**

理由:
1. openclaw既存のboard.md操作（読み書き・自動更新）との互換性が最も高い
2. 追加インフラがサイドカー1個と最小限
3. ラグ最小化のSLOをファイルシステム直接参照で確実に達成
4. 将来GitHub Projectsに移行する場合もboard.mdからのデータ移行は容易

---

## 4. 推奨案（案E）の詳細設計

### 4.1 アーキテクチャ図

```
┌─────────────────────────────────────────────────────┐
│  openclaw Pod                                       │
│                                                     │
│  ┌──────────────┐  ┌────────────────────────────┐   │
│  │  openclaw     │  │  board-server (サイドカー)  │   │
│  │  (gateway)    │  │  Nginx / Caddy / Node.js   │   │
│  │  :18789       │  │  :8080                     │   │
│  └──────┬───────┘  └────────────┬───────────────┘   │
│         │                       │                   │
│         └───────┬───────────────┘                   │
│                 │                                   │
│         ┌───────▼───────┐                           │
│         │ PVC:          │                           │
│         │ openclaw-data │                           │
│         │               │                           │
│         │ /home/node/   │                           │
│         │   .openclaw/  │                           │
│         │   workspace/  │                           │
│         │   tasks/      │                           │
│         │   board.md    │                           │
│         └───────────────┘                           │
└───────────────────┬─────────────────────────────────┘
                    │
            ┌───────▼───────┐
            │  cloudflared   │
            │  Deployment    │
            └───────┬───────┘
                    │ Tunnel
            ┌───────▼───────┐
            │  Cloudflare    │
            │  Access        │
            │  (GitHub認証)  │
            └───────┬───────┘
                    │
            ┌───────▼───────┐
            │  ブラウザ       │
            │  marked.js     │
            │  DOMPurify     │
            │  → HTML描画    │
            └───────────────┘
```

### 4.2 board-serverサイドカーの設計

**選択肢:**

| サーバー | イメージサイズ | 設定の容易さ | 備考 |
|---------|-------------|-------------|------|
| Nginx | ~25MB | 中（nginx.conf） | 静的ファイル配信に最適 |
| Caddy | ~40MB | 高（Caddyfile） | HTTPS自動化が不要ならオーバースペック |
| Node.js (express/hono) | ~150MB | 高 | openclaw本体と同一ランタイム |

**推奨: Nginx**

理由: board.mdの単純なファイル配信であり、最軽量かつ信頼性が高い。

**Nginx設定の概要:**

```nginx
server {
    listen 8080;

    # HTMLシェル + セルフホストJS（marked.js, DOMPurify）を返す
    location / {
        root /usr/share/nginx/html;
        index index.html;
        add_header Content-Security-Policy
            "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src https:; frame-ancestors 'none'";
        add_header Cache-Control "public, max-age=3600, stale-while-revalidate=86400";
    }

    # board.md の生データを返す API（常に最新を返す）
    location /api/board.md {
        alias /data/workspace/tasks/board.md;
        default_type text/plain;
        add_header Cache-Control "no-cache";
    }
}
```

> **CSP整合性の注記**: `script-src 'self'` はセルフホストされたJS（marked.min.js, purify.min.js）のみを許可する。CDN配信は使用しない。インラインスクリプトは外部JSファイルに分離して `'self'` で読み込む。

### 4.3 フロントエンド（HTMLシェル）の設計

ブラウザに配信するHTMLシェルは以下の処理を行う:

1. `/api/board.md` からMarkdownテキストを `fetch`
2. `marked.js` でHTMLに変換
3. `DOMPurify` でサニタイズ
4. DOMに挿入して描画
5. （Phase 2）ポーリングまたはWebSocketで自動更新

```
fetch('/api/board.md')
  → marked.parse(md)
  → DOMPurify.sanitize(html)
  → document.getElementById('board').innerHTML = safeHtml
```

### 4.4 Tunnel ingress設計

**パターン1: 新サブドメイン `board.b0xp.io`**

```hcl
ingress_rule {
  hostname = "board.b0xp.io"
  service  = "http://openclaw.openclaw.svc.cluster.local:8080"
}
```

**パターン2: 既存ドメインのパスルーティング `openclaw.b0xp.io/board`**

Cloudflare Tunnelのingress ruleはhostname + pathの組み合わせで `path` 指定が可能だが、運用上の簡潔さと既存パターンとの統一のため、パターン1（新サブドメイン）を採用する。なお、実装時にパスベースルーティングの方が適切と判断された場合は切り替え可能。

---

## 5. セキュリティ: 脅威モデルと対策

### 5.1 脅威モデル

| 脅威 | 混入経路 | 影響 |
|------|----------|------|
| **Stored XSS** | board.mdに `<script>` タグやイベント属性が混入 | 閲覧者のブラウザでスクリプト実行 |
| **Markdown経由XSS** | `javascript:` URIの埋め込み | クリック時にスクリプト実行 |
| **外部由来テキスト取り込み** | openclawが外部ソースからテキストを取り込む際のサニタイズ漏れ | 間接的なスクリプト注入 |

### 5.2 多層防御戦略

| 層 | 対策 | 実装 |
|----|------|------|
| **L1: Cloudflare Access** | 未認証アクセスをブロック | 既存のGitHub認証ポリシー |
| **L2: CSPヘッダ** | ブラウザ側でのスクリプト実行を制限 | Nginxレスポンスヘッダで付与 |
| **L3: DOMPurifyサニタイズ** | `marked.js` 変換後のHTMLをフロント側で浄化 | `DOMPurify.sanitize(html)` |
| **L4: URIスキーム制限** | `javascript:`, `data:` スキーム禁止 | DOMPurify設定で制御 |

---

## 6. 段階導入計画 (Phase)

### Phase 1: 最小実装（MVP）— 目安 1-2日

**ゴール**: board.mdをブラウザで閲覧可能にする（更新反映 ≤ 3秒）

1. **k8s manifest変更**: `argoproj/openclaw/deployment-openclaw.yaml`
   - board-serverサイドカー（Nginx）を追加
   - PVC `openclaw-data` を `/data` にマウント（readOnly）
   - ConfigMap `board-server-config` でnginx.conf + index.htmlを管理

2. **Terraform**: `terraform/cloudflare/b0xp.io/board/`
   - `tunnel.tf`: 既存openclawトンネルに `board.b0xp.io` → `:8080` のingress rule追加
   - `access.tf`: Access Application + GitHub認証ポリシー
   - `dns.tf`: `board.b0xp.io` → Tunnel CNAME

3. **HTMLシェル**: Nginx ConfigMapに含める
   - marked.js + DOMPurify をセルフホスト（バージョン固定のminifiedファイルをConfigMapまたはDockerイメージに同梱し、CDN依存を排除。`script-src 'self'` CSPと整合）
   - `/api/board.md` をfetchしてレンダリング
   - GitHub Markdown風CSS（インライン）
   - **サプライチェーン対策**: ライブラリはnpm/GitHub Releasesからバージョン固定で取得し、Renovateで定期更新。セルフホストによりCDN改ざんリスクを排除

4. **CI**: 既存のTFAction CIで `terraform plan/apply`

### Phase 2: 自動更新・安定化 — 目安 1週間後

1. **ポーリング自動更新**: フロントJSが30秒間隔で `/api/board.md` を再取得、変更時に再描画
2. **エラーハンドリング**: board.mdが存在しない場合のフォールバック表示
3. **モニタリング**: Nginx accessログをGrafanaに連携

### Phase 3: UI強化（オプション）— 将来

1. **Kanbanビュー**: JSでカラムレイアウト表示
2. **フィルタ・検索**: タスクID、Impact、Repoでのフィルタリング
3. **GitHub Projects移行検討**: 実運用でGUI操作の需要が判明した場合に再評価

---

## 7. リスクと緩和策

| リスク | 影響度 | 緩和策 |
|--------|--------|--------|
| PVC ReadWriteOnce制約 | 低 | サイドカーは同一Pod内のため影響なし |
| Nginxサイドカーのリソース消費 | 低 | メモリ32MB / CPU 50mの制限で十分 |
| board.md形式変更でレンダリング崩れ | 中 | Markdownをそのままレンダリングするため影響は軽微 |
| クラスタ障害時のボード閲覧不可 | 中 | CLI直接アクセスは常時可能。HTMLシェル（index.html, JS, CSS）はCloudflare CDNキャッシュ（`Cache-Control: public, max-age=3600, stale-while-revalidate=86400`）で配信し、クラスタダウン時もシェルは表示可能。board.md APIエンドポイントは `Cache-Control: no-cache` で常に最新を返すが、障害時はフロントJS側でエラーメッセージを表示する |
| XSS | 高 | DOMPurify + CSPヘッダの多層防御で緩和 |

---

## 8. 非スコープの確認

以下は本計画では実施しない:

- ❌ 本番実装・デプロイ（計画書作成のみ）
- ❌ board.md形式の正規化実装（Phase 1では現状フォーマットのまま）
- ❌ GitHub Projects移行の実施（意思決定基準を提示するのみ）
- ❌ Kanbanビュー等のリッチUI実装（Phase 3として計画記載のみ）

---

## 9. 次のアクション

1. 本計画のレビュー・承認
2. Phase 1実装タスクをboard.mdのInboxに追加
3. k8s manifest変更（サイドカー追加）
4. Terraform実装（tunnel ingress + Access + DNS）
5. HTMLシェル + Nginx設定の作成
