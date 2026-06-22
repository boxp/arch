# lolice k8s 1.35 worker precheck delegate fix

## 背景

`Kubernetes Upgrade` workflow の `target_node=golyat-2` run `27923067729` で、pre-upgrade validation と snapshot は成功したが、worker upgrade job 内の `pre_checks` が失敗した。

失敗箇所は `Verify all nodes are Ready` で、worker drain delegate は `shanghai-2` に変更済みだった一方、この precheck はまだ `shanghai-1` へ delegate していた。worker job の SSH config は `golyat-2` と `shanghai-2` を前提にしているため、`shanghai-1` への direct SSH が timeout した。

## 方針

- worker upgrade job 内の `pre_checks` も `kubernetes_worker_drain_delegate` を使う。
- worker precheck の API server も delegate 先 control plane の `node_ip:6443` に合わせる。
- control plane upgrade の precheck は従来どおり対象 node 自身を使う。

## 検証

- `ansible-lint` で対象 playbook / role task を検証する。
- `actionlint` / `ghalint` は workflow の変更がないため、必要に応じて既存 CI に任せる。

## 運用

main merge 後、`target_node=golyat-2` / `dry_run=false` / version input 明示で再実行する。`golyat-2` が Ready かつ `v1.35.6` / CRI-O `1.35.4` で復帰するまで、`golyat-3` は開始しない。
