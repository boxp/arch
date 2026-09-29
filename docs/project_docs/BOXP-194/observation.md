# BOXP-194 現行クラスタ観測台帳

観測日時: 2026-09-29T09:19:01Z（UTC）
方法: `kubectl get` / API read-only endpoint を使用。後から許可された read-only `kubectl exec` は、etcd 3 Pod の endpoint health/status と snapshot store の `df` / ファイル名・size に限って試行したが、実行主体の ServiceAccount に `pods/exec` 権限がなく全件 Forbidden だった。Secret の取得、SSH、変更操作、dispatch は実施していない。

前回の BOXP-191（2026-09-29 09:13 UTC）から、Kubernetes 1.37 は保留し、1.36 系の最新 patch を別チケットで段階的に扱う方針である。本台帳は更新開始の Go 判定ではない。

## API とノード

`/readyz?verbose` と `/livez?verbose` はともに `ok`、API server は `v1.36.1`（linux/arm64）。7 台すべて `Ready=True` である。

| ノード | Ready | kubelet | CRI-O | 役割/注記 |
| --- | --- | --- | --- | --- |
| golyat-1 | True | v1.36.1 | 1.36.1 | worker |
| golyat-2 | True | v1.36.1 | 1.36.1 | worker |
| golyat-3 | True | v1.36.1 | 1.36.1 | worker |
| golyat-4 | True | v1.36.2 | 1.36.1 | GPU worker |
| shanghai-1 | True | v1.36.1 | 1.36.1 | control plane |
| shanghai-2 | True | v1.36.1 | 1.36.2 | control plane |
| shanghai-3 | True | v1.36.1 | 1.36.1 | control plane |

前回と同じく、kubelet は golyat-4、CRI-O は shanghai-2 のみが 1.36.2 で、残りは 1.36.1。

追加GETで確認したnode OS/architecture: golyat-1/2/3はUbuntu 22.04.5 LTS / amd64、
golyat-4はUbuntu 24.04.4 LTS / amd64、shanghai-1/2/3は
Armbian-unofficial 25.08.0-trunk noble / arm64。単一のUbuntu/architecture検証で全台を代替しない。

## control plane、etcd、kube-vip

- static etcd Pod は `etcd-shanghai-{1,2,3}` の全てが `Running` / `1/1 Ready`。restart count は順に 2、2、1。image は shanghai-1 が `registry.k8s.io/etcd:3.6.4-0`、shanghai-2/3 が `3.6.8-0`。
- これは **Pod health** の観測である。etcd member health / quorum は未確認。各 Pod で既存 healthcheck client 証明書を使う `etcdctl endpoint health` / `status` を read-only で試行したが、`system:serviceaccount:codex-workspace:codex-workspace` に `kube-system` の `pods/exec` 権限がなく Forbidden だった。権限追加は行っていない。
- `kube-vip-ds` は desired/current/ready/available = `3/3/3/3`。3 Pod は各 control plane に 1 台ずつ `Running 1/1`。restart count は shanghai-1=13、shanghai-2=7、shanghai-3=13（いずれも約 7–8 時間前が最後）。

## Longhorn、PVC、snapshot store

