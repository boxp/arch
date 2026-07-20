# BOXP-120 修正計画

1. Worker シークレットを Terraform 管理から外し、AWS/SSM provider 依存を削除する。
2. Wrangler CLI または Cloudflare Dashboard による手動シークレット設定を文書化する。
3. Worker の申請・承認・却下フローを Vitest でテストし、ローカルで実行する。

## デプロイパイプライン修正（2026-07-20）

1. `apps/lolice-member-portal/**` の変更を Worker の Terraform ディレクトリへ紐付ける `test_workflow.plan_and_apply` を追加する。
2. `worker.tf` に同期コメントを追加し、PR #11332 の Worker コードを Terraform apply で再デプロイする。
3. Terraform のフォーマット・初期化・plan を実行して設定を検証する。
