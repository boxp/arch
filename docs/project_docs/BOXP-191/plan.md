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

候補packageの指定revisionは、対象repository専用の一時APT source/cacheで署名付き索引を取得して照合する。check modeでもこの事前gateを実行し、通常のホストAPT設定・cache・package状態は変更しない。本番対象ホストでの実行と全依存解決は、許可された検証を行うまで未達である。CNI/CSI互換性、復旧演習、A/B/C試験、作業窓、例外受容も未達であり、このautomation準備を本番Goまたはticket完了として扱わない。

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

## 正式review gateへの対応（2026-09-28）

- dry-runではAPT source更新がskipされる一方、旧実装の`apt-cache madison`はホストの既存cacheを参照していた。既存cache次第の誤合格・誤不合格を修正する。
- 対象minorの署名付きAPT索引とexact revisionを一時ディレクトリ内で検証する。通常実行とcheck modeで同じgateを通し、取得/署名/指定revisionの失敗は停止条件とする。
- 一時データは成功・失敗ともcleanupし、ホストのsource、trusted key、cache、dpkg状態を検証のために変更しない。
- 回帰試験では未cacheの対象revision、対象repoにないrevision、取得/署名エラー、隔離とcleanupを確認する。fixtureの成功を候補1.37や本番ホストの依存解決成功へ換算しない。

今回のpackage入力契約は確認済み候補の`1.37.1-1.1` / `1.37.1-3.1`と既存Molecule
fixtureに合わせた`X.Y.Z-N.N`である。OBS全ディストリビューションの任意revision形式への
対応は主張しない。将来候補が異なる形式になった場合はworkflow/roleの両gateを同時に
変更して検証する。未知形式を推測で通す代わりに、現時点では入力gateで停止する。

## 2026-11-19: gate 無効化の本番設定（Owner 方針受容後）

Owner は BOXP-618 の再評価を受け、1.37 実施時に kube-controller-manager の
`NodeControllerLeaseCircuitBreaker=false`（kubernetes#141572 回避）を一時的に使う方針を受容した。
arch#15353 で用意した既定オフの投入経路を、本番 inventory で次のとおり有効化する。

- `inventories/production/hosts.yml` の `control_plane` vars に
  `kubernetes_upgrade_controller_manager_feature_gates` を宣言する。値は
  更新先 `kubernetes_upgrade_version` の minor が `1.37` のときだけ
  `{NodeControllerLeaseCircuitBreaker: false}`、それ以外（1.36 patch、1.38、未指定）は `{}`。
- 1.36 の KCM は未知 gate で即終了するため、1.36 manifest へは書かない。gate は
  `kubeadm upgrade apply/node --patches` で各 CP の manifest が 1.37 に作り直される時だけ付く。
- worker は `control_plane` group に属さないため常に `{}`（role 既定）。
- 通常 Apply（control-plane.yml 等）はこの変数を参照しない。
- 対象版: 1.37.0〜1.37.2（#141622 未 merge、release-1.37 に同等修正なし）。
- 撤去条件: #141622 相当の修正入り 1.37.x へ上げるとき `{}` に戻して kubeadm upgrade で
  manifest を作り直す。1.38 を更新先にすると自動で `{}` になり、再利用前に再評価する。
- 本番 Kubernetes/CRI-O 1.37 dispatch はこの変更に含めない。

検証: `tests/test_kcm_feature_gate_patches.py` に production inventory を解決する 3 件を追加
（CP 3 台 × 1.37.0/1.37.2/1.37.10 で gate=false、1.36.5/1.36.9/1.38.0/未指定で `{}`、
worker は `{}`、解決値が role の検証を通り `--feature-gates=NodeControllerLeaseCircuitBreaker=false`
1 要素の JSON patch になる）。
