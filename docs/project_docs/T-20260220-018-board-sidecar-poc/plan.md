# T-20260220-025: board-server board.md 配信遅延問題 調査報告

## 1. 調査目的

board-server 側で `board.md` の変更が反映されず古い内容が配信される問題について、PVC/volume 構成・nginx 設定・キャッシュ制御・更新反映メカニズムを横断的に調査し、原因候補と改善案を特定する。

> **注記**: 本調査はコード・設定ファイルの静的解析に基づく。クラスタ上での実測（hash比較・`cf-cache-status` 確認等）は未実施であり、原因の確定には本ドキュメント セクション7 の検証手順を実行する必要がある。

---

## 2. 調査対象のシステム構成

### 2.1 全体アーキテクチャ

```
ブラウザ → Cloudflare Access (GitHub認証)
         → Cloudflare Tunnel (board.b0xp.io)
         → cloudflared Pod (namespace: openclaw)
         → openclaw Service :8080
         → openclaw Pod / board-server サイドカー (nginx :8080)
           └── PVC openclaw-data (readOnly) → /data/workspace/tasks/board.md
```

### 2.2 実装状況

| コンポーネント | リポジトリ | ステータス |
|---|---|---|
| DNS (`board.b0xp.io` CNAME) | boxp/arch `terraform/cloudflare/b0xp.io/openclaw/dns.tf` | **適用済み** (main) |
| Tunnel ingress rule (`:8080`) | boxp/arch `terraform/cloudflare/b0xp.io/openclaw/tunnel.tf` | **適用済み** (main) |
| Access Application + Policy | boxp/arch `terraform/cloudflare/b0xp.io/openclaw/access.tf` | **適用済み** (main) |
| board-server サイドカー | boxp/lolice `argoproj/openclaw/deployment-openclaw.yaml` | ブランチ `T-20260220-018-board-sidecar-poc` (commit `123bf96`) |
| ConfigMap (nginx.conf + HTML) | boxp/lolice `argoproj/openclaw/kustomization.yaml` configMapGenerator | ブランチ `T-20260220-018-board-sidecar-poc` |
| Service port `:8080` 追加 | boxp/lolice `argoproj/openclaw/service-openclaw.yaml` | ブランチ `T-20260220-018-board-sidecar-poc` |
| NetworkPolicy `:8080` 許可 | boxp/lolice `argoproj/openclaw/networkpolicy.yaml` | ブランチ `T-20260220-018-board-sidecar-poc` |

---

## 3. PVC / Volume 構成の調査

### 3.1 PVC 定義

```yaml
# boxp/lolice: argoproj/openclaw/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: openclaw-data
  namespace: openclaw
spec:
  accessModes:
    - ReadWriteOnce       # 同時に1ノードからのみマウント可能
  storageClassName: longhorn
  resources:
    requests:
      storage: 10Gi
```

**注意点**: `ReadWriteOnce` は「同時に1ノードからのみマウント可能」という制約である（CSI実装によっては同一ノード上の複数Podからマウント可能なケースもある）。board-server サイドカーは同一 Pod 内に配置されており、同一ノード制約を満たしている。

### 3.2 Volume Mount マッピング

| コンテナ | マウント先 | subPath | readOnly | PVC上のパス |
|---|---|---|---|---|
| `openclaw` | `/home/node/.openclaw` | なし | No | `/` (PVCルート) |
| `openclaw` | `/home/node/ghq` | `ghq` | No | `/ghq` |
| `board-server` | `/data` | なし | **Yes** | `/` (PVCルート) |

`board.md` のパスマッピング:
- openclaw コンテナ内: `/home/node/.openclaw/workspace/tasks/board.md`
- board-server コンテナ内: `/data/workspace/tasks/board.md`
- PVC 上の相対パス: `workspace/tasks/board.md`

**評価**: board-server の PVC マウントは subPath を使用していないため、Kubernetes の既知の subPath inotify 問題は回避されている。同一 Pod 内の同一 PVC マウントであり、カーネルの page cache は共有されるため、ファイルシステムレベルでの不整合は通常発生しない。

---

## 4. Nginx 設定の調査

### 4.1 nginx.conf (`board-server-config-nginx` ConfigMap)

```nginx
server {
    listen 8080;
    server_name _;

    # Security headers applied globally
    add_header Content-Security-Policy "..." always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        root /usr/share/nginx/html;
        index index.html;
    }

    location = /api/board.md {
        alias /data/workspace/tasks/board.md;
        default_type "text/markdown; charset=utf-8";
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header CDN-Cache-Control "no-store" always;
        open_file_cache off;
    }

    location = /healthz {
        access_log off;
        return 200 "ok";
        add_header Content-Type text/plain;
    }
}
```

