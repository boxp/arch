# T-20260220-005: Google Calendar / Google Maps 統合計画 (babashka API 実装)

## 概要

OpenClaw から Google Calendar および Google Maps を babashka スクリプト経由で利用可能にする。
Google Calendar API / Google Maps API を babashka の HTTP クライアントで直接呼び出し、
OpenClaw スキルのラッパースクリプトとして統合する。

**スコープ**: 設計・計画のみ。本番 OAuth 接続や実 API キー投入は対象外。

**方針変更 (PR #7092 レビュー反映)**:
gcalcli / googlemaps Python ライブラリを使わず、babashka (`bb`) で Google REST API を
直接呼び出す構成に変更。理由: コンテナに既に bb v1.12.214 がインストール済みであり、
中途半端にサードパーティ CLI/ライブラリを導入するよりも API 直叩きの方がシンプルかつ保守性が高い。

---

## 1. 技術方式

### 1.1 babashka による API 直接呼び出し

| 項目 | 内容 |
|------|------|
| ランタイム | [babashka](https://github.com/babashka/babashka) v1.12.214 (コンテナに導入済み) |
| HTTP クライアント | `babashka.http-client` (babashka 組込み) |
| JSON パーサー | `cheshire.core` (babashka 組込み) |
| 出力形式 | JSON (API レスポンスを直接整形) |
| 対象 API | Google Calendar API v3, Google Maps Geocoding/Directions API |

**利点**:
- 追加の CLI ツール (gcalcli) や Python ライブラリ (googlemaps) のインストールが不要
- API レスポンスが JSON のため、TSV→JSON 変換のような中間処理が不要
- babashka は JVM 不要で起動が高速 (数十 ms)
- 認証フロー (OAuth2 トークンリフレッシュ) もスクリプト内で完結

### 1.2 Google Calendar API v3

| 項目 | 内容 |
|------|------|
| ベース URL | `https://www.googleapis.com/calendar/v3` |
| 認証方式 | OAuth2 Bearer Token |
| 主要エンドポイント | `GET /calendars/{id}/events`, `GET /users/me/calendarList`, `POST /calendars/{id}/events` |
| レスポンス形式 | JSON |

### 1.3 Google Maps API

| 項目 | 内容 |
|------|------|
| Geocoding URL | `https://maps.googleapis.com/maps/api/geocode/json` |
| Directions URL | `https://maps.googleapis.com/maps/api/directions/json` |
| 認証方式 | API Key (クエリパラメータ `key=...`) |
| レスポンス形式 | JSON |

---

## 2. 認証・権限モデル設計

### 2.1 設計原則

- **最小権限 (Least Privilege)**: 初期導入は read-only から開始
- **秘密情報の分離**: API キー / OAuth トークンは環境変数経由で注入
- **トークンライフサイクル管理**: リフレッシュ・失効・ローテーション手順を定義

### 2.2 Google Calendar 認証 (OAuth2)

```
┌─────────────┐    OAuth2     ┌──────────────────────┐
│ Google Cloud │◄────────────►│ bb gcal_*.bb          │
│ Project      │   Bearer     │ (HTTP client で API   │
│              │   Token      │  直接呼び出し)        │
└─────────────┘              └──────────────────────┘
                                     │
                              /token/oauth.json
                              (token cache file)
```

| 項目 | 値 |
|------|-----|
| OAuth スコープ (Phase 0-1) | `https://www.googleapis.com/auth/calendar.readonly` |
| OAuth スコープ (Phase 2+) | `https://www.googleapis.com/auth/calendar.events` (書込み追加時) |
| トークン保存先 | `/token/oauth.json` (emptyDir マウント) |
| リフレッシュ | babashka スクリプトが `https://oauth2.googleapis.com/token` にリフレッシュリクエスト |
| 失効対応 | ローカルで再認証 → Secret 更新 → Pod 再起動 |

**Secret 管理**:
- `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET`: 環境変数で注入
- OpenClaw config (`openclaw.json`) の `channels` セクションには secret を**格納しない**
- K8s 環境では Sealed Secret / External Secrets Operator 経由で Pod に注入

### 2.3 Google Maps 認証 (API Key)

| 項目 | 値 |
|------|-----|
| 認証方式 | API Key |
| 環境変数名 | `GOOGLE_MAPS_API_KEY` |
| API 制限 | Geocoding API, Directions API のみ有効化 (Cloud Console) |
| IP 制限 | サーバー IP / CIDR のみ許可 |
| 課金 | 月 $200 無料クレジット (個人利用で十分) |

**Note**: 既存 `goplaces` スキルは `GOOGLE_PLACES_API_KEY` を使用。
Maps API Key とは別管理 (API ごとの最小権限) とするが、同一キーの共用も可能。

### 2.4 トークン更新・失効手順

| イベント | Calendar (OAuth2) | Maps (API Key) |
|----------|-------------------|----------------|
| トークン期限切れ | bb スクリプトが自動リフレッシュ (oauth2 token endpoint) | N/A (API Key に期限なし) |
| リフレッシュトークン失効 | ローカルで再認証 → Secret 更新 | N/A |
| キーローテーション | Client Secret 再生成 → 環境変数更新 | Cloud Console で新キー発行 → `GOOGLE_MAPS_API_KEY` 更新 |
| セキュリティインシデント | Cloud Console でトークン無効化 → 再認証 | Cloud Console でキー無効化 → 新キー発行 |

### 2.5 インシデント時ローテーション SLA

| イベント | 目標時間 | 検知方法 | 実行責任 | 手順 |
|----------|----------|----------|----------|------|
| API Key 漏えい検知 | 15 分以内に無効化 | GitHub Secret Scanning 自動アラート / Grafana OnCall 通知 | 運用者 (当番 on-call) | Cloud Console → API Key 無効化 → 新キー発行 → 環境変数更新 → Pod 再起動 |
| OAuth トークン漏えい検知 | 15 分以内に無効化 | Cloud Console 監査ログ異常検知 / Grafana OnCall 通知 | 運用者 (当番 on-call) | Cloud Console → OAuth 同意画面からトークン無効化 → 再認証 → Secret 更新 → Pod 再起動 |
| Client Secret 漏えい検知 | 30 分以内に再生成 | GitHub Secret Scanning / 手動報告 | 運用者 (当番 on-call) | Cloud Console → クレデンシャル再生成 → Sealed Secret 更新 → デプロイ |

**オンコール体制**: 既存の Grafana OnCall スケジュールに統合。Google API 関連インシデントは `severity: high` ラベルでルーティング。

### 2.6 K8s 環境での OAuth トークン管理

ローカル開発環境で OAuth 認証して取得したトークンを K8s Pod で利用するための手順:

1. ローカルで認証用 bb スクリプトを実行し OAuth 認証完了
2. `oauth.json` (access_token, refresh_token, expiry を含む) を Base64 エンコード
3. Sealed Secret として `google-calendar-oauth-token` を作成
4. **initContainer でトークンファイルを emptyDir にコピーし、`chown 1000:1000` で権限を設定**
   - Secret Volume は read-only のため、bb スクリプトのトークン自動リフレッシュ書込みが失敗する
   - emptyDir 経由にすることでリフレッシュトークンを書き戻せるようにする
   - **`runAsUser: 1000` で動作する非 root コンテナから書き込みできるよう `chown` が必須**
5. トークンリフレッシュ失敗時はローカルで再認証 → Secret 更新 → Pod 再起動のフローを実行

**Pod spec パターン (概要)**:
```yaml
initContainers:
  - name: copy-oauth-token
    image: busybox:1.37
    command:
      - sh
      - -c
      - |
        cp /secret/oauth.json /token/oauth.json
        chown 1000:1000 /token/oauth.json
        chmod 0600 /token/oauth.json
    volumeMounts:
      - name: oauth-secret
        mountPath: /secret
        readOnly: true
      - name: oauth-token-rw
        mountPath: /token
containers:
  - name: openclaw
    securityContext:
      runAsUser: 1000
      runAsGroup: 1000
    volumeMounts:
      - name: oauth-token-rw
        mountPath: /home/openclaw/.google/oauth.json
        subPath: oauth.json
volumes:
  - name: oauth-secret
    secret:
      secretName: google-calendar-oauth-token
  - name: oauth-token-rw
    emptyDir: {}
```

---

## 3. OpenClaw 統合方式設計

### 3.1 スキル構成

2 つの独立したスキルとして実装する。スクリプトは babashka (`.bb`) で記述。

#### google-calendar スキル

```
skills/google-calendar/
├── SKILL.md              # 必須: フロントマター + コマンド説明
└── scripts/
    ├── gcal_agenda.bb    # 予定一覧取得 (Calendar API events.list)
    ├── gcal_search.bb    # イベント検索 (Calendar API events.list + q パラメータ)
    ├── gcal_add.bb       # イベント追加 (Calendar API events.insert, Phase 2)
    └── gcal_auth.bb      # OAuth2 トークンリフレッシュ共通ロジック
```

**SKILL.md フロントマター**:
```yaml
---
name: google-calendar
description: >
  Query and manage Google Calendar events via Google Calendar API v3.
  Use for: checking today's schedule, searching upcoming events,
  listing calendars, creating events.
  Scripts call the API directly using babashka HTTP client.
tools:
  - shell
---
```

#### google-maps スキル

```
skills/google-maps/
├── SKILL.md              # 必須: フロントマター + コマンド説明
└── scripts/
    ├── geocode.bb        # 住所→座標変換 (Geocoding API)
    ├── reverse_geocode.bb # 座標→住所変換 (Geocoding API reverse)
    └── directions.bb     # ルート検索 (Directions API)
```

**SKILL.md フロントマター**:
```yaml
---
name: google-maps
description: >
  Geocode addresses, reverse-geocode coordinates, and get directions
  using Google Maps API. Use for: finding coordinates of an address,
  getting travel time and route between two locations, converting
  coordinates to human-readable addresses. Pairs with goplaces skill
  for place search. Scripts call the API directly using babashka HTTP client.
tools:
  - shell
---
```

### 3.2 コマンドインターフェース

#### Google Calendar コマンド例

| コマンド | 説明 | 出力 |
|----------|------|------|
| `bb scripts/gcal_agenda.bb` | 今日〜7日間の予定 | JSON |
| `bb scripts/gcal_agenda.bb --from 2026-02-20 --to 2026-02-21` | 指定日の予定 | JSON |
| `bb scripts/gcal_search.bb --query "会議"` | キーワード検索 | JSON |
| `bb scripts/gcal_add.bb --title "..." --when "..." --where "..."` | イベント追加 (Phase 2) | JSON |

#### Google Maps コマンド例

| コマンド | 説明 | 出力 |
|----------|------|------|
| `bb scripts/geocode.bb "東京駅"` | ジオコーディング | JSON |
| `bb scripts/reverse_geocode.bb 35.6812 139.7671` | 逆ジオコーディング | JSON |
| `bb scripts/directions.bb "東京駅" "渋谷駅"` | ルート検索 | JSON |

### 3.3 返却 JSON 形式

#### Calendar イベント

```json
{
  "events": [
    {
      "title": "チーム定例",
      "start": "2026-02-20T10:00:00+09:00",
      "end": "2026-02-20T11:00:00+09:00",
      "location": "会議室A",
      "calendar": "work"
    }
  ],
  "count": 1,
  "range": { "from": "2026-02-20", "to": "2026-02-27" }
}
```

#### Maps Geocode

```json
{
  "query": "東京駅",
  "results": [
    {
      "formatted_address": "日本、〒100-0005 東京都千代田区丸の内１丁目",
      "lat": 35.6812362,
      "lng": 139.7671248
    }
  ]
}
```

#### Maps Directions

```json
{
  "origin": "東京駅",
  "destination": "渋谷駅",
  "routes": [
    {
      "summary": "首都高速都心環状線",
      "distance": "7.2 km",
      "duration": "18 mins",
      "steps": [
        { "instruction": "南に進む", "distance": "0.3 km", "duration": "1 min" }
      ]
    }
  ]
}
```

### 3.4 babashka スクリプト実装パターン

以下に `gcal_agenda.bb` の概要を示す。他のスクリプトも同様のパターンで実装する。

```clojure
#!/usr/bin/env bb
(require '[babashka.http-client :as http]
         '[cheshire.core :as json]
         '[babashka.cli :as cli])

(def token-path (or (System/getenv "GOOGLE_OAUTH_TOKEN_PATH")
                    "/home/openclaw/.google/oauth.json"))

(defn read-token []
  (json/parse-string (slurp token-path) true))

(defn refresh-token! [{:keys [refresh_token client_id client_secret]}]
  (let [resp (http/post "https://oauth2.googleapis.com/token"
               {:form-params {:grant_type "refresh_token"
                              :refresh_token refresh_token
                              :client_id client_id
                              :client_secret client_secret}})
        new-token (json/parse-string (:body resp) true)]
    (spit token-path (json/generate-string
                       (merge (read-token) new-token)))
    (:access_token new-token)))

(defn get-events [access-token {:keys [time-min time-max calendar-id]}]
  (let [resp (http/get
               (str "https://www.googleapis.com/calendar/v3/calendars/"
                    (or calendar-id "primary") "/events")
               {:headers {"Authorization" (str "Bearer " access-token)}
                :query-params {"timeMin" time-min
                               "timeMax" time-max
                               "singleEvents" "true"
                               "orderBy" "startTime"}})]
    (json/parse-string (:body resp) true)))

;; メイン処理: CLI引数パース → トークン取得 → API呼出し → JSON出力
```

### 3.5 障害時フォールバック

| 障害パターン | 検知方法 | フォールバック |
|-------------|----------|---------------|
| OAuth トークン失効 | HTTP 401 | bb スクリプトが自動でリフレッシュトークンを使って再取得 |
| リフレッシュトークン失効 | リフレッシュ応答 HTTP 400 | ユーザーに再認証を案内 (ローカルで認証 → Secret 更新) |
| API Key 無効 | HTTP 403 | ユーザーに API Key 確認を案内 |
| API レートリミット | HTTP 429 | 30秒待機後リトライ (最大3回、指数バックオフ) |
| ネットワークエラー | Connection timeout | エラーメッセージ表示、リトライ案内 |
| bb 未インストール | `which bb` 失敗 | エラーメッセージ表示 (コンテナイメージ再ビルドを案内) |
| Places API (goplaces) | goplaces exit code != 0 | google-maps スキルの geocode.bb にフォールバック |

---

## 4. 導入フェーズ計画

### Phase 0: 設計・レビュー (本フェーズ)

- [x] CLI ツール選定・調査
- [x] 認証・権限モデル設計
- [x] OpenClaw 統合方式設計
- [x] フェーズ計画策定
- [x] 計画書 PR 作成・レビュー
- [x] PR #7092 レビューコメント反映 (babashka API 方式へ変更)

### Phase 1: Google Cloud Project 設定・認証セットアップ

**目標**: Google Cloud Project を設定し、OAuth2 / API Key 認証が動作することをローカルで確認。

| タスク | 詳細 | 担当 |
|--------|------|------|
| Google Cloud Project 設定 | OAuth 同意画面・Calendar API 有効化・クレデンシャル作成 | 運用者 |
| Maps API Key 発行 | Geocoding / Directions API 有効化、API Key に IP 制限設定 | 運用者 |
| OAuth 認証用 bb スクリプト作成 | ローカルでブラウザ認証 → oauth.json 取得 | 開発者 |
| 認証動作確認 | bb スクリプトから Calendar API / Maps API が応答を返すこと | 開発者 |

**完了条件**:
- bb スクリプトから `GET /calendar/v3/users/me/calendarList` が HTTP 200 で応答する
- bb スクリプトから Geocoding API が HTTP 200 で応答する
- oauth.json にアクセストークンとリフレッシュトークンが保存されている

### Phase 2: OpenClaw スキル実装

**目標**: google-calendar / google-maps スキルを babashka スクリプトで実装し、OpenClaw から利用可能にする。

| タスク | 詳細 | 担当 |
|--------|------|------|
| google-calendar/SKILL.md 作成 | フロントマター + コマンド説明 | 開発者 |
| google-calendar/scripts/ 作成 | gcal_agenda.bb, gcal_search.bb, gcal_auth.bb | 開発者 |
| google-maps/SKILL.md 作成 | フロントマター + コマンド説明 | 開発者 |
| google-maps/scripts/ 作成 | geocode.bb, reverse_geocode.bb, directions.bb | 開発者 |
| goplaces スキルとの連携確認 | Places 検索は goplaces、Geocode/Directions は google-maps | 開発者 |
| スキル単体テスト | 各スクリプトの手動実行確認 | 開発者 |

**完了条件**:
- OpenClaw 上で「今日の予定を教えて」→ bb スクリプト実行 → JSON 応答が得られる
- OpenClaw 上で「東京駅の座標を調べて」→ bb スクリプト実行 → JSON 応答が得られる
- 各スクリプトの exit code 0 での正常終了率 100% (手動テスト5回以上)
- JSON 出力が定義したスキーマ (セクション 3.3) に準拠していること

### Phase 3: K8s / lolice 環境統合

**目標**: lolice K8s クラスタ上の OpenClaw Pod で動作するよう設定を投入。

| タスク | 詳細 | 担当 |
|--------|------|------|
| Secret 定義 | Sealed Secret で CLIENT_ID/SECRET, GOOGLE_MAPS_API_KEY を管理 | 運用者 |
| OAuth トークン Secret 化 | ローカル認証済み oauth.json を Sealed Secret 化 (セクション 2.6 のパターン) | 運用者 |
| ConfigMap 更新 | openclaw.json に google-calendar / google-maps 設定セクション追加 | 開発者 |
| デプロイ・動作確認 | staging 環境でのE2E確認 | 開発者 + 運用者 |

**完了条件**:
- K8s Pod 内から各 bb スクリプト (gcal_agenda.bb, geocode.bb, directions.bb) が exit code 0 で正常完了し、JSON 出力が得られる
- API 応答時間: p95 < 5秒 (直近 10 回のテスト呼出しで計測)
- OAuth トークンの自動リフレッシュが emptyDir 上で成功することを確認
  - initContainer で `chown 1000:1000` 済みのファイルに bb スクリプトが書き戻せること
  - Pod 再起動後も動作すること

### Phase 4: 検証・拡張

**目標**: 実運用での品質確認と機能拡張。

| タスク | 詳細 | 担当 |
|--------|------|------|
| Calendar 書込み機能追加 | gcal_add.bb を実装 (OAuth スコープ拡張) | 開発者 |
| エラーハンドリング強化 | リトライ・フォールバックの実装確認 | 開発者 |
| 利用ログ・メトリクス | Grafana ダッシュボードでの API 呼出し監視 | 運用者 |
| ドキュメント整備 | ユーザー向け利用ガイドの作成 | 開発者 |

**完了条件**:
- 書込み機能を含む全機能が安定稼働している
- Grafana でスキル利用回数・API エラー率が可視化されている
- エラー率 < 1% (直近7日間の API 呼出し)
- モニタリングアラートが設定され、API エラー率 > 5% で通知が発火する

---

## 5. リスクと緩和策

| リスク | 影響度 | 緩和策 |
|--------|--------|--------|
| OAuth 同意画面の審査遅延 | 中 | テスト段階では「テストユーザー」モードで運用 (審査不要) |
| OAuth フロー (ブラウザ必要) | 中 | 初回認証のみブラウザ必要。以降はトークンキャッシュ利用。K8s 環境ではローカルで認証 → トークンファイルを Secret としてマウント |
| Maps API の課金超過 | 低 | 月 $200 無料クレジットで十分。アラート設定 (Cloud Console Budgets) |
| babashka HTTP クライアントの制約 | 低 | `babashka.http-client` は十分成熟しており、OAuth2 フローに必要な POST/GET をサポート。万一問題があれば `curl` を `babashka.process/shell` 経由で呼ぶフォールバックが可能 |
| goplaces との機能重複 | 低 | 場所検索 = goplaces、Geocoding/Directions = google-maps で明確に分離 |
| API レートリミット / クォータ超過 | 中 | Cloud Console で日次クォータアラート設定。bb スクリプト側で 429 検知時に指数バックオフリトライ (最大3回)。クォータ超過時はユーザーに待機を案内 |
| 秘密情報漏えい | 高 | セクション 2.5 のローテーション SLA に従い 15 分以内に無効化。Cloud Console の Secret Manager 監査ログで検知。GitHub Secret Scanning が有効な場合は自動通知 |

---

## 6. 次アクション

1. **Phase 1 開始**: Google Cloud Project 設定、OAuth 認証用 bb スクリプトの作成
2. **Phase 2 着手**: スキルの SKILL.md と各 bb スクリプトの実装
3. **Phase 1 完了後**: 認証フローの動作確認、K8s Secret 設計の詳細化

---

## 変更履歴

| 日付 | 変更内容 |
|------|----------|
| 2026-02-20 | 初版作成 (gcalcli + googlemaps Python ライブラリ方式) |
| 2026-02-20 | PR #7092 レビュー反映: babashka API 直接呼び出し方式へ全面変更。Codex P1 (initContainer chown/chmod) 反映。Codex P2 (Phase 3 完了条件の出力形式整合) 反映 |
