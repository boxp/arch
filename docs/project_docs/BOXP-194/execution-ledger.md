# 2026-09-30 04:11 UTC再試行の参照

最新runは[run-retry-20260930.md](run-retry-20260930.md)。04:13〜04:16 UTCの5連続health成功、release/APT署名・全8deb再照合、新規snapshot/隔離restoreを記録した。snapshot名のfact cache再利用による03:14:52copy上書きも明記した。04:24〜04:25 UTCにCP3 direct API/kubelet TLS timeoutとNotReadyが再発し、最終判定はNo-Go。今回dry-runは中断、本番全7台更新は未開始。以下のNo-Go記述は03:45 UTCの前回実測に基づく履歴であり、今回判断とは区別する。

---

# 2026-09-30 現在の実行台帳

本番update/drain/Applyは全台未開始。全7台check-modeは成功したが、反復観測でCP3 readyz HTTP500/etcd-readiness failedを確認したため開始No-Go。詳細はrun-20260930.md。以下の旧台帳は履歴。

| 対象 | dry-run証跡/SHA | 本番run | gate |
|---|---|---|---|
| shanghai-1 | GitHub36663600324/attempt1、2ecf970a9、SUCCESS | 未開始 | 現行API異常でNo-Go |
| shanghai-2 | local six-node-check、2ecf970a9、failed0 | 未開始 | 同上 |
| shanghai-3 | local six-node-check、2ecf970a9、failed0 | 未開始 | 同上 |
| golyat-1 | local six-node-check、2ecf970a9、failed0 | 未開始 | 同上 |
| golyat-2 | local six-node-check、2ecf970a9、failed0 | 未開始 | 同上 |
| golyat-3 | local six-node-check、2ecf970a9、failed0 | 未開始 | 同上 |
| golyat-4 | local six-node-check、2ecf970a9、failed0、委譲先API遅延検出 | 未開始 | 同上 |

---

# BOXP-194 実行台帳（更新未開始）

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

## 更新前復旧点と経路検証

| UTC | 操作 | 対象/SHA | 結果 |
|---|---|---|---|
| 10:19-10:20 | SSH/API/etcd read-only観測 | 全7台、etcd 3 member | SSH 7/7、API ready、endpoint health 3/3成功 |
| 10:21:02-10:21:49 | snapshot role、retention=0 | shanghai-1、現在のPR基点 | `pre-upgrade-20260929T102102.db`を作成・status・size一致・atomic publish・非空確認、failed=0 |
| 10:23 | PVC原本のsize/hash | 88,285,216 bytes | SHA-256 `f6eee8e743fe6d1e7149a61cd72a6ee7e7dd5b8eef6443bbebe90561002eb36d` |
| 10:24 | PVCからshanghai-2へ取得、隔離restore | etcdutl 3.6.8 | hash `4453a47d`、revision `743902070`、4,679 keys、restore成功 |

検証用copy/data-dirだけを削除し、PVC原本とshanghai-1の保全copyを残した。
上表はupdate workflowのrun/attemptではなく、復旧gateの事前証跡である。

追加の必須照合:

- dry-runの成功は実導入・期待版・更新後healthの成功ではない。各ホストのAPT preflightと
  cluster-wide pre-checkの実行ホスト・結果を分けて保存する。
- 本番の各dispatch直前に先行全ノードの成功run/attempt・実測版・観測完了を照合する。
  順序は手動gateであり、workflowの依存jobがskippedでも合格と見なさない。
- 復旧点が新規か同日snapshot再利用かを記録する。非空性だけでなくstatus/hash/revision・
  取得・隔離restoreの証跡が必要。未取得なら復旧gateは未達。
