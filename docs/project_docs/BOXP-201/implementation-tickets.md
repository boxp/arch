# BOXP-201 分割ticket案

以下は実装可能なticket本文案。I1〜I7は文書内IDで、実際のBOXP番号ではない。実カードの作成・割当・lane変更は行っていない。新規作成時もまずBacklog/boxpとし、対応済みagentの割当による意図しない起動を避ける。親: BOXP-201。共通仕様: [design.md](design.md)。各段階を別PRで検証する。

依存順: I1 → I2 → I3 → I4。I5はI1/I3後、I6はI1/I2後に進められる。I7はI1〜I6の検証後。I1〜I6はコード/fixture検証までで、本番有効化しない。

## I1: v2 schemaと公開diagnosticのvalidator

**成果/AC**: intent/scope/revision、decision、retry、notification schemaをversionedに検証。unknown version/route/probe、欠落field、範囲外path、期限切れをfail closed。公開diagnosticをallowlistで生成し、任意例外文・URL・secretを保存しない。旧marker/PR gate契約は維持。

**対象path**: `boxp/arch: docker/codex-workspace/task-board/task_board_runner.bb`、新規 `docker/codex-workspace/task-board/autonomy_policy.bb`、`tests/codex-workspace/task-board-runner-test.sh`、新規fixture `tests/codex-workspace/fixtures/autonomy/`。vault仕様更新は別成果としてdiffを提示。

**test**: valid/invalid/version mismatch、path traversal、禁止operation、private URL、synthetic token/Secretを含むexceptionの公開抑止。現model-profile/candidate-action black-box回帰。schema例がvalidatorを通ること。

**rollout/rollback**: flag offのままlibrary導入、fixtureのみ。revertで戻す、永続state formatの書換なし。

**人間境界**: policyの許可operation/環境はowner判断。実装agentが新しい許可を足さない。

## I2: execution intentと停止優先の候補判定

**成果/AC**: legacy-v1/v2を明示分岐、v2はassignee変更だけで起動しない。pause/cancel/wait-human/Doneで新規起動0。snapshotとlock後revision再検証。run終了が新しいowner停止を上書きしない。head/scope変更でdecisionを無効化。shadow評価はBoard/state投影を書き換えない。

**対象path**: arch `docker/codex-workspace/task-board/task_board_runner.bb` のcandidate-action/process-card!/candidate-cards、I1 library、`tests/codex-workspace/task-board-runner-test.sh`。

**test**: 全lane×intent×supported/unsupported route、候補取得後pause、実行中lane変更、old head decision、missing state、shadowが起動せずファイル不変。legacy result/PR URL/none回帰。

**rollout/rollback**: shadow-onlyで比較summary生成。feature offでlegacy維持。v2実行が始まった後のlegacy復帰はI7手順必須で、単なるflag offにしない。

**人間境界**: opt-in対象とscope選択。新規canary以外は移行しない。停止解除は明示revision更新のみ。

## I3: 共通writer lock・transition journalと安全なhelper

**成果/AC**: Board/ticket/stateを共通vault writer lockで更新。revision CAS、atomic rename、write-ahead journal、current lane優先のrecover。helperにintent/decision/retryのdry-run操作を追加。未対応旧writerと同時書込みしない。

**対象path**: arch `docker/codex-workspace/task-board/task_board_runner.bb`、`docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`、`tests/codex-workspace/task-board-runner-test.sh`。他installed helperへの配布先はread-only inventoryで確認してI7へ引き継ぐ。

**test**: 2 process＋helperの同時Notes/frontmatter/Board更新で追記消失0、duplicate card/欠落ticketを自動修復しない、journal各write間kill、owner変更と回復競合、lease盗取後の古いworker終了、dry-run不変。stale/corrupt/planned shutdown既存回帰。

**rollout/rollback**: temp vault/複数processでのみ有効化。新writer journalを旧writerへ誤解釈させず保存。切戻し前にdrain、未完了transitionを現在laneと照合して個別解決。

**人間境界**: conflict解消に目的/停止の推定が必要ならownerへ。Board一括補正を実装範囲に含めない。

## I4: Blocked retryとstep budgetのscheduler

**成果/AC**: registry probe、next_check/deadline/attempts、revision/head/intent再確認による条件付き再開。PR gate/idle/recoveryも総budget内。duplicate eventでattemptやrunを重複作成しない。auth/未知scopeは自動修復しない。transient失敗が恒久障害ならpacket一件へ。

**対象path**: arch `docker/codex-workspace/task-board/task_board_runner.bb`、I1 library、`tests/codex-workspace/task-board-runner-test.sh`、fixture mock probe。既存 `docker/codex-workspace/cron/scheduler.bb` と `docker/codex-workspace/recurring-events/recurring_events.bb` はread-only連携調査まで。新retry scanはrunner tick内でまず検証し、cron変更はI7の別PR。

