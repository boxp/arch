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
- `tasks/apiserver_goaway.yml` の入力検証: 範囲チェック（0〜0.02）の前に、値が 10 進の有限数（`^[0-9]+(\.[0-9]+)?$`）であることを
  assert する。Ansible の `float` フィルタは `"invalid"` を 0.0 にするため範囲チェックをすり抜け、文字列がそのままマニフェストへ書かれて
  kube-apiserver が crash-loop し得た（codex-review 3 回目 P2 指摘対応）。molecule verify に `reject-case.yml` を追加し、
  `invalid` / `1e-3` / `nan` / `-0.001`（形式）と `0.5`（範囲）が期待メッセージで止まり、converge 済みマニフェストが変わらないことを検証

- `tasks/apiserver_goaway.yml` のフラグ判定と編集: マニフェスト全体の部分文字列検索 + 正規表現編集をやめ、YAML として解析した
  `name: kube-apiserver` コンテナ（ちょうど 1 つ、command 先頭が `kube-apiserver` であることを assert）の `command` に対して
  「既存の goaway 指定（`--goaway-chance=VALUE` 形式と、pflag が受け付ける分離形式 `--goaway-chance` + 次要素の値の両方）をすべて除き、`--secure-port=` 直後（無ければ末尾）に宣言値を 1 つ入れた」望ましい command を作り、
  現状と異なる場合だけその command を差し替えたマニフェスト全体を `to_nice_yaml(indent=2, width=4096)` で書き戻す（構造化更新。
  kubeadm と同じ整形。手作業コメントは残らないが原本は退避済み）。書き戻し後に再解析し「kube-apiserver の command に宣言値の要素が
  ちょうど 1 つ」「他のコンテナ / initContainers が不変」を assert する。従来はコメント / アノテーション / sidecar に同じ文字列や
  `- kube-apiserver` 行があるだけで未適用・編集範囲ずれ・重複残りが起き得た（codex-review 4 回目 P2 指摘 + 自己確認 codex review の
  P2 2 件「編集対象を kube-apiserver コンテナに限定」対応）。molecule verify に `normalize-case.yml` を追加し、
  (a) コメント + アノテーション混入 (b) 値違い・空白違い・分離形式を含む重複 4 件 (c) 先行する initContainer の command が `kube-apiserver` で始まり
  `--secure-port` / `--goaway-chance=0.009` を持ち、sidecar も同名フラグを持つ、のそれぞれで kube-apiserver の command だけが 1 つに
  正規化され、metadata・他コンテナの command が不変で、2 回目が no-op になることを検証
- 値検証を `tasks/apiserver_goaway_validate.yml` に分離し、`tasks/main.yml` で `kubeadm.yml`（`kubeadm-config.yaml.j2` の書き出し）より前に
  include する（`apiserver_goaway.yml` も同じファイルを include するので `tasks_from` 単独実行でも検証される）。従来は検証が
  `apiserver_goaway.yml` にしか無く、新規 control plane 構築（`kubeadm init --config`）では不正値が先にテンプレートへ書き出されて
  init 失敗 / crash-loop になり得た（自己確認 codex review の P2 対応）。molecule verify に `tasks/main.yml` の include 順
  （validate < kubeadm < apiserver_goaway）を固定する assert を追加

## 安全条件

- 既定 false なので、この PR の merge で本番に変化はない（apply-ansible.yml は既存タスクの no-op 再実行）。
- 有効化は `playbooks/control-plane.yml` の 1 行を true にする別 PR。その merge = apply-ansible.yml による本番適用で、
  `serial: 1` / matrix `max-parallel: 1` により apiserver が shanghai-1 → 2 → 3 の順で 1 台ずつ再起動する。
- rollback は `apiserver_goaway_chance: "0"`（フラグは残し値 0 = 無効）を apply する。原本からの手戻しは不要。
- 本 run では update / dry-run / dispatch / merge / Apply / Pod・Node 操作を行っていない。

## 検証

- `ansible-lint`（production profile）: Passed
- 入力検証の単体確認（localhost、include_role tasks_from）: `0` / `0.001` / `0.02` / `0.0010` 受理、`invalid` / `1e-3` / `nan` / `inf` / `-0.001` は形式で拒否、`0.5` は範囲で拒否
- ClusterConfiguration merge を live の ConfigMap 内容に対してオフラインで再現し、`apiServer.extraArgs` 以外のキーが
  不変で、2 回目は no-op になることを確認
