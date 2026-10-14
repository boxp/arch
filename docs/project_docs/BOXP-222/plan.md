# BOXP-222: CRI-O checkpoint/restore の明示設定と 1.36 baseline の live 追従

## Context

- 月次セキュリティ診断（2026-10-07）の High 所見「lolice 全7ノードの CRI-O 1.36.1/1.36.2」は、BOXP-194 の直列更新（2026-10-10〜10-11）で全7台 CRI-O 1.36.6（deb 1.36.6-3.1）/ kubelet v1.36.5 となり、版としては是正済み。
- cri-o/cri-o の repository advisory を照合した結果、1.36 系の patched version は CVE-2026-62146 / CVE-2026-17113 = 1.36.4、CVE-2026-92574 / CVE-2026-15801 / CVE-2026-76061 = 1.36.6。v1.36.7 は version bump のみで追加修正なし。
- 残件のうち repo 変更で閉じられるのは次の2点で、本 PR はこれを扱う。
  1. CVE-2026-92574 / CVE-2026-15801（checkpoint restore 経路）の advisory workaround である `[crio.checkpoint_restore] container_level_enabled = "checkpoint_only"`（または `"none"`）が ansible に明示されていない。
  2. `crio_version` / `kubernetes_version` / `kubernetes_package_version` が 1.36.1 固定のままで live（1.36.6 / 1.36.5 / 1.36.5-1.1）と乖離しており、新規 worker image や再構築時に 1.36.1 が入って drift が再発する。
- CP 3台の CVE-2026-62146 running container wipe（cordon→drain→reboot）、node 内 read-only 確認、目標版（1.36.6 維持 or 1.36.7）の判定は owner 承認が必要なため本 PR の scope 外。

## Plan

1. `kubernetes_components` role に `crio_checkpoint_restore_level`（default `"checkpoint_only"`）を追加し、`/etc/crio/crio.conf.d/05-checkpoint-restore.conf` として `[crio.checkpoint_restore] container_level_enabled` を書く。`"checkpoint_restore"` は assert で拒否する。変更時は既存の `Restart crio` handler を notify する。
2. Molecule default scenario の verify に drop-in の存在と内容（`checkpoint_only`、`checkpoint_restore` 不在）の検証を追加する。
3. `inventories/production/hosts.yml`（control_plane / workers）、`playbooks/control-plane.yml`、`playbooks/node-shanghai-{1,2,3}.yml`、`playbooks/worker-image.yml` の baseline を `kubernetes_version 1.36.5` / `kubernetes_package_version 1.36.5-1.1` / `crio_version 1.36.6`（worker-image は `crio_package_version 1.36.6-3.1`）へ更新する。
4. `upgrade-k8s.yml` の workflow_dispatch 入力例を現行版に合わせる。
5. 検証: `ansible-lint`、`actionlint` / `ghalint`、Molecule default（x86_64 と `MOLECULE_DOCKER_PLATFORM=linux/arm64`）。PR の Plan Ansible（`--check --diff`、shanghai-1/2/3 と golyat-4）で、変更が drop-in 追加と `Restart crio` handler のみで、cri-o / kubelet の downgrade・再インストールが出ないことを確認してから merge する。

## 適用時の注意

- Apply Ansible は `max-parallel: 1` かつ `control-plane.yml` は `serial: 1` + `flush_handlers` + etcd health gate のため、`Restart crio` が複数 CP で同時に走ることはない。CRI-O の再起動は既存 container を保持する（CVE-2026-62146 の wipe にはならない）。
- 通常 Apply は `crio_package_version` 未指定（`cri-o` state=present、`allow_downgrade: false`）で、kubelet 系は baseline より新しい package をスキップするため、live と同版の baseline では package 変更は発生しない。

## Rollback

PR を revert する。revert は宣言メタデータと drop-in を戻すだけで、live の package 版は変わらない。drop-in を外した場合も CRI-O 1.36.6 の既定値は `checkpoint_only` のため、restore 経路が開くことはない。
