# BOXP-531 USB SSD 限定適用計画

## 目的と確認済み状態

既存 SSD と Longhorn のデータを維持し、fstab とマウント下の空ディレクトリ保護を管理する。2026-11-13 の実機確認結果:

| ノード | ext4 UUID | マウント先 | underlay | SSD |
| --- | --- | --- | --- | --- |
| golyat-1 | f06fd95d-4136-46c2-ab6d-537d2670c5b0 | /var/lib/longhorn-usb | 空、root:root 0755、immutable | immutable なし |
| golyat-3 | ef52a1bb-f02d-48b4-9e23-2e4c1ac0a1d9 | /var/lib/longhorn-usb | 空、root:root 0755、immutable | immutable なし、レプリカあり |

## 限定入口と安全設計

単独 playbook `usb-ssd-storage.yml` を明示的な確認フラグと limit で実行する。apply-ansible の対象解決は playbook と専用 vars・script をどのノードにも割り当てず、golyat-1/3 は自動適用 matrix にも含まれない。inventory は変更しない。UUID と ext4 を検証し、fstab の重複・競合を拒否する。underlay は非再帰 bind を private mount namespace 内で利用し、空であることを確認してから immutable を設定する。SSD ルートが immutable の場合は停止する。未マウント時のみ systemd mount unit を開始する。

## 適用手順

事前に各ノードの `/etc/fstab` を安全な場所へバックアップし、SSD ルートと namespace 経由の underlay の `lsattr -d` を記録する。実機状態と Longhorn を確認した上で、まず次を実行する。

```sh
cd ansible && uv run ansible-playbook -i inventories/production/hosts.yml playbooks/usb-ssd-storage.yml --limit golyat-1,golyat-3 -e usb_ssd_storage_confirm=true -e "ansible_ssh_common_args=''" --check --diff
```

結果を確認後、同じコマンドから `--check` を除いて適用し、さらに同じ適用コマンドを再実行して changed=0 を確認する。

## ロールバックと対象外

必要なら事前バックアップから fstab を復元し systemd daemon-reload を行う。underlay の immutable 解除が必要な場合は対象を確認し、マウント中は必ず private namespace の非再帰 bind 経由でのみ `chattr -i` を実行する。Longhorn の操作は別途判断する。再起動試験、アンマウント、Longhorn の変更は対象外。