- `molecule test -s apiserver-goaway`（amd64 ローカル、CI は arm64 で `molecule test --all`）

## 有効化（W1 live 適用、2026-10-09、claude-fable run `20261009T023442Z-2bd04c6b`）

owner 指示（2026-10-08 15:41 UTC、hermes-agent 経由「いや進めてほしい」）に基づき、W1 を実際に有効化して持続観測まで進める。
対象は Decision Packet §0 / §6 で特定した 3CP（shanghai-1 → 2 → 3、`serial: 1` + apply-ansible の `max-parallel: 1`）のみ。
194 の再開・P2（plan 直列化）・etcd tuning・swap・無関係対象の変更は含めない。

### 変更内容

- `playbooks/control-plane.yml`: `apiserver_goaway_chance_enabled: true`（コメントアウトを解除、値は既定の `"0.001"`）。
  この PR の merge = apply-ansible.yml による本番適用で、各 CP で kube-apiserver が 1 回ずつ再起動する（PID 変化 + `/readyz` 200 + etcd health gate を待ってから次のノード）。
- `tasks/apiserver_goaway.yml`: check mode（plan-ansible.yml の `--check --diff`）では `copy` が「変更あり」を返すだけでファイルを書かないため、
  再読込後の assert・PID 変化待ち・readyz 待ちに `not ansible_check_mode` を付けた。これが無いと有効化 PR の plan が
  「宣言値のフラグがちょうど 1 つ」の assert で必ず失敗する（既定 off の間は全タスクが skip されていたので顕在化しなかった）。
  実際の適用経路（apply-ansible.yml）の挙動は不変。
- molecule `apiserver-goaway` に `check-mode-case.yml` を追加: フラグ未設定のマニフェストに対して check mode で role を通し、
  失敗せず「変更あり」を報告し、マニフェストは書き換えないことを検証。

### 適用前の確認（2026-10-09 02:38 UTC、worker-4 の Prometheus 経由、CP への exec なし）

- G1 相当: 7 Node Ready、etcd 3 台とも has_leader=1、apiserver up 3/3、Longhorn volume 18 healthy、VIP 保持者 shanghai-1。
- G2 相当: 直近 30 分 etcd leader change 0、API 5xx 0。直近の apiserver 再起動は 10-08 22:58（CP1）/ 23:01（CP2）/ 23:12（CP3）で 3 時間以上前。
- 偏り: long-running request CP1 908 / CP2 672 / CP3 77（最後に再起動した CP3 が最少、再現）。MemAvailable 10 分最小 CP1 551 / CP2 877 / CP3 1,118 MiB。
- 並行 mutation なし: apply / plan / upgrade workflow の in-progress / queued なし、Task Board lock は本 run のみ。

### 停止条件・rollback・観測

- 停止: apply-ansible の各 CP で readyz が 5 分以内に 200 へ戻らない / etcd health gate 不成立なら `fail-fast: true` で後続ノードは走らない。
  観測側で 2 台以上の apiserver scrape 断、etcd leader なし、API 5xx > 5% が 5 分継続を見たら `gh run cancel` で止める。
- rollback: `apiserver_goaway_chance: "0"` を同じ経路（PR merge → apply）で適用。フラグは残して値 0（無効）にする。
- 観測: 最後の apiserver 再起動から最低 60 分（過去の 10〜15 分再発周期を超える）、Decision Packet §7 の成立条件で評価し、
  24h 後に 7 日区分表と比較する案を残す。結果は Obsidian `research/boxp-225-cp-memory-watch-skew-20261008/` に保存。

## M1: kube-apiserver `GOMEMLIMIT=1536MiB`（2026-10-09、claude-fable run `20261009T065939Z-1cb11a47`）

owner の包括承認（2026-10-09 06:56 UTC、hermes-agent 経由「承認なしで進めて大丈夫。安定化できるまで試行錯誤」）に基づき、
W1 の次の対策として M1 を実装し、同じ PR で有効化する（Apply の回数を 1 回に抑え、CP 上の Ansible 負荷を減らすため。
role defaults は off のまま）。194 の再開・P2・etcd tuning・swap・無関係対象の変更は含めない。

### 根拠（W1 後の live 再観測、03:45〜07:01 UTC、worker-4 の Prometheus 経由、CP への exec なし）

