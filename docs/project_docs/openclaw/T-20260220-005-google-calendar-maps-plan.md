# T-20260220-005: Google Calendar / Google Maps CLI 統合計画

## 概要

OpenClaw から Google Calendar および Google Maps を CLI ベースで利用可能にする。
本計画書は、CLI ツール選定・認証設計・OpenClaw スキル統合方式・導入フェーズを定義する。

**スコープ**: 設計・計画のみ。本番 OAuth 接続や実 API キー投入は対象外。

---

## 1. CLI ツール選定

### 1.1 Google Calendar: gcalcli

| 項目 | 内容 |
|------|------|
| ツール名 | [gcalcli](https://github.com/insanum/gcalcli) |
| バージョン | v4.5.x (PyPI) |
| インストール | `pip install gcalcli` / `pipx install gcalcli` |
| 認証方式 | OAuth2 (Google Cloud Project の Client ID/Secret 必要) |
| 出力形式 | テキスト (デフォルト) / TSV (`--tsv`) |
| 主要コマンド | `gcalcli list`, `gcalcli agenda`, `gcalcli search`, `gcalcli add`, `gcalcli delete` |

**選定理由**: Google Calendar CLI として唯一の成熟した OSS。OAuth2 フローをネイティブサポートし、
read-only スコープ (`calendar.readonly`) での運用が可能。TSV 出力でスクリプト連携が容易。

### 1.2 Google Maps: googlemaps Python ライブラリ + 薄い CLI ラッパー

| 項目 | 内容 |
|------|------|
| ライブラリ | [googlemaps](https://github.com/googlemaps/google-maps-services-python) (v4.10.x) |
| インストール | `pip install googlemaps` |
| 認証方式 | API Key (Google Cloud Console で発行) |
| 対象 API | Geocoding API, Directions API, Places API (New) |
| 出力形式 | JSON |

**選定理由**: Google Maps 専用の成熟 CLI ツールは存在しない。公式 Python ライブラリに
薄いスクリプトラッパーを自作し、OpenClaw スキルの `scripts/` に同梱するのが最も堅実。

**補足**: 場所検索については、既存スキル `goplaces` (Google Places API New) が利用可能。
Geocoding / Directions については追加のラッパーが必要。

---

## 2. 認証・権限モデル設計

### 2.1 設計原則

- **最小権限 (Least Privilege)**: 初期導入は read-only から開始
- **秘密情報の分離**: API キー / OAuth トークンは環境変数経由で注入
- **トークンライフサイクル管理**: リフレッシュ・失効・ローテーション手順を定義

### 2.2 Google Calendar 認証

```
┌─────────────┐    OAuth2     ┌──────────────────┐
│ Google Cloud │◄────────────►│ gcalcli           │
│ Project      │   Client ID  │ (OAuth2 flow)     │
│              │   + Secret   │                   │
└─────────────┘              └──────────────────┘
                                     │
                              ~/.gcalcli_oauth
                              (token cache file)
```

| 項目 | 値 |
|------|-----|
| OAuth スコープ (Phase 0-1) | `https://www.googleapis.com/auth/calendar.readonly` |
| OAuth スコープ (Phase 2+) | `https://www.googleapis.com/auth/calendar.events` (書込み追加時) |
| トークン保存先 | `~/.gcalcli_oauth` (gcalcli デフォルト) |
| リフレッシュ | gcalcli が自動でリフレッシュトークンを使用 |
| 失効対応 | `gcalcli init` で再認証フローを実行 |

**Secret 管理**:
- `GCALCLI_CLIENT_ID` / `GCALCLI_CLIENT_SECRET`: 環境変数で注入
- OpenClaw config (`openclaw.json`) の `channels` セクションには secret を**格納しない**
- K8s 環境では Sealed Secret / External Secrets Operator 経由で Pod に注入

### 2.3 Google Maps 認証

| 項目 | 値 |
|------|-----|
| 認証方式 | API Key |
| 環境変数名 | `GOOGLE_MAPS_API_KEY` |
| API 制限 | Geocoding API, Directions API のみ有効化 (Cloud Console) |
| IP 制限 | サーバー IP / CIDR のみ許可 |
| 課金 | 月 $200 無料クレジット (個人利用で十分) |

**Note**: 既存 `goplaces` スキルは `GOOGLE_PLACES_API_KEY` を使用。
Maps API Key とは別管理 (APIごとの最小権限) とするが、同一キーの共用も可能。

### 2.4 トークン更新・失効手順

| イベント | Calendar (OAuth2) | Maps (API Key) |
|----------|-------------------|----------------|
| トークン期限切れ | gcalcli が自動リフレッシュ | N/A (API Key に期限なし) |
| リフレッシュトークン失効 | `gcalcli init` で再認証 | N/A |
| キーローテーション | Client Secret 再生成 → `GCALCLI_CLIENT_SECRET` 更新 | Cloud Console で新キー発行 → `GOOGLE_MAPS_API_KEY` 更新 |
| セキュリティインシデント | Cloud Console でトークン無効化 → 再認証 | Cloud Console でキー無効化 → 新キー発行 |

### 2.5 インシデント時ローテーション SLA

| イベント | 目標時間 | 検知方法 | 実行責任 | 手順 |
|----------|----------|----------|----------|------|
| API Key 漏えい検知 | 15 分以内に無効化 | GitHub Secret Scanning 自動アラート / Grafana OnCall 通知 | 運用者 (当番 on-call) | Cloud Console → API Key 無効化 → 新キー発行 → 環境変数更新 → Pod 再起動 |
| OAuth トークン漏えい検知 | 15 分以内に無効化 | Cloud Console 監査ログ異常検知 / Grafana OnCall 通知 | 運用者 (当番 on-call) | Cloud Console → OAuth 同意画面からトークン無効化 → `gcalcli init` 再認証 → Secret 更新 → Pod 再起動 |
| Client Secret 漏えい検知 | 30 分以内に再生成 | GitHub Secret Scanning / 手動報告 | 運用者 (当番 on-call) | Cloud Console → クレデンシャル再生成 → Sealed Secret 更新 → デプロイ |

**オンコール体制**: 既存の Grafana OnCall スケジュールに統合。Google API 関連インシデントは `severity: high` ラベルでルーティング。

### 2.6 K8s 環境での OAuth トークン管理

ローカル開発環境で `gcalcli init` を実行して取得したトークンファイル (`~/.gcalcli_oauth`) を
K8s Pod で利用するための手順:

1. ローカルで `gcalcli init` を実行し OAuth 認証完了
2. `~/.gcalcli_oauth` の内容を Base64 エンコード
3. Sealed Secret として `gcalcli-oauth-token` を作成
4. **initContainer でトークンファイルを emptyDir にコピー** し、メインコンテナは emptyDir を `~/.gcalcli_oauth` として read-write マウント
   - Secret Volume は read-only のため、gcalcli のトークン自動リフレッシュ書込みが失敗する
   - emptyDir 経由にすることで gcalcli がリフレッシュトークンを書き戻せるようにする
5. トークンリフレッシュ失敗時はローカルで再認証 → Secret 更新 → Pod 再起動のフローを実行

**Pod spec パターン (概要)**:
```yaml
initContainers:
  - name: copy-oauth-token
    command: ["cp", "/secret/gcalcli_oauth", "/token/gcalcli_oauth"]
    volumeMounts:
      - name: oauth-secret
        mountPath: /secret
        readOnly: true
      - name: oauth-token-rw
        mountPath: /token
containers:
  - name: openclaw
    volumeMounts:
      - name: oauth-token-rw
        mountPath: /home/openclaw/.gcalcli_oauth
        subPath: gcalcli_oauth
volumes:
  - name: oauth-secret
    secret:
      secretName: gcalcli-oauth-token
  - name: oauth-token-rw
    emptyDir: {}
```

---

## 3. OpenClaw 統合方式設計

### 3.1 スキル構成

2 つの独立したスキルとして実装する。

#### google-calendar スキル

```
skills/google-calendar/
├── SKILL.md              # 必須: フロントマター + コマンド説明
├── scripts/
│   ├── gcal_agenda.sh    # agenda取得ラッパー (JSON変換付き)
│   ├── gcal_search.sh    # イベント検索ラッパー
│   └── gcal_add.sh       # イベント追加ラッパー (Phase 2)
└── references/
    └── gcalcli-commands.md  # gcalcli 全コマンドリファレンス
```

**SKILL.md フロントマター**:
```yaml
---
name: google-calendar
description: >
  Query and manage Google Calendar events via gcalcli.
  Use for: checking today's schedule, searching upcoming events,
  listing calendars, creating events. Requires gcalcli and OAuth2 setup.
metadata:
  openclaw:
    emoji: "📅"
    requires:
      bins: ["gcalcli"]
      env: ["GCALCLI_CLIENT_ID", "GCALCLI_CLIENT_SECRET"]
    primaryEnv: "GCALCLI_CLIENT_ID"
    install:
      - id: pipx
        kind: pipx
        package: gcalcli
        bins: ["gcalcli"]
        label: "Install gcalcli (pipx)"
---
```

#### google-maps スキル

```
skills/google-maps/
├── SKILL.md              # 必須: フロントマター + コマンド説明
├── scripts/
│   ├── geocode.py        # 住所→座標変換
│   ├── reverse_geocode.py # 座標→住所変換
│   └── directions.py     # ルート検索 (出発地→目的地)
└── references/
    └── maps-api-usage.md # API利用ガイド
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
  for place search.
metadata:
  openclaw:
    emoji: "🗺️"
    requires:
      bins: ["python3"]
      env: ["GOOGLE_MAPS_API_KEY"]
    primaryEnv: "GOOGLE_MAPS_API_KEY"
    install:
      - id: pip
        kind: pip
        package: googlemaps
        bins: []
        label: "Install googlemaps (pip)"
---
```

### 3.2 コマンドインターフェース

#### Google Calendar コマンド例

| コマンド | 説明 | 出力 |
|----------|------|------|
| `gcalcli agenda --tsv` | 今日〜7日間の予定 | TSV → JSON 変換 |
| `gcalcli agenda "2026-02-20" "2026-02-21" --tsv` | 指定日の予定 | TSV → JSON 変換 |
| `gcalcli search "会議" --tsv` | キーワード検索 | TSV → JSON 変換 |
| `gcalcli list` | カレンダー一覧 | テキスト |
| `gcalcli add --title "..." --when "..." --where "..."` | イベント追加 (Phase 2) | 確認テキスト |

#### Google Maps コマンド例

| コマンド | 説明 | 出力 |
|----------|------|------|
| `python3 scripts/geocode.py "東京駅"` | ジオコーディング | JSON (`{lat, lng, formatted_address}`) |
| `python3 scripts/reverse_geocode.py 35.6812 139.7671` | 逆ジオコーディング | JSON (`{formatted_address, components}`) |
| `python3 scripts/directions.py "東京駅" "渋谷駅"` | ルート検索 | JSON (`{distance, duration, steps}`) |

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

### 3.4 障害時フォールバック

| 障害パターン | 検知方法 | フォールバック |
|-------------|----------|---------------|
| OAuth トークン失効 | gcalcli exit code 1 + "token" エラー | ユーザーに `gcalcli init` 再認証を案内 |
| API Key 無効 | HTTP 403 / googlemaps.exceptions | ユーザーに API Key 確認を案内 |
| API レートリミット | HTTP 429 | 30秒待機後リトライ (最大3回) |
| ネットワークエラー | Connection timeout | エラーメッセージ表示、リトライ案内 |
| gcalcli 未インストール | `which gcalcli` 失敗 | SKILL.md の install 定義でインストール案内 |
| Places API (goplaces) | goplaces exit code != 0 | google-maps スキルの geocode.py にフォールバック |

---

## 4. 導入フェーズ計画

### Phase 0: 設計・レビュー (本フェーズ — 完了済み)

- [x] CLI ツール選定・調査
- [x] 認証・権限モデル設計
- [x] OpenClaw 統合方式設計
- [x] フェーズ計画策定
- [x] 計画書 PR 作成・レビュー

### Phase 1: CLI ツール導入・認証セットアップ

**目標**: gcalcli と googlemaps ライブラリをインストールし、認証が動作することを確認。

| タスク | 詳細 | 担当 |
|--------|------|------|
| Google Cloud Project 設定 | OAuth 同意画面・Calendar API 有効化・クレデンシャル作成 | 運用者 |
| gcalcli インストール・認証 | `pipx install gcalcli` → `gcalcli init` で OAuth フロー完了 | 運用者 |
| Maps API Key 発行 | Geocoding / Directions API 有効化、API Key に IP 制限設定 | 運用者 |
| googlemaps ライブラリ導入 | `pip install googlemaps` | 運用者 |
| 動作確認 | `gcalcli agenda` / `python3 -c "import googlemaps"` | 運用者 |

**完了条件**:
- `gcalcli agenda` が exit code 0 で予定一覧を出力する
- `python3 -c "import googlemaps; print(googlemaps.__version__)"` がバージョンを正常出力する
- API Key で `python3 -c "import googlemaps; c=googlemaps.Client(key='...'); print(c.geocode('Tokyo'))"` が結果を返す

### Phase 2: OpenClaw スキル実装

**目標**: google-calendar / google-maps スキルを実装し、OpenClaw から利用可能にする。

| タスク | 詳細 | 担当 |
|--------|------|------|
| google-calendar/SKILL.md 作成 | フロントマター + コマンド説明 | 開発者 |
| google-calendar/scripts/ 作成 | gcal_agenda.sh, gcal_search.sh (TSV→JSON変換) | 開発者 |
| google-maps/SKILL.md 作成 | フロントマター + コマンド説明 | 開発者 |
| google-maps/scripts/ 作成 | geocode.py, reverse_geocode.py, directions.py | 開発者 |
| goplaces スキルとの連携確認 | Places検索はgoplaces、Geocode/Directionsはgoogle-maps | 開発者 |
| スキル単体テスト | 各スクリプトの手動実行確認 | 開発者 |

**完了条件**:
- OpenClaw 上で「今日の予定を教えて」「東京駅の座標を調べて」が動作する
- 各スクリプトの exit code 0 での正常終了率 100% (手動テスト5回以上)
- JSON 出力が定義したスキーマ (セクション 3.3) に準拠していること

### Phase 3: K8s / lolice 環境統合

**目標**: lolice K8s クラスタ上の OpenClaw Pod で動作するよう設定を投入。

| タスク | 詳細 | 担当 |
|--------|------|------|
| Secret 定義 | Sealed Secret で GCALCLI_CLIENT_ID/SECRET, GOOGLE_MAPS_API_KEY を管理 | 運用者 |
| OAuth トークン Secret 化 | ローカル認証済みトークンファイルを Sealed Secret 化しマウント (セクション 2.6) | 運用者 |
| ConfigMap 更新 | openclaw.json に google-calendar / google-maps 設定セクション追加 | 開発者 |
| Dockerfile 更新 | gcalcli / googlemaps を Pod 内にプリインストール | 開発者 |
| デプロイ・動作確認 | staging 環境でのE2E確認 | 開発者 + 運用者 |

**完了条件**:
- K8s Pod 内から `gcalcli agenda` が exit code 0 で正常完了し、JSON 出力が得られる
- K8s Pod 内から各 Maps スクリプト (geocode.py, directions.py) が exit code 0 で正常完了する
- API 応答時間: p95 < 5秒 (直近 10 回のテスト呼出しで計測)
- OAuth トークンの自動リフレッシュが emptyDir 上で成功することを確認 (Pod 再起動後も動作)

### Phase 4: 検証・拡張

**目標**: 実運用での品質確認と機能拡張。

| タスク | 詳細 | 担当 |
|--------|------|------|
| Calendar 書込み機能追加 | `gcalcli add` をスキルに追加 (OAuth スコープ拡張) | 開発者 |
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
| gcalcli の OAuth フロー (ブラウザ必要) | 中 | 初回認証のみブラウザ必要。以降はトークンキャッシュ利用。K8s 環境ではローカルで認証 → トークンファイルを Secret としてマウント |
| Maps API の課金超過 | 低 | 月 $200 無料クレジットで十分。アラート設定 (Cloud Console Budgets) |
| gcalcli のメンテナンス停滞 | 低 | 代替: Google Calendar API を直接叩く Python スクリプトに切替可能 |
| goplaces との機能重複 | 低 | 場所検索 = goplaces、Geocoding/Directions = google-maps で明確に分離 |
| API レートリミット / クォータ超過 | 中 | Cloud Console で日次クォータアラート設定。スクリプト側で 429 検知時に指数バックオフリトライ (最大3回)。クォータ超過時はユーザーに待機を案内 |
| 秘密情報漏えい | 高 | セクション 2.5 のローテーション SLA に従い 15 分以内に無効化。Cloud Console の Secret Manager 監査ログで検知。GitHub Secret Scanning が有効な場合は自動通知 |

---

## 6. 次アクション

1. **Phase 1 開始**: Google Cloud Project 設定、gcalcli / googlemaps 導入
2. **Phase 2 着手**: スキルの SKILL.md とスクリプトの実装
3. **Phase 1 完了後**: 認証フローの動作確認、K8s Secret 設計の詳細化
