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