### 4.2 キャッシュ制御の分析

| レイヤー | 設定 | 効果 | 評価 |
|---|---|---|---|
| Nginx `open_file_cache` | `off` | ファイルディスクリプタ・メタデータキャッシュ無効 | **OK** |
| Nginx `sendfile` | 未指定（`nginx:alpine` デフォルト: `on`） | カーネル空間でファイル転送（`read()`/`sendfile()` いずれも page cache を使用） | **OK**（後述） |
| HTTP `Cache-Control` | `no-store, no-cache, must-revalidate` | ブラウザキャッシュ抑止 | **OK** |
| HTTP `Pragma` | `no-cache` | HTTP/1.0 互換性 | **OK** |
| HTTP `CDN-Cache-Control` | `no-store` | Cloudflare Edge キャッシュ抑止 | **OK** |
| Cloudflare `proxied` | `true` (dns.tf) | Cloudflare Edge を経由 | **要確認** |
| Nginx `etag` | 未指定（デフォルト: `on`） | ETag ヘッダーが返る → 条件付きリクエストの可能性 | **要確認** |

### 4.3 `sendfile` に関する補足

`sendfile on`（デフォルト）と `sendfile off` の違いは、ファイル転送にカーネルの `sendfile()` システムコールを使うか `read()` + `write()` を使うかの違いである。**いずれの場合もカーネルの page cache を経由する**ため、`sendfile` の on/off は page cache の鮮度に影響しない。

同一 Pod 内で同一 PVC をマウントしている場合、書き込みコンテナ（openclaw）と読み取りコンテナ（board-server）は同一カーネル・同一ブロックデバイスを共有しており、page cache はプロセス間で統一されている。したがって、`sendfile` の設定は本問題の直接的な原因にはならない。

---

## 5. 古い内容が配信される原因の推定

### 5.1 原因候補一覧

| # | 原因候補 | 可能性 | 根拠 |
|---|---|---|---|
| **C1** | **Cloudflare Edge キャッシュ** | **中** | `CDN-Cache-Control: no-store` で抑止しているが、Cloudflare の挙動はプラン・ゾーン設定・Page Rules/Cache Rules により異なる。`cf-cache-status` ヘッダーの実測が必要 |
| **C2** | **ETag / 条件付きリクエスト** | **低〜中** | Nginx がデフォルトで ETag を返すため、理論上はブラウザが `If-None-Match` を送り 304 が返る可能性がある。ただし `no-store` を正しく実装するブラウザでは発生しない。実測（アクセスログの 304 確認や DevTools のネットワークタブ確認）で確度を判定する必要がある |
| **C3** | **ポーリング間隔（5秒）** | **低（仕様内）** | フロントエンドは 5秒間隔でポーリングしているため、理論上最大 5秒の遅延は設計上の仕様 |
| **C4** | **board.md の atomic write パターン** | **低** | `sed -i` や `mv` を使ったアトミック書き込みでは inode が変わるが、同一 PVC 上で VFS が正しくパス解決するため通常は問題にならない |
| **C5** | **Longhorn レプリカ同期のレイテンシ** | **低** | Longhorn がレプリカ間同期を行う際に一時的に古いデータが読める可能性はあるが、同一 Pod 内の同一ノードでは該当しない |

### 5.2 最有力候補: C1 — Cloudflare Edge キャッシュ

Cloudflare の `proxied: true`（DNS レコード）設定により、全 HTTP トラフィックは Cloudflare Edge を経由する。以下の条件が重なると、`CDN-Cache-Control: no-store` を設定していてもキャッシュが行われる可能性がある:

- **Cloudflare Cache Rules / Page Rules**: ゾーンレベルで特定パスのキャッシュルールが設定されている場合、`CDN-Cache-Control` ヘッダーよりルールが優先される
- **Cloudflare のデフォルト動作**: 拡張子が `.md` のリソースは通常キャッシュ対象外だが、明示的なルールがある場合は例外
- **Access Application の影響**: Cloudflare Access を経由する場合のキャッシュ挙動は、通常の CDN キャッシュとは異なる場合がある

**検証方法**:

