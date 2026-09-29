# BOXP-194 実行台帳（未開始）

本票の本番update/dry-run dispatchは未実施。以下は空欄の代わりに「未実施」を明記した台帳であり、
成功記録ではない。候補の固定根拠は `packages.md`、更新前のGET観測は `observation.md` を参照。

| 対象 | 更新前kubelet / CRI-O | dry-run run/attempt | 本番run/attempt | 開始/終了UTC | gate/復旧結果 |
|---|---|---|---|---|---|
| shanghai-1 | 1.36.1 / 1.36.1 | 未実施 | 未実施 | 未実施 | 未実施 |
| shanghai-2 | 1.36.1 / 1.36.2 | 未実施 | 未実施 | 未実施 | 未実施 |
| shanghai-3 | 1.36.1 / 1.36.1 | 未実施 | 未実施 | 未実施 | 未実施 |
| golyat-1 | 1.36.1 / 1.36.1 | 未実施 | 未実施 | 未実施 | 未実施 |
| golyat-2 | 1.36.1 / 1.36.1 | 未実施 | 未実施 | 未実施 | 未実施 |
| golyat-3 | 1.36.1 / 1.36.1 | 未実施 | 未実施 | 未実施 | 未実施 |
| golyat-4 | 1.36.2 / 1.36.1 | 未実施 | 未実施 | 未実施 | 未実施 |

開始前に記入する値:

- 作業窓UTC開始/終了、復旧用残時間、GPU/local-llm停止上限、各台/全台観測時間。
- 例外資源namespace/name、受容者・理由・期限、連絡先/復旧許可経路。
- クラスタ外実行・監視主体、引継ぎ先台帳（golyat-4に依存しないこと）。
- 最新release再確認時刻と候補Kubernetes/CRI-O version・exact package・image digest。
- 実行SHA、ref、execution_id、target_node、dry_runを含む全workflow input。
- 最初の復旧点のfilename・UTC・size・status/hash/revision・保管場所・障害時取得経路。
- 排他対象Apply/保守のrun/attemptとremote処理の照合結果。

各台で追記する値:

- GitHub run URL/ID/attempt、UTC開始終了、実測版、Ready/uncordon。
- API/VIP/etcd、Longhorn/PVC、DNS/NetworkPolicy、主要workload、GPU推論の該当証跡。
- 観測時間の実績、一時設定の元値/復元値、次台へ進める根拠。
- 失敗時は後続停止・remote処理照合・復旧結果を記入。unknownを無条件再送しない。

全台後: baseline/image追従PR、CI、通常Apply、監視収束、snapshot保持/cleanupの結果を記入。

追加の必須照合:

- dry-runの成功は実導入・期待版・更新後healthの成功ではない。各ホストのAPT preflightと
  cluster-wide pre-checkの実行ホスト・結果を分けて保存する。
- 本番の各dispatch直前に先行全ノードの成功run/attempt・実測版・観測完了を照合する。
  順序は手動gateであり、workflowの依存jobがskippedでも合格と見なさない。
- 復旧点が新規か同日snapshot再利用かを記録する。非空性だけでなくstatus/hash/revision・
  取得・隔離restoreの証跡が必要。未取得なら復旧gateは未達。
