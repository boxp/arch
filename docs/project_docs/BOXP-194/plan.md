# 2026-09-30 04:11 UTC再試行の参照

最新runは[run-retry-20260930.md](run-retry-20260930.md)。04:13〜04:16 UTCの5連続health成功、release/APT署名・全8deb再照合、新規snapshot/隔離restoreを記録した。snapshot名のfact cache再利用による03:14:52copy上書きも明記した。04:24〜04:25 UTCにCP3 direct API/kubelet TLS timeoutとNotReadyが再発し、最終判定はNo-Go。今回dry-runは中断、本番全7台更新は未開始。以下のNo-Go記述は03:45 UTCの前回実測に基づく履歴であり、今回判断とは区別する。

---

# 2026-09-30 再開時の実施方針（現在有効）

03:11 UTCのboxp指示を優先する。以下の旧計画は履歴であり、形式的な既存異常受容、native ARM64 Molecule/Plan、golyat-4後の人手監視担当確定は開始の必須条件から外す。

- 実施直前にAPI、全7ノード、etcd全member、Longhorn、ネットワークの現状を再観測し、既存異常と新規悪化を区別する。
- 新規etcd snapshotをforce=true/retention=0で取得し、非空性、SHA-256、status、別control-planeへの取得と隔離restoreを検証する。最初の復旧点を保持し、legacy rollback.ymlや単純package downgradeは実行しない。
- 固定候補はKubernetes 1.36.5-1.1、CRI-O 1.36.6-3.1。署名/hash/両architecture解決と公式releaseを再確認する。
- 対象SHAと実行automationの一致を確認して全7台dry-run後、1台ずつ本番実行する。各台でpreflight/health、Ready/uncordon、版、API/VIP/etcd、Longhorn/PVC、DNS/NetworkPolicy、主要workloadを確認して次台へ進む。
- golyat-4はGitHub-hosted runner/SSH経路を用い、GPU推論復帰を確認する。全台完了後は約1時間の自動観測を実施する。旧計画の各台1時間待機は最新指示に置き換える。
- 新規/悪化したcontrol-plane・etcd・API・Longhorn・ネットワーク異常、または実行失敗で後続を停止する。無条件再送、強制eviction、PDB削除は行わない。
- 実行台帳を更新し、baseline/image追従と通常Applyまで確認する。未完了をDoneにしない。

今回の実測証跡はrun-20260930.mdに記録する。全7台dry-runは成功したが、回復確認中にCP3のAPI readyzがHTTP500/etcd-readiness failedとなったため、本番開始判定はNo-Go。形式的な旧gateを復活させず、API/etcd不安定の解消と再観測後に再開する。

---

## 過去runの計画

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

## 本番開始gate

| 項目 | 必要な記録 |
|---|---|
| 候補 | Kubernetes/CRI-O release、exact package、署名、hash、各architecture解決、image digest |
| 作業窓 | 2026-09-29回答は「いつでも可」。各dispatch前に復旧余裕と連絡経路を再確認する |
| 停止・観測 | GPU/local-llmは更新完了まで停止可。各ノード更新後1時間、さらに全7台完了後1時間を短縮せず観測する |
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
この時点では本番dispatch・update・drain・Applyを禁止し、image digest、ARM64実行、
etcd member検証、snapshot非空性・restore取得経路と運用条件を未達として残した。
10:17 UTC以降の追跡結果は末尾の節を正とする。

## 手動gateと既存automationの保証範囲

- dry-runはcheck-modeの到達性・入力・候補package解決の検証であり、候補版の実導入や
  更新後healthの検証ではない。`health_check.yml`はcheck-mode中の版不一致を失敗にしない。
  全7台のdry-run成功後も、各台の本番更新後に実測版と全health gateを別に確認する。
- workflowは対象ノードを個別選択でき、先行jobがskippedでも後続対象jobを実行できる。
  ノード順序と台間の観測時間は自動強制されない。実行者は各dispatch直前に、確定順序の
  先行全ノードについて成功run/attempt、実測版、復旧・観測完了を台帳で照合する。
  不明・未完了なら次台をdispatchしない。`target_node=all`を本票では使わない。
- snapshot roleは同日PVC snapshotを再利用でき、再利用時の自動検証は非空性のみ。
  status/hash/revision・鮮度・restore可能性を自動保証しない。新規snapshot作成や
  retention=0だけでも復旧gateの合格にならない。開始前に実際に保全する最初の復旧点を
  明示し、権限のあるクラスタ外主体がstatus/hash/revision、取得経路、隔離restoreを
  検証・記録する。再利用する場合もこの証跡を必須とし、満たせなければ開始しない。
- cluster-wide pre-check playは`control_plane[0]`だが、各対象roleの`tasks/main.yml`も
  `pre_checks.yml`をincludeし、`apt_preflight.yml`を実行する。workflow前段の
  `--tags pre_checks`は`--limit`なしであり、対象個別jobでは`--limit`付きのroleが動く。
  「pre-check全体がCP-1だけ」という解釈はしない。台帳にはホスト名ごとの
  APT preflight結果とcluster-wideの確認結果を分けて残す。

## 10:17 UTC以降の運用回答と再確認

- 作業窓は「いつでも可」。GPU/local-llmは現在未使用で、全更新完了後に復帰できればよい。
  「観測は1hourぐらい」は短縮せず、保守的に各ノード更新後1時間と全7台完了後1時間の
  両方へ適用する。観測中に新規異常があれば後続を停止する。
- 現在のCodex Podから全7台へSSH TCP/22で `hostname` が成功した。更新workflowは
  GitHub-hosted `ubuntu-latest` で実行され、更新前に全7台へのSSHを必須確認するため、
  golyat-4上のCodex Podに更新処理自体は依存しない。ただしgolyat-4更新後の1時間観測を
  誰が継続し、どの連絡経路でGo/No-Goを記録するかはdispatch前に明記する。今回成功したのは
  Codex PodからのSSHであり、GitHub-hosted runnerからの認証済みSSHは未実証なので、最初の
  dry-runでworkflow自身の全7台SSH pre-check成功を台帳へ保存する。
- 既存異常の受容者・理由・期限は未回答であり、`observation.md`記載の異常を黙示受容しない。
  ここが未確定の間はdry-runを含むupgrade workflowをdispatchしない。
- 10:21 UTCに既存roleをshanghai-1限定、retention=0で実行し、最初の復旧点を作成した。
  10:24 UTCにPVCからshanghai-2へ取得し、statusと隔離restoreを確認した。詳細は
  `observation.md`と`execution-ledger.md`に固定する。update/drain/Applyは実施していない。
