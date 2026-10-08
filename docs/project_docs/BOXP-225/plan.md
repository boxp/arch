# BOXP-225: kube-apiserver `--goaway-chance` を IaC 化し、control-plane の watch 偏りによるメモリ逼迫を解消する準備

作成日: 2026-10-08（claude-fable、Task Board run `20261008T081604Z-98a23ad9`）

## 背景（原因切り分けの結論）

BOXP-194（1.36.5 patch 更新）は G3（3CP とも MemAvailable > 400MiB かつ major fault < 50/秒が 10 分継続）が
CP1 で成立せず Blocked になった。本 ticket で CP1 / CP3 の症状を live 再観測した結果:

- apiserver の long-running request（ほぼ watch）が **CP1 1,054 / CP2 81 / CP3 518** と偏っている。
  7 日間の推移では 3 台の apiserver が同時に再起動するたびに「最後に戻った apiserver が最少、他が肥大」が再現し、
  次の再起動まで偏りは動かない（in-cluster クライアントは HTTP/2 1 本に数百 watch を多重化し、再接続しないため）。
  10-06 時点では CP1 が 122 で最軽（MemAvailable 1,230MiB）、10-08 02:13 以降は CP1 が 1,054 で最重（最小 290MiB）。
- apiserver RSS は watch 数と相関（7 日・5 分解像度 6,016 点: r=0.65、約 0.73MiB/watch、切片約 1.15GiB）。
  偏った 1 台では anon が RAM 3.9GiB のうち約 3.0GiB を占め、ページキャッシュが 260〜800MiB まで縮む。
- CP1 の major fault は container 別で **etcd が支配的**（平均 11.7/秒、最大 88/秒。apiserver 自身は 0.5/秒）。
  bbolt の mmap がキャッシュから落ち、eMMC から再読込される（disk read 最大 15MB/秒、CP2 は 5.8MB/秒）。
  スパイク間隔は 5 分の倍数が大半で、etcd compaction 分 ±1 分に 55%（全分の基準 30%）が集中する。
- つまり「CP1 固有のメモリリーク」ではなく、「watch の偏りが乗った CP が逼迫し、etcd の I/O 症状として現れる」。
  CP3 の断続症状も 518 watch + VIP 保持（kubelet の個別 ConfigMap watch 162 本）+ kcm leader の重なり。

詳細な証拠・候補比較・適用 / rollback / 観測計画は Obsidian
`Projects/lolice-k8s-1.36-upgrade/research/boxp-225-cp-memory-watch-skew-20261008/decision-packet-20261008.md`。

## 選んだ最小改善（W1）

kube-apiserver の `--goaway-chance=0.001`（上流推奨開始値、上限 0.02）。要求の 1/1000 に GOAWAY を返し、
クライアントを kubernetes Service / kube-proxy 経由で再接続させて偏りを時間とともにならす、apiserver 組み込みの機能。
再起動だけでは次の同時再起動で偏りが再発するのに対し、持続的に効く。memory limit / swap / sysctl / etcd timeout には触れない。

## 変更内容（本 PR、既定 off）

- `roles/kubernetes_components/defaults/main.yml`: `apiserver_goaway_chance_enabled: false`、`apiserver_goaway_chance: "0.001"`
- `roles/kubernetes_components/tasks/apiserver_goaway.yml`（新規）: `control_plane_metrics.yml` と同じ二段構え
  1. `/etc/kubernetes/manifests/kube-apiserver.yaml` の `--secure-port` 行直後へフラグを冪等に追加 / 同期
     （原本は `/var/backups/kubernetes-manifests/kube-apiserver.yaml.orig` へ退避、PID 変化と `/readyz` 200 を待つ）
  2. `kube-system/kubeadm-config` の ClusterConfiguration へ `apiServer.extraArgs` として保存
     （稼働中の値を読み、`goaway-chance` だけ差し替える。次回 `kubeadm upgrade` で消えない）
- `roles/kubernetes_components/tasks/main.yml`: include 追加
- `roles/kubernetes_components/templates/kubeadm-config.yaml.j2`: 有効時に `apiServer.extraArgs` へ同じ値を宣言（新規クラスタ / `--config` 利用時も宣言と実機が一致する。codex-review P2 指摘対応）
- `playbooks/control-plane.yml`: 有効化行をコメントで用意（**有効化しない**）
- `roles/kubernetes_components/molecule/apiserver-goaway/`（新規）: kubeadm 形式の模擬マニフェストに対して
  追加・冪等性・字下げ・既存フラグ保持・Pod として parse 可能・原本退避・静的 Pod ディレクトリに余計なファイルなしを検証。
  さらに admin.conf（ダミー）・ClusterConfiguration ストア・mock `kubectl` / `kubeadm` を prepare で用意し、
  kubeadm-config ConfigMap への保存経路（稼働中の値を読み、既存 `apiServer.extraArgs` を保持したまま `goaway-chance` を 1 件追加、
  他セクション不変、converge + idempotence で upload-config が 1 回だけ、merged ファイルが 0600 で upload 内容と一致）も
  CI で検証する（codex-review 2 回目 P2 指摘対応。実機側は admin.conf の有無だけをゲートにし挙動不変）

## 安全条件

- 既定 false なので、この PR の merge で本番に変化はない（apply-ansible.yml は既存タスクの no-op 再実行）。
- 有効化は `playbooks/control-plane.yml` の 1 行を true にする別 PR。その merge = apply-ansible.yml による本番適用で、
  `serial: 1` / matrix `max-parallel: 1` により apiserver が shanghai-1 → 2 → 3 の順で 1 台ずつ再起動する。
- rollback は `apiserver_goaway_chance: "0"`（フラグは残し値 0 = 無効）を apply する。原本からの手戻しは不要。
- 本 run では update / dry-run / dispatch / merge / Apply / Pod・Node 操作を行っていない。

## 検証

- `ansible-lint`（production profile）: Passed
- ClusterConfiguration merge を live の ConfigMap 内容に対してオフラインで再現し、`apiServer.extraArgs` 以外のキーが
  不変で、2 回目は no-op になることを確認
- `molecule test -s apiserver-goaway`（amd64 ローカル、CI は arm64 で `molecule test --all`）
