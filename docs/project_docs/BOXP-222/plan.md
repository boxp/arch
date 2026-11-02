# BOXP-222: CRI-O checkpoint/restore の明示設定と 1.36 baseline の live 追従

## Context

- 月次セキュリティ診断（2026-10-07）の High 所見「lolice 全7ノードの CRI-O 1.36.1/1.36.2」は、BOXP-194 の直列更新（2026-10-10〜10-11）で全7台 CRI-O 1.36.6（deb 1.36.6-3.1）/ kubelet v1.36.5 となり、版としては是正済み。
- cri-o/cri-o の repository advisory を照合した結果、1.36 系の patched version は CVE-2026-62146 / CVE-2026-17113 = 1.36.4、CVE-2026-92574 / CVE-2026-15801 / CVE-2026-76061 = 1.36.6。v1.36.7 は version bump のみで追加修正なし。
- 残件のうち repo 変更で閉じられるのは次の2点で、本 PR はこれを扱う。
  1. CVE-2026-92574 / CVE-2026-15801（checkpoint restore 経路）の advisory workaround である `[crio.checkpoint_restore] container_level_enabled = "checkpoint_only"`（または `"none"`）が ansible に明示されていない。
  2. `crio_version` / `kubernetes_version` / `kubernetes_package_version` が 1.36.1 固定のままで live（1.36.6 / 1.36.5 / 1.36.5-1.1）と乖離しており、新規 worker image や再構築時に 1.36.1 が入って drift が再発する。
- CP 3台の CVE-2026-62146 running container wipe（cordon→drain→reboot）、node 内 read-only 確認、目標版（1.36.6 維持 or 1.36.7）の判定は owner 承認が必要なため本 PR の scope 外。

## Plan

1. `kubernetes_components` role に `crio_checkpoint_restore_level`（default `"checkpoint_only"`）を追加し、`/etc/crio/crio.conf.d/05-checkpoint-restore.conf` として `[crio.checkpoint_restore] container_level_enabled` を書く。`"checkpoint_restore"` は assert で拒否する。変更時は既存の `Restart crio` handler を notify する。`crio_version` が 1.36.6 未満のときはテーブルが未知で無視されるため、警告（debug）で可視化する（codex review 指摘）。
2. Molecule default scenario の verify に drop-in の存在と内容（`checkpoint_only`、`checkpoint_restore` 不在）の検証を追加する。
3. `inventories/production/hosts.yml`（control_plane / workers）、`playbooks/control-plane.yml`、`playbooks/node-shanghai-{1,2,3}.yml`、`playbooks/worker-image.yml` の baseline を `kubernetes_version 1.36.5` / `kubernetes_package_version 1.36.5-1.1` / `crio_version 1.36.6` / `crio_package_version 1.36.6-3.1` へ更新する。
   - codex review 指摘: `crio_version` は apt repo の major.minor（v1.36）を決めるだけで、`crio_package_version` 未指定の本番経路（inventory / control-plane / node playbook）では `cri-o` が `state=present` で入るため、宣言値を変えても実 package 版は固定・更新されない。対処として `tasks/crio.yml` に Kubernetes package と同じ baseline 比較（未導入または指定版未満なら `cri-o=<指定版>` を導入、指定版より新しければ downgrade せずスキップ、指定時は apt hold）を追加し、本番経路すべてに `crio_package_version: 1.36.6-3.1`（OBS v1.36、amd64/arm64 とも存在）を設定する。
   - テスト: Molecule default scenario で pin した revision が入り hold されること、新規 `crio-baseline` scenario で「installed が baseline より新しいとき downgrade されない」ことを検証する。
4. `upgrade-k8s.yml` の workflow_dispatch 入力例を現行版に合わせる。
5. 検証: `ansible-lint`、`actionlint` / `ghalint`、Molecule default（x86_64 と `MOLECULE_DOCKER_PLATFORM=linux/arm64`）。PR の Plan Ansible（`--check --diff`、shanghai-1/2/3 と golyat-4）で、変更が drop-in 追加と `Restart crio` handler のみで、cri-o / kubelet の downgrade・再インストールが出ないことを確認してから merge する。

## 適用時の注意

- Apply Ansible は `max-parallel: 1` かつ `control-plane.yml` は `serial: 1` + `flush_handlers` + etcd health gate のため、`Restart crio` が複数 CP で同時に走ることはない。CRI-O の再起動は既存 container を保持する（CVE-2026-62146 の wipe にはならない）。
- 通常 Apply は cri-o / kubelet 系とも baseline 比較で「指定版未満なら更新、新しければスキップ」のため、live（cri-o 1.36.6-3.1 / kubelet 1.36.5-1.1）と同版の baseline では package 変更は発生しない。`Hold CRI-O package` は `crio_package_version` 指定により全ノードで走るので、まだ hold されていないノードでは hold が changed になる（package 変更ではない）。
- 将来 upgrade-k8s workflow で版を上げたら、同じ PR か直後の PR で `crio_package_version` / `kubernetes_package_version` も追従させる。追従しないと通常 Apply は downgrade こそしないが、新規 image / 再構築時に古い版が入る。

## Rollback

PR を revert する。revert は宣言メタデータと drop-in を戻すだけで、live の package 版は変わらない。drop-in を外した場合も CRI-O 1.36.6 の既定値は `checkpoint_only` のため、restore 経路が開くことはない。
