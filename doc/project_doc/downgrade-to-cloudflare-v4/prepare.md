# Cloudflare Provider v4へのダウングレード準備

## ダウングレードの対象となるworkdir

以下のディレクトリが対象となります：

### terraform/cloudflare ディレクトリ配下
- terraform/cloudflare/boxp.tk
- terraform/cloudflare/boxp.tk/portfolio
- terraform/cloudflare/boxp.tk/hitohub/prod
- terraform/cloudflare/boxp.tk/hitohub/stage
- terraform/cloudflare/b0xp.io/k8s
- terraform/cloudflare/b0xp.io/portfolio
- terraform/cloudflare/b0xp.io/prometheus-operator
- terraform/cloudflare/b0xp.io/argocd
- terraform/cloudflare/b0xp.io/longhorn
- terraform/cloudflare/b0xp.io/hitohub/prod
- terraform/cloudflare/b0xp.io/hitohub/stage

### templates ディレクトリ配下
- templates/cloudflare

## cloudflare provider v4の最新バージョン

Cloudflare provider v4の最新バージョンは **v4.52.0** です。

これは2024年2月5日にリリースされた、v4系の最終バージョンです。GitHubリポジトリの情報によると、このバージョン以降はv4系の積極的な開発は終了し、新機能や改善はすべてv5系に実装されるとのことです。

## 現在の状況

現在のプロジェクトでは、Cloudflare providerはv5.0.0が使用されており、バージョン制約は ">= 4.0.0" となっています。

## ダウングレード作業の方針

v5.0.0から v4.52.0 へダウングレードするために、各workdirのTerraformファイルで以下の変更が必要です：

1. backend.tfファイル内のrequired_providersブロックを以下のように修正します：
   ```hcl
   required_providers {
     cloudflare = {
       source  = "cloudflare/cloudflare"
       version = "= 4.52.0"
     }
   }
   ```

2. 変更後、各ディレクトリで `terraform init -upgrade` を実行して、プロバイダーをダウングレードする必要があります。
