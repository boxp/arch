# BOXP-191 arch automation準備

- 本番実行はNo-Goのままとし、PR #10832が管理するKubernetes通常baselineを変更しない。
- Kubernetes更新と通常Ansible Applyを同一の本番cluster concurrency groupで直列化する。
- 台帳の相関IDを必須にし、GitHub run IDとattemptの組を一意な主識別子として、dispatch入力、ref、SHA、run ID、attemptをrun summaryへ記録する。
- KubernetesとCRI-Oで一致する厳密なpackage revisionを必須にし、wildcardによるpackage解決を禁止する。
- worker drainに加えてsetup、更新、health check、復旧余裕を確保できるよう更新jobのtimeoutを延長する。
- snapshot PVCの空き容量を転送前に検査し、atomic renameで公開する。7台の作業中はretentionを無効化し、最初の復旧点を最終安定まで保全する。
- YAML/workflow、Ansible syntax/lint、実行可能な範囲のMolecule、Codex reviewで検証する。

本番dispatch、cluster変更、merge、baseline版変更は、この準備変更の対象外とする。

既存のPlan Ansible PR workflowはSSH接続後、通常のcontrol-plane/node/worker-image playbookを`--check --diff`で実行する。`playbooks/upgrade-k8s.yml`は呼び出さないため、upgrade role内の`check_mode: false`観測を含む更新taskはPR CIでは実行されない。production dry-runは明示的な`workflow_dispatch`操作であり、このPRを開くことでは許可されない。

GitHub Actions concurrencyは複数のmutation workflowが同時にrunningになることを防ぐ。一方で、GitHubは古いpending runを置換する場合があり、runner終了後にremote processが残っていないことも証明しない。各本番dispatch前にworkflowのrun/attemptとhost上のprocess/package状態を照合し、queuedまたはunknown状態を再送の根拠にしない。

候補packageのAPT解決はrepository切替後のread-only taskをcheck modeでも実行して厳密照合するため、production dry-runを実行するまでは未検証である。CNI/CSI互換性、復旧演習、A/B/C試験、作業窓、例外受容も未達であり、このautomation準備を本番Goまたはticket完了として扱わない。

## snapshot保全の終了条件

`retention_count=0`はupgrade dispatchへの一時extra-varであり、role既定値3は変更しない。
本workflowからは自動削除しない。全7台と所定観測時間の合格後、台帳に最初の復旧点・
保全継続対象・削除候補・PVC残容量を記載し、通常snapshot運用へ戻す際に既定値3を
再適用する。最初の復旧点がまだ必要なら個別の確認済み不要ファイルだけ整理する。
この終了gateは本番運用台帳に残し、準備PRのmergeで完了扱いにしない。保持を止めたまま
次の更新を繰り返さず、次回の容量gate前にも前回cleanup記録を確認する。

独立レビューのretention恒久化懸念は上記の明示的終了gateで扱う。全台安定を知らない
個別node workflowへ自動pruneを追加すると保全要件を破るため、既定値の変更や自動cleanupは行わない。

## 再試行時の入力・識別検証

- workflow入力gateのpackage形式をrole pre-checkと同じ `X.Y.Z-N.N` に統一する。他のDebian revisionを許可する変更は両gateを同時に行う。
- `execution_id` は作業前に決める相関IDであり、一意性や冪等性を保証しない。実行の主識別子はGitHub run IDとattemptの組で、台帳には両方を必ず保存する。同じ相関IDのrunが複数見つかった場合は一つを推測で選ばず後続操作を停止して照合する。
- 相関IDを再利用したdispatchやGitHub rerunは再実行を防止しない。unknown状態ではrun ID/attemptと実機状態の照合が終わるまで再送しない。
