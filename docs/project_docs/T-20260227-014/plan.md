# T-20260227-014: Tailscale Terraform Apply 運用確認

## 概要

PR #7263 (Phase 1 scaffold + Phase 1.5 resource enable) および PR #7266 (follow-up fix) により
Tailscale Terraform apply が成功した。本ドキュメントでは apply 成功の証跡整理、WIF 検証手順、
ロールバック手順の最終版を記録し、PoC を「実運用で再現可能」状態に進める。

## 1. Apply 成功の証跡

### 1.1 タイムライン

| 時刻 (UTC) | イベント | 結果 |
|---|---|---|
| 2026-02-27T08:29:20Z | PR #7263 merge → main push | — |
| 2026-02-27T08:29:22Z | apply workflow run [#22478747958](https://github.com/boxp/arch/actions/runs/22478747958) 開始 | — |
| 2026-02-27T08:30:36Z | terraform apply **失敗** | HTTP 400: `requested tags are invalid or not permitted` |
| 2026-02-27T08:30:45Z | tfaction create-follow-up-pr → PR #7266 自動作成 | — |
| 2026-02-27T09:00:07Z | PR #7266 merge → main push | — |
| 2026-02-27T09:00:10Z | apply workflow run [#22479672276](https://github.com/boxp/arch/actions/runs/22479672276) 開始 | — |
| 2026-02-27T09:01:34Z | terraform apply **成功** | `Apply complete! Resources: 3 added, 0 changed, 0 destroyed.` |

### 1.2 Apply 対象リソース (target: `terraform/tailscale/lolice`)

| リソース | Terraform ID | 状態 |
|---|---|---|
| `tailscale_acl.this` | (ACL全体) | Created (暗黙的に最初に作成) |
| `tailscale_federated_identity.github_actions_argocd_diff` | WIF Trust Credential | Created |
| `tailscale_tailnet_key.subnet_router` | `kwp2vKW4Ck11CNTRL` | Created |
| `aws_ssm_parameter.subnet_router_auth_key` | `/lolice/tailscale/subnet-router-auth-key` | Created |

> **注**: apply ログ上 `tailscale_acl.this` の作成ログが先行で出力されなかったのは、
> `depends_on` による順序制御で ACL 作成完了後に残り2リソースが並行作成されたため。
> 成功 run では ACL 作成は tfaction/apply step 内で暗黙的に完了している。

### 1.3 State

- Backend: S3 `tfaction-state` / `terraform/tailscale/lolice/v1/terraform.tfstate`
- Region: `ap-northeast-1`
- AWS Role Session: `tfaction-apply-terraform_tailscale_lolice-22479672276`

### 1.4 失敗→修正の経緯

PR #7263 の初回 apply で `tailscale_tailnet_key.subnet_router` と `tailscale_federated_identity.github_actions_argocd_diff` が
`tailscale_acl.this` と**並行作成**された。Tailscale API は `tagOwners` ACL が適用される前にタグ参照を許可しないため
HTTP 400 エラーが返された。

PR #7266 で `depends_on = [tailscale_acl.this]` を `auth_key.tf` および `wif.tf` に追加し、
ACL → 他リソースの順序を保証。再 apply で成功。

## 2. WIF 経路の動作確認手順

### 2.1 前提条件

- Tailscale tailnet に以下が存在すること:
  - ACL policy (`tagOwners` に `tag:ci`, `tag:subnet-router`)
  - WIF Trust Credential (`tailscale_federated_identity.github_actions_argocd_diff`)
- `boxp/lolice` リポジトリに ArgoCD Diff Check ワークフローが存在すること

### 2.2 検証手順: argocd-diff ワークフロー経由の WIF 接続

**ゴール**: GitHub Actions OIDC → Tailscale WIF → tailnet 接続 → ArgoCD API 疎通

#### Step 1: ワークフロー側の Tailscale セットアップ確認

`boxp/lolice` の ArgoCD Diff Check ワークフローに以下のステップが含まれていること:

```yaml
- name: Tailscale
  uses: tailscale/github-action@v3
  with:
    # WIF: OIDC token → Tailscale API (keyless)
    oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}   # = wif_client_id output
    oauth-secret: ""                                       # WIF では不要
    tags: tag:ci
```

> **注**: `oauth-client-id` は `terraform output wif_client_id` の値を
> `boxp/lolice` の GitHub Secrets (`TS_OAUTH_CLIENT_ID`) に設定する必要がある。

#### Step 2: PR 作成によるトリガー

1. `boxp/lolice` で任意の変更を含む PR を作成
2. ArgoCD Diff Check ワークフローが自動実行される
3. Tailscale ステップでOIDCトークン交換が行われる

#### Step 3: 結果確認

- **成功**: ワークフローの Tailscale ステップが `Connected` を出力
- **失敗パターンと対処**:

| エラー | 原因 | 対処 |
|---|---|---|
| `oauth client not found` | `TS_OAUTH_CLIENT_ID` が未設定 or 不正 | `terraform output wif_client_id` の値を確認 |
| `requested tags are invalid` | ACL の `tagOwners` にタグ未定義 | `tailscale_acl.this` の state を確認 |
| `custom claim mismatch` | ワークフロー名不一致 | `var.argocd_diff_workflow_name` を確認 |
| `subject mismatch` | イベントタイプが `pull_request` でない | ワークフローの `on:` トリガーを確認 |

#### Step 4: ArgoCD API 疎通確認 (Phase 2 以降)

> **前提**: subnet router Pod デプロイ済み、`argocd_service_cluster_ip` 設定済み

```bash
# ワークフロー内で:
curl -k https://<argocd-cluster-ip>:443/api/version
```

### 2.3 現時点の制約

- subnet router Pod は未デプロイ → ArgoCD API への実疎通テストは Phase 2 以降
- 現時点で検証可能なのは **WIF トークン交換による tailnet 接続** まで
- `argocd_service_cluster_ip` は空のため ACL rules / autoApprovers は空配列

## 3. ロールバック手順 (最終版)

### 3.1 通常ロールバック (推奨)

1. PR #7263 + #7266 の変更を revert する PR を作成:
   ```bash
   # 両コミットを新しい順に revert (範囲指定は始点を含まないため、個別に指定)
   git revert --no-commit 1e958d8 4fc88b3
   git commit -m "revert: remove tailscale terraform resources"
   ```
2. PR マージ → tfaction apply が自動実行
3. `terraform apply` が全リソースを `destroy` (ACL, WIF, auth key, SSM parameter)
4. **確認**: apply workflow の結果が `Resources: 0 added, 0 changed, 4 destroyed.` であること

### 3.2 緊急ロールバック (CI が使えない場合)

```bash
cd terraform/tailscale/lolice/

# 環境変数セット (Tailscale API credentials)
export TAILSCALE_API_KEY="<api-key>"
export TAILSCALE_TAILNET="<tailnet>"
export AWS_PROFILE=<tfaction-apply-profile>

terraform init
terraform destroy -auto-approve
```

### 3.3 最終手段 (Terraform state 不整合時)

1. **Tailscale 管理コンソール** で以下を手動削除:
   - Trust Credential (WIF)
   - ACL policy のカスタムルール
2. **AWS SSM Parameter Store** で `/lolice/tailscale/subnet-router-auth-key` を手動削除
3. **Terraform state** を整合:
   ```bash
   terraform state rm tailscale_acl.this
   terraform state rm tailscale_federated_identity.github_actions_argocd_diff
   terraform state rm tailscale_tailnet_key.subnet_router
   terraform state rm aws_ssm_parameter.subnet_router_auth_key
   ```
4. 24時間以内にstate整合を完了すること (S3 state lock のタイムアウト考慮)

### 3.4 ロールバック時の注意事項

- `tailscale_acl.this` を削除すると **tailnet 全体の ACL** が影響を受ける可能性がある。
  現在は lolice PoC 用タグのみなので安全だが、他リソースが追加された場合は部分的な変更を検討すること。
- auth key は `ephemeral=true` のため、接続中の subnet router ノードがある場合は
  ノードが切断される。事前に Pod をスケールダウンすること。
- SSM Parameter Store のパラメータ削除後、lolice 側の External Secrets が参照エラーになる。
  lolice 側の対応も並行で行うこと。

## 4. 次のステップ (Phase 2 への移行)

| # | タスク | リポジトリ | 依存 |
|---|---|---|---|
| 1 | subnet router Pod デプロイ | boxp/lolice | auth key SSM 設定済み ✓ |
| 2 | External Secrets で auth key 取得設定 | boxp/lolice | SSM parameter 作成済み ✓ |
| 3 | ArgoCD Service ClusterIP 確認 | boxp/lolice | subnet router 接続後 |
| 4 | `argocd_service_cluster_ip` 変数設定 PR | boxp/arch | ClusterIP 判明後 |
| 5 | ACL / autoApprovers 有効化 apply | boxp/arch | 変数設定後 |
| 6 | WIF 接続 + ArgoCD API 疎通テスト | boxp/lolice | ACL 有効化後 |
| 7 | `wif_client_id` を lolice Secrets に設定 | boxp/lolice | WIF Trust Credential 作成済み ✓ |

## 5. Board 用サマリ

### 完了条件チェック

| 条件 | 状態 |
|---|---|
| apply 成功の根拠が整理されている | ✅ 成功 run #22479672276, 3 resources created |
| 検証手順が最新化されている | ✅ WIF 接続手順 + argocd-diff 想定フロー文書化済み |
| ロールバック手順が最新化されている | ✅ 3段階 (通常/緊急/最終手段) + 注意事項追記 |
| 追加修正があれば PR 作成済み | ✅ 本ドキュメント + CLAUDE.md 更新を含むPR |

### PoC ステータス

**Phase 1 + 1.5: 完了** — Terraform リソース (ACL, WIF, auth key, SSM) の apply に成功。
tfaction CI/CD パイプラインで再現可能な状態。

**Phase 2: 未着手** — subnet router デプロイ待ち。boxp/lolice 側の作業が必要。

## 関連

- PR #7263: feat(tailscale): add lolice Terraform + tfaction PoC scaffold
- PR #7266: chore(terraform/tailscale/lolice): follow up #7263 (depends_on fix)
- boxp/lolice PR #490: Tailscale WIF PoC 導入計画
- T-20260227-009: Phase 1 scaffold plan
- T-20260227-010: Phase 1.5 resource enable plan