- W1 で watch は CP1 399 / CP2 750 / CP3 607 と均されたが、3 台とも apiserver の Go heap goal（`go_gc_heap_goal_bytes`）が
  最大 1,826MiB、ランタイム総量（`go_memstats_sys_bytes`）が 2,058〜2,073MiB まで伸び、ノードの MemAvailable 10 分最小が
  CP1 327 / CP2 324 / CP3 356MiB、ページキャッシュが 267MiB まで縮んだ（05:45 以降は CP2 / CP3 も床割れ）。
  04:50〜04:52 には CP1 でヒープが 2 分で +740MiB → major fault 216/s → etcd commit p99 1 秒 → leader / VIP 移動（kill なし）。
- 既定 GOGC=100 では heap goal = live heap × 2。live heap（`go_gc_heap_live_bytes`）の 7 日最大は CP1 977 / CP2 997 / CP3 1,030MiB
  （p99 926 / 970 / 960）、非 heap ランタイム（sys − heap_sys）最大 190〜217MiB。偏りが無くてもピークは約 2GiB になる。
- GOMEMLIMIT は Go ランタイムの soft limit。limit に近づくと GC を前倒しし、使っていないヒープを OS へ返す。cgroup memory limit
  （OOM-kill 経路）ではなく、超えても kill されない（GC CPU は 50% で頭打ち）。kube-apiserver は `debug.SetMemoryLimit` を
  呼ばないので環境変数がそのまま効き、反映は `go_gc_gomemlimit_bytes` で確認できる（現在 8796093022208 = 無制限）。
- 値 1536MiB: live 最大 + 非 heap（約 1.25GiB）の 1.23 倍。live が p99 の時に GC 1 サイクルあたりの割当余地は約 360MiB
  （既定の約 960MiB に対し GC 頻度約 2.7 倍）、GC CPU は現状 0.1〜0.5 core / 4 core なので最悪でも 1 core 程度。
  ランタイム総量のピークは 2.07〜2.38GiB → 1.5GiB 以下になり、ページキャッシュへ約 500〜800MiB の余地ができる見込み。
  1792MiB は GC 負荷が軽いが余地が 270〜590MiB にとどまるため、まず 1536MiB で観測し、GC CPU が持続的に 25% を超える /
  API p99 が悪化するなら 1792MiB へ上げる（同じ経路、apiserver 1 台ずつ再起動）。

### 変更内容

- `roles/kubernetes_components/defaults/main.yml`: `apiserver_gomemlimit_enabled: false`、`apiserver_gomemlimit: "1536MiB"`
- `roles/kubernetes_components/tasks/apiserver_gomemlimit_validate.yml`（新規）: 形式（整数 + B/KiB/MiB/GiB、または rollback 用の `off`）と
  範囲（1024〜3072MiB）を assert。小数・指数・単位なし・10 進単位（MB）・大文字 OFF は拒否。`tasks/main.yml` で `kubeadm.yml` より前に include
- `roles/kubernetes_components/tasks/apiserver_gomemlimit.yml`（新規）: `apiserver_goaway.yml` と同じ構造化更新
  1. `/etc/kubernetes/manifests/kube-apiserver.yaml` を YAML として解析し、`name: kube-apiserver` コンテナの `env` から既存の GOMEMLIMIT
     （重複・valueFrom 形式を含む）をすべて除いて宣言値を 1 つ足す。他の env・command・他コンテナ・initContainers・metadata は不変を assert。
     原本退避（既存の `.orig` があれば保持）、PID 変化 + `/readyz` 200 待ち、check mode では書かずに「変更あり」のみ報告
  2. `kube-system/kubeadm-config` の ClusterConfiguration（v1beta4）を読み、`apiServer.extraEnvs` に GOMEMLIMIT だけ差し替えて
     `kubeadm init phase upload-config kubeadm` で書き戻す（次回 `kubeadm upgrade` で消えない）
- `roles/kubernetes_components/templates/kubeadm-config.yaml.j2`: 有効時に `apiServer.extraEnvs` へ同じ値を宣言（新規クラスタ / `--config` 利用時）
- `playbooks/control-plane.yml`: `apiserver_gomemlimit_enabled: true`（**この PR で有効化**。merge = apply-ansible.yml による本番適用）
- `roles/kubernetes_components/molecule/apiserver-gomemlimit/`（新規、prepare は `apiserver-goaway` のものを共用）:
  env の追加（exactly once）・command / image / metadata 不変・goaway 無効のまま・原本退避・静的 Pod ディレクトリに余計なファイルなし・
  ClusterConfiguration の `extraEnvs` 追加と `extraArgs` / 他セクション保持・upload-config 1 回・merged ファイル 0600、
  不正値 7 件の拒否、include 順、正規化 3 ケース（重複 + 他 env 混在 / sidecar + initContainer の同名 env / rollback 値 `off`）、check mode

