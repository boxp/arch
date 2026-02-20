# T-20260220-020: Google連携 Phase 1 — SSM パラメータ定義 (arch側)

## 概要

Google Calendar API / Google Maps API 用のクレデンシャルを
AWS SSM Parameter Store に SecureString として定義する。

対応する lolice 側 PR で ExternalSecret → K8s Secret → Pod 注入の経路を整備。

## 追加 SSM パラメータ

| リソース名 | SSM パス | 用途 |
|-----------|---------|------|
| `google_oauth_client_id` | `/lolice/openclaw/GOOGLE_OAUTH_CLIENT_ID` | Calendar API OAuth2 Client ID |
| `google_oauth_client_secret` | `/lolice/openclaw/GOOGLE_OAUTH_CLIENT_SECRET` | Calendar API OAuth2 Client Secret |
| `google_oauth_refresh_token` | `/lolice/openclaw/GOOGLE_OAUTH_REFRESH_TOKEN` | Calendar API OAuth2 Refresh Token |
| `google_maps_api_key` | `/lolice/openclaw/GOOGLE_MAPS_API_KEY` | Maps Geocoding/Directions API Key |

## 設計判断

- 既存パターン準拠: `type = "SecureString"`, `value = "dummy-value-to-be-updated-manually"`, `lifecycle { ignore_changes = [value] }`
- IAM ポリシー変更不要: `external_secret_policy` は `Resource = ["*"]` で全SSMパスにアクセス可能
- 実際のクレデンシャル値は Google Cloud Console 設定後に運用者が手動で SSM に投入

## 次アクション

1. Google Cloud Console でクレデンシャル発行 (運用者)
2. `aws ssm put-parameter` で実際の値を投入 (運用者)
3. lolice 側の ExternalSecret が自動同期 (1h interval)