**test**: fake clockでbackoff/期限/3回上限、pending→成立、probe failure、head変更、duplicate/out-of-order event、pause直前race、restart後attempt維持、idle繰返し停止、起動不能同route一度確認、未許可fallback0、既存PR gate limit不増。

**rollout/rollback**: fixture/shadowでdue candidate記録のみ。I7 canary前はagent起動しない。停止時はretry予約を凍結しstate保持、解除前にscope/revision再検査。

**人間境界**: budget増加、credential修復、route変更の事前許可、目的変更。未回答をretry許可にしない。

## I5: 全体WIP・資源lease・公平性

**成果/AC**: global/per_repo/per_ticket/probe枠を跨ownerで取得。多repoは定順序取得し部分取得を解放。Blocked待機でslot解放、lease失効は実効果の停止確認と分離。priority agingとbudgetで飢餓/暴走を防ぐ。

**対象path**: arch `docker/codex-workspace/task-board/task_board_runner.bb` のtick!/in-flight/lock処理、I1 library、`tests/codex-workspace/task-board-runner-test.sh`。

**test**: 複数ownerでglobal=2超過0/per_repo=1超過0、同PR競合、repo逆順によるdeadlockなし、owner crash/late heartbeat、待機slot解放、低優先度aging、effect結果不明時に盲目再実行0。

**rollout/rollback**: synthetic並列ticketのみ、I7 canary時は2/1/1/1。rollbackは新受付を止めてrunning checkpoint待ち、leaseを一括削除しない。

**人間境界**: WIP/費用上限の拡大と共有外部資源のeffect許可。生産環境の排他取得だけで実行許可としない。

## I6: Decision Packet・通知outboxと監査投影

**成果/AC**: 一決定packet、artifact head/revision/期限付き回答、supersede/resolved追跡。digest/dedupe/reminder一度、outbox再送、安全なNotes要約、公開秘密0。実行eventからdecisionまで追跡可能。

**対象path**: arch I1 library、`docker/codex-workspace/task-board/task_board_runner.bb`、helper `docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`、`tests/codex-workspace/task-board-runner-test.sh`。vault `Projects/codex-task-board-runner/spec.md` は承認対象diffとして別途提示。

**test**: 同blocker3回をdigest一件、restart後dedupe、delivery failure/retry、未回答/期限切れ/head変更でeffect不許可、decision replay防止、secret sentinelがNotes/PR/通知に出ない、audit連結、packetなしの独立可逆作業は継続。

**rollout/rollback**: temp vault Notesとローカルoutboxのみ。external connector通知は許可先決定後の別変更。rollbackはdelivery無効、outboxとauditを保持し既送信を巻き戻さない。

**人間境界**: 通知channel/宛先/保存期限、owner identity、secret保管経路。作業権限をpacket生成agentが自己承認しない。

## I7: 限定配布と移行運用

**成果/AC**: 配布済みroute/image digest/CLIと全writer inventoryを確認。旧owner drain→lease失効→新writerのみactivate。新規canary一件でfault injection/観測後、拡大は別decision。既存ticketはdry-run diffとowner選択後の個別移行のみ。

**対象path**: arch `docker/codex-workspace/Dockerfile`、`.github/workflows/test-codex-task-board-runner.yml`、`docker/codex-workspace/cron/scheduler.bb`、`docker/codex-workspace/recurring-events/recurring_events.bb`、`docker/codex-workspace/skills/` の関連helper/運用docs。lolice `argoproj/codex-workspace/deployment.yaml` は**別repo/別PR**。vault `Projects/codex-task-board-runner/spec.md` と新規canary ticketはhelperで個別操作。cron/recurring連携の変更は必要性確認後の別PRとし重複pollを避ける。

**test**: image/CLI/route smoke、旧writer排除、新規canaryの安全修正→CI→Review、Blocked条件成立、pause/restart/redaction、global WIP、packet期限、notification dedupe、rollback rehearsal。停止ticket0起動、未許可effect0、秘密公開0を必須条件にする。

**rollout/rollback**: read-only inventory→shadowの差分検査→ownerが対象とwindowを選択→限定image/Deployment配布→観測。失敗時は新規受付停止、v2 pause/checkpoint、journal保存、drain、旧writer復帰前にv2 card起動抑止確認。既存card一括変更は禁止。Argo sync/Deployment rollout/cron有効化は個別decisionが必要。

**人間境界**: 本番配布、移行対象、実行window、WIP/予算拡大、既存ticket再開、外部通知。旧fable新規割当禁止。claude-fableの利用は配布確認後。