- Longhorn manager / CSI plugin は worker 4 台で全 Pod Ready。Longhorn Volume CR は列挙された 18 件すべて `attached` / `healthy`。Bound の Longhorn PVC は確認でき、未Bound は観測されなかった。
- etcd snapshot store は `etcd-snapshots/etcd-snapshot-store-79ddfbf6c6-mjd7s`（golyat-3）で `Running 1/1`、restart 0。PVC `etcd-snapshots` は `Bound`、10Gi、RWO、storageClass `longhorn`、PV `pvc-948d20d3-2c85-4fb2-92c1-a058fe44912c` は `Bound`、関連 Longhorn volume は `attached/healthy`。
- リポジトリ実装では、control plane host の `/var/lib/etcd-snapshots` に snapshot を一時保存し、etcd-snapshot-store Pod の PVC mount `/snapshots` へ `.part` として stream、size 一致後に原子的 rename する。role の既定保持数は 3、空き容量の下限は 1Gi。ただし本票の upgrade dispatch は一時 extra-var `etcd_snapshot_store_retention_count=0` を指定し、全台安定まで prune を無効化する計画である。既定値 3 を今回の実行値と誤認しない。出典: `ansible/roles/kubernetes_upgrade/tasks/etcd_snapshot.yml`、`defaults/main.yml`、`docs/project_docs/BOXP-194/plan.md`。
- `rollback.yml` は host 側の `/var/lib/etcd-snapshots/pre-upgrade-<timestamp>.db` を first control plane で `etcdctl snapshot restore` し、etcd data directory を置換した後、kubeadm/kubelet/kubectl を単純 downgrade する legacy 実装である。manual intervention が必要と明記され、PVC 上の snapshot を host へ取り出す手順、当該手順全体の restore 検証、現在の承認済み復旧手順はいずれも確認できない。本票ではこのファイルをそのまま実行しない。出典: `ansible/roles/kubernetes_upgrade/tasks/rollback.yml`。
- snapshot store PVC の存在・Bound・Longhorn volume health は確認済み。一方、`/snapshots` 内の snapshot の有無・非空性・最新性・空き容量は、read-only `df` とファイル名/size の照会を試行したものの `etcd-snapshots` namespace の `pods/exec` 権限がなく Forbidden となり **未確認**。実際の restore 成功も未確認である。この観測では snapshot を runner に fetch していない。

## GPU と workload 配置

- golyat-4 は GPU worker label を持つ。Intel GPU plugin/exporter は golyat-4 で各 `Running 1/1`。
- 実行主体の `codex-workspace`（main Pod と PVC maintenance Pod）、`hermes-agent`（main と login Pod）、正常稼働中の `llama-server` は全て golyat-4 に配置されている。golyat-4 の drain はこの実行主体・監視主体と GPU workload に影響する。
- `local-llm` の現行 Deployment は `1/1 Available` だが、旧 Pod `llama-server-5675b87df7-pkblt` は `Failed`（restart 8）。`palserver` にも `ContainerStatusUnknown` 後の Failed Pod が 1 件、node-debugger の Failed Pod が 5 件ある。

## PDB と Argo CD

- PDB で allowed disruptions=0: `kube-system/calico-kube-controllers`、Longhorn instance-manager 4 件、`monitoring/prometheus-k8s`。drain 前にその時点の再観測と影響評価が必要である。
- Argo CD Application は全て `argocd` namespace にある。正常でない status は `argocd/arc-controller`、`argocd/descheduler`、`argocd/longhorn`、`argocd/prometheus-operator`、`argocd/prometheus-operator-crd`、`argocd/reloader` が `OutOfSync, Healthy`、`argocd/hermes-agent` が `Synced, Degraded`、`argocd/tidb-operator` が `Unknown, Healthy`。
- `stage-hitohub` では `statefulset/tidb-cluster-pd` が `0/1`、Pod `tidb-cluster-pd-0` が `0/1 CrashLoopBackOff`（観測時 restart 23888）、`statefulset/tidb-cluster-tidb` が `0/1`、Pod `tidb-cluster-tidb-0` が `1/2 CrashLoopBackOff`（restart 68）である。これら、`hermes-agent` ExternalSecret の参照 Secret 不在、control-plane を含む複数 Pod の `DNSConfigForming` は、本観測時点の既存異常・例外受容の具体的な対象として扱い、更新起因の異常と混同しない。

## 判定

API と全ノードの Ready、kube-vip Pod/DaemonSet、Longhorn PVC/Volume、snapshot store Pod/PVC の基礎状態は read-only で確認できた。ただし etcd member health、snapshot 非空性・整合性、PVC から復旧 host への実取得、restore 演習は未確認であり、開始 gate を満たしたとは判定しない。更新時には worker 自身が golyat-4 に配置されていることを前提に、別実行主体へ移すか、監視と台帳継続の方法を先に確定する必要がある。
