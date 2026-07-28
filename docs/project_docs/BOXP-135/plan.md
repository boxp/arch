# BOXP-135: boxp/arch apply fail 修正計画

## 問題

`terraform/cloudflare/b0xp.io/k8s` ターゲットで `terraform apply` が繰り返し失敗。
Cloudflare が 409 Conflict (error code 1014: "You already have a route defined for this exact IP subnet") を返す。

## 根本原因

- PR #11342 (Cloudflare provider v4→v5 移行) でtfmigrate により `cloudflare_zero_trust_tunnel_route.codex_workspace` を state から削除
- v5 の新リソース名 `cloudflare_zero_trust_tunnel_cloudflared_route.codex_workspace` を state に import する処理が欠落
- 結果: apply のたびに Terraform が 192.168.10.98/32 の route を新規作成しようとして 409 Conflict

## 修正アプローチ

### データソース + import ブロック

Cloudflare provider v5.22.0 に存在する `cloudflare_zero_trust_tunnel_cloudflared_route` データソースを使用して既存 route の UUID を取得し、HCL import ブロックで state に取り込む。

#### 調査内容

- Cloudflare provider v5.22.0 の `internal/provider.go` で `NewZeroTrustTunnelCloudflaredRouteDataSource` が登録済みを確認
- filter パラメータ: `network_subset`・`network_superset` に同じ CIDR を指定することで正確に 1 件にマッチ
- import ID 形式: `{account_id}/{route_id}` (resource.go の `ImportState` 関数で確認)
- Terraform 1.6+ で import ブロックの `id` に expressions が使用可能（本プロジェクトは v1.15.8）

#### 変更ファイル

- `terraform/cloudflare/b0xp.io/k8s/tunnel.tf`: データソース + import ブロック追加

#### 注意事項

- 初回 apply で import が完了したら、データソースと import ブロックは不要になる（フォローアップ PR で削除推奨）
- import ブロックは idempotent: 二回目以降は no-op

## 受け入れ基準

- `terraform/cloudflare/b0xp.io/k8s` の apply が 409 Conflict なしに成功する
- `cloudflare_zero_trust_tunnel_cloudflared_route.codex_workspace` が Terraform state に正しく管理される
- OPEN な follow-up PR (#11621, #11675) がクローズされる
