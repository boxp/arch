# BOXP-194 検証状況

対象automationのSHAは `b59398473a85f30bf498ca7c9425217fe35323dd`。
今回の変更は計画・観測・検証台帳のみ。通常baseline、role、workflowは変更していない。
候補の版と運用gateが未確定のまま本番設定を先上げする変更は作らない。

2026-09-29 UTCの実行結果:

- `uv run --project ansible python -m unittest discover -s ansible/tests -p 'test_*.py' -v`: 3件成功。
  全7台の個別選択、不正入力拒否、同minor別patchの許可を検証。候補package導入の試験ではない。
- `cd ansible && uv run ansible-lint roles/kubernetes_upgrade playbooks/upgrade-k8s.yml`:
  16ファイル、production profile、0 failures / 0 warnings。
- `cd ansible && uv run ansible-playbook -i inventories/production/hosts.yml playbooks/upgrade-k8s.yml --syntax-check`: 成功。
- `git diff --check`: 成功。
- Trivy 0.74.0 `config --skip-check-update --skip-dirs ansible/.venv --skip-dirs ansible/.ansible --exit-code 0`:
  65 config、13 findings（HIGH 5、LOW 8）。内蔵checksによるscanであり、最新checks/脆弱性DBを
  用いた検証でもclean合格でもない。初回は生成されたvenvのJinja Dockerfileがparse errorに
  なったため、再実行で生成物を除外した。設定の変更はないため、今回の変更由来の修正対象とはしない。
- x86/ARM64 Moleculeの実行結果は `automation-validation.md` へ記録する。
- 本票の本番Plan/dry-run、更新、更新後通常Applyは未実施。過去PRのCI成功を代用しない。

`tool.uv.dev-dependencies` deprecationは既存の警告。候補packageの上流確認・署名・hash・
解決は `packages.md`、実機の到達性と復旧gateの制限は `observation.md` を参照する。

## 再開runの確認

2026-09-29 09:42 UTC以降、main `39edb697c7c7a5d6f612d56e5b17d7dfe337fcd9` を基点に
台帳を復元した。前回対象SHAとの差分を確認し、Ansibleと更新・テスト・Plan workflowが
同一であることを確認した。前回のlint/input test/x86 Moleculeを再実行の成功と扱わない。

今回のcommit前にもTrivy 0.74.0で同じ除外・内蔵checksによるconfig scanを実施した。
65 config / 13 findings（HIGH 5、LOW 8）で前回と一致した。clean合格ではない。
PRは台帳のみの変更であり、Ansible PlanとARM64 Moleculeはpath条件の対象外。
CIのskipを本番Plan・ARM64 gateの合格へ読み替えない。

独立レビューはgpt-5.6-terraへ委譲した。dry-runの保証範囲、手動の順序照合、
snapshot再利用時の追加検証をplanと台帳に反映した。CP-1のみでpre-checkされるという
指摘は、各node roleの`tasks/main.yml`からのincludeとworkflowのタグ選択を照合し不採用。
対象別APT preflightとcluster-wide確認を区別して記録するよう明確化した。

Draft PR [#12934](https://github.com/boxp/arch/pull/12934) の初回head
`bcec99b41ff853e729e8d121616dbbccc7cbc0fb`では
[Gitleaks](https://github.com/boxp/arch/actions/runs/36551093700)と
[pull_request_target](https://github.com/boxp/arch/actions/runs/36551095051)がsuccess。
後者のpath-filter・hide-comment・setupは成功、test-ansibleとTerraform Plan等はskipped。
Ansible Planは発火しなかった。レビュー対応後のheadのCI状態はPRとticket Notesへ記録する。
