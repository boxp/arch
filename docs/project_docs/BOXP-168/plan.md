# BOXP-168: shanghai-2 ノードダウン — Ansible再発防止策反映

## 根本原因まとめ

1. **IPv6 RA RDNSS による DNSサーバー過多**: RouterAdvertisement が IPv6 DNS を2つ広告 → resolv.conf が4サーバーになり kubelet の上限(3)を超過 → Pod操作ごとに "Nameserver limits exceeded" エラーを高頻度ログ出力
2. **ログサイズ制限なし**: journald `SystemMaxUse` 未設定、rsyslog logrotate サイズ制限なし → 40日で 29 GB eMMC が満杯
3. **watchdog タイムアウト**: ディスクフルで systemd-watchdog が sunxi-wdt(16s) を更新できず → ハードウェアリセット

## Ansible への反映内容

### `kubernetes_components` ロール

| 変更 | 詳細 |
|---|---|
| `journald_system_max_use` | `200M` → `512M` |
| `journald_runtime_max_use` (新規) | `256M` |
| `rsyslog_logrotate_max_size` (新規) | `200M` |
| `tasks/journald.yml` | `RuntimeMaxUse={{ journald_runtime_max_use }}` を `10-persistent-storage.conf` に追加 |
| `tasks/system_preparation.yml` | rsyslog logrotate の size 制限タスクを追加 |

### `network_configuration` ロール

| 変更 | 詳細 |
|---|---|
| `network_disable_ra_dns` (新規) | デフォルト `true` |
| `tasks/main.yml` | networkd drop-in `/etc/systemd/network/10-netplan-<iface>.network.d/no-ra-dns.conf` を作成 (`[IPv6AcceptRA] UseDNS=no`) |
| `handlers/main.yml` | `Restart systemd-networkd` ハンドラーを追加 |

## 効果

- Podの DNS 解決で "Nameserver limits exceeded" エラーが出なくなる (resolv.conf が 2 サーバー以内に収まる)
- journald のディスク使用量が 512M (persistent) / 256M (runtime) に上限設定される
- rsyslog が 200M を超えたら logrotate でローテーションされる
- 今後クラスターを再構築 / ノードを追加しても同じ設定が自動適用される