### 適用・停止・rollback・観測

- 適用: PR merge → apply-ansible.yml が shanghai-1 → 2 → 3（→ golyat-4 は対象外で no-op）の順に 1 台ずつ apiserver を再起動（PID 変化 +
  readyz 200 + etcd health gate）。直前に G1 / G2 相当（7 Node Ready、etcd leader、apiserver up 3/3、5xx 0、並行 workflow なし）を確認。
- 停止: readyz が 5 分以内に 200 に戻らない / etcd health gate 不成立で `fail-fast`。観測側で apiserver up ≤ 1、etcd leader なし、
  5xx > 5% が 5 分継続、GC CPU（`go_cpu_classes_gc_total_cpu_seconds_total`）が 1 台で 2 core 超を 5 分継続なら `gh run cancel`。
- rollback: `apiserver_gomemlimit: "off"` を同じ経路で apply（env は残り Go ランタイムは limit なし）。または 1792MiB へ緩和。
- 観測: 最後の再起動から最低 60 分、`go_gc_gomemlimit_bytes` = 1610612736 の反映確認、`go_memstats_sys_bytes` / RSS のピーク、
  MemAvailable 10 分最小（目標: 3 台とも 450MiB 超を 60 分継続）、node / etcd major fault、etcd commit p99、GC CPU、API p99、5xx、
  leader change、Node Ready。結果は Obsidian `research/boxp-225-cp-memory-watch-skew-20261008/m1-gomemlimit-20261009.md` に保存。

## P2: plan-ansible の control plane 保護（2026-10-09、claude-fable run `20261009T101832Z-1ec49c48`）

### 根拠

- post-merge-observation-20261008 §3: 10-08 の apiserver kill 3 回中 2 回、etcd leader change 7 回中 6 回は、その CP で Ansible plan / apply を実行中に発生（plan 中の sysctl template タスクが通常 6〜10 秒のところ 100〜122 秒 stall）。
- W1 / M1 の適用時も、apply 開始直後の leader change（03:27、03:38、08:09）と plan 終了直後の CP3 MemAvailable 269MiB（07:45）が観測された。
- M1 後は MemAvailable の床が 900MiB 超になったが、plan は 3 台の CP で同時に走るため、逼迫時に 3 台同時 stall → etcd quorum 喪失のリスクが残る。

### 変更内容（`.github/workflows/plan-ansible.yml` のみ。`ansible/**` は触らないので merge で Apply Ansible は走らない）

- (a) `strategy.max-parallel: 1`: plan を shanghai-1 → 2 → 3 → golyat-4 の順に 1 台ずつ実行（apply-ansible と同じ）。CI は最大約 9 分 → 約 30 分に延びる。
- (b) `Check control plane memory headroom` step: CP では SSH 疎通確認のあと `/proc/meminfo` の MemAvailable を読み、
  `CP_PLAN_MIN_MEMAVAILABLE_MIB`（600）未満なら `CP_PLAN_HEADROOM_POLL_SECONDS`（30）ごとに `CP_PLAN_HEADROOM_WAIT_SECONDS`（300）まで待つ。
  戻らなければ plan を skip し、SSH 不達と同じ形式の fmt.json（playbook `cp-memory-headroom`、skipped 1、unreachable 0）を残す。worker（golyat-*）は確認なしで続行。
- 閾値 600MiB の根拠: 10-08〜09 に stall / kill が起きたときの MemAvailable 10 分最小は 269〜588MiB、M1 後の床は 915MiB 以上。通常時は待機に入らず、逼迫時だけ止める。

### 副作用・rollback

- plan 結果が欠ける CP が出うる（コメントに `cp-memory-headroom` として表示）。その場合は余力が戻ってから re-run する。apply-ansible 側には同じガードを入れていない（apply は merge 後に 1 台ずつ走り、fail-fast で止まると部分適用になるため、別途 wait 型のガードを検討）。
- rollback: 本 workflow の変更を revert するだけ（CP の状態は変わらない）。

### 検証

- actionlint v1.7.12 OK、headroom step の shell をローカルで ssh を mock して 4 ケース（閾値以上 / 未満 / 読取不能 / worker）確認。
- 本 PR 自体の plan run（直列）で、各 CP の plan 中の MemAvailable / leader change / major fault を worker-4 の Prometheus 経由で観測する。
