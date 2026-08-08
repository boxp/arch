# shanghai ノードの突然死対策 (A / B / D)

## 背景

2026-08-01 20:50:45 UTC、control-plane ノード `shanghai-1` (192.168.10.102 / Orange Pi Zero 3)
が突然停止し、**3日間** 無応答のままだった。電源 LED は点灯していたが、同一 L2 上の
shanghai-2 から見て ARP が INCOMPLETE、22/6443/10250/2379 すべて閉。

### 調査で除外できた原因

Prometheus (31日保持) で停止直前まで追跡した結果、いずれも異常なし:

- OOM: 0件、MemAvailable 約 870MB (swap なし)
- 温度: cpu-thermal 69℃ で安定 (H618 のスロットルは 85℃〜)
- rootfs: 37.4GB 空き、`node_filesystem_readonly` = 0
- NIC: `end0` up、受信エラー 0
- 段階的劣化なし。20:50:30 まで全指標フラットで、次のスクレイプから消滅

### 真因: microSD の I/O 破綻によるハードハング

| 日付 | shanghai-1 | shanghai-2 | shanghai-3 |
|---|---|---|---|
| 07/20 | 5.0 ms | 2.8 ms | 2.3 ms |
| 07/30 | 6.9 ms | 3.7 ms | 3.1 ms |
| **08/01 (死亡日)** | **9.5 ms** | 5.4 ms | 2.3 ms |

(`node_disk_write_time_seconds_total / node_disk_writes_completed_total`、device=mmcblk0)

3ノードとも書き込み量は同一 (**~64 GiB/日**、2026-07-25 19:00 UTC に 27→64 GiB/日 へ倍増)
なのに、shanghai-1 の write await だけが劣化していた。書き込みの主犯は **etcd**
(実測 13.8 MB/60s のユーザ空間書き込みが、fsync と SD の消去ブロック粒度でブロック層 64GiB/日 に増幅)。
shanghai-1 の ext4 `Lifetime writes` は 3408 GB。

**同じ死に方の証拠が shanghai-2 に残っている** (2026-08-03 00:13、前回ブートの journal):

```
00:09 のログエントリが 00:11:16 に書かれている  ← journald が2分遅延
Aug 03 00:10:34 systemd-journald.service: Watchdog timeout (limit 3min)!
Aug 03 00:09:56 kubelet: Status from runtime service failed: DeadlineExceeded
Aug 03 00:13:20 ← ログが途切れる (shutdown メッセージなし = ハード凍結)
Aug 03 00:14:12 ← 再起動
```

### 復旧後に判明した2つの構造的欠陥

1. **死亡時のログが原理的に残らない。**
   `/var/log` は `armbian-ramlog` により **zram0 (RAM) 上**にあり、`/var/log.hdd` への同期は
   **clean shutdown 時のみ** (定期タイマなし)。ハードハングすると全消失する。
   journald は persistent 設定 (200M / 1month、`journald.yml` で導入済み) だが、
   **置き場所が RAM なので効果がなかった。** 復旧後の `journalctl -b -1` は実際に空振りした。

2. **ハングしても誰も復旧させない。**
   `/dev/watchdog` は存在するが systemd の `RuntimeWatchdogSec` が未設定で、誰も蹴っていない。
   `kernel.panic=10` / `panic_on_oops=1` は設定済みなのに自動再起動しなかった
   = oops/panic ではなく **I/O 待ちのハードハング**。

### 付随して判明した観測の穴

etcd の ServiceMonitor は PR #319 で導入済みだが、**3ノードとも scrape 失敗**していた
(`192.168.10.10x:2381: connection refused`)。

実機を確認したところ、**フラグ自体は 3 ノードとも存在していた**:

```
- --listen-metrics-urls=http://127.0.0.1:2381
```

`0.0.0.0` ではなく **loopback にしか bind していない**ため、ノード IP を叩く Prometheus
から届いていなかった。`kubeadm-config.yaml.j2` は `http://0.0.0.0:2381` を宣言しているが、
これが静的 Pod マニフェストへ反映されるのは `kubeadm init/upgrade` の時だけで、
先に構築されたクラスタには効いていない。
そのため etcd メトリクスが一切なく、07/25 の書き込み倍増の犯人も追えていない。

## 対応方針

本 PR では A / B / D を扱う。C (etcd を SD から外して USB SSD へ) は別途。

### A. 自動復旧 — hardware watchdog + hung_task_panic

