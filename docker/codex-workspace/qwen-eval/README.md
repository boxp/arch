# BOXP-344 閉じた合成画像評価

固定の合成設定・合成短編を各1件、画像各1枚まで処理する隔離ハーネス。通常Board・既存素材は接続しない。共通flockとSQLiteで状態を永続化し、中断後に再生成しない。未確定状態は`recovery-needed`で両入口を止める。外部画像APIへのfallbackはない。

## fake試験

```sh
python3 docker/codex-workspace/qwen-eval/harness.py --root /tmp/qwen-fake submit task-board
python3 docker/codex-workspace/qwen-eval/harness.py --root /tmp/qwen-fake run task-board --fake
python3 -B -m unittest discover -s tests/qwen-eval -v
```

fakeは1×1のテストPNGであり、実Qwen画像の実績に数えない。`--fake`を省いた単体CLIは接続しない。rootは単一ユーザー専用のLinux同一filesystem上に置く（SQLite/flock/renameat2、NFSは対象外）。参照関数は許可root・symlink・hash・PNGを検査するが、今回の固定合成ジョブは参照なし。

## 限定実機経路

`live.py`は固定Turbo revision・896×1184・seed101/202を使用する。2件を1回の切替にまとめ、生成を成功してもGemma復帰の検証が済むまでノートを公開しない。fakeと実機profileは同じrootで混在させない。

```sh
python3 docker/codex-workspace/qwen-eval/live.py \
  --root <vault内の新規評価専用directory> \
  --lolice-worktree <本run専用のcleanなlolice-worktree> \
  --token BOXP-344-<一意token>
```

この操作は事前のコードレビュー・CIとlolice受付機構の配備が必要。各段階で通常のGitOps PRを作成し、独立レビュー・CI・mergeを待つ。プログラム自身はmerge、直接patch、RBAC追加、kill、lock解除をしない。段階は封鎖→drain確認→Gemma=0/GPU解放→Qwen=1→2件生成→Qwen=0/GPU解放→Gemma=1/verify→health・固定短文推論→open。Service/LAN/Podの全入口、loaded modelのslots、upstream active/pending、Pod UID、nodeのGPU FDを照合する。Qwenは既存SSH/file-queueで投入し、既存依存とqueueの空を確認、egressは全拒否する。

node共通leaseと永続session markerは別rootからの二重評価も拒否する。中断したmarkerやlockを自動削除しない。timeout、Podの入替、未知GPU利用者、復帰失敗等は閉じた状態で止め、履歴とdesired/actual/queue/outputを照合して明示的に復旧する。生成の有無が未確定なら再投入しない。既存のqueue runnerが1件を処理中のときも再試行しない。

公開先はroot内`vault/qwen-synthetic-evaluation/{board}/`。元の合成文・相対リンク付きノート・PNG・hash/契約/生成metadataを原子的・非上書きで公開する。実root自体をvault内の専用評価領域に置く。実機証拠は`live-evidence`、状態と各段階の時刻はSQLiteの`events`。不完全なPNGやmetadata、復帰未確認時に偽リンク・完成扱いを作らない。

## BOXP-349 runtime制御の基礎（未配備）

`runtime.py` は永続phase intentと観測のみのreconcile、`kubernetes_runtime.py` は明示kubeconfig・対象名固定・scale subresource/受付ConfigMapへのUID/resourceVersion条件付き更新を実装する。結果不明の書込は再送しない。複数objectの更新は原子的ではなく、復帰時はverify gateを先に書く。実行CLI・通常Boardへの画像接続はまだ提供していない。

既存 `RuntimeAdapter` は限定実機adapterを継承する統合用の骨格で、既存のBOXP-344 token/一回限りmarker/合成2件という制約も残る。新しい実runにそのまま使用してはいけない。新SA配備・credential配送・Argo所有契約を確認するcallback・全Pod収束callback・node leaseの再起動対応と通常Board/参照対応を完成させてから有効化する。

