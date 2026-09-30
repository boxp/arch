# BOXP-201 分割ticket案

以下は実装可能なticket本文案。I1〜I7は文書内IDで、実際のBOXP番号ではない。実カードの作成・割当・lane変更は行っていない。新規作成時もまずBacklog/boxpとし、対応済みagentの割当による意図しない起動を避ける。親: BOXP-201。共通仕様: [design.md](design.md)。各段階を別PRで検証する。

依存順: I1 → I3 → I2 → I4。I3で認証済みcontrol API/storeの固定interfaceとmock・CAS契約を検証してから、I2でそれを利用する。I5はI1/I3後、I6はI1/I2後に進められる。I7はI1〜I6の検証後。I1〜I6はコード/fixture検証までで、本番有効化しない。

## I1: v2 schemaと公開diagnosticのvalidator

**成果/AC**: intent/scope/revision、objectiveの要求snapshot/版/digest、writer_generation、decision、retry、notification schemaをversionedに検証。unknown version/route/probe、欠落field、範囲外path、期限切れをfail closed。公開diagnosticをallowlistで生成し、任意例外文・URL・secretを保存しない。旧marker/PR gate契約は維持。

**対象path**: `boxp/arch: docker/codex-workspace/task-board/task_board_runner.bb`、新規 `docker/codex-workspace/task-board/autonomy_policy.bb`、`tests/codex-workspace/task-board-runner-test.sh`、新規fixture `tests/codex-workspace/fixtures/autonomy/`。vault仕様更新は別成果としてdiffを提示。

**test**: valid/invalid/version mismatch、path traversal、禁止operation、private URL、synthetic token/Secretを含むexceptionの公開抑止。現model-profile/candidate-action black-box回帰。発行済みの具体値fixtureのみvalidatorを通ること。issuance=templateとプレースホルダhead/期限は発行・実行入力として拒否。

**rollout/rollback**: flag offのままlibrary導入、fixtureのみ。revertで戻す、永続state formatの書換なし。

**人間境界**: policyの許可operation/環境はowner判断。実装agentが新しい許可を足さない。

## I2: execution intent・停止優先とClaude route実装

**成果/AC**: legacy-v1/v2を明示分岐、v2はassignee変更だけで起動しない。pause/cancel/wait-human/Doneで新規起動0。snapshotとlock後revision再検証。run終了が新しいowner停止を上書きしない。head/scope変更でdecisionを無効化。shadow評価はBoard/state投影を書き換えない。新規Claude routeはvalidなv2 opt-in・owner選択済み新規canary・control原本一致・run intentを満たす対象に限定する。legacy-v1やopt-in不在へ新routeを追加しても起動しない。新規Claude route `claude-fable` を `supported-assignee?`・候補判定・起動分岐へ追加し、Claude CLIへ明示的に `--model claude-fable-5-1` を渡す。model/profile/agent定義の選択契約を実装し、Codex用profileや旧FABLE環境overrideから暗黙のモデル変更を受けない。helper path・policy prompt・Notes source・出力/終了判定・idle retry・PR gate retryのClaude分岐も新routeに対応させ、retryで旧routeへ戻さない。旧 `fable` はv2および新規起動候補で拒否し、既存旧routeの再開が必要なら別owner decisionで `claude-fable` へ個別移行する。既に起動済みの旧runの終了/監査は読み取れる互換性を維持し、この実装だけで既存cardを変更しない。

**対象path**: arch `docker/codex-workspace/task-board/task_board_runner.bb` のsupported-assignee?/candidate-action/process-card!/candidate-cards、run-agent!・model/agent引数・prompt/進捗/出力分岐、I1 library、`tests/codex-workspace/task-board-runner-test.sh`。

**test**: agent・古いrun・未認証helperによる未認可revision/scope/intent変更を拒否、目的snapshot欠落/改変/digest不一致・同path内の別目的要求・agentによるticket要求書換で起動0、Notes/laneだけの更新は目的変更にしない。原本取得不能で起動0、revision更新だけでbudget消費をリセットしない。全lane×intent×supported/unsupported route、候補取得後pause、実行中lane変更、old head decision、missing state、shadowが起動せずファイル不変。legacy result/PR URL/none回帰。legacy-v1・v2 opt-in不在・state欠落/不正・canary許可なしの `claude-fable` は候補0/CLI起動0。fake Claude CLIで `claude-fable` の許可候補だけがClaude CLI経由で起動し、argvのmodelが `claude-fable-5-1`、helper/prompt/sourceが新routeと一致すること。未知Claude route・旧 `fable` の新規/再試行候補は0起動、暗黙fallbackや旧overrideによるmodel変更を拒否。新routeのidle timeout/子process停止/進捗継続/PR gate retryでrouteを保持し、Codex系model/profile回帰を維持。I2のCLI smokeはfixtureでargv/agent定義解決を検証し、実配布CLIでのmodel/profile対応確認はI7の必須gateとする。

