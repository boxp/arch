# Cloudflare Provider v5 への移行手順

## 概要

Cloudflare Provider v5へのアップグレードに伴い、Cloudflare Tunnelなどのリソース名と設定方法が変更されました。
このドキュメントでは、既存のTerraformコードを新しい書き方に移行するための手順を説明します。

## 移行対象のディレクトリ

以下のディレクトリで古い形式のCloudflare Tunnelが使用されており、移行が必要です：

1. terraform/cloudflare/b0xp.io/prometheus-operator
2. terraform/cloudflare/b0xp.io/argocd
3. terraform/cloudflare/b0xp.io/longhorn
4. terraform/cloudflare/b0xp.io/hitohub/prod
5. terraform/cloudflare/b0xp.io/hitohub/stage

なお、terraform/cloudflare/b0xp.io/k8sディレクトリはすでに新しい形式に移行済みです。

## 変更点

### リソース名の変更

| 旧リソース名 | 新リソース名 |
|------------|-------------|
| `cloudflare_tunnel` | `cloudflare_zero_trust_tunnel_cloudflared` |
| `cloudflare_tunnel_config` | `cloudflare_zero_trust_tunnel_cloudflared_config` |
| `cloudflare_access_application` | `cloudflare_zero_trust_access_application` |
| `cloudflare_access_policy` | `cloudflare_zero_trust_access_policy` |

### 設定方法の変更点

1. DNSレコードの設定
   - 旧: `value = cloudflare_tunnel.xxx_tunnel.cname`
   - 新: `content = cloudflare_zero_trust_tunnel_cloudflared.xxx_tunnel.cname`

2. Tunnel設定
   - リソース名が `cloudflare_zero_trust_tunnel_cloudflared` に変更
   - 設定内容は基本的に同じ（`account_id`, `name`, `secret`）

3. Tunnel Configuration
   - リソース名が `cloudflare_zero_trust_tunnel_cloudflared_config` に変更
   - 設定構造は基本的に同じ

4. Access Application
   - リソース名が `cloudflare_zero_trust_access_application` に変更
   - 設定内容は基本的に同じ

5. Access Policy
   - リソース名が `cloudflare_zero_trust_access_policy` に変更
   - 設定内容は基本的に同じ

## 移行手順の例（longhornの場合）

### DNSレコードの変更
```hcl
# Before
resource "cloudflare_record" "longhorn" {
  zone_id = var.zone_id
  name    = "longhorn"
  value   = cloudflare_tunnel.longhorn_tunnel.cname
  type    = "CNAME"
  proxied = true
}

# After
resource "cloudflare_record" "longhorn" {
  zone_id = var.zone_id
  name    = "longhorn"
  content = cloudflare_zero_trust_tunnel_cloudflared.longhorn_tunnel.cname
  type    = "CNAME"
  proxied = true
}
```

### Tunnelの変更
```hcl
# Before
resource "cloudflare_tunnel" "longhorn_tunnel" {
  account_id = var.account_id
  name       = "cloudflare longhorn tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# After
resource "cloudflare_zero_trust_tunnel_cloudflared" "longhorn_tunnel" {
  account_id = var.account_id
  name       = "cloudflare longhorn tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}
```

### Tunnel Configurationの変更
```hcl
# Before
resource "cloudflare_tunnel_config" "longhorn_tunnel" {
  tunnel_id  = cloudflare_tunnel.longhorn_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.longhorn.hostname
      service  = "http://longhorn-frontend:80"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# After
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "longhorn_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.longhorn_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.longhorn.hostname
      service  = "http://longhorn-frontend:80"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}
```

### Access Applicationの変更
```hcl
# Before
resource "cloudflare_access_application" "longhorn" {
  zone_id          = var.zone_id
  name             = "Access application for longhorn.b0xp.io"
  domain           = "longhorn.b0xp.io"
  session_duration = "24h"
}

# After
resource "cloudflare_zero_trust_access_application" "longhorn" {
  zone_id          = var.zone_id
  name             = "Access application for longhorn.b0xp.io"
  domain           = "longhorn.b0xp.io"
  session_duration = "24h"
}
```

### Access Policyの変更
```hcl
# Before
resource "cloudflare_access_policy" "longhorn_policy" {
  application_id = cloudflare_access_application.longhorn.id
  zone_id       = var.zone_id
  name          = "policy for longhorn.b0xp.io"
  precedence    = "1"
  decision      = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}

# After
resource "cloudflare_zero_trust_access_policy" "longhorn_policy" {
  application_id = cloudflare_zero_trust_access_application.longhorn.id
  zone_id       = var.zone_id
  name          = "policy for longhorn.b0xp.io"
  precedence    = "1"
  decision      = "allow"
  include {
    login_method = [data.cloudflare_access_identity_provider.github.id]
  }
}
```

## 注意事項

1. 移行前に必ずterraform planを実行し、変更内容を確認してください
2. 本番環境への適用前にステージング環境でテストすることを推奨します
3. バックアップを取得してから移行を開始してください
4. 移行中にサービスの中断が発生する可能性があるため、メンテナンス時間を設定することを推奨します

## 参考

- [Cloudflare Provider v5.0.0 Documentation](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs)
- [Cloudflare Zero Trust Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deployment-guides/terraform/) 