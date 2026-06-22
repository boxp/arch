# lolice k8s 1.35 worker Longhorn drain fix

## 背景

`Kubernetes Upgrade` workflow の `target_node=golyat-2` run `27924328237` は、pre-upgrade validation と etcd snapshot reuse には成功したが、worker drain で失敗した。

`longhorn-system/instance-manager-fbc98d39ab24982baed6584271104234` の PDB が `disruptionsAllowed=0` で、`kubectl drain` が 5分 timeout に到達した。`golyat-2` には `prod-hitohub/tikv-tidb-cluster-tikv-0` の Longhorn single replica があり、現行の Longhorn `node-drain-policy=block-if-contains-last-replica` では drain を止めるのが正しい。

## 方針

- worker drain timeout を control plane と分離する。
- worker drain は Longhorn replica eviction / rebuild を待てるように `1800s` を使う。
- Longhorn `node-drain-policy` の一時切り替えは cluster operation として扱う。
  - upgrade 中: `block-for-eviction-if-contains-last-replica`
  - worker upgrade 完了後: `block-if-contains-last-replica`

## 検証

- `ansible-lint` で worker drain task と role defaults を検証する。
- `ansible-playbook --syntax-check` で upgrade playbook を検証する。

## 運用

main merge 後、Longhorn setting を計画メンテナンス用に一時変更してから `golyat-2` を再実行する。`golyat-2` が Ready かつ `v1.35.6` / CRI-O `1.35.4` で復帰するまで、`golyat-3` は開始しない。
