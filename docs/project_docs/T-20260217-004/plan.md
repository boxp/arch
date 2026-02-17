# T-20260217-004: Kubernetes Upgrade失敗時の診断性改善

## 背景

run 22098896889 / job 63863098987 にて `Pre-upgrade Validation` の `Run pre-upgrade checks` が失敗。
原因は `etcdctl` コマンドが見つからないエラーだったが、失敗時にログ本文を詳細に確認しないと原因特定できない状態だった。

## 変更内容

### 1. SSH到達性チェックの明示ステップ化
- `pre-check` ジョブに `Verify SSH connectivity` ステップを追加
- 全ノード（ALL_NODE_IPS）に対してSSH疎通を事前検証
- 失敗時は `::error::` アノテーションで明示的にどのノードが到達不能か表示

### 2. Ansible実行ログのファイル保存とartifactアップロード
- `ansible-playbook` 出力を `tee` で `/tmp/pre-check-ansible.log` に保存
- `set -eo pipefail` でパイプ経由でもansibleの終了コードを正しく伝搬
- `if: failure()` 条件で `actions/upload-artifact` を使いログをartifactとしてアップロード（保持14日間）

### 3. Ansible冗長度の引き上げ
- `-v` → `-vv` に変更し、タスク実行の詳細情報を増加

## 想定される失敗分類と確認手順

| 分類 | 症状 | 確認手順 |
|------|------|----------|
| **認証/SSH** | `Verify SSH connectivity` ステップ失敗 | Cloudflareトンネル・SSH鍵の有効性を確認 |
| **ネットワーク** | SSH接続タイムアウト | bastion経由の経路・ファイアウォール設定を確認 |
| **Playbook/モジュール** | `Run pre-upgrade checks` 失敗 | artifactのログを確認、`-vv` 出力からタスク名・モジュール・エラー詳細を特定 |

## 対象ファイル

- `.github/workflows/upgrade-k8s.yml` (pre-checkジョブのみ変更)
