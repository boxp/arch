# BOXP-269 P0: golyat-1〜3 向け worker image pipeline の変数化と image 検証

チケット: BOXP-269（golyat-1〜3 を golyat-4 同様の worker image build pipeline 管理へ移行する）。
設計・根拠の正本は Obsidian `Projects/BOXP-269/`（README / evidence / migration-plan）。本ファイルは P0 の実装計画と安全境界の記録。

## 範囲（P0 で承認された内容）

- pipeline を node 非依存にし、golyat-1/2/3 の image を build・検証できるようにする。
- 既存 golyat-4 の image と通常 Ansible 管理の挙動を変えない。
- golyat-1〜3 を本番 Apply/Plan 対象に追加しない（G1 は別 PR）。実機 first boot / flash / 再 join は未承認。

## 変更内容

1. `ansible/vars/nodes.yml`
   - `node_ips` に golyat-1/2/3 を追加（CP playbook は添字参照のみなので挙動不変）。
   - `worker_nodes` を新設し、機種固有要素（NIC 名、GPU host tools の要否、ハード説明）を node ごとに記録。
2. `ansible/playbooks/worker-image.yml`
   - `worker_static_network_interface` を `worker_nodes[node_name].interface` から解決（`enp44s0` 決め打ちを撤去）。
   - `worker_install_gpu_host_tools` は image build（`chroot_build=true`）時のみ node 値を採用し、live 実行時は従来どおり既定 false。`-e` の明示指定が常に優先。
   - `node_name` が `worker_nodes`/`node_ips` にあることを assert。`default('golyat-4')` を撤去。
   - `worker_configure_static_network` の既定 false は変更しない（live ノードのネットワーク切替は G1/G2 の判断事項）。
3. `scripts/images/build-gpu-worker-image.sh`
   - `INSTALL_GPU_HOST_TOOLS` / `WORKER_NETWORK_INTERFACE` の既定を `auto` にし、`scripts/images/worker-node-config.py` 経由で `nodes.yml` と playbook の pin 値を解決。
   - `virt-sysprep` 後に `scripts/images/verify-gpu-worker-image.sh --image` で image 内部を read-only 検証し、`image-verify.txt` と拡張した `image-info.json`（node_ip/interface/gpu/k8s/CRI-O/multipath/verification）を出力。
4. `scripts/images/verify-gpu-worker-image.sh`（新規）
   - hostname、`/etc/lolice-worker-image`、networkd 静的設定、kubelet `--node-ip`、パッケージ版、GPU パッケージの有無、sshd、host key 非混入、authorized_keys、join 資材なし、build 残骸なし、credential パターンなしを検査。
   - Longhorn multipath blacklist（BOXP-267 arch#13808）は repo に `ansible/files/longhorn-multipath.conf` が存在する時のみ必須、それまでは warn。
5. `.github/workflows/build-gpu-worker-image.yml`
   - `install_gpu_host_tools` を choice（auto/true/false、既定 auto）へ。
   - 検証レポートを log・S3（timestamp 版と `latest.verify.txt`）・summary に出力。`verification=passed` と `node_name` 一致を確認。
6. テスト `ansible/tests/test_worker_nodes.py`, `ansible/tests/test_verify_gpu_worker_image.py`
   - nodes.yml と production inventory の整合、playbook の node 解決と live 既定、helper script、検証 script（合成 root tree で pass/fail）、plan/apply の対象が広がっていないこと（P0 ガード）。
7. `docs/GPU_WORKER_IMAGE_DEPLOYMENT.md` を 3 台分へ拡張。

## trigger / 副作用の検証

- `apply-ansible.yml` は `main` push かつ `ansible/**` 変更で発火し、matrix は shanghai-1〜3 + golyat-4 固定（fail-fast、max-parallel 1）。本 PR は `ansible/**` を含むため merge 時に既存 Apply は発火し得るが、これは renovate の ansible 依存更新と同じ経路で日常的に発生しているもの。
- 既存ノードへの影響は「golyat-4 の worker-image.yml 解決値が同一であること」で担保する: interface は workflow の `-e enp44s0` が引き続き優先、`worker_configure_static_network` は `-e true`、GPU は live 既定 false のまま。CP playbook は `node_ips[node_name]` の添字参照のみで、追加キーの影響なし。PR の Plan Ansible（check mode）で golyat-4 の差分が 0 であることを確認する。
- `build-gpu-worker-image.yml` は `workflow_dispatch` のみ。IAM trust は `repo:boxp/arch:*` なので PR branch からの dispatch で build でき、golyat-1〜3 の S3 prefix は新規（既存 golyat-4 の latest は触らない）。
- `plan-ansible.yml` / `plan-ansible-node.yml` / `apply-ansible.yml` は変更しない。

## 実施手順

1. PR 作成 → CI（test-ansible unittest/ansible-lint、Plan Ansible、actionlint/ghalint）。
2. PR branch を ref に `build-gpu-worker-image.yml` を golyat-1/2/3 で dispatch（`install_gpu_host_tools=auto`）。
3. S3 の成果物（timestamp 版 + sha256 + image-info.json + verify）と run log を確認し、Obsidian `Projects/BOXP-269` に記録。
4. review 後 merge。main 反映後に golyat-4 の Apply が発火した場合は差分 0 を確認する。

## P0 で行わないこと

- golyat-1〜3 への Ansible Apply / Plan 対象追加、実機 first boot、USB/disk 書込み、drain/再 join、Longhorn 操作。
- arch#13808 / lolice#871 の merge。#13808 が main に入るまで golyat-1〜3 の image には multipath blacklist が入らないため、G2 の flash 前に再 build が必要。
- build 成功を移行完了として扱うこと。
