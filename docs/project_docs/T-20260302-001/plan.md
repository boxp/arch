# T-20260302-001: argocd diff が動作しない件の復旧対応

## 根本原因

`terraform/tailscale/lolice/acl.tf` の ACL ルールが `var.argocd_service_cluster_ip`（デフォルト `""`）に依存する条件式になっており、変数未設定時に `acls = []`（空リスト）となっていた。

Tailscale では空の ACL は「全トラフィック拒否」を意味するため、`tag:ci`（GitHub Actions WIF ノード）から `tag:k8s-operator`（ArgoCD proxy pod `lolice-argocd`）への通信が完全にブロックされていた。

### 経緯

1. 当初は subnet router 経由の ArgoCD アクセスを想定し、ClusterIP ベースの ACL ルールを設計
2. 実装フェーズで Tailscale K8s Operator proxy 方式に切り替え（`tailscale.com/expose` annotation）
3. ACL ルールが subnet router 前提のままで、K8s Operator proxy（`tag:k8s-operator`）向けのルールが追加されなかった
4. `argocd_service_cluster_ip` 未設定 → `acls = []` → 全トラフィック拒否

### 症状

- GitHub Actions の `argocd-diff` ワークフローで Tailscale WIF 接続は成功
- しかし `tailscale ping lolice-argocd` が 3 分タイムアウトで失敗
- Cloudflare fallback 経由で argocd diff 自体は動作していた

## 修正内容

`acl.tf` に `tag:ci` → `tag:k8s-operator` への通信を無条件で許可する ACL ルールを追加。

- Port 80: ArgoCD grpc-web plaintext（`argocd-diff` ワークフローが `--plaintext --grpc-web` で使用）
- Port 443: ArgoCD HTTPS（将来の TLS 対応用）

既存の subnet router 向け条件ルールはそのまま保持（Phase 4 撤去対象）。

## 検証手順

1. `terraform plan` で差分確認（CI で自動実行）
2. マージ後に `terraform apply` で ACL 適用
3. lolice リポジトリで argoproj/ 配下を変更する PR を作成し、`argocd-diff` ワークフローで Tailscale 経路が使用されることを確認

## 残課題

- `argocd_service_cluster_ip` 変数と subnet router 関連コードの撤去（Phase 4 スコープ）
- Tailscale 経路での argocd diff 動作確認は ACL apply 後に実施
