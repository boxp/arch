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

## 保全ゲートの結果 (2026-10-10)

- `s3://boxp-longhorn-backup/hitohub-decommission/20261010T163719Z/` に stage/prod の dump (tar.gz + sha256 + inventory + MANIFEST) を保存。
  stage: 1,528,693 bytes、sha256 `a622dbba8eebcaefa0442329d0d2adc05e560152d8e0c342388c173f380a5626`、vr_match 9 テーブル 169,611 行。
  prod: vr_match が存在しない空クラスタ (2025-07-18 再 bootstrap) の証跡のみ、3,164 bytes。
- S3 から再取得して hash/サイズ一致、隔離 TiDB v7.5.1 へ restore して table 集合・行数一致を確認済み。
- 詳細は lolice 側 plan.md と Obsidian `Projects/hitohub/decommission`。

## PR A2 の内容

- `terraform/aws/hitohub/{prod,stage}`: `ecr.tf` / `iam.tf` / `variable.tf` を削除 (ECR 4 repo + lifecycle policy、IAM role/policy/attachment を destroy)。
- `terraform/cloudflare/b0xp.io/hitohub/{prod,stage}`: `dns.tf` / `tunnel.tf` / `access.tf` / `moved.tf` / `variables.tf` を削除
  (DNS 4 record、tunnel 2 + config 2、SSM tunnel token 2、random_password 2、stage の Access application/policy を destroy)。
- `terraform/cloudflare/boxp.tk`: `hitohub.boxp.tk` CNAME と redirect rule、moved block を削除 (共有 zone の hitohub 専用エントリのみ)。
- `backend.tf` / `provider.tf` / `tfaction.yaml` / aqua / lock file は残し、tfaction が destroy plan を生成・apply できるようにする (A3 で shell を削除)。

## PR A2 の apply 結果 (2026-10-10)

- PR #13504 (merge `e67bbc8c`)、apply run 38069417957 (5 job すべて success)。
  - `terraform/aws/hitohub/prod`: 0 added / 0 changed / 7 destroyed
  - `terraform/aws/hitohub/stage`: 0 added / 0 changed / 7 destroyed
  - `terraform/cloudflare/b0xp.io/hitohub/prod`: 0 added / 0 changed / 6 destroyed
  - `terraform/cloudflare/b0xp.io/hitohub/stage`: 0 added / 0 changed / 8 destroyed
  - `terraform/cloudflare/boxp.tk`: 0 added / 1 changed (redirect ruleset) / 1 destroyed (CNAME)
- 想定外の destroy や他サービスへの影響は plan / apply ともに無し。

## PR A3 (この PR)

- 空になった working directory の shell を削除: `terraform/aws/hitohub/{prod,stage}`、
  `terraform/cloudflare/b0xp.io/hitohub/{prod,stage}`、`terraform/cloudflare/boxp.tk/hitohub/{prod,stage}`
  (backend.tf / provider.tf / tfaction.yaml / aqua / lock / .tfmigrate.hcl / tfmigrate 履歴 / .tfaction)。
- `README.md` と `docs/project-structure.md` の hitohub 記述を削除。
- `tfaction-state` / `tfaction-history` 上の既存 state / history オブジェクトは共有 bucket のデータとして触らない
  (resource は A2 で全て destroy 済みで state は空)。
- リソース変更は無し (tfaction の plan 対象 working directory 自体が無くなる)。

## lolice 側の実リソース撤去結果 (2026-10-10、参照)

- Argo CD Application `prod-hitohub` / `stage-hitohub` 削除 → TidbCluster 削除 → namespace 削除で
  PVC 8 / PV 8 / Longhorn volume 8 本を撤去 (Longhorn 18 → 10 volume、すべて healthy)。
- 詳細は Obsidian `Projects/hitohub/decommission` と lolice 側 plan.md。
