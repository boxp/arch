# BOXP-737: Task Runner の終了処理をロック所有者に限定する

BOXP-732（TLA+/TLC の限定検証）の知見 1 のフォローアップ。

## 方針
- 正本仕様: vault `Projects/codex-task-board-runner/spec.md`「終了処理は lock の持ち主だけが行う（BOXP-737）」R1〜R5。
- `process-card!` の lifecycle commit 開始直後（他の状態を書く前）に `heartbeat-once!`（ticket guard 内の所有照合＋heartbeat 更新）で所有を確認する。
- 所有を失っていれば lane / frontmatter / Notes / 予算 / event を書かず、自 run の summary を `:interrupted`（`lock ownership lost before lifecycle commit`）にするだけ。lock には触らない。
- 例外経路（Blocked・lane 復元・superseded）も同じ確認をする。

## 検証
- 回帰テスト `test_lifecycle_commit_only_by_lock_owner`（取り直し・lock 削除・所有者の正常終了）、`test_lock_lost_failure_does_not_block`。修正前の実装で失敗することを確認済み。
- `repro-stale-runner-commit.sh` が `observed: fenced` になることを確認。

## 対象外
- 旧 Runner の agent の作業重複そのもの、lock 全体の再設計、TLC の CI 導入・必須化。

## codex review 指摘への対応（P1 ×2）
- review gate の結果記録（AI Ops gate 集計・correction event・PR 競合観測）より前に所有を確認する（仕様 R6）。
- 例外経路では所有の確認を planned shutdown の判定より先に行い、所有を失った run は `run.interrupted` event を書かない（仕様 R7）。lock にも触らない。
- PR 競合観測の非同期記録は、この run が終了処理の所有確認を通った後（promise が true）にだけ書く。取得待ちの間に所有を失った run は記録しない（仕様 R8）。
- runner 自己テストに「lock 喪失＋gate 失敗」「lock 喪失＋gate 中の shutdown」の 2 ケースを追加。修正前の実装で FAIL、修正後に PASS を確認。

## 同一ファイル連続指摘の根本原因（BOXP-588 判断）
- 3 回連続の P1（gate 記録・shutdown 分岐・PR 競合観測 ×2）は、どれも「ある時点で所有を確認し、その結果を後の書き込みで使い回す」形の TOCTOU という同じ原因だった。
- 個別に確認箇所を足すのをやめ、終了処理の外で後から書く処理は、書く瞬間に ticket guard の中で所有を確かめてそのまま書く `call-as-lock-owner!` を通すことにした（仕様 R9）。lock の取り直しも同じ guard を通るので、確認と書き込みの間には割り込めない。
- lock を解放する前に未了の観測を最大 30 秒待ち、それを過ぎた記録は捨てる（fail closed）。
- 自己テスト: helper を実際の lock ファイルで検証するケースと、「取得待ちの間に所有を失う」ケースを追加。guard を外した実装では FAIL、修正後は PASS。

## 4 回目の P1（終了処理全体が guard の外）への対応（仕様 R10）
- 指摘: 所有確認の後の終了処理が ticket guard の外なので、確認直後に旧 runner が止まり lease 切れで別 runner が取り直すと、再開後の旧 runner が lane・frontmatter・Notes を上書きできる。
- 判断: これまでの 4 件と同じ「確認と書き込みが別の区間」という原因。R9 で非同期記録だけを guard 内にしたが、終了処理本体と例外経路、gate 記録が残っていた。
- 対応: ticket guard を同一 thread から入れ子で入れるようにし（in-JVM は ReentrantLock、FileLock は最初の 1 回だけ取る）、終了処理は所有確認の直前に guard を取り、本体と例外経路の最後の書き込みまで離さない。finally の最初で離し、その後で PR 競合観測を待ち lock を解放する。gate 記録も確認と同じ guard 区間で書く。
- 自己テスト: 終了処理中（カード移動中）に別 thread が guard 経由で lock を取り直そうとするケースを、正常経路と例外経路の 2 つ追加。修正前（f38aed98）は取り直しが旧 runner の書き込み前に完了して FAIL、修正後は旧 runner の書き込みが全て終わってから取り直しが完了して PASS。

## 5 回目の P1（終了処理の guard 内で予算ロックを取るデッドロック）への対応（仕様 R11）
- 指摘: 終了処理が ticket guard を持ったまま予算ロックを取る一方、予算予約は予算ロックを持ったまま ticket guard を取るため、同時に走るとデッドロックする。
- 判断: 過去 4 件（確認と書き込みが別区間）を R10 で一つの区間にまとめた結果、区間内の予算書き込みとの間で既存のロック順序（予算ロック → ticket guard）を逆転させた。原因は「ロック順序が暗黙で、強制されていない」こと。個別の呼び出し箇所を直すのではなく、順序を一つに固定して強制する。
- 対応: 予算ロックを同一 thread から入れ子で入れるようにし、終了処理・gate 記録・例外経路は予算ロック → ticket guard の順に取る（`with-lifecycle-commit-locks`）。ticket guard を持った thread が予算ロックを新たに取ろうとすると待たずに例外にする（fail closed）。ticket guard 区間から予算ロックを取る関数の推移的な呼び出しを機械的に洗い、他に逆順の経路が無いことを確認した。
- 自己テスト: 終了処理の予算書き込み直前に、別 thread が「予算ロック → 同じ ticket の guard」を取るケースと、逆順の拒否・入れ子のケースを追加。修正前（7dd7c7fc）はデッドロックして FAIL（その後テストがハング）、修正後は PASS、自己テスト全体 exit 0。
