# BOXP-324: Cloudflare One Client セッション認証の組織全体有効化

## 目的

Kohako Even G2 の HTTPS 入口（未決の別 scope）で、Access ログインを WebView ではなく
Cloudflare One Client（旧 WARP）の登録 identity で済ませる「Authenticate with Cloudflare One Client」
を使えるようにする。今回は account の Access 設定でこの機能を有効化するだけ。

## 変更

- `terraform/cloudflare/b0xp.io/k8s/zero_trust_organization.tf` を追加
  - dashboard 管理だった `cloudflare_zero_trust_organization` を `import` block で取り込む（import ID = account ID）
  - provider は organization を全項目 PUT で更新するため、未指定の項目は消える。既存値を壊さないよう、
    全項目を data source `cloudflare_zero_trust_organization` の現在値から pass-through する
  - 明示するのは `warp_auth_session_duration = "168h"`（UI の「Cloudflare One Client セッションを使用した認証を有効にする」と session 期限）のみ
- 置き場所は account 全体の WARP 既定 profile を管理している k8s module

## 変えないもの

- `allow_authenticate_via_warp`（UI「すべてのアプリケーションのクライアント認証をオンにする」）は現在値のまま。
  Client 認証は Access アプリ単位で ON にする
- `warp_auth_non_browser_401`、login 方法、MFA、IdP、既存 Access アプリ / policy、WARP profile、DNS、tunnel
- 新しい API token は作らない（CI の既存 token を使う）

## 影響

- client session は「Client 認証を ON にした Access アプリ」にだけ使われる（Cloudflare docs `client-sessions`）。
  現在 ON のアプリは無い想定なので、既存アプリのログイン・MFA・IdP 条件は変わらない
- session 期限（168h）は Client 認証 ON のアプリにだけ効く

## 確認手順

1. PR の tfaction plan で、`cloudflare_zero_trust_organization.this` が import され、差分が
   `warp_auth_session_duration`（null → "168h"）だけであることを確認する。他の項目に差分があれば merge しない
2. CI token に `Access: Organizations, Identity Providers, and Groups` の Read/Write が無い場合は plan/apply が 403 になる。
   その場合は token 権限の追加が別判断になる（今回は token を変更しない）
3. merge 後の apply 結果と、dashboard の Access settings で「Cloudflare One Client セッションを使用した認証」が ON・期限 168h になっていることを readback する

## rollback

- この PR を revert すると resource が state から消えるだけで設定は戻らない。無効化に戻す場合は
  `warp_auth_session_duration = null` にする PR を apply するか、dashboard で toggle を OFF にする（その後 Terraform を追従）

## CI plan で分かったこと（2026-10-27）

- CI token で organization の読み取り（data source・import）はできた
- `service_token_inactivity` は API 上 `enabled = false` だけの未設定状態。resource は action と inactivity_threshold_days も必須にするため config では表せず、null にすると毎回の plan で削除差分が出る。`lifecycle.ignore_changes` で state の値を保持し、この設定は dashboard 管理のままにする
- `login_design` は未設定なので、空 object `{}` ではなく null を渡す
- `cloudflare_zero_trust_device_default_profile.warp_include` の `policy_id -> (known after apply)` は既存の provider 挙動で、この PR の変更ではない（default profile の id は固定）

## merge 後の apply 失敗と修正（2026-10-27）

- #14162 の apply は organization の PUT で `access.api.error.invalid_org_config`
  （`service_token_inactivity must include enabled, inactivity_threshold_days, and action`）になり失敗した。
  `ignore_changes` で state の `{ enabled = false }` をそのまま送ったため。organization の設定は変わっていない
- `service_token_inactivity` を `enabled = false`・`action = "disable"`・`inactivity_threshold_days = 90` の完全な形で書く。
  enabled = false なので service token の自動無効化・削除は起きない（action と日数は enabled = true のときだけ効く）