> **注意**: `board.b0xp.io` は Cloudflare Access で保護されているため、認証なしの `curl` は 302/403 を返す。以下のいずれかの方法で認証済みリクエストを送る必要がある:
> - **方法A (Service Token)**: Cloudflare Access の Service Token を発行し、`CF-Access-Client-Id` / `CF-Access-Client-Secret` ヘッダーを付与する
> - **方法B (Cookie)**: ブラウザで認証後、DevTools から `CF_Authorization` Cookie を取得し、`-b "CF_Authorization=<token>"` として `curl` に渡す
> - **方法C (クラスタ内部)**: cloudflared Pod 経由ではなく、クラスタ内から直接 `curl http://openclaw.openclaw.svc.cluster.local:8080/api/board.md` にアクセスする（Cloudflare Edge をバイパスして Nginx レスポンスを直接確認）

```bash
# 方法C（クラスタ内から直接確認、Cloudflare Edge をバイパス）
kubectl exec -n openclaw deploy/openclaw -c board-server -- \
  wget -qS -O /dev/null http://localhost:8080/api/board.md 2>&1

# 方法B（認証Cookie付きで Cloudflare Edge 経由を確認）
# まず HTTP status=200 かつ content-type が text/markdown であることを確認
# （302/403 の場合は Access 認証エラーであり、cf-cache-status は board.md の値ではない）
curl -sI -b "CF_Authorization=<token>" https://board.b0xp.io/api/board.md | grep -iE 'HTTP/|content-type|cf-cache-status'
```

- `cf-cache-status: DYNAMIC` → Cloudflare がキャッシュ対象外と判定（正常）
- `cf-cache-status: MISS` → キャッシュ対象だがキャッシュになかった（初回アクセスでは正常、繰り返し MISS なら Cache Rules 確認）
- `cf-cache-status: HIT` → Cloudflare Edge でキャッシュされたレスポンスを返している（問題）
- `cf-cache-status: EXPIRED` / `REVALIDATED` → キャッシュが期限切れ後にオリジンへ再検証（`no-store` が効いていない可能性、要調査）

### 5.3 副次候補: C2 — ETag / 条件付きリクエスト

Nginx はデフォルトで `etag on` であり、レスポンスに `ETag` ヘッダーを含める。ブラウザが次回リクエスト時に `If-None-Match` ヘッダーを送ると、ファイルが変更されていない場合に Nginx は 304 Not Modified を返す。

`Cache-Control: no-store` を正しく実装するブラウザでは、レスポンスを保存しないため条件付きリクエスト自体が発生しない。ただし RFC 7234 の解釈やブラウザ実装のばらつきにより、一部環境で条件付きリクエストが送られる可能性は排除できない。

**検証方法**:
```bash
# クラスタ内から直接確認（Cloudflare Access をバイパス）
kubectl exec -n openclaw deploy/openclaw -c board-server -- \
  wget -qS -O /dev/null http://localhost:8080/api/board.md 2>&1 | grep -i etag

# 認証Cookie付きで Cloudflare Edge 経由を確認（セクション 5.2 参照）
curl -sI -b "CF_Authorization=<token>" https://board.b0xp.io/api/board.md | grep -i etag
```

---

## 6. 改善案

### 6.1 検証優先: Cloudflare キャッシュ状態の確認（推奨度: 最高）

改善策を適用する前に、まず `cf-cache-status` を実測して問題の所在を特定する。

> **注意**: Cloudflare Access 保護下のため、認証済みリクエストが必要（セクション 5.2 の検証方法を参照）。

```bash
# クラスタ内から直接確認（Cloudflare Edge をバイパス）
kubectl exec -n openclaw deploy/openclaw -c board-server -- \
  wget -qS -O /dev/null http://localhost:8080/api/board.md 2>&1

# board.md を更新し、クラスタ内から即座にレスポンスを取得して内容を比較
kubectl exec -n openclaw deploy/openclaw -c openclaw -- \
  sh -c 'echo "<!-- test: $(date -Iseconds) -->" >> /home/node/.openclaw/workspace/tasks/board.md'
sleep 1
kubectl exec -n openclaw deploy/openclaw -c board-server -- \
  wget -qO- http://localhost:8080/api/board.md 2>/dev/null | tail -1

# クリーンアップ: 検証用の追記行を削除
kubectl exec -n openclaw deploy/openclaw -c openclaw -- \
  sed -i '/<!-- test:/d' /home/node/.openclaw/workspace/tasks/board.md
```

### 6.2 Nginx 設定の強化: `etag off`（推奨度: 高）

nginx.conf の `location = /api/board.md` ブロックに `etag off` を追加し、ETag ヘッダーの生成を停止する。

```nginx
location = /api/board.md {
    alias /data/workspace/tasks/board.md;
    default_type "text/markdown; charset=utf-8";
    etag off;                                              # 追加
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header CDN-Cache-Control "no-store" always;
    open_file_cache off;
}
```