| 設定 | 値 | 狙い |
|---|---|---|
| `RuntimeWatchdogSec` | 15 | PID1 ごとハングした場合に SoC watchdog がリセット |
| `RebootWatchdogSec` | 15 | 再起動処理自体がハングした場合の保険 |
| `kernel.hung_task_timeout_secs` | 300 | 「5分 D 状態」を異常と判定 |
| `kernel.hung_task_panic` | 1 | ユーザ空間だけが I/O 待ちで全停止するケースを panic 経由で再起動 |
| `kernel.panic` | 10 | panic 後 10 秒で再起動 (Armbian 既定と同値だが明示化) |

watchdog だけでは shanghai-2 型のハング (PID1 が生きていて watchdog を蹴り続ける) を救えない。
逆に `hung_task_panic` だけでは PID1 ごと死んだ場合に効かない。両方入れて初めて塞がる。
閾値 300 秒は「5分間 I/O が返らない時点で実質死んでいる」という判断。

**🔥 watchdog のタイムアウトは 16 秒を超えてはいけない。** Orange Pi Zero 3 (H618) の
`sunxi-wdt` は `max_timeout=16`。実機確認済み
(`/sys/class/watchdog/watchdog0/timeout` = 16、dmesg
`Watchdog enabled (timeout=16 sec, nowayout=0)`)。これを超える値を指定すると
`WDIOC_SETTIMEOUT` が `EINVAL` を返し、systemd は watchdog を諦めてデバイスを閉じる。
**drop-in ファイルは出来るのに watchdog は無効**という最悪の形になるため、
15 秒に設定し molecule でも上限を assert している。

### B. 証拠保全 — armbian-ramlog 無効化

`/etc/default/armbian-ramlog` の `ENABLED=false` + サービス無効化により `/var/log` を SD 上へ戻す。
既存の `journald_persistent_storage` (200M 上限 / 1ヶ月保持) がこれで初めて機能する。

**順序が重要。** `armbian-ramlog` は先頭で `[ "$ENABLED" != true ] && exit 0` しており、
`ENABLED=false` にすると `start` だけでなく **`stop` も no-op** になる。
先に設定を書き換えると、次のシャットダウン時の `ExecStop` が `syncToDisk` せずに終了し、
RAM 上にある「適用前ブートのログ」がそのまま失われる。
そのため **まだ有効なうちに `systemctl stop armbian-ramlog` を実行**する
(`stop` = `syncToDisk` + `umount -l`。lazy なので使用中でも失敗しない)。
これにより再起動を待たずに `/var/log` が SD 上のディレクトリへ戻り、以降のログが永続化される。
lazy umount 後も journald は元の fd を掴んだままなので、既存の
`Restart systemd-journald` ハンドラで開き直させる。

増加する書き込みは journald 実測 272 KiB/60s ≒ **0.4 GB/日** で、
etcd の 13 GB/日 に対して 3% 程度。`hung_task_timeout_secs` 超過時のスタックトレースが
SD に残るようになり、次回の突然死は原因が確定できる。

再起動は不要 (上記の `stop` で即時に切り替わる)。ただし他のロガー
(rsyslog 等) は次の再起動まで元の fd を使い続ける。

### D. etcd の書き込み削減と可観測性

- **D1. etcd defrag の定期自動化** — DB 626MB のうち 94% が未使用。CronJob で自動化する (lolice 側)
- **D2. descheduler の実行間隔** — `*/2 * * * *` (720回/日) → `*/30 * * * *` (48回/日)。
  1回ごとに Job/Pod オブジェクトの生成・更新・削除が etcd に書かれる (lolice 側)
- **D3. etcd メトリクスの有効化** — 稼働中の `/etc/kubernetes/manifests/etcd.yaml` の
  `--listen-metrics-urls` を宣言値 (`http://0.0.0.0:2381`) へ揃え、既存 ServiceMonitor を
  生かす (本リポジトリ)。現行 3 ノードは `127.0.0.1` bind なので「追加」ではなく
  「既存値の追従」パスが実際の修正になる

`leases` の 5.3 writes/s は kube-controller-manager / kube-scheduler / Longhorn の
リーダー選出更新であり、Kubernetes の正常動作。renew 間隔の変更は control-plane の
flap リスクがあるため**本 PR では触らない**。

## 変更内容 (本リポジトリ)

