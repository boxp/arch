# BOXP-120 修正計画

1. Worker シークレットを Terraform 管理から外し、AWS/SSM provider 依存を削除する。
2. Wrangler CLI または Cloudflare Dashboard による手動シークレット設定を文書化する。
3. Worker の申請・承認・却下フローを Vitest でテストし、ローカルで実行する。
