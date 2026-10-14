# BOXP-231: kube-apiserver GOMEMLIMIT 1536MiB → 1792MiB の逐次試行と安全観測

作成日: 2026-10-14（claude-fable、Task Board run `20261014T092731Z-6f5573fa`）。
owner の明示承認「はい、引き上げを試してみましょう」（BOXP-230 第 1 手完了 / 60 分観測後の第 2 手）に基づく。
対象は値 1536MiB → 1792MiB の変更のみ。1792 超・`off`・GOGC 変更・etcd / node / swap / sysctl / GOAWAY 変更は範囲外。

## 背景（なぜ 1792MiB か）

- BOXP-225 M1（PR #13480、2026-10-09）で `GOMEMLIMIT=1536MiB` を 3 CP に適用。ヒープのピークは 1.8GiB → 1.3GiB に下がり
  MemAvailable の床は 330 → 930MiB へ回復した。当時の live heap 7 日最大は 977〜1,030MiB。
- その後 1.36.5 へ更新され（BOXP-194）、live heap が育った。2026-10-13 09:00〜10-14 09:00 UTC の 24h 実測（Prometheus、CP 外）:

  | 指標 | shanghai-1 | shanghai-2 | shanghai-3 |
  |---|---|---|---|
  | live heap 最大 / p99（MiB） | 1,128 / 1,099 | 1,167 / 1,122 | 1,121 / 1,084 |
  | heap_inuse 最大 / runtime sys 最大（MiB） | 1,386 / 1,707 | 1,440 / 1,783 | 1,381 / 1,708 |
  | GC CPU 平均 / 最大（core、4 core 中） | 1.00 / 1.73 | 1.63 / 2.10 | 0.84 / 1.27 |
  | GC 回数（/分、15m rate の 24h 最大） | 17.9 | 19.7 | 13.9 |
  | apiserver CPU 平均（core） | 1.55 | 2.31 | 1.37 |
  | MemAvailable 最小 / p10（MiB） | 1,347 / 1,447 | 1,082 / 1,218 | 1,492 / 1,591 |
  | load15 per-core 平均 | 1.51 | 2.56 | 0.94 |
  | major fault 最大（/s） | 2.4 | 5.6 | 5.4 |

- live heap ≈ 1.1GiB に対して limit 1536MiB では GC 1 サイクルあたりの割当余地が約 400MiB しかなく、GC が毎分 10〜20 回走って
  GC CPU が平均 25〜41% を占める（BOXP-230 の残課題: GC 32〜37% / per-core load ≈ 2）。
- 1792MiB は余地を約 650MiB（1.6 倍）にし、GC 頻度 / GC CPU をおおよそ 6 割に下げる見込み。メモリ側は +256MiB でも
  MemAvailable の床は 800MiB 以上残り（M1 前の 330MiB、P2b の Apply 閾値 600MiB より上）、etcd の major fault 再発余地は小さい。
- 停止 / rollback 閾値は BOXP-225 Decision Packet §6 / 現行停止条件のまま（readyz 5 分以内に 200 に戻らない、apiserver scrape 断 2 台以上、
  etcd leader なし、API 5xx > 5% が 5 分、MemAvailable < 400MiB かつ major fault > 50/s の再発、leader change の連発）。

## 実装（本 PR）

- `ansible/playbooks/control-plane.yml` の `apiserver_gomemlimit` を node 別の dict にし、**shanghai-1 だけ 1792MiB**、shanghai-2 / 3 は 1536MiB のまま。
  role（`tasks/apiserver_gomemlimit.yml`）・defaults・テンプレート・workflow は変更しない。
- 理由: 既存の authoritative Apply 経路（main への merge → `apply-ansible.yml`、matrix 直列 shanghai-1 → 2 → 3 → golyat-4、
  CP には P2b の memory headroom wait）は 1 回の merge で 3 CP を続けて回す。ticket の「1 台ずつ 60 分以上観測してから次へ」を
  この経路で満たすには、値を node 別に持って 1 PR = 1 台の apiserver 再起動にするのが最小差分（値が変わらない node は既存タスクが
  changed=0 で再起動しない。2026-10-14 08:52 の Apply run 38538261670 で 3 CP とも gomemlimit タスクは changed=0 だったことを確認）。
- 2 台目・3 台目は同じ試行範囲で、各 60 分以上の観測と安全 gate 成立後に dict の値を 1 台ずつ 1792MiB にする PR を順に merge する。
  rollback は該当 node の値を 1536MiB に戻す PR（同じ経路、その 1 台だけ再起動）。
- kube-system/kubeadm-config の `apiServer.extraEnvs` はクラスタ共通の ConfigMap なので、移行中は最後に Apply が走った CP（shanghai-3）の
  値になる（stage 1 では 1536MiB）。`kubeadm upgrade` を挟まない限り稼働中の manifest には影響せず、全台が 1792MiB になった時点で一致する。
