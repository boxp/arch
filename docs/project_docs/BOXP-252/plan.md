# BOXP-252: codex-workspace Pod 終了時の graceful shutdown と進行中 run 保全

設計正本は Obsidian `Projects/codex-task-board-runner/graceful-shutdown/design.md`。本ファイルは arch 側実装 PR 用の計画。

## 現状（2026-10-19 時点、main と live Pod は一致）

- task-board-runner / novel-board-runner container は `bb <runner> loop` が PID 1。SIGTERM で JVM shutdown hook が planned-shutdown marker を書き、即終了する。
- `setsid` で起動した claude / codex CLI と子孫は別 session のため TERM を受けず、PID 1 終了による PID namespace 崩壊で SIGKILL される。`terminationGracePeriodSeconds: 60` はほぼ未使用。
- 終了側 runner は自分の run を記録せず、次 Pod が marker 一致 lock を `interrupted` にする（この経路は本日 BOXP-247/250 で実績あり、維持する）。
- 他 owner の空 marker と `:terminating` owner state は回収されず約 120 件蓄積。bb が PID 1 で孤児 zombie を reap しない。

## 変更（限定）

1. `task_board_runner.bb`
   - shutdown hook: marker 書き込み後、登録済み agent process group へ TERM → 上限 `CODEX_TASK_BOARD_SHUTDOWN_AGENT_GRACE_SECONDS`（既定 20 秒）待ち → 残存に KILL。無制限待ちはしない。
   - `run-agent!` は agent process group を登録し（登録時点で既に shutdown 要求済みなら即 TERM、hook との競合対策）、shutdown 中に agent が終了した場合は run を `:interrupted`（reason planned workspace shutdown、`:shutdown` 詳細）で記録して `:shutdown? true` を返す。
   - `process-card!` は `:shutdown?` の run をレーン/frontmatter/Notes/blocked へ反映せず、lock も解放しない（次 owner の既存 marker 回収に委ねる）。
   - `mark-run!` は `:shutdown` を保持し、次 owner の interrupted 記録で終了側の記録が消えないようにする。
   - 他 owner の空 marker は `CODEX_TASK_BOARD_SHUTDOWN_MARKER_RETENTION_SECONDS`（既定 3600 秒）経過後に tombstone 化して削除する。
2. `novel_board_runner.bb`: 同じ hook / process group 登録 / `:shutdown?` 判定。localllm streaming は shutdown 要求で body を閉じ、partial を保存して interrupted とする。
3. `entrypoint.sh`: novel-board-runner role を `tini -- runner loop` で起動（zombie reap、signal 転送）。
4. black-box test: task-board 3 件（cooperative agent の TERM 伝播と lock 保持・次 owner の一度だけ回収、TERM 無視 agent の grace 後 KILL、期限切れ他 owner marker 回収）、novel-board 2 件（cloud agent 停止、localllm stream 停止と partial 保持・再要求なし）。
5. 設計レビュー: codex review の指摘（agent 起動→登録の間に SIGTERM が来ると hook が空集合を見る競合）を登録時再確認で解消。2 回目の指摘（shutdown 中に登録された agent が最終 KILL/待機対象から漏れる）は、待機ループと最終 KILL での registry 再取得＋停止完了後の登録は即 KILL、shutdown 中の unregister を no-op（親だけ TERM で終了した group も最終 KILL 対象に残す）で解消し、両 runner の内蔵テスト（`bb ... test`）に競合テストを追加。

## 関連 PR

- boxp/lolice #846（tini 化 + README）

## 検証

- `tests/codex-workspace/task-board-runner-test.sh`、`novel-board-runner-test.sh`、runner 内蔵 `test`。
- production の active run は kill / rollout / lock 削除しない。配備は通常 GitOps（image updater → Argo CD Recreate）。

## 追記（2026-10-20）

- CI `Test Codex Task Board Runner` の `test_prune_holds_checkout_over_commit_limit` 失敗は本変更と無関係の flaky。prune fixture が 2 つの checkout で同一メッセージ・同一親の空コミットを作るため、同一秒内に作られたコミットは同一 SHA になり、BOXP-331 側の正当な GitHub lookup が BOXP-332 側の over-limit SHA と一致して誤検知していた。fixture のコミットメッセージに checkout path を含めて SHA を一意化した。
- codex-review gate 4 回目の指摘（2026-10-20）: `process-card!` が `run-agent!` の返す古い `shutdown?` しか見ないため、agent 正常終了後〜review gate 中〜レーン確定前に SIGTERM が届くと終了側 runner が success/blocked 記録・レーン移動・frontmatter 更新・lock 解放を行う競合があった。`ensure-not-shutting-down!` で agent 終了直後・review gate 完了直後（diagnostic/retry 計数の永続化前）・ライフサイクル確定直前の 3 点で live フラグを再確認し、shutdown 中は `:interrupted` 記録＋lock 保持に倒す（`run-agent!` が記録済みなら `:recorded? true` で二重記録しない）。内蔵テスト 2 件を追加し、修正なしで FAIL することを確認した。
- ローカル codex review の追加指摘（確認直後〜commit 完了の間に TERM が届く窓）: `begin-lifecycle-commit!`（確認＋`committing-cards` 加算）と hook の `request-shutdown!` を同じ monitor `lifecycle-commit-lock` で原子化。TERM は確認前（interrupted・何も書かない）か commit 開始後（commit を完走させ、hook の `await-in-flight-finalization!` が `committing-cards` 0 まで finalize 予算内で待つ）のどちらかになる。commit 途中の中断は部分書き込みになるため行わない。内蔵テストを 2 件追加（計 4 件）。
- codex-review gate 5 回目の指摘（2026-10-20）: (1) novel runner の `process-card!` は `@shutdown-requested?` を確認してから `finish-run!` を呼ぶ間が非原子的で、その隙間に TERM が届くと終了側が成功/失敗確定・レーン/frontmatter 更新・lock 解放を行える。(2) task runner は lock 取得後、agent 起動前の `move-card!`・frontmatter・開始 Notes・`mark-run! :running` を shutdown ガードなしで実行するため、lock 取得直後の TERM でもカードを In Progress に動かしてから agent を止めていた。対応: novel runner にも `lifecycle-commit-lock` / `committing-cards` / `request-shutdown!` / `begin-lifecycle-commit!` を導入し、開始遷移と `finish-run!` を commit 区間にした（hook の finalize 待ちも `committing-cards` を見る）。task runner は開始遷移を `begin-lifecycle-commit!` で囲み、遷移後に `ensure-not-shutting-down!` で agent を起動しない。両 runner に `before the start transition` / `during the start transition` の内蔵テストを追加（修正なしで FAIL を確認）、novel runner には `after the run finished` / `during finish-run!` / finalize 待ちのテストも追加。
