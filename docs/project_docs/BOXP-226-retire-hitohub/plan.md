# BOXP-226: hitohub 廃止 (arch 側: AWS / Cloudflare 専用リソースの撤去)

チケット: Obsidian `Tickets/BOXP-226`。lolice 側の計画は `lolice/docs/project_docs/BOXP-226-retire-hitohub/plan.md`。

## Summary

サービス終了済み hitohub の SQL dump を owner 管理の非公開 S3 (`boxp-longhorn-backup`、
prefix `hitohub-decommission/`) へ保全・復元検証した後、hitohub 専用の Terraform リソースを撤去する。
保全検証の成立が destroy を含む PR の merge 前提 (gate)。

## 対象 (専用リソース)

- `terraform/aws/hitohub/{prod,stage}`: ECR `hitohub-{backend,frontend}-{prod,stage}` と lifecycle policy、
  IAM role/policy `hitohub-{prod,stage}-gha-*` (boxp/vr-match の GitHub OIDC 用)。
- `terraform/cloudflare/b0xp.io/hitohub/{prod,stage}`: DNS `hitohub[-stage].b0xp.io` / `api-hitohub[-stage].b0xp.io`、
  Zero Trust tunnel + config、SSM `hitohub-{prod,stage}-tunnel-token`、stage の Access application/policy。
- `terraform/cloudflare/boxp.tk/dns.tf`: `hitohub.boxp.tk` CNAME と `hitohub.boxp.tk -> hitohub.b0xp.io` redirect rule
  (共有 zone 内の hitohub 専用エントリのみ)。
- `terraform/cloudflare/boxp.tk/hitohub/{prod,stage}`: リソース無しの shell。

## 手順 (PR を分けて tfaction の plan を毎回確認する)

1. PR A1 (この PR): ECR 4 repository に `force_delete = true` を追加。image が残っていても destroy できるようにする。
   destroy は含まない。
2. PR A2: 上記対象の resource `.tf` を削除 (backend.tf / provider.tf / tfaction.yaml などの shell は残し、
   tfaction が destroy plan を生成できるようにする。openhands/openclaw 撤去と同じ方式)。
   boxp.tk の hitohub 専用 DNS record / redirect rule / moved block も削除。
   plan に想定外 destroy や他サービスへの影響があれば merge しない。
3. PR A3: 空になった working directory の shell と docs の hitohub 記述を削除。

## 削除しないもの

- `tfaction-state` / `tfaction-history` / `boxp-longhorn-backup` などの共有 bucket と既存データ。
- Cloudflare zone / account、GitHub OIDC provider。
- IaC 管理外の SSM パラメータ (`hitohub-*-tidb-root-password`、`-google-application-credentials`、
  `-firebase-*`) と GCS `vr-match-prod` / `vr-match-staging`: 所有境界が IaC で確認できないため報告のみ。
- Terraform state 自体は tfaction の apply で更新されるものに限り、手動操作しない。
