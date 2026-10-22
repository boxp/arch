# BOXP-267: apply-ansible の適用対象を変更ファイルから導出する

> `plan.md` は同票の恒久修正 PR (#13808) が同じディレクトリに追加するため、衝突を避けてファイル名を分けている。

## 背景

- BOXP-267 の恒久修正 (#13808) は worker (golyat-4) 限定の差分 (`worker-image.yml`、`files/longhorn-multipath.conf`、
  `files/verify_longhorn_multipath.py`、手動用 `longhorn-multipath.yml`、tests) だが、`apply-ansible.yml` は
  main への `ansible/**` push で `shanghai-1 → shanghai-2 → shanghai-3 → golyat-4` の固定 matrix を直列 (fail-fast) に
  Apply するため、merge が control plane 3 台への本番 Apply を起動してしまう (2026-10-22 07:28 UTC run #39740734239 では
  shanghai-1/2 が実 Apply 成功、shanghai-3 が別件で失敗、golyat-4 は cancel)。
- owner 承認は「恒久対策を、意図しない CP Apply を起こさずに正本へ反映する」。CP Apply の包括承認でも、Apply の恒久停止でもない。

## 方針 (最小・安全な分離)

`apply-ansible.yml` に `select-targets` job を前置し、push で変更されたファイルから影響ノードを導出して
`apply` job の matrix に渡す。導出は `.github/scripts/ansible-apply-targets.sh` が行い、規則は次の通り。

| 変更ファイル | 対象 |
| --- | --- |
| `ansible/playbooks/control-plane.yml` | 全 `shanghai-*` |
| `ansible/playbooks/worker-image.yml` | 全 `golyat-*` (現在は golyat-4) |
| `ansible/playbooks/node-<node>.yml` | その node (apply 対象でなければなし) |
| 上記以外の `ansible/playbooks/*.yml` | それを参照する playbook の対象 (単独なら なし。例: `upgrade-k8s.yml`、`longhorn-multipath.yml`) |
| `ansible/roles/<role>/**` | その role を使う playbook の対象。どの playbook も使わなければ全ノード (fail closed) |
| `ansible/files/**`, `ansible/templates/**` | ファイル名を参照する playbook / role の対象。参照が見つからなければ全ノード (fail closed) |
| `ansible/group_vars/control_plane.yml` | 全 `shanghai-*` |
| `ansible/tests/**`, `*.md`, `.ansible-lint`, `roles/*/molecule/**` | なし |
| それ以外の `ansible/**` (inventories, vars, uv.lock, pyproject, ansible.cfg ...) | 全ノード (従来通り) |
| `ansible/` 外 (workflow 自身、docs) | なし |

- 対象が `[]` なら `apply` job は起動しない (select-targets の Step Summary に「対象なし」の根拠が残る。skip を成功証拠にはしない)。
- 変更ファイル一覧が取れない場合は fail (推測で Apply しない)。
- 共有物・参照不明は従来通り全ノードへ倒す (fail closed)。CP の通常更新経路 (control-plane.yml / node-shanghai-N.yml /
  CP 用 role の変更で該当 CP に Apply) は維持。`node-shanghai-N.yml` 単独変更は該当 1 台のみになる。
- `workflow_dispatch` に `nodes` 入力を追加 (対象ノードの明示指定)。既存の対象 4 台の部分集合に限定し、権限・対象の拡大はしない。
- `select-targets` は毎回 `ansible-apply-targets.test.sh` (46 ケース) を先に実行し、失敗したら Apply に進まない。
- `apply` job の中身 (bastion 経由 SSH、`--limit <node>`、直列 fail-fast) は変更しない。

## 期待される merge 順序と効果

1. 本 PR の merge: 変更は workflow / scripts / docs のみ → 対象なし → Apply は起動しない。
2. #13808 の merge: `files/*` は merge 後の tree で `worker-image.yml` / `longhorn-multipath.yml` から参照される →
   `["golyat-4"]` のみ。golyat-4 は既に同内容を手動限定適用済みのため収束確認 (Plan #39745060355 の golyat-4 は
   changed=1 で、これは `user_management` の sudoers lineinfile が check-mode で常に changed になる既存挙動。shanghai-1〜3 の
   Plan も同じ changed=1)。worker-image.yml の CI 経由 full apply は 2026-10-14 run #38567590772 で golyat-4 成功実績あり。
3. #13811 (BOXP-269) は `vars/nodes.yml` を含むため、この規則では全ノード扱い。269 側で merge 経路を判断する (本票では触らない)。

## 検証

- `.github/scripts/ansible-apply-targets.test.sh`: fixture tree + 実 repo で 46 ケース。
- `#13808` の merge 後 tree (`git archive`) に対して PR のファイル一覧を入力 → `["golyat-4"]`。本 PR のファイル一覧 → `[]`。
- shellcheck (0.11.0, `-S style`)、actionlint 1.7.7 (+shellcheck)、ghalint 1.5.6、`gh actions-lock --verify`。
- 実反映後: main push の Apply Ansible run で `select-targets` のみ実行され `apply` が起動しないこと、
  その後の #13808 merge run で matrix が golyat-4 のみであることを確認する。

## 切戻し

- 本 PR を revert すれば従来の固定 matrix に戻る (lockfile の tj-actions entry も revert に含まれる)。
- 明示的に特定ノードへ Apply したい場合は `workflow_dispatch` の `nodes` 入力を使う。