**rollout/rollback**: shadow-onlyで比較summary生成。feature offで従来binaryのlegacy判定を維持するため新route/拒否規則はshadow結果のみ。I7で有効化した新writerでは旧routeの候補拒否を適用し、flag offだけで旧routeを再開させない。v2実行が始まった後のlegacy復帰はI7手順必須で、単なるflag offにしない。

**人間境界**: opt-in対象とscope選択。新規canary以外は移行しない。停止解除は明示revision更新のみ。

## I3: 共通writer lock・transition journalと安全なhelper

**成果/AC**: 制御原本の認証済みAPI・store・actor別権限・単調revision/event契約をmock検証し、agent書込可能な投影を認可に使わない。実API/store配置はI7。owner専用の不変目的snapshot/新要求版発行と旧decision/retry無効化、単調writer_generation発行と起動/write直前の現世代照合をmock検証する。Board/ticket/stateを共通vault writer lockで更新。revision CAS、atomic rename、write-ahead journal、current lane優先のrecover。helperにintent/decision/retryのdry-run操作を追加。未対応旧writerと同時書込みしない。

**対象path**: arch `docker/codex-workspace/task-board/task_board_runner.bb`、`docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`、`tests/codex-workspace/task-board-runner-test.sh`。他installed helperへの配布先はread-only inventoryで確認してI7へ引き継ぐ。

**test**: 未認可agent/古いrun/helperによるrevision・scope・停止解除拒否、runnerによる権限拡大拒否、revision/generation巻戻し・旧世代起動/write・原本取得不能を拒否、revision変更後も同budget epochの累積消費維持。2 process＋helperの同時Notes/frontmatter/Board更新で追記消失0、duplicate card/欠落ticketを自動修復しない、journal各write間kill、owner変更と回復競合、lease盗取後の古いworker終了、dry-run不変。stale/corrupt/planned shutdown既存回帰。

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

**成果/AC**: I6単独の完了条件はローカルfixture/mockによる契約・verifier・通知投影の検証に限定し、実owner回答の取得や本番承認storeへの保存は含めない。一決定packet、認証済みowner回答の取得、署名付き不変承認eventのappend-only保存をmock APIで再現する。actor subject/decision ID/option ID/head/revision/packet digest/scope/operation/発行時刻/期限を実行直前に検証し、一回消費をCAS予約。packet statusは権限を持たない投影とし、supersede/resolved追跡。digest/dedupe/reminder一度、outbox再送、安全なNotes要約、公開秘密0。実行eventからdecisionまで追跡可能。

**対象path**: arch I1 library、`docker/codex-workspace/task-board/task_board_runner.bb`、helper `docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`、`tests/codex-workspace/task-board-runner-test.sh`。新規 `docker/codex-workspace/task-board/approval_verifier.bb` と `tests/codex-workspace/fixtures/autonomy/approval/`。owner専用承認サービス/storeはI6でAPI・署名・権限分離契約とmockを設計検証し、配置/credentialはI7の別repo/別PR。vault `Projects/codex-task-board-runner/spec.md` は承認対象diffとして別途提示。

**test**: templateの承認store登録/approval event照合を拒否し、issuedでもプレースホルダを拒否。以下はtemp vault・mock API/store・synthetic identity/署名による契約testであり、実環境の権限分離証明はI7で行う。同blocker3回をdigest一件、restart後dedupe、delivery failure/retry、未回答/期限切れ/head変更でeffect不許可、agentのpacket/status更新・owner名偽装・未検証resolvedを不許可、agent/runner credentialで承認API書込不可、偽署名/未知issuer/誤audience/非owner subject/改変option・scope・packet digest/未来発行/失効/原本取得不能を拒否。正規owner署名の一致eventのみ許可し、並行消費で一回だけ、crash後も再消費不可。decision replay防止、secret sentinelがNotes/PR/通知に出ない、audit連結、packetなしの独立可逆作業は継続。

**rollout/rollback**: temp vault Notesとローカルoutboxのみ。external connector通知は許可先決定後の別変更。rollbackはdelivery無効、outboxとauditを保持し既送信を巻き戻さない。

