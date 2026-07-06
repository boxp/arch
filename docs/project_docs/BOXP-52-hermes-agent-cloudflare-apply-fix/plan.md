# BOXP-52 Hermes Agent Cloudflare apply fix

## 背景

`boxp/arch` PR #10840 の merge 後 apply で、`terraform/cloudflare/b0xp.io/hermes-agent` の `cloudflare_access_policy.hermes_agent_policy` 作成だけが失敗した。

失敗した apply は Access Application、Cloudflare Tunnel、DNS record、Tunnel config、SSM SecureString `hermes-agent-tunnel-token` を既に作成済みで、follow-up PR #10842 の plan は Access Policy 1件追加のみになっている。

## 原因

`cloudflare_access_policy.hermes_agent_policy` の `include` が次の形式になっていた。

```hcl
include {
  github {
    identity_provider_id = data.cloudflare_access_identity_provider.github.id
    name                 = "boxp"
  }
}
```

Cloudflare API はこの `include.github` 設定を `invalid 'include' configuration (12130)` として拒否した。既存の `terraform/cloudflare/b0xp.io/*/access.tf` では GitHub 認証必須の UI policy に `include.login_method = [data.cloudflare_access_identity_provider.github.id]` を使っているため、Hermes Agent もその形式へ合わせる。

## 実装方針

- Access Application、Tunnel、DNS、Tunnel config、SSM Parameter の resource 名や設定は変更しない。
- deprecated warning が出ている `cloudflare_access_application` / `cloudflare_access_policy` から Zero Trust resource への移行は今回の scope に含めない。
- `include.github` を `include.login_method` へ置き換え、既存 b0xp.io Access 実装と同じ GitHub IdP 必須の policy にする。
- `boxp/lolice` PR #696 は lolice cluster 側の cloudflared runtime / ExternalSecret を担当し、`boxp/arch` PR #10842 は Cloudflare / DNS / SSM token を担当する。

## 検証

- `terraform fmt` を `terraform/cloudflare/b0xp.io/hermes-agent` で実行する。
- `terraform validate` を同ディレクトリで実行する。ローカル認証や backend 事情で実行不能な場合は理由を PR に残し、tfaction plan を確認する。
- PR #10842 の plan で意図しない destroy / replace がなく、Access Policy の追加のみであることを確認する。

## apply 後確認手順

1. tfaction apply が成功し、`cloudflare_access_policy.hermes_agent_policy` が作成されたことを確認する。
2. 未認証のブラウザまたは `curl -I https://hermes-agent.b0xp.io` で Cloudflare Access の認証画面または redirect になり、Web UI に直接到達できないことを確認する。
3. GitHub 認証後に `https://hermes-agent.b0xp.io` へアクセスし、Hermes Agent Web UI が表示されることを確認する。
4. lolice 側で `hermes-agent-tunnel-token` の ExternalSecret が同期され、cloudflared Pod が Tunnel ready になっていることを確認する。