| ファイル | 変更 |
|---|---|
| `ansible/roles/kubernetes_components/defaults/main.yml` | `node_resilience_*` 変数を追加 (既定 false) |
| `ansible/roles/kubernetes_components/tasks/node_resilience.yml` | 新規。watchdog / hung_task / armbian-ramlog |
| `ansible/roles/kubernetes_components/tasks/main.yml` | 上記を include |
| `ansible/roles/kubernetes_components/handlers/main.yml` | `Reexec systemd` ハンドラを追加 |
| `ansible/roles/kubernetes_components/tasks/kubeadm.yml` | etcd マニフェストの `--listen-metrics-urls` を宣言値へ揃える。`backup: true` を廃し `/var/backups` へ退避。復旧確認を `/health` に変更 |
| `ansible/playbooks/control-plane.yml` | `serial: 1` を追加。control-plane で `node_resilience_*` を有効化 |
| `ansible/roles/kubernetes_components/molecule/*/verify.yml` | 上記の検証を追加 |

既定値は **false**。`journald_persistent_storage` と同じく、
control-plane playbook 側で明示的に有効化する方式に揃える。

## 適用手順

```bash
cd ansible

# 1. watchdog / hung_task / ramlog / etcd メトリクス
ansible-playbook -i inventories/production/hosts.yml playbooks/control-plane.yml \
  --tags "kubernetes" --limit shanghai-1

# 2. etcd の健全性を確認してから次のノードへ
kubectl -n kube-system exec etcd-shanghai-2 -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  endpoint status --cluster -w table
```

再起動は不要。armbian-ramlog は playbook 内で `stop` してから無効化するため、
`/var/log` はその場で SD 上のディレクトリへ切り替わる。

**1ノードずつ処理される。** etcd マニフェストの変更は静的 Pod の再起動を伴うため、
3台同時に行うと quorum を失う。これは play の `serial: 1` で担保している
(task 側の `throttle: 1` だけでは、linear strategy が「全ホストの書き換え」→
「全ホストの復旧待ち」の順に進むため直列化にならない)。
`--limit` での明示的な絞り込みも併用するとより安全。

## 検証項目

- [ ] `cat /proc/sys/kernel/hung_task_panic` → `1`
- [ ] `systemctl show -p RuntimeWatchdogUSec` → `15s` (0 でないこと)
- [ ] `cat /sys/class/watchdog/watchdog0/state` → `active`
- [ ] `journalctl -u init.scope | grep -i watchdog` に EINVAL / 失敗ログが無いこと
- [ ] `findmnt /var/log` が rc=1 (= /var/log がマウントポイントでない)。
      `findmnt --target /var/log` は `/dev/mmcblk0p1` を返す (zram0 でないこと)
- [ ] 再起動をまたいで `journalctl -b -1` が読めること
- [ ] `grep listen-metrics-urls /etc/kubernetes/manifests/etcd.yaml` → `http://0.0.0.0:2381`
- [ ] `/etc/kubernetes/manifests/` に `*~` が残っていないこと。
      **適用前の実機 3 ノードすべてに旧 `backup: true` 由来の
      `etcd.yaml.<pid>.<date>~` が残っていた** (kubelet が静的 Pod として読むため
      etcd が重複定義される)。playbook が `/var/backups/kubernetes-manifests/` へ退避する
- [ ] Prometheus の `serviceMonitor/monitoring/etcd/0` が 3/3 up
- [ ] `etcd_mvcc_db_total_size_in_bytes` が取得できること

## 適用時に踏んだ罠 (2026-08-05)

`Apply Ansible` ワークフロー (main への push で自動実行される) が shanghai-1 で失敗した。
etcd マニフェストの更新までは成功し、health ゲートで 30 回リトライして落ちた。
`serial: 1` により shanghai-2/3 のジョブは cancelled となり、**shanghai-1 だけが
「etcd 部分は適用済み・A/B は未適用」という中途半端な状態**になった。

失敗ログに残っていたレスポンスは期待通りだった:

```
status: 200
content: {"health":"true","reason":""}
content_type: text/plain; charset=utf-8
```

**真因: etcd の `/health` は `Content-Type: text/plain` を返す。**
Ansible の `uri` モジュールが `.json` を埋めるのは JSON の Content-Type の時だけなので、
`etcd_health_probe.json` は常に undefined になり `default('false')` に落ちていた。
`.content` を `from_json` で自前解釈するよう修正。

実機の応答をそのまま入れて、旧式 `False` / 新式 `True` を確認済み。

## 残課題

- **C. etcd を SD から外す (USB SSD)** — 本命の恒久対策。別 PR
- 2026-07-25 19:00 UTC の書き込み倍増 (27→64 GiB/日) の犯人特定。
  D3 で etcd メトリクスが取れるようになってから再調査する
- shanghai-1 の SD カード (SE064 57.6GiB、ext4 lifetime writes 3408 GB) は
  write await が兄弟機の 4 倍まで劣化しており、交換候補