新規dispatchには件数とwindow上限があるが、生成中の強制打切りや長期公平性を保証しない。実GPU画像・実機での再起動/長文streaming試験は未実施。必要な権限案と残作業は [BOXP-349計画](../../../docs/project_docs/BOXP-349/plan.md) を参照。

## BOXP-349 実験用 runtime worker

`worker.py` は固定合成入力のみを対象とし、GitOpsのphase PRを作らず、明示的な書込kubeconfigをruntime transportに渡す。別の読取kubeconfigは既存のPod/deployment・入口probeに使用する。実行前に専用SA、入口、Argoの対象3フィールドの所有分離とbootstrap、全probeを配備・検証する必要がある。`--ownership-check` は実際のArgo設定を検査し、検証できない場合に非zeroを返す実行ファイルの絶対パスであり、その実装と配備は未完了。read権限を専用書込SAに追加する設計ではない。

```sh
python3 docker/codex-workspace/qwen-eval/worker.py --help
python3 -W ignore::ResourceWarning -B -m unittest discover -s tests/qwen-eval -v
```

実行時の引数形式（前提条件を満たすまで実行しない）:

```sh
python3 docker/codex-workspace/qwen-eval/worker.py \
  --root <新規専用root> --token BOXP-349-<一意token> \
  --write-kubeconfig <専用SA設定> --read-kubeconfig <既存読取設定> \
  --ownership-check <実際の所有契約検証プログラム> --max-batch 2 --max-window 1800
```

同じroot/tokenの中断後は `--recover-observe` を付けてnode lease再取得とpending観測だけを実行する。生成・復帰は自動再開しない。旧形式markerやnode再起動後は手動調査が必要。参照契約は `{'path': <許可root内のPNG相対path>, 'sha256': <小文字64桁>}`。ローカル検証関数はあるが実queueによる参照入力は未実装であり、dispatchは拒否される。通常Board接続、連続window間の公平性、markerの安全な完了処理は未実装。


## BOXP-349 継続の実行経路

`file_backend.py`はlolice #930の専用SA Podに既存node file queueで制御metadataだけを送り、write credentialを普通のrunnerへ渡さない。`ownership_check.py`が両Argoの名指し3field/RespectIgnoreDifferences/selfHeal/prune/Syncedを確認する。初回配備は所有移管readback→再作成時のclosed初期値の順。

通常localllmの新規character作成がReviewに達したら `prepare_board_image.py --vault VAULT --ticket BOXP-N --run RUN --manifest PRIVATE_JSON` で既存auditの新規作成/hashを検証し、local Gemmaだけに本文を渡して約1MP/Turbo画像briefを固定する。stdoutはpath/count/hashのみ。原典の実画像リンク候補があれば選択を必須にし、原画像bytes/hashをQwenの`ref`へ実入力する。Qwenの既存gen.pyはPILで`ref`を開きpipelineの`image`へ渡す（canonical.jsonのhashを実行前に照合）。

`worker.py --root STATE --token BOXP-349-UNIQUE --node-api --read-kubeconfig READ_CONFIG --ownership-check /ABS/ownership_check.py --research-manifest PRIVATE_JSON --vault VAULT --board-root BOARD_ROOT --docs-write-lock BOARD_ROOT/locks/localllm-docs-write.lock --max-batch 1` で1件を実行する。新しい資料bundleのreference.mdから設定ノート/画像/metadataをリンクし、元設定ノートは上書きしない。modelとPVCを変更しない。

上限はdispatch開始/最大batchの制限。生成中の強制停止や障害時の厳密なstarvation上限ではない。120秒の文章受付cooldown後にだけ次の完了windowから新規tokenへ移る。完了markerはarchiveして保存し、同一tokenの再生成/recoverは拒否。`--recover-observe`は未完了同一boot/tokenの観測のみであり、結果不明を勝手に再送しない。
