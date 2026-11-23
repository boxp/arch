# BOXP-675 実装・検証記録

## 対象と分割

変更前 HEAD の localllm 呼出し一覧を抽出し、新 manifest と順序も含め一致（85 件）。偶数位置 43 件、奇数位置 42 件。既定は 1 shard の全 85 件、`LOCALLLM_TEST_ONLY` の部分一致フィルターも維持。runner の既存 177 ケースと qwen-eval、および他 suite は維持し、novel-board の 2 コマンドのみ remaining から新グループへ移動した。matrix は 6 グループ、max-parallel 6、fail-fast false。集約 test は引き続き suites 全体の success だけを許可する。

## 隔離と限界

localllm はプロセスごとに mktemp の mode、request log、fake CLI と server を持ち、各ケースはその下の別 vault/state を使う。サーバーは localhost の OS 割当ポートを bind してから通知するため、同一ホストの shard 同士もポートを共有しない。競合テスト内の並列 tick と待機は変更していない。CI の matrix はそれぞれ独立 runner。novel-board 既存テストはランダムポートを使うため同一ホストの他プロセスとの偶発的衝突リスクはあるが、CI では独立 runner。共有マシンの負荷による時間依存テストの揺らぎと GitHub 上の実行時間・queue・安定性は本検証では確定できない。

製品の状態遷移や lock 仕様は変えず、有限なケース一覧と実際の CI 条件の変更であるため、抽象化を追加するより実スクリプトと workflow の在庫、異常系、実行結果を直接検証した。Lean モデルの追加は対象外。

## 回帰検証

- workflow の新構成を期待する検査は変更前に失敗（localllm 実行数 1 != 2）、変更後に成功。
- ci-partition-test.py 7 件成功。85 件と定義の一致、欠落・重複・未知ケース、shard 設定の空・ゼロ・範囲外・負・先頭ゼロ・非数・巨大数、未知ケースによる失敗、ケースの終了コード 23 の伝播、集約の failure/cancelled/skipped 等を検査。
- 既定の未分割モードで `LOCALLLM_TEST_ONLY=test_corpus_read_accepts_the_wikilink_form_of_a_corpus_note` が成功。`bash -n` と `git diff --check` 成功。
- novel-board の `bb ... novel_board_runner.bb test` と `novel-board-runner-test.sh` は両方成功（終了コード 0）。
- 初回並行実行は全 85 ケースを出力したが、実行中にスクリプトを編集したため末尾の読み込みが乱れて両方終了コード 127。成功には数えず、変更を固定して同時に再実行。
