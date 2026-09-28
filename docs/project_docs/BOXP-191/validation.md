# BOXP-191 arch検証結果

2026-09-28 UTCに、本番clusterへのdispatchを行わず以下を確認した。

- `uv run ansible-lint roles/kubernetes_upgrade playbooks/upgrade-k8s.yml`: production profileで違反0。
- `uv run ansible-playbook -i inventories/production/hosts.yml playbooks/upgrade-k8s.yml --syntax-check`: 成功。
- `git diff --check`: 成功。
- Molecule x86_64最終構成: `uv run molecule test`がconverge、idempotence、verifyを含め成功（failed 0）。snapshot容量検査、`.part`転送、転送size一致、atomic publish、4 packageの厳密APT解決を確認した。既存scenarioにdependency/cleanup/side_effect playbookがない旨の警告のみ残る。
- Molecule ARM64: `MOLECULE_DOCKER_PLATFORM=linux/arm64 uv run molecule test`はcontainer作成後、prepareのGathering Factsで到達不能となった。`docker run --rm --platform linux/arm64 geerlingguy/docker-ubuntu2404-ansible:latest uname -m`も`exec format error`であり、実行hostにARM64 binfmt/QEMUが登録されていない環境阻害と確認した。role task起因の失敗ではなく、ARM64 CIでの確認を要する。
- `actionlint 1.7.7`: 変更したupgrade/apply workflowで成功。`ghalint 1.5.6 run`: 成功。
- 入力gate単体テスト: `uv run python -m unittest discover -s tests -p test_upgrade_inputs.py -v`の3件成功（7台許可、all/不正入力/package不一致/minor不一致拒否、同minor別patch許可）。
- `trivy 0.74.0 config .`: 実行開始したがchecks bundle取得が完了しておらず、現時点で未検証。

既存Moleculeの`apt_key` deprecation、uvの`tool.uv.dev-dependencies` deprecationは今回変更前からの警告である。

本番dry-run、APT候補1.37の実解決、cluster操作、backup/restore、CNI/CSI/GPU互換性、A/B/C試験は未実施であり、開始gateは未達のままである。

親担当追試: `rhysd/actionlint:1.7.7`コンテナへworkflow本文をstdinで渡し、変更した
upgrade/apply両workflowが警告なしで成功。`ghalint 1.5.6 run`も成功。
独立Codexレビューで指摘されたdry-run候補確認skipは`check_mode: false`へ修正。
ただしcheck modeはAPT repo/cacheを書き換えないため、既存cacheに候補がなければ不合格となる。
対象新repoの依存解決成功を意味せず、別の事前APT検証gateが必要。

## 2026-09-28 CI gate retry

- PR #12903 の全体 actionlint は、変更対象外だった `build-babashka-arm32.yml` の
  ShellCheck 7件（SC2012、SC2086、SC2207、SC2145）で失敗した。`find`、配列展開、
  `mapfile -d ''` に置換し、ファイル名の空白を含む入力も安全に扱うよう修正した。
- Plan Ansible の shanghai-2 は SSH 事前確認後に `control-plane.yml --check --diff` が
  exit 4 で失敗した。既存workflowはstderrを出力もartifact保存もしなかったため、原因を
  推測せず、失敗時のstderrをActions logへ表示しplan artifactを `always()` で保存する。
  失敗をskipや成功へ変更していない。再実行結果で実原因を確認する。
