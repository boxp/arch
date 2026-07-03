# lolice k8s 1.36 upgrade guard

## 背景

lolice cluster を Kubernetes 1.36 系へ上げる前に、`Kubernetes Upgrade` workflow の本番実行が control plane / worker をまとめて進めないようにする。

1.35 upgrade では workflow の job dependency は存在していたが、運用としては各 node の Ready、static pods、etcd health、Longhorn / workload 回復を確認してから次の node に進む必要がある。`target_node=all` が選べる状態だと、この gate を operator が明示的に挟まない事故が起きやすい。

## 方針

- `workflow_dispatch` の `target_node` choices から `all` を外す。
- default は `shanghai-1` にする。
- API や古い UI state から `target_node=all` が渡されても、pre-check の先頭で fail させる。
- 既存の per-node job 構成は残し、1 node ずつの workflow_dispatch だけを許可する。

## 検証

- `actionlint`
- `ghalint run`
- PR CI

## Rollback

この変更自体は workflow の選択肢と guard のみなので、問題があれば PR revert で戻す。