**効果**: ETag ヘッダーが返らなくなることで、ブラウザが条件付きリクエスト（`If-None-Match`）を送る動機がなくなる。`no-store` と合わせた多層防御として有効。

> **注記**: `if_modified_since off` は Nginx が `If-Modified-Since` リクエストヘッダーに対して 304 を返す挙動を無効にする設定だが、`etag off` と合わせることで条件付きキャッシュの余地を大幅に減らせる。ただし `no-store` が正しく機能している環境ではブラウザ側からそもそも条件付きリクエストは送られないため、あくまで防御的措置である。

### 6.3 Cloudflare Cache Rules の確認・追加（推奨度: 中）

`cf-cache-status: HIT` が確認された場合、Cloudflare ダッシュボードで以下を確認:

1. ゾーンレベルの Page Rules / Cache Rules に `/api/*` パスのキャッシュルールがないか
2. 必要に応じて `board.b0xp.io/api/*` パスに対する「Cache Level: Bypass」ルールを追加

### 6.4 監視: board.md の hash 比較手順（推奨度: 中）

```bash
# Nginx 内部比較ワンライナー（クラスタ内から直接確認、Cloudflare Access をバイパス）
DISK=$(kubectl exec -n openclaw deploy/openclaw -c board-server -- md5sum /data/workspace/tasks/board.md | cut -d' ' -f1)
HTTP=$(kubectl exec -n openclaw deploy/openclaw -c board-server -- wget -qO- http://localhost:8080/api/board.md 2>/dev/null | md5sum | cut -d' ' -f1)
[ "$DISK" = "$HTTP" ] && echo "OK: hashes match" || echo "MISMATCH: disk=$DISK http=$HTTP"
```

Cloudflare Edge 経由の比較が必要な場合は、認証Cookie付きの `curl` を使用する（セクション 5.2 参照）。

---

## 7. board.md 最新性の判定手順

### 7.1 4点比較法

board.md の最新性を判定するために、以下の4地点で hash を比較する:

```
#1 [PVC上のファイル]
  → #2 [board-server コンテナ内のファイル]
    → #3 [Nginx HTTPレスポンス (localhost, Cloudflare バイパス)]
      → #4 [Cloudflare Edge 経由の HTTPレスポンス (外部)]
```

```bash
# Pod名を固定（Deployment に複数 Pod がある場合、呼び出しごとに別 Pod に当たるのを防ぐ）
POD=$(kubectl get pod -n openclaw -l app.kubernetes.io/name=openclaw -o name | head -n1)

# 1. PVC上のファイル (openclaw コンテナ経由)
kubectl exec -n openclaw "$POD" -c openclaw -- \
  md5sum /home/node/.openclaw/workspace/tasks/board.md

# 2. board-server コンテナ内のファイル
kubectl exec -n openclaw "$POD" -c board-server -- \
  md5sum /data/workspace/tasks/board.md

# 3. Nginx HTTPレスポンス（クラスタ内 localhost、Cloudflare をバイパス）
kubectl exec -n openclaw "$POD" -c board-server -- \
  wget -qO- http://localhost:8080/api/board.md 2>/dev/null | md5sum

# 4. Cloudflare Edge 経由（認証Cookie付き、セクション 5.2 参照）
# 注意: HTTP status=200 かつ content-type が text/markdown であることを先に確認する
curl -sI -b "CF_Authorization=<token>" https://board.b0xp.io/api/board.md | head -5
curl -s -b "CF_Authorization=<token>" https://board.b0xp.io/api/board.md | md5sum
```

### 7.2 判定ロジック

| #1 vs #2 | #2 vs #3 | #3 vs #4 | 推定原因 |
|---|---|---|---|
| 一致 | 一致 | 一致 | 問題なし（フロントJSポーリング待ちの可能性） |
| 一致 | **不一致** | — | **Nginx の内部キャッシュまたは設定の問題**（board-server コンテナ内のファイルとNginx HTTPレスポンスの不整合） |
| 一致 | 一致 | **不一致** | **Cloudflare Edge キャッシュ**（Nginx は最新を返しているが、Cloudflare Edge で古いレスポンスがキャッシュされている） |
| **不一致** | — | — | **採取タイミング競合（更新中に測定）、パス誤認、またはまれに PVC マウントの不整合**。同一 Pod 内の同一 PVC マウントでは通常は同一実体を参照するため、まず採取タイミングとコマンド実行条件を疑い、再現性を確認すること |

