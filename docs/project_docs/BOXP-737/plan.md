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
