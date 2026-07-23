# BOXP-127: control-plane ノード電源断原因調査と恒久対策

## 根本原因

Orange Pi Zero3 の control-plane ノード（shanghai-1/2/3）が繰り返し到達不能になる原因は、**microSD カードの書き込み耐久性不足**による OS フリーズ・ファイルシステム read-only 化。

- INC-2（2026-07-06, shanghai-2）: SD カード障害 → OS 再イメージで復旧
- INC-4（2026-07-12, shanghai-2）: 交換後わずか 7 日で再障害 → etcd WAL 書き込み負荷による急速摩耗
- BOXP-127（2026-07-22, shanghai-1）: 同パターン

## 即座の対応（実施済み・手動）

1. shanghai-1 の電源サイクル（ユーザーが 2026-07-23 に実施）
2. 起動しない場合は `shanghai-control-plane-sdcard-failure.md` runbook に従い SD カード交換 → etcd member re-join

## 恒久対策の優先順位

### 1. journald 永続化（本 PR: arch repo）

`kubernetes_components` Ansible ロールに journald.yml タスクを追加。

- `/var/log/journal` ディレクトリを作成し `Storage=persistent` に設定
- `SystemMaxUse=200M`, `MaxRetentionSec=1month` で SD カード消費を抑制
- デフォルト無効（`journald_persistent_storage: false`）。control-plane playbook 側で `true` に設定することで control-plane ノード限定で有効化。worker ノードには適用されない
- 次回 Ansible Apply 時に全 control-plane ノードに適用される

**効果**: 次回 SD カード障害時に障害直前のカーネルログ・ストレージエラー（`EXT4-fs error`, `mmcblk0: error -110`）が保存され、根本原因の確定が可能になる。

### 2. Alertmanager ルール追加（lolice repo: feature/control-plane-node-alert ブランチ）

`control-plane-node-rules.yaml` に以下のアラートを追加:

| アラート名 | 条件 | 重要度 |
|---|---|---|
| `ControlPlaneNodeNotReady` | control-plane ノードが 5 分以上 NotReady | critical |
| `EtcdMemberDown` | etcd member 数が 2 未満 | critical |
| `EtcdHighFsyncDuration` | WAL fsync p99 > 500ms が 10 分継続 | warning |
| `ControlPlaneFilesystemReadOnly` | `/`, `/var`, `/var/lib` が read-only | critical |
| `ControlPlaneHighDiskIOWait` | mmcblk デバイスの I/O 使用率 > 90% が 15 分継続 | warning |

### 3. 高耐久メディアへの移行（今後の実施）

優先順位:
1. **高耐久 microSD（A2/SLC キャッシュ付き）への交換**: Samsung PRO Endurance / Western Digital Purple SC QD101 / SanDisk MAX Endurance などを推奨。TBW 値が通常品の 10〜40 倍。
2. **USB SSD への移行（最優先推奨）**: etcd データディレクトリ（`/var/lib/etcd`）を USB SSD にバインドマウント。SD カードを読み取り専用 OS 起動用に限定。
3. **eMMC への移行**: Orange Pi Zero3 には eMMC スロットがない（ボード非対応）ため対象外。

## 実施済み変更

- `arch/ansible/roles/kubernetes_components/tasks/journald.yml`: journald 永続化タスク（新規）
- `arch/ansible/roles/kubernetes_components/tasks/main.yml`: journald.yml を include
- `arch/ansible/roles/kubernetes_components/defaults/main.yml`: `journald_persistent_storage` デフォルト変数追加
- `arch/ansible/roles/kubernetes_components/handlers/main.yml`: `Restart systemd-journald` ハンドラ追加
- `lolice/argoproj/prometheus-operator/control-plane-node-rules.yaml`: etcd・SDカード I/O アラート追加

## journald 無効時の設計方針

`journald_persistent_storage: false`（ロールデフォルト）では:

1. **ロール管理の drop-in のみを削除する**（`state: absent`）。`Storage=volatile` を書き込むことはしない。
2. **既存の `/var/log/journal` は保持する**。ログの破壊的削除は `journald_purge_persistent_logs: true` の明示指定時だけ行う。
3. **Storage=auto 動作への委任は意図的な設計**。drop-in 不在で journald はデフォルトの `Storage=auto` に戻る。新規ノードや `/var/log/journal` を持たないノードでは volatile になり永続化しない。これが worker ノードの想定動作。
4. **Molecule 検証**では、無効時に drop-in が存在しないことを確認する（`journald-disabled` シナリオ）。

> `/var/log/journal` が既に存在するホストで false に切り替えた場合、`Storage=auto` により journald が引き続き永続化する可能性がある。これは既存ログを保全するための意図的な非破壊設計。そのようなホストで完全に volatile に戻したい場合は `journald_purge_persistent_logs: true` を使用すること。