- 検証: `ansible-lint` Passed、`--syntax-check` OK、node 別の値を role の `apiserver_gomemlimit_validate.yml` に通して 3 node とも受理
  （値は `str`、長さ 7、形式 / 範囲 assert 通過）。PR の `plan-ansible.yml`（--check --diff、CP 直列）で shanghai-1 のみ manifest 書換えが
  changed になり shanghai-2 / 3 は changed=0 であることを merge 前に確認する。

## 実行手順（run 内で実施）

1. 事前 gate（CP 外 observer golyat-3 → prometheus-k8s と shanghai-3 admin 経路）: apiserver up 3/3、etcd leader あり / 24h leader change 0、
   7 Node Ready / lease 更新、Longhorn 4 node Ready / 10 volume healthy、Terminating ns 0、競合 Apply / Task Board カードなし。
2. 原本保全: 3 CP の `kube-apiserver.yaml`（非 Secret）と kubeadm-config の ClusterConfiguration を run workspace `backup/gomemlimit-20261014/`
   （700 / 600、SHA256SUMS）に保存。role 側も `/var/backups/kubernetes-manifests/kube-apiserver.yaml.orig` を保持。
3. PR → CI（plan で差分 dry-run を確認）→ merge → Apply run を 1 分間隔で監視（停止条件該当が 5 回連続なら `gh run cancel`）。
   shanghai-1 の job 完了後に pod env / `go_gc_gomemlimit_bytes`（1879048192）/ readyz / 他 2 台の不変を確認。
4. 変更後 60 分以上、5 分間隔で GC CPU・GC 回数・live heap・heap goal・runtime sys・RSS・MemAvailable・major fault・etcd fsync / commit p99・
   leader・API p99 / 5xx / 429・Node / lease・Longhorn を取得し、事前 baseline と未変更台（shanghai-2 / 3、いずれも 09:01〜09:24 UTC に
   再起動済みで heap の年齢がほぼ同じ）を対照にする。再起動直後の軽い heap と 1792 の持続効果は区別する。
5. 結果は Obsidian `Projects/BOXP-231/` に保存し ticket Notes にリンク。24h / 日次比較は未取得として明示し、既存の担当継続経路へ引き継ぐ。

## 先に起きていたこと（本 PR の前提）

- renovate PR #13552（`.github/workflows/apply-ansible.yml` の action 更新）の merge で 2026-10-14 08:52〜09:27 UTC に Apply run 38538261670 が走り、
  3 CP とも `--goaway-chance` フラグの位置 drift（1.36.5 の `kubeadm upgrade` がフラグを末尾に並べ直していた）を W1 タスクが修正したため
  apiserver が 09:01 / 09:13 / 09:24 に再起動した（GOMEMLIMIT は 1536MiB のまま、changed=0）。golyat-4 は cri-o の downgrade 拒否で failure
  （control-plane.yml の `kubernetes_version: 1.36.1` と live 1.36.5 の drift、本票の範囲外。CP 3 台の job は success）。
  本 PR の merge で走る Apply でも golyat-4 job は同じ理由で失敗する見込みだが、matrix の最後なので CP の適用には影響しない。

## 進捗（2026-10-14、run `20261014T102122Z-29c009d6` で追記）

- 10:07 UTC: PR #13624 merge（ed2fc7e21）。plan で shanghai-1 のみ manifest changed、shanghai-2 / 3 は apt cache のみを確認済み。
- 10:16 UTC: Apply run 38547325019 の shanghai-1 job で apiserver 再起動（10:16:36Z）。pod env / `go_gc_gomemlimit_bytes` = 1792MiB、readyz 200、up 3/3、shanghai-2 / 3 は 1536MiB で不変。
- 前提の変化: etcd leader は 09:48:30 UTC に shanghai-2 → shanghai-1（BOXP-222 Apply の shanghai-2 CRI-O 再起動時。etcd プロセス再起動なし、本票の変更前）。
  変更台が leader になったため、60 分窓では shanghai-1 の etcd fsync / commit p99 を重点監視する。
- 第 2 段（本 PR）: shanghai-3 を 1792MiB にする。順序は leader でない shanghai-3 → shanghai-2（leader は最後）。
  merge 条件は shanghai-1 の 60 分窓（10:16〜11:16 UTC）で GC CPU / GC 回数の改善が未変更台対照で見え、かつ安全 gate（up 3/3、leader あり / 連発なし、
  5xx ≤ 5%、MemAvailable ≥ 400MiB かつ major fault 再発なし、etcd fsync / commit の秒級スパイクなし、7 Node Ready / lease / Longhorn 健全）が成立していること。
  改善なし / 悪化 / 原因不明なら merge せず、shanghai-1 を 1536MiB に戻す PR に切り替える。
- 観測の生データ: 前 run の `/tmp/b231` は workspace shutdown で消失。再開 run で Prometheus（golyat-3 経由）から 09:30 以降を 5 分刻みで再構成し、以後 5 分間隔で継続。
