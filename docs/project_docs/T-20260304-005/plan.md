# T-20260304-005: etcdctl Pre-upgrade Validation 実行失敗修正

## 問題
GitHub Actions `Pre-upgrade Validation` で `etcdctl endpoint health` をノード上で直接実行しており、
ノードに `etcdctl` バイナリが存在しないため `No such file or directory: etcdctl` で失敗する。

- 失敗ジョブ: https://github.com/boxp/arch/actions/runs/22676103540/job/65733108565

## 原因分析
kubeadm管理のKubernetesクラスタでは、etcdは `kube-system` namespace内の静的Pod (`etcd-<ノード名>`) として動作する。
`etcdctl` はetcd Podのコンテナ内にのみ存在し、ノードのファイルシステムには配置されていない。

影響箇所:
- `ansible/roles/kubernetes_upgrade/tasks/pre_checks.yml` - "Verify etcd cluster health"
- `ansible/roles/kubernetes_upgrade/tasks/health_check.yml` - "Verify etcd cluster health (control plane only)"

## 修正方針
`etcdctl` の直接実行を `kubectl exec` 経由でetcd Pod内実行に変更する。

```
kubectl --kubeconfig=<path> -n kube-system exec etcd-<node> -- \
  etcdctl endpoint health \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=<ca> --cert=<cert> --key=<key>
```

- kubeadm環境ではetcd Pod名は `etcd-<inventory_hostname>` で確定
- 証明書パスはPod内にホストからマウントされるため同一パスで動作
- endpointを `https://127.0.0.1:2379` で明示指定
- `ansible.builtin.command` の `argv` 形式で `--` セパレータを安全に扱う

## 非スコープ
- `etcd_snapshot.yml` の `etcdctl snapshot save/status` (スナップショット戦略変更は非スコープ)
- upgrade全体ロジックの刷新

## リスク・ロールバック
- リスク: etcd Pod名が `etcd-<hostname>` と異なるカスタム構成の場合は失敗するが、
  kubeadm標準構成では常にこの命名規則が使われる
- ロールバック: このコミットをrevertすれば元に戻る
