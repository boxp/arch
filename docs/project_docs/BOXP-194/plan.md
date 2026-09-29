# BOXP-194: lolice 1.36 patch更新

## 現在の判断

本番開始条件は未確定。準備・隔離検証のみ進める。全7台の更新、通常復旧、監視収束、
baseline/image追従、通常Applyが完了するまでDoneにしない。

1.36系最新patchの候補を公式release、APT署名・deb hash・amd64/arm64実解決、image digestで
固定する。1.36.5はチケットの候補であり、検証前の決定版ではない。
Calico/Longhornのminor更新は含めない。1.37のsupport、#141572、kind 1.37.1 imageを
1.36 patchの開始条件に流用しない。1.36に固有の新たな問題は別途評価する。
既存roleの `kubeadm_upgrade_etcd: false` を維持し、今回etcd imageを変更しない。
ただし混在する現行etcdのmember healthと復旧確認は省略しない。

## 前回調査のGit状態（09:18 UTC時点）

- 初期worktree HEAD: `e53ce4e8ffbadf26024e042a44199c6491252843`、clean。
- 2026-09-29取得main: `b59398473a85f30bf498ca7c9425217fe35323dd`。指定worktreeをfast-forward済み。
- [準備PR #12903](https://github.com/boxp/arch/pull/12903)はmerge済み。排他、75分job、
  exact revision、隔離APT索引検証、dispatch識別、snapshot retention=0を再利用する。
- mainのproduction inventory、control-plane/node-shanghai/worker-imageは1.36.1を維持。
  `ansible`の1.37文字列は入力gateのテストfixture等であり、本番desired versionではない。
- [PR #10832](https://github.com/boxp/arch/pull/10832): OPEN、head
  `9e6ee5ddf2534dd90260a6999a22fae94f087da8`。最新mainとのmerge-base差分は5ファイル9行の
  version置換。Kubernetes versionを1.37.1にするがpackageは1.36.1-1.1を残す。
  node-shanghai各台とworker-imageのCRI-Oも1.37.1になる一方、worker-imageのpackageは旧版。
  本票へ取り込まない。09:23 UTCに別票BOXP-195でCloseされた（下記参照）。
- 通常Apply Ansibleは[run 36523866975](https://github.com/boxp/arch/actions/runs/36523866975)
  がcommit `d204146b593531963afb467434f5259681e976d8`でsuccess。
  BOXP-191記載の別workflowのaction_requiredと混同しない。この成功は本票の更新後Applyではない。

## 実施順序

1. `packages.md`に上流・署名・package・image検証結果を保存する。未確認を成功扱いにしない。
2. `observation.md`にAPI/全7台/etcd/VIP/Longhorn/PVC/GPU/主要workloadを記録する。
3. 更新候補と開始条件が確定した後、必要な最小実装を独立PRで検証する。既存automationが
   同minor別patchを受け取れるため、候補未確定のまま通常baselineを先上げしない。
4. backupの非空性・status・API/Longhorn障害時の取得経路と最初の復旧点保全を確認する。
   PVC Boundやetcd Pod Readyだけをbackup/etcd member healthの合格にしない。
5. 開始gateが全て成立したら、同じ固定SHAと固定packageで全7台の個別dry-runを完了する。
6. shanghai-1 → shanghai-2 → shanghai-3 → golyat-1 → golyat-2 → golyat-3 → golyat-4を候補順とし、
   PDB/replica配置と運用条件を照合して確定する。各台Ready/uncordon・版・API/VIP/etcd・
   Longhorn/PVC・DNS/NetworkPolicy・主要workloadと観測時間を満たして次台へ進む。
   golyat-4はGPU推論も必要。
7. 全台安定後にproduction inventory、各playbook、worker-imageの版とpackageを一致させる。
   lint、x86/native ARM64 Molecule、Plan、レビュー、通常Applyを確認する。

## 本番開始gate（全て未確定または未完了）

| 項目 | 必要な記録 |
|---|---|
| 候補 | Kubernetes/CRI-O release、exact package、署名、hash、各architecture解決、image digest |
| 作業窓 | UTC開始/終了、復旧余裕、連絡経路 |
| 停止・観測 | GPU/local-llm最大停止時間、各台/全台観測時間 |
| 既存異常 | namespace/resource、理由、受容者、期限 |
| 実行主体 | golyat-4のdrain後も継続するクラスタ外実行・監視環境、台帳引継ぎ |
| 復旧 | 非空snapshot/status、PKI、障害時取得、隔離restore、最初の復旧点保全 |
| 排他 | Apply/保守を含むrun/attemptと実機処理照合、unknownなし |

## 停止と台帳

失敗時は次台へ進まない。無条件再送、強制eviction、PDB削除、単純downgradeをしない。
既存`rollback.yml`は本票の承認済み復旧手順ではなく、そのまま実行しない。
run ID/attempt/URL、UTC開始終了、SHA、全inputs、対象台、更新前/期待/実測版、各gateの
証拠、停止理由、remote処理継続の有無、復旧結果を記録する。snapshotをrunnerへfetchしない。
全台安定までretention=0を維持し、最初の復旧点の要否と空き容量を確認したうえで
通常保管へ戻す。今回まだdispatchを行っておらず、run台帳に架空の値を作らない。

## 09:42 UTC以降の再開

前回runはagent-process-errorで終了した。上記と他台帳の検証時刻・SHAは前回の記録を保持し、
今回再実行した結果と混同しない。今回の指定worktreeはcleanな初期HEADから最新main
`39edb697c`へfast-forwardした。前回検証SHA `b59398473`との差分はTerraformのツール設定のみで、
`ansible/**` と更新関連workflowに差分はない。

GitHubで再確認した結果、1.37準備PR #10832（head `9e6ee5dd`）は09:23:25 UTC、
[PR #12593](https://github.com/boxp/arch/pull/12593)（head `afe246cc`）は09:23:29 UTCにClose済み。
BOXP-195での操作であり、今回runでCloseしたものではない。

再開指示に従い、まず台帳を独立レビューしてDraft PRへ公開し、適用されるCIを確認する。
既存automationは同minor別patch入力に対応しており、現時点で追加runtime変更は不要。
本番dispatch・update・drain・Applyは禁止。image digest、ARM64実行、etcd member検証、
snapshot非空性・restore取得経路と運用条件は未達のまま残す。
