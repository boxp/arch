# OpenClaw Grafana Metrics Pull Integration (arch)

## Overview
OpenClawがGrafana APIからメトリクスを取得するために必要なAPIキーを、AWS Parameter Storeで管理するためのTerraform変更。

## Changes

### Terraform SSM Parameter
- `aws_ssm_parameter.grafana_api_key` を `ssm.tf` に追加
- パス: `/lolice/openclaw/GRAFANA_API_KEY`
- ExternalSecretがこのパラメータを参照して `openclaw-credentials` Secretに同期

## Post-deployment Steps
1. `terraform plan` / `terraform apply` でSSMパラメータを作成
2. AWS Consoleまたは `aws ssm put-parameter` でGrafana APIキーの実際の値を設定
3. lolice側のExternalSecretが1時間以内に自動同期
