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
6. terraform/cloudflare/b0xp.io/k8s

## 変更点

### リソース名の変更

| 旧リソース名 | 新リソース名 |
|------------|-------------|
| `cloudflare_tunnel` | `cloudflare_zero_trust_tunnel_cloudflared` |
| `cloudflare_tunnel_config` | `cloudflare_zero_trust_tunnel_cloudflared_config` |
| `cloudflare_access_application` | `cloudflare_zero_trust_access_application` |
| `cloudflare_access_policy` | `cloudflare_zero_trust_access_policy` |
| `cloudflare_access_identity_provider` | `cloudflare_zero_trust_access_identity_provider` |
| `cloudflare_record` | `cloudflare_dns_record` |
| `cloudflare_access_group` | `cloudflare_zero_trust_access_group` |

### 設定方法の変更点

1. DNSレコードの設定
   - 旧: `value = cloudflare_tunnel.xxx_tunnel.cname`
   - 新: `content = "${cloudflare_zero_trust_tunnel_cloudflared.xxx_tunnel.id}.cfargotunnel.com"`

2. Tunnel設定
   - リソース名が `cloudflare_zero_trust_tunnel_cloudflared` に変更
   - `secret` が `tunnel_secret` に変更
   - 設定内容は基本的に同じ（`account_id`, `name`, `tunnel_secret`）

3. Tunnel Configuration
   - リソース名が `cloudflare_zero_trust_tunnel_cloudflared_config` に変更
   - `config` 属性はマップ型として指定
   - `ingress_rule` ではなく `ingress` 配列を使用

4. Access Application
   - リソース名が `cloudflare_zero_trust_access_application` に変更
   - 設定内容は基本的に同じ

5. Access Policy
   - リソース名が `cloudflare_zero_trust_access_policy` に変更
   - `account_id` が必須パラメータとして追加
   - `application_id` が不要に
   - `app_id` は存在しない
   - `precedence` は非サポートになり削除が必要
   ```hcl
   # 旧
   resource "cloudflare_access_policy" "example" {
     application_id = cloudflare_access_application.example.id
     zone_id       = var.zone_id
     name          = "policy for example.com"
     precedence    = "1"
     decision      = "allow"
     include {
       login_method = [data.cloudflare_access_identity_provider.github.id]
     }
   }
   
   # 新
   resource "cloudflare_zero_trust_access_policy" "example" {
     account_id  = var.account_id
     name        = "policy for example.com"
     decision    = "allow"
     include {
       login_method = [data.cloudflare_zero_trust_access_identity_provider.github.id]
     }
   }
   ```

6. Identity Provider
   - リソース名が `cloudflare_zero_trust_access_identity_provider` に変更
   - `account_id` が必須パラメータとして追加

7. Access Group
   - リソース名が `cloudflare_zero_trust_access_group` に変更
   - `account_id` が必須パラメータとして追加
   - `zone_id` は非推奨となり、`account_id` の使用が推奨

8. 全般的な変更点
   - ほとんどのリソースで `zone_id` の代わりに `account_id` の使用が推奨
   - `terraform import` コマンドの形式が変更（例: `terraform import cloudflare_zero_trust_tunnel_cloudflared.example account_id/tunnel_id`）
   - 一部のリソースで新しい属性が追加（例: `cloudflare_zero_trust_access_application` の `type` 属性）