> **注意**: `kubectl exec` による hash 採取は逐次実行のため、コマンド間に board.md が更新されると正常系でも不一致となる。正確な判定のためには以下の条件を守ること:
> 1. board.md の更新を一時停止した状態で採取する
> 2. または、短時間で複数回採取して再現性を確認する
> 3. mtime（セクション 7.3）も合わせて確認する

### 7.3 mtime 確認

```bash
# ファイルの最終更新時刻を確認
kubectl exec -n openclaw deploy/openclaw -c openclaw -- \
  stat -c '%Y %n' /home/node/.openclaw/workspace/tasks/board.md

kubectl exec -n openclaw deploy/openclaw -c board-server -- \
  stat -c '%Y %n' /data/workspace/tasks/board.md
```

両コンテナで mtime が一致すれば PVC 層が正常である可能性が高い。ただし mtime 一致は補助指標であり、内容の一致（hash 比較）と合わせて判定すること。

---

## 8. OpenClaw → board.md 更新後の Nginx 反映フローのレビュー

### 8.1 現在のフロー

```
1. openclaw が board.md を書き換え
     ↓
2. カーネルが page cache を更新（同一ノード・同一PVCのため即座に反映）
     ↓
3. board-server (nginx) が次のリクエストで board.md を読み取り
   - open_file_cache off → 毎回 open() + read() (fd キャッシュなし)
   - page cache 経由 → 書き込み直後のデータが読める
     ↓
4. HTTP レスポンス (Cache-Control: no-store, CDN-Cache-Control: no-store)
     ↓
5. [Cloudflare Edge] → [ブラウザ]
     ↓
6. フロントエンド JS が 5秒間隔でポーリング → DOM 更新
```

### 8.2 確認事項

- ステップ 2→3: 同一 Pod 内・同一カーネルの page cache 共有により、ファイルシステムレベルでの遅延は発生しない。PVC の readOnly マウントは書き込み防止のみであり、読み取り時の page cache には影響しない。
- ステップ 4→5: Cloudflare Edge を経由するため、`cf-cache-status` が `DYNAMIC` であることを実測で確認する必要がある。
- ステップ 5→6: 5秒間隔のポーリングは設計上の遅延であり、SLO（≤10秒）の範囲内。

### 8.3 リスクポイント

主要なリスクポイントは以下の2つである:
- **Cloudflare Edge 層**（ステップ 4→5）: Nginx → Cloudflare 間でキャッシュが発生すると、`no-store` ヘッダーが無視される形でクライアントに古いレスポンスが返る。`cf-cache-status` の実測で確定・排除できる。
- **ETag による条件付きキャッシュ**（ステップ 3→4）: Nginx がデフォルトで ETag を返すため、一部環境でブラウザが 304 Not Modified を受け取る可能性がある（セクション 5.3 参照）。

---

## 9. まとめ

### 課題

1. **Cloudflare Edge キャッシュの挙動が未検証** — `CDN-Cache-Control: no-store` で抑止しているが、ゾーン設定・Page Rules/Cache Rules の影響で実際にキャッシュが発生していないか実測が必要
2. **ETag ヘッダーが有効のまま** — Nginx デフォルトで ETag が返るため、条件付きリクエストの余地がある（`no-store` が正しく機能する環境では影響ないが、防御的に無効化が望ましい）
3. **更新の整合性を監視する手段がない** — PVC ↔ HTTP レスポンスの hash 比較を手動で行う必要がある

### 改善案の優先度

| 優先度 | 改善案 | 対象 |
|---|---|---|
| **P0** | `cf-cache-status` の実測確認 | 運用手順（`curl -sI`） |
| **P1** | `etag off` 追加 | `board-server/nginx.conf` |
| **P2** | Cloudflare Cache Rules で `/api/*` をバイパス（C1確定時） | Cloudflare ダッシュボード or Terraform |
| **P3** | hash 比較による監視手順の確立 | 運用ドキュメント |

### 推奨手順

1. 認証済みリクエスト（セクション 5.2 参照）で `cf-cache-status` を確認し、Cloudflare Edge キャッシュの有無を特定。クラスタ内からの直接確認も併用する
2. lolice リポジトリの `T-20260220-018-board-sidecar-poc` ブランチで nginx.conf に `etag off` を追加
3. 本ドキュメントのセクション 7「board.md 最新性の判定手順」に従い 4点比較で検証
4. `cf-cache-status: HIT` が確認された場合、Cloudflare Cache Rules で `board.b0xp.io/api/*` に「Cache Level: Bypass」を設定
