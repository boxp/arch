# BOXP-588 ③: 同じ PR・同じファイルへの重大指摘が続いたら設計の見直しを促す

正本: Obsidian `Projects/model-usage-attribution/retry-loop-reduction.md` 4章③、`active-conditions-design.md` 8章 A（③は独立した PR に分ける）。
Notes 入力の抑制（①）はこの PR に含めない。prompt に入る票の本文は全文のまま。

## 範囲

- runner（`docker/codex-workspace/task-board/task_board_runner.bb`）への記録と、prompt への指示 1 段落の追加だけ。
- 変えないもの: retry の指紋と上限、gate 失敗予算とその履歴、P0/P1 の判定、CI、排他と停止条件、担当とモデル、票の本文。

## 動き

- codex review の blocking 指摘（P0/P1）の場所からファイル名を取り出し、票 × PR × ファイルごとの連続回数を `same-file-review-streaks.edn` に記録する。経過は `same-file-review-history.jsonl` に追記する。
- 連続が切れる条件: その PR の review が通った／merge された（PR の記録を消す）、同じ PR で別のファイルだけが指摘された（指摘されなかったファイルの記録を消す）。
- CI など他の gate の失敗は、数えも消しもしない。同じ run を処理し直しても 2 回は数えない。
- 連続回数が閾値 `CODEX_TASK_BOARD_SAME_FILE_REVIEW_STREAK_THRESHOLD`（既定 3）以上になると、次の implement / review-fix / blocked-retry の prompt に「指摘を並べて同じ原因か判断し、同じなら 1 件ずつ直さず設計を見直す」という指示を足す。
- 同じ原因かどうかの判定は「同じ PR・同じファイル」という近似。そのため指示には「無関係なら理由を Notes に書いて通常どおり直す」「設計変更が承認範囲を超えるなら、この指示は承認ではないので blocked（owner-decision）か停滞レビューにする」を含める。
- review の結果が出ないまま閉じられた PR の記録が残り続けないよう、7 日間更新のない記録は指示に使わない。
- 記録ファイルが読めないときは指示を出さないだけで、prompt の生成は止めない。記録の失敗も run の結果処理を止めない。

## 配備前の再生（モデルを呼ばない）

`bb docs/project_docs/BOXP-588/tools/replay.bb streak <runner.bb> ~/.codex-task-board/runs BOXP-428 BOXP-476 BOXP-525 BOXP-501`
（過去 run の summary.edn の review gate と blocking 成果物を、runner の記録関数へ時系列に流した。2026-11-17 実施。7 日の失効は実時間に依存するため、この再生では効かない）

- 3 回目に達して指示が出た場面: 19（428: 15、476: 1、501: 3、525: 0）。2 回目では一度も出ない。
- 最長の連続: 428 lolice#1091 `boxp-langfuse-observer/__init__.py` 24 回、lolice#1179 同ファイル 18 回、arch#14548 `langfuse_exporter.bb` 13 回。
- 誤検知の確認（指摘本文を目視）:
  - 428: 伏せ漏れの別パターンが続く同じ原因（BOXP-586 で確認済み）。
  - 476 arch#14730 `gesture.ts`（5 回）: 腕の描画方式が受入条件を満たさないという同じ原因。
  - 501 arch#14822 `notifications.ts`（4 回）: 返信の永続化・再送・冪等性という同じ状態設計の穴。
  - 501 arch#14891 `task_board_events.bb`（4 回）: 家配信が使えないときの別経路と heartbeat の同期方式が混ざる**境界例**。こうした場合のために「無関係なら理由を書いて通常修正」を許している。
- この票自身の PR#15226 でも、同じファイルへの P1 が 7 回続いた（語句で条件を見分ける方式が原因）。3 回目で方式を変える判断は 1 度したが、同じ枠の中の変更にとどまった。
- token と利用枠への効果はこの再生では測れない。配備後 2 週間、自然に発生した票で観測する。

## 検証

- 単体テスト `tests/codex-workspace/task-board-same-file-review-test.bb`: 2 回では出ない・3 回で出る、同じ run の二重計上なし、他 gate の失敗は影響なし、別ファイルで切れる、review 通過で消える、閾値 0 で指示なし（記録は続く）、7 日で失効、壊れた記録ファイルで prompt が壊れない、票の本文は全文のまま。
- 既存の runner テスト全 shard（CI）。

## 配備後

- 通常の CI・review・merge → codex-workspace image の配備 → runner の復帰を確認。
- 2 週間の観測項目: 指示が出た回数、その後の連続の長さ、差し戻し、token。架空の比較 run は作らない。

## 切戻し

`CODEX_TASK_BOARD_SAME_FILE_REVIEW_STREAK_THRESHOLD=0`（指示だけ止まる）、または revert。記録ファイルは追加だけで、既存の形式は変えない。