9. Tunnelトークンの取得について: Cloudflare Provider v5では`token`属性が削除されました。代わりに`data.cloudflare_zero_trust_tunnel_token`データソースを使用する必要があります

   ```hcl
   # Before
   resource "aws_ssm_parameter" "tunnel_token" {
     name  = "tunnel-token"
     type  = "SecureString"
     value = sensitive(cloudflare_tunnel.example_tunnel.token)
   }

   # After - 方法1: データソースを使用
   data "cloudflare_zero_trust_tunnel_token" "example_token" {
     account_id = var.account_id
     tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.example_tunnel.id
   }

   resource "aws_ssm_parameter" "tunnel_token" {
     name  = "tunnel-token"
     type  = "SecureString"
     value = sensitive(data.cloudflare_zero_trust_tunnel_token.example_token.token)
   }
   ```

   方法2：HTTP APIを使って直接トークンを取得する方法（推奨）：

   ```hcl
   # 環境変数CLOUDFLARE_API_TOKENを利用するためのデータソース
   data "external" "env" {
     program = ["sh", "-c", "echo '{\"token\":\"'\"$CLOUDFLARE_API_TOKEN\"'\"}'"]
   }

   # HTTP APIを使用してトンネルトークンを取得
   data "http" "tunnel_token" {
     url = "https://api.cloudflare.com/client/v4/accounts/${var.account_id}/cfd_tunnel/${cloudflare_zero_trust_tunnel_cloudflared.example_tunnel.id}/token"
     request_headers = {
       "Authorization" = "Bearer ${data.external.env.result.token}"
       "Content-Type"  = "application/json"
     }
   }

   resource "aws_ssm_parameter" "tunnel_token" {
     name  = "tunnel-token"
     type  = "SecureString"
     value = sensitive(jsondecode(data.http.tunnel_token.response_body)["result"])
   }
   ```

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
resource "cloudflare_dns_record" "longhorn" {
  zone_id = var.zone_id
  name    = "longhorn"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.longhorn_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  ttl     = 1  # プロキシ有効時は1固定
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
  account_id     = var.account_id
  name           = "cloudflare longhorn tunnel"
  tunnel_secret  = sensitive(base64sha256(random_password.tunnel_secret.result))
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
  config = {
    ingress = [
      {
        hostname = cloudflare_dns_record.longhorn.hostname
        service  = "http://longhorn-frontend:80"
      },
      {
        service = "http_status:404"
      }
    ]
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
  account_id  = var.account_id
  name        = "policy for longhorn.b0xp.io"
  decision    = "allow"
  include {
    login_method = [data.cloudflare_zero_trust_access_identity_provider.github.id]
  }
}
```

### Identity Providerの変更
```hcl
# Before
data "cloudflare_access_identity_provider" "github" {
  zone_id = var.zone_id
  name    = "GitHub"
}

# After
data "cloudflare_zero_trust_access_identity_provider" "github" {
  account_id = var.account_id
  name       = "GitHub"
}
```

## 注意事項

1. 移行前に必ずterraform planを実行し、変更内容を確認してください
2. 本番環境への適用前にステージング環境でテストすることを推奨します
3. バックアップを取得してから移行を開始してください
4. 移行中にサービスの中断が発生する可能性があるため、メンテナンス時間を設定することを推奨します
5. DNSレコードの`ttl`属性は必須です。プロキシ有効時は1に設定してください
6. Identity Providerの参照には`name`属性を直接指定するか、`filter`ブロックを使用してください
7. Access Policyの`include`属性はリスト形式（map[]）で指定する必要があります
8. Tunnel Configurationの`config`属性はマップ型として指定する必要があります
9. Tunnelトークンの取得について: Cloudflare Provider v5では`token`属性が削除されました。代わりに`data.cloudflare_zero_trust_tunnel_token`データソースを使用する必要があります

   ```hcl
   # 代替方法：HTTP APIを使用してトークンを取得
   data "http" "tunnel_token" {
     url = "https://api.cloudflare.com/client/v4/accounts/${var.account_id}/cfd_tunnel/${cloudflare_zero_trust_tunnel_cloudflared.example_tunnel.id}/token"
     request_headers = {
       "Authorization" = "Bearer ${var.cloudflare_api_token}"
       "Content-Type"  = "application/json"
     }
   }

   resource "aws_ssm_parameter" "tunnel_token" {
     name  = "tunnel-token"
     type  = "SecureString"
     value = sensitive(jsondecode(data.http.tunnel_token.response_body)["result"])
   }
   ```

   環境変数`CLOUDFLARE_API_TOKEN`を直接参照する方法：

   ```hcl
   # 環境変数CLOUDFLARE_API_TOKENを利用するためのデータソース
   data "external" "env" {
     program = ["sh", "-c", "echo '{\"token\":\"'\"$CLOUDFLARE_API_TOKEN\"'\"}'"]
   }

   data "http" "tunnel_token" {
     url = "https://api.cloudflare.com/client/v4/accounts/${var.account_id}/cfd_tunnel/${cloudflare_zero_trust_tunnel_cloudflared.example_tunnel.id}/token"
     request_headers = {
       "Authorization" = "Bearer ${data.external.env.result.token}"
       "Content-Type"  = "application/json"
     }
   }

   resource "aws_ssm_parameter" "tunnel_token" {
     name  = "tunnel-token"
     type  = "SecureString"
     value = sensitive(jsondecode(data.http.tunnel_token.response_body)["result"])
   }
   ```

## 参考

- [Cloudflare Provider v5.0.0 Documentation](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs)
- [Cloudflare Zero Trust Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deployment-guides/terraform/) 
