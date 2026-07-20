# BOXP-120 修正計画

1. Worker シークレットを Terraform 管理から外し、AWS/SSM provider 依存を削除する。
2. Wrangler CLI または Cloudflare Dashboard による手動シークレット設定を文書化する。
3. Worker の申請・承認・却下フローを Vitest でテストし、ローカルで実行する。

## デプロイパイプライン修正（2026-07-20）

1. `apps/lolice-member-portal/**` の変更を Worker の Terraform ディレクトリへ紐付ける `test_workflow.plan_and_apply` を追加する。
2. `worker.tf` に同期コメントを追加し、PR #11332 の Worker コードを Terraform apply で再デプロイする。
3. Terraform のフォーマット・初期化・plan を実行して設定を検証する。

## Worker ログ有効化（2026-07-21）

1. Cloudflare Dashboard で無効になっている Worker Observability を、Cloudflare provider v5 の `observability` 設定で有効化する。
2. Workers Logs の永続化、Invocation Logs、および 100% の head sampling を設定し、`console.error` を Dashboard の Observability から確認可能にする。
3. この専用ディレクトリの Cloudflare provider を v5.18 へ更新し、observability を Terraform の状態管理下に置く。既存 Worker と D1 の v4 state は provider がデコードできないため、tfmigrate で state entry のみを再 import する（リソース本体は削除しない）。
