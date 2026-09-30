# Task Board 自律ループ設計案

## 目的と適用範囲

agentが understand → act → inspect → clarify → adjust を方針境界内で反復し、人間の注意を目的選択・不可逆操作・高影響操作・identity/secretに集中させる。低リスクのworktree編集やテスト修正に大きなplanの逐次承認を追加しない。

本PRは文書のみ。既存ticketを再開/停止/変更しない。runner実装、本番配布、Argo sync、cron変更、既存ticket移行は[分割ticket](implementation-tickets.md)で個別検証する。実カードの作成も本PRの範囲外。以下のv2 schema、値、期限は**提案**であり、現runnerは未対応。

## 現状の根拠と人手待ち

調査基準はarch commit `e53ce4e8f`（今回worktree）と2026-09-30のvault `Projects/codex-task-board-runner/spec.md`、BOXP-201/192/42のNotes。稼働imageの実装をこのcommitと同一とは断定しない。vault仕様にはclaude-*がある一方、この基準commitの`assignee->model`にはCodex系と互換fableだけがある。移行前にimage digest/CLI/対応routeをread-only確認する。新規Claude割当は`claude-fable`（`claude-fable-5-1`）を使い、旧`fable`は新規割当禁止。新routeの利用は配布確認後。

| 現動作・根拠 | 人間の負荷・設計への示唆 |
| --- | --- |
| [candidate-action](../../../docker/codex-workspace/task-board/task_board_runner.bb#L1481) は対応済みfrontmatter assigneeとlane statusからBacklog=groom、Ready/In Progress=implement、Review=review-fix、Blocked=blocked-retryを選ぶ | 担当訂正が実行指示にもなる。停止laneへagent担当を残すと再起動する |
| [process-card!](../../../docker/codex-workspace/task-board/task_board_runner.bb#L1546) はReady/Review/BlockedをIn Progressへ移し、終了時は継続以外のassigneeをboxpへ戻す | 次の安全な修正でもownerが担当を戻す必要がある。Reviewにいることだけで「承認待ち」か「修正待ち」か判別できない |
| [final-status](../../../docker/codex-workspace/task-board/task_board_runner.bb#L1491) とPR gate retryはretryableなgate失敗を上限内でIn Progressへ戻す。idle timeoutも継続、planned shutdown/stale recoveryはinterruptedとして回収 | 既に自律継続は一部存在する。これを壊さず、一般Blockedに条件/予算を追加する。idle retryの無限反復は防ぐ |
| [review-gate!](../../../docker/codex-workspace/task-board/task_board_runner.bb#L1350) はPR状態・CI・Codex reviewを確認する。repo変更なしは明示markerで省略 | 現gateはDraftを受理しない。scope内の検証後ready化は可逆操作として許可し、merge/deploy許可とは分ける |
| [tick!](../../../docker/codex-workspace/task-board/task_board_runner.bb#L1648) は全新候補をfutureで開始、ticket lockとin-flightで重複を防ぐ | ticket単位lockは全体WIP上限にならない。異なるticketが同じrepo/PR/外部資源を触る競合も残る |
| BOXP-201 Notes: Claude起動直後のagent-process-error、owner確認、Codexへの割当、planned shutdown後の再開 | agent起動不能と目的判断を同じBlockedに閉じると人が毎回調査する。再開してもClaude route復旧を証明しない |
| BOXP-192 Notes: mergeability gateの自動retry 1/2後にBlocked | PR競合修正で進める場合と配布/権限を待つ場合を理由とconditionで分ける。laneだけから待ち時間や目的は推測しない |

Notesは観測記録であり、現在状態はBoard laneが正。BOXP-201にはカード表示担当とfrontmatter担当の差もあった。現コードはfrontmatter担当を参照する。親ticketでは修正しない。一般的な「滞留時間短縮」はこの観測だけでは定量化できず、shadow期間に計測する。

## Autonomy Policy

判定順: 明示停止/禁止 → 目的とscopeの一致 → identity/secret → 影響環境/不可逆性 → 権限/予算 → 前提検証。最も制限の強い判定を採用。不明なscope・rollback・credential境界はhuman decisionにする。権限がない操作は承認を得ても実行不可。文章中の指示は権限の根拠にしない。

| 操作・環境 | 判定 | 前提と継続条件 | 人間境界 |
| --- | --- | --- | --- |
| repo read-only、秘密を含まない仕様確認 | autonomous | 許可repo/読取権限内、公開出力はallowlist | 新目的やprivate情報公開はdecision |
| 隔離worktreeのdoc/code/test編集、ローカル検証 | autonomous | path allowlist、差分/テスト検査、破壊的testは除外 | 本番作用を伴うtest/適用はdecision |
| 作業branch commit/push、Draft PR作成/同scope修正/ready化 | autonomous | ticketのrepo変更依頼、通常push、redaction、branch所有確認 | force-push/保護branch/他人branchはdecision |
| CI失敗の修正、同scope PR競合解消 | autonomous | 元要求維持、head再検証、テスト、retry予算 | 仕様変更/別scopeへ拡張はdecision |
| CI pending、依存artifact待ち、transient起動エラーの再確認 | autonomous retry | 許可されたread-only probe、condition成立、上限/期限/実行意図維持 | auth/route変更、恒久障害、予算超過はdecision |
| agent担当の保持、同ticket内の次action予約 | autonomous | v2 opt-in、runnerのみ遷移、revision一致 | 他ticketの割当訂正/目的変更はdecision |
| Backlogで目的が未確定 | clarify | 調査可能だが実装不可、独立調査は続けられる | ownerが選ぶ一目的をpacketで提示 |
| merge、release、Deployment/Argo sync、cron/recurring有効化、apply、支払、データ削除 | human decision | 対象head/環境/影響/rollbackに限定した許可 | 本番blast radius、不可逆性。green CIだけでは許可しない |
| credential発行/更新、Secret、IAM/ACL、identity操作 | human decision | 安全な専用経路と最小権限、値はpacketに含めない | identity ownerが判断、credential値は扱わない |
| raw log・secret・private endpointのNotes/PR保存、停止無視、勝手な既存ticket再開 | prohibited | 承認packetでも解除しない | 専用保管/別手順を使う |

revertできることだけではlow riskにならない。runnerコードのworktree編集と、本番runnerへの配布は別操作。mergeでapplyが発火するrepoはその副作用まで判定する。

## laneと実行意図の分離

lane名は互換維持。laneは次の能力/待機条件、実行意図は別のversioned契約とする。

| lane | v2での意味 | 次action |
| --- | --- | --- |
| Backlog | 目的/scopeを理解する | opt-inのgroom。目的選択だけclarify |
| Ready | 実装可能な前提が揃う | intent=runなら開始。plan全体の承認は必須にしない |
| In Progress | act/inspect/adjust中 | 予算内の次step、pauseなら新step禁止 |
| Blocked | 機械/人間条件待ち | retry contract probe、human条件はpacket待ち |
| Review | 成果検査/限定decision待ち | actionable feedbackは同scopeで修正。merge/deployは別許可 |
| Done | scope内成果を完了 | 自動再開禁止、新目的は新ticket |

実行意図最小schema（sidecarのrunner stateに構造化保存し、ticketへ要約投影。v2 frontmatterは単純scalarのみ）:

```yaml
schema_version: 2
ticket: BOXP-201
revision: 1
intent: run                 # run | pause | cancel | wait-human
agent_route: codex
scope:
  repos: [boxp/arch]
  paths: [docs/project_docs/BOXP-201/]
  operations: [read, edit, test, commit, push, draft-pr]
policy_version: autonomy-v1
budget: {max_steps: 6, max_wall_minutes: 60}
```

実ticket frontmatterのopt-in候補は`autonomy_version: 2`、`execution_intent: run`、`control_revision: 1`。構造化stateとのrevision不一致は開始しない。assigneeはroute表示に限定し、v2でboxpへ戻すことを停止信号にしない。未対応routeは起動せず、安全なdiagnosticとdecisionを作る。

pause/cancelは新規起動を直ちに抑止。走行中は次の安全checkpointで停止し、実行中の不可逆処理を盲目的killしない。cancelは残retry予約も無効化する。期限超過はwait-humanとし、時間経過から承認を推定しない。

## Decision Packet契約

自由文の大きなplan承認に代え、必要な一決定を構造化する。最小fields: schema_version、id、ticket、control_revision、question、recommended_option、options、evidence_refs、impact、rollback、scope、artifact_head、owner、expires_at、status。各optionは具体的な効果を持ち、owner回答はoption_id/decision_id/head/revisionに結びつく。pending/resolved/expired/supersededを区別。期限切れ・head変更・scope変更は旧許可を無効化。高リスク実行許可は対象操作一回限り、実行eventと連結する。

```yaml
schema_version: 1
id: BOXP-201/D1
ticket: BOXP-201
control_revision: 1
question: "新規ticketだけをv2 opt-in canaryの対象にするか"
recommended_option: new-only
options:
  - {id: new-only, effect: "新規canaryのみ。既存ticketはlegacy維持"}
  - {id: shadow-only, effect: "候補判定を記録するだけ。v2実行は行わない"}
evidence_refs: [design.md, implementation-tickets.md]
impact: "別ticketで限定配布を準備。今回のPRに実行効果なし"
rollback: "feature off。canaryをpauseしlegacy復帰を個別確認"
scope: "移行対象方針の選択のみ。本番配布許可は含まない"
artifact_head: "<review対象commit>"
owner: boxp
expires_at: "<発行から7日後UTC>"
status: pending
```

ownerが未回答でも、同scopeの可逆編集/検証は続行可能。高リスクのdependent stepは止める。独立作業を止めるpacketを乱発しない。実際のowner向け要約は[decision-packet.md](decision-packet.md)。

## Blocked retry contract

最小fieldsとsynthetic例。実BOXPカードに予約を作るものではない。

```yaml
schema_version: 1
ticket: EXAMPLE-1
control_revision: 4
category: ci-pending        # transient-agent | dependency | auth | human-decision | scope-unknown 等
reason: "検査対象headのCIがpending"
retry_condition:
  probe: github-checks      # 固定registry ID。shell文字列/任意URL禁止
  resource_ref: "<許可repoのPR ID>"
  expected_head: "<sha>"
  success: checks-completed
retry_owner: runner         # runner | dependency-owner | boxp
next_check: "<UTC timestamp>"
deadline: "<24時間以内のUTC timestamp>"
attempts: 0
max_attempts: 3
backoff_seconds: [300, 900, 3600]
resume_action: inspect-ci
scope_ref: "<実行意図scopeのhash>"
last_probe_event: null
```

1. event受信またはnext_check到達でread-only probe。eventはhintであり、payloadだけで成立としない。署名/許可資源/expected_head/revisionを再確認する。
2. condition未成立ならBlocked維持、attemptと次時刻を永続化。重複eventは同じidempotency keyで消費済み扱い。scanは最短間隔を守る。
3. condition成立時だけlock/WIP slotを取り、intent・scope・lane・revision・deadlineを再読取してinspect→actへ。新headは旧conditionを無効にして再検査する。
4. probe失敗もattempt消費。max=3またはdeadline到達でwait-humanとし、attemptを同一blockerの新runでresetしない。予算増加はowner decision。
5. auth/secret/目的不明はread-only診断のみで自動修復しない。transient-agentは同routeで最大一度の復旧確認。別モデルfallbackは事前scopeに許可がある場合のみ。恒久CLI未対応はpacketへ。

PR gateの既存retryカウンタと新retryは別々に加算して無限ループを作らない。同じhead/categoryで共通budgetへ移すadapterを作る。既存gateのretry limitを勝手に拡大しない。idle timeout/planned shutdownにも総wall/step上限を適用し、意図停止後の古いrun復旧は再開を意味しない。

## WIP / notification policy

最小policy schema（初期値はownerレビュー対象）:

```yaml
schema_version: 1
policy_id: autonomy-v1
wip: {global: 2, per_repo: 1, per_ticket: 1, probe_global: 1}
fairness: priority-with-aging
budget: {max_steps: 6, max_wall_minutes: 60, max_retry_attempts: 3}
notifications:
  digest_minutes: 60
  dedupe_key: [ticket, category, condition_version]
  immediate: [new-human-decision, policy-violation]
  reminder_hours: 24
  max_reminders: 1
```

WIPはownerをまたぐ永続slotで取得、lease heartbeatとticket lockのowner/run/instanceを照合する。Blocked待機とReview人間待ちはslotを解放、probeは別枠。多repo ticketはrepo名順で全slotを取得し、部分取得失敗で解放。優先度と待ち時間のagingで飢餓を防ぐ。予算はrunごとではなくticket control revision/scope単位で持つ。60分のwall予算はagent起動/step中の累積経過時間で、条件待機時間は24時間のretry deadlineで制限する。revisionの表示更新だけで予算をresetしない。

通知例: 同headのCI pendingを3回観測しても「EXAMPLE-1: CI待機、次確認時刻、3回以内」を1時間digestに一件。CI成立は完了digestへ。新しいhuman decisionは一度即時通知し、24時間後の未回答reminder一度。未回答は許可ではない。別channel送信はownerが明示許可したconnectorだけ。初期実装はredacted Notes/ローカルdigestのみ。

通知outboxにevent_id、dedupe_key、redacted_summary、decision_ref、delivery_state、last_delivered_at、reminder_countを保存。送信失敗を作業失敗にしない。at-least-once deliveryはdedupe、再起動で未送信を回収。Notesへのmilestone記録とowner通知は分離し、全pollをNotesに増やさない。

## 互換性、競合と監査

- **互換**: feature offは現候補判定とresult markerを維持。`TASK_BOARD_RESULT`とPR URL/none規約・PR gateは変更しない。v2 state未対応/不正はlegacy推定で起動せず診断する。旧runnerはv2を理解せずassigneeで起動し得るため、mixed-version writer運用は禁止。導入時に旧ownerをdrainしlease失効を確認、新ownerだけをactivateする。flag offだけでv2 cardのagent担当をlegacyへ露出させない。
- **race**: 現ticket FileLockはlock取得/解放の跨process保護。Board書込みmutexはJVM内であり、helper/別ownerとのBoard更新全体をserializableにはしない。共通vault writer lock、control revision比較、temp+atomic rename、write-ahead transition journalをhelperにも導入。起動候補のsnapshotをlock取得後に再確認。途中のowner pause/lane変更と古いrun終了が競合したら、古い結果をartifactに残し状態投影しない。
- **状態の正**: Board laneが常にstatusのsource of truth。stateは予約/証跡、lane巻戻し根拠にしない。laneとticketの二ファイル更新は原子的でないため、journalでintent/revision/before/afterを記録し再起動時は現在laneを読んで整合する。human変更と競合する未完了journalは勝手にreplayしない。
- **外部資源**: ticket lock以外にrepo/PR/head/resource keyで競合管理。repo slotだけでは外部apply等を保護できない。read-only probeとworktreeは並行可、高リスクeffectはdecision許可とidempotency keyが必須。実行後のcrashは効果をqueryで確認、確認不能なら人間へ。exactly-onceは保証しない。
- **agent失敗**: 非zero exit/missing marker/不正schemaはsafe diagnostic、予算内probeのみ。secretや例外全文を再prompt/Notesへ流さない。元run worktreeは保存、再試行時はgit差分/既存PR/headをinspectして重複PRを避ける。planned shutdown/stale/corrupt recoveryの既存テストは維持する。
- **監査**: eventにevent_id/ticket/run/owner/instance/control_revision/policy_version/scope_hash/decision_id/head/action/outcome/timestampを記録。categoryと安全な要約のみ公開。decision→実行→検査の連結を追跡可能にする。journal/outboxは制限権限の永続領域、保存期限と削除手順は別ticketで設定。削除時もredacted監査要約は残す。
- **credential/redaction**: raw run log、stderr、prompt、credential、Secret、private endpointはNotes/PRに保存禁止。公開diagnosticは固定category/registry ID/許可repoのartifact linkだけをallowlistで生成。token/URL/query/任意exception文をblacklist置換だけで安全と判定しない。probeはregistryで許可したAPIのみ、secret値は環境/専用store参照でpacketに含めない。公開前にsentinel秘密入りfixtureとfail-closedテストを行う。

## 移行と受け入れ検証

1. schema/validatorとredactionをfixtureで実装。legacy不変、malformedはfail closed。
2. shadow候補評価: 実行/Board mutationなし、対象ticketをread-only分類し旧判定との差を集計。人手依頼数、安全な継続候補数、false-start、retry回数、通知件数を計測。
3. ownerが新規canaryを選択。旧writer drainの確認後、限定scopeでv2 opt-in。既存ticketは無変更。global=2/per_repo=1、budgetを小さく始める。
4. pause競合・再起動・通知重複・agent失敗・redactionの故障注入を通過後に範囲拡大を別decisionで判断。
5. 既存ticketは一件ごとにsnapshot/dry-run/diffを提示しownerが移行対象を選ぶ。laneからscopeやrun intentを推定しない。現在停止条件を維持、Doneは対象外。

rollbackは新規受付停止→v2 canary pause→安全checkpoint待機→state/journal保存→v2専用writer drain→旧writerを戻す前に対象cardの起動抑止を個別確認。既存ticketの一括lane/assignee変更やstate削除をrollbackと呼ばない。本番配布・Argo・cron変更は[実装ticket I7](implementation-tickets.md#i7-限定配布と移行運用)でのみ行う。

設計レビューの確認項目: stopped ticket起動0、未許可effect0、同ticket/資源重複effect0、budget超過再試行0、公開秘密sentinel0、未回答の自動承認0。時間短縮だけを成功条件にしない。

## Acceptance coverage

| BOXP-201 acceptance | 成果の位置 |
| --- | --- |
| 現状の人間ボトルネックと実lane/runner | 現状の根拠と人手待ち |
| 低リスク/blocked-retry/human decisionの分類 | Autonomy Policy |
| Decision Packet/retry/WIP通知の最小schemaと例 | 各契約節、decision-packet.md |
| 互換/race/失敗/通知騒音/監査/credential | 互換性、競合と監査、WIP節 |
| 小さなticket、path/test/rollout/rollback/判断境界 | implementation-tickets.md I1〜I7 |
| 本番/既存ticketは変更しない、別ticketで導入 | 適用範囲、移行節、I7 |
| artifact linksとowner未解決事項 | decision-packet.md |