**人間境界**: 通知channel/宛先/保存期限、owner identity、secret保管経路。認証provider/署名方式/専用store・owner subject登録はowner判断。agent環境と認証経路の分離未確認ならdependent effectは有効化不可。作業権限をpacket生成agentが自己承認しない。

## I7: 限定配布と移行運用

**成果/AC**: I6の契約を満たす実owner承認サービス/storeとI3のcontrol API/storeを別repo/別PRで実装・配置し、owner認証provider・鍵・allowlistを構成する。配置先と運用責任者をownerが確定するまでI7を完了扱いせず、human-dependent effectを無効に保つ。I2で実装した `claude-fable` routeを含むimageをbuildし、image digest/CLI version/model・profile・agent定義と全writer inventoryを確認。配布済みCLIが `claude-fable-5-1` を受け付けない、agent定義が未解決、または旧 `fable` へfallbackする場合はClaude canaryを有効化しない。[writer世代切替gate](design.md#writer世代切替gatei7)を必須ACとし、旧owner drain→旧Deployment replica=0/全起動元抑止→全旧writer・agent子process不在→旧credential/mount/書込・起動権限剥奪→単調writer_generation発行→新世代だけactivate。lease失効だけでは完了しない。全host/helperをinventoryし、未知writer・共有identity未分離・権限剥奪未証明なら有効化禁止。canary有効化前に実環境でowner承認サービス/storeとagent/runnerのcredential・trust境界分離を必須gateとして実証し、安全な結果要約を監査へ保存。未確認/失敗時はhuman-dependent effectを有効化しない。新規canary一件でfault injection/観測後、拡大は別decision。既存ticketはdry-run diffとowner選択後の個別移行のみ。

**対象path**: arch `docker/codex-workspace/Dockerfile`、`.github/workflows/test-codex-task-board-runner.yml`、`docker/codex-workspace/cron/scheduler.bb`、`docker/codex-workspace/recurring-events/recurring_events.bb`、`docker/codex-workspace/skills/` の関連helper/運用docs。lolice `argoproj/codex-workspace/deployment.yaml` は**別repo/別PR**。vault `Projects/codex-task-board-runner/spec.md` と新規canary ticketはhelperで個別操作。cron/recurring連携の変更は必要性確認後の別PRとし重複pollを避ける。

**test**: 実agentからcontrol API/storeの書込とowner-only制御変更を拒否、runnerのscope拡大/停止解除/budgetリセット拒否。配布候補imageの実Claude CLIで新routeの明示model・profile/agent定義を解決し、temp vaultのsynthetic ticketで最小応答とresult markerを確認するCLI smoke（実ticket/secretをpromptへ含めない、費用とwindowはowner許可内）。旧route/未知routeはCLI起動前に拒否し、新routeが未対応のCLIは診断のみでcanary不許可。image/CLI/route smoke、旧replica復活/残存process/子process/別host helper/権限剥奪未完了ではactivate拒否。lease失効後も動く旧binaryを旧identityで再起動しBoard/ticket/state/journal書込・control mutation・agent起動/effect要求の全拒否を確認。generation不一致/巻戻し/原本取得不能で新writerのwrite/起動拒否、正常切替は現世代だけ成功。rollbackでは新世代の停止/剥奪・legacy入力からv2対象隔離の未完了で復帰拒否。新規canaryの安全修正→CI→Review、Blocked条件成立、pause/restart/redaction、global WIP、packet期限、notification dedupe、rollback rehearsal。実際のagent/runner identityで署名鍵読取、承認API発行/更新/削除、承認store書込/削除、trust鍵/owner allowlist変更、ownerセッション取得を試み全件拒否を確認（secret値を出力しない）。正規owner eventの検証成功と、改変/自己申告resolved/原本取得不能の拒否も配置済みverifierで確認。停止ticket0起動、未許可effect0、秘密公開0を必須条件にする。

**rollout/rollback**: read-only inventory→shadowの差分検査→ownerが対象とwindowを選択→限定image配布（新writer無効）→writer世代切替gateと承認経路分離gate確認→新writer/canary有効化→観測。失敗時は新規受付停止、v2 pause/checkpoint、journal保存、新Deployment replica=0・全process停止・権限剥奪、次世代発行、旧binary用新identityとv2 cardのlegacy入力隔離を確認してから復帰。隔離不能なら両writer停止を維持しowner判断へ。flag off/pause/lease失効だけで旧writerを戻さない。既存card一括変更は禁止。Argo sync/Deployment rollout/cron有効化は個別decisionが必要。

**人間境界**: 本番配布、移行対象、実行window、WIP/予算拡大、既存ticket再開、外部通知。旧fable新規割当禁止。claude-fableの利用は配布確認後。
