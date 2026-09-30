# 分割実装・検証・復旧案

## 実装分割

以下は後続ticket本文の候補であり、本票では発行・配布しない。運用owner候補はboxp、正式owner/代行者/応答時間/通知先はboxpによる確認待ち。未回答を承認にしない。

| 分割 | 対象ファイル/責務 | 依存・完了条件 |
| --- | --- | --- |
| A: arch診断 | 新設候補 `docker/codex-workspace/auth/auth_health.bb` とfake tests。CLI版ごとのadapter、方式/期限種別、allowlist出力、state/retry/dedupe永続化 | [状態契約](design.md#診断契約)をfixtureで再現。実credentialは読まない。status/API有効性の分離とpolicy拒否を実装。read-only shadowに限定して先行可能 |
| B: arch起動gate | `task-board/task_board_runner.bb`、`cron/run-codex-cron.sh`、必要なら `cron/scheduler.bb`。同provider admission、unknown有界再診断、起動前lock、進行中の安全停止 | A、BOXP-202のstdout/stderr安全分類が前提。runner lane/lock/result契約を保持。provider holdからPR gate/idleの無限retryへ入らない |
| C: arch/lolice永続化・排他 | arch `entrypoint.sh` / Dockerfile、lolice `argoproj/codex-workspace/deployment.yaml`。実効CLI/UID/HOME固定、全利用者wrapper、独立sessionまたは直列stream、PVC継承 | 他repoは専用worktree/別PR。shared checkout編集不可。別machine/対話/委譲CLIを含め排他網羅性を証明。Secret/credential変更/rolloutは別承認 |
| D: owner復旧・運用 | 本runbook、owner向け実操作packet、必要ならvault Projectへレビュー済み設計を同期 | 通知経路、owner/代行、72h/24h・1hの初期値、認証読取り範囲、canary/再開条件を確認。認証操作はownerが実施 |

BOXP-202は旧fable未定義agent、Claude route/CLI固定、stdoutのみを含む起動失敗分類と実障害復旧を担当。本票は事前診断/期限予防、認証更新の永続化と排他、provider受付制御を担当する。BOXP-192のPR gate修正、BOXP-201の自律運転/承認storeを重複実装しない。現mainのblocker-safe-reasonは固定文だがprovider分類は未実装。regexで生ログをredactするだけでは本票のallowlist契約を満たさない。

cron schedulerはfire直後にlast-firedを記録し、次のscheduleで再度起動する。起動失敗専用retryはないがjobごとに並列実行できる。job lockはmkdir/stale削除でprovider共有を守らない。長時間jobのstale誤削除も認証sessionのlockに流用しない。Task Boardは複数ticketのfuture、さらにCodex PR review gateも認証利用者に含める。

Codex hold中でもClaude本作業の受付は独立させる。ただし後段のCodex PR reviewが必要なら**review段階だけ保留**し、reviewを省略して成功にはしない。runnerは`dependency-provider-held`等の固定reasonと再開条件を残し、レビュー用Codexを自動で繰り返し起動しない。外部CLI委譲にもgate/lockを適用し、同sessionは親終了後に直列化、並行委譲は独立発行sessionが必要。異providerのlockも入れ子取得しない。詳細はdesignの排他契約に従う。

## Fakeテストと受入条件

providerに接続しないfake CLI/credentialだけを使い、sandbox HOME・config・PATHを隔離する。実HOME/環境変数の継承を禁止し、ネットワークを切る。CLI版/schema fixtureは秘密値を含まない。偽秘密値はテスト中に生成し、失敗メッセージにもその値を表示しない。

| ケース | 期待する状態/検証 |
| --- | --- |
| subscription + known login期限 >72h + 有効性根拠 | healthy/allow。statusのみならunknown/hold |
| 72h、24h、0秒境界 | expiring bandを一度通知、0秒でexpired-or-revoked/hold。UTC/clock skew検査 |
| accessのみ期限近接/経過、login期限未取得 | expiredと断定せずunknown/hold。accessをlogin通知に使わない |
| expiryなし、未承認読取り、過去成功TTL切れ | unknown/hold。期限をmtime/last_refreshから推測しない |
| 公式refresh拒否/失効、missing | 該当providerの本作業起動0。他providerのwork起動は継続 |
| file missing + keyring/host使用候補 | missingと即断しない。方式が証明できなければunknown |
| 破損JSON、未知schema、権限、symlink、不明CLI版 | unknown/hold、入力の値/pathを出さない |
| status exit 0 + model 401、stdoutだけauth失敗 | 有効性unverified、BOXP-202分類を使う。認証失敗をPR retryにしない |
| network timeout/429/5xx/refresh lock | provider共有budget内で最大3回/15分、1検査30秒。上限到達後本作業0 |
| retry中のcron次回、別ticket、Pod再起動 | counter/deadline/holdを引き継ぐ。budgetを更新しない |
| API key/env/helper/Console/cloud/custom provider | policy-disallowed/hold、helper起動0、fallback/課金方式切替0。環境変数の値を表示しない |
| 独立sessionと同じtokenのdirectoryコピー | コピーだけの分離を拒否。全利用者とreview gateの同session同時CLI実行0 |
| 親CLIからの同session子CLI/異provider入れ子 | 起動を拒否し自己待ち/相互待ち0。独立session委譲と親終了後のreviewは可能 |
| PVC再利用/image更新/古いseed | 更新済みfake credential保持。自動seed上書き0、lock inodeの途中削除0 |
| 通知再起動/重複/状態変化/sink失敗 | 同一key重複0、24h初回は一件、状態変化は通知。外部sink未承認なら呼出0 |
| state破損/書込不能/clock逆行 | 過去healthyへ戻らずunknown/hold。固定reason出力 |
| 進行中失効/owner再開前 | 新request/委譲0、grace後process group drain、部分成果保持、hold自動解除0 |
| Claude正常/Codex review hold | Claude本作業を全停止しない、Codex review起動0、review完了へ偽装0 |

**漏洩テスト**: fake token/refresh token/API key/cookie/認証URL/email/orgと自由文sentinelを、credential全field、CLI stdout/stderr（JSON/non-JSON/長大/改行）、例外/timeoutへ注入。stdout/stderr、summary、Notes、ローカルstate、通知sink、test report、例外メッセージを収集し、sentinelまたはそのURL/base64等の既知変形の一致件数0をassertする。差分の値を失敗reportに含めず、件数とsink enumだけ表示する。raw pipeをログへteeしないこととfake以外のHOMEを開かないことをspyで検証する。秘密値を隠すだけでなくunknownなfield/free textを出さないschema検証も行う。

A/B/C実装時は新設auth fixtureに加えて既存 `tests/codex-workspace/task-board-runner-test.sh` と `tests/codex-workspace/recurring-events-test.sh` を実行し、必要に応じ `.github/workflows/test-codex-task-board-runner.yml` に追加する。cron gate/並列は新しいfake統合テストが必要。本設計PRはruntime無変更のため上記runtime試験は実施せず、文書の参照/要件/秘密値を点検する。実provider probeは別承認後にだけ行う。

## 段階導入とrollback

1. 設計レビュー: owner/通知先/時間値、PUBLICのarch workflowへCodex公式CI/CD維持例を適用しない制約、実効方式の読取り範囲、排他案を確認。設計mergeを操作許可にしない。
2. Aのfake/漏洩試験後、別承認されたread-only shadow。model request/refreshを起こさずlocal stateだけ出力。unknownが続く原因と版対応を評価。
3. 全利用者のmetadata inventoryとlock互換性を確認。BOXP-202の分類API完成後、新規隔離canaryの1 provider/1 workerにenforcement導入。Bのコードでlegacy lane/lockを維持できることをfakeで確認。
4. 再認証/Secret保存/公式更新確認が必要なら対象操作を別packetに固定。ownerによる独立session発行または全利用者drain後の直列化、更新ファイル永続化を確認。
5. 限定配布の結果をレビューし、別承認で他provider/全利用者へ拡大。外部通知は経路承認後に別段階で有効化。

rollbackはまず該当providerの新規受付停止、維持job停止、進行中runをcheckpoint/drain、診断state/安全な監査項目を保存する。旧image/manifest/codeへ戻す操作は承認範囲で行う。古いrunnerへ戻して受付gateが消える場合はrunner/cron/対話利用者を停止したままにし、認証安全性確認まで再開しない。更新済みcredentialは保持し、古いseed/backup tokenへ自動復元しない。認証復旧とimage rollbackは別手順。Pod再起動を認証復旧策にしない。

## Owner復旧runbook（手順案・未実行）

1. **状態確認**: provider/固定reason/検査時刻/期限種別だけ確認する。Ready/SSH成功では判定しない。同じ実効UID/HOME/config/固定CLIをmetadataから特定する。read-onlyの範囲を超えるcredential読取り/status/probeは別承認。
2. **停止/drain**: 該当providerの受付をholdし、workspace対話・cron・Task Board・review gate・委譲CLI・外部machineを停止/drainする。Board laneの操作はrunnerのみ。進行中runの部分成果を保持し、provider lock所有者終了を確認する。credential削除・lock file削除を行わない。
3. **公式subscription再ログイン**: ownerが秘密値を記録しない専用端末で実施。Codexは対象CODEX_HOMEとUIDで公式 `codex login` のsubscription browser flow。Claudeは対象CLAUDE_CONFIG_DIRとUIDで公式 `claude auth login` または対話 `/login` のsubscription flow。Console選択/`--console`/API key経路は禁止。認証URLもNotes/PRへ転載しない。logout/credential削除が必要な場合は破壊範囲を別承認。
4. **長期token採用時のみ**: Claude `setup-token` はownerの専用端末で公式subscription認可。出力はagentログに通さずapproved secret経路へ保存。固定tokenの期限・保存ownerを非秘密台帳で管理する。期限が迫ったら公式再発行が必要、非対話独自refreshは使わない。今回は採用/実行していない。
5. **保存確認**: ownerまたは承認されたadapterが選択方式をsubscriptionと確認し、更新済みcredentialの保存先・所有権・permission/ACLをmetadataだけで照合する。Codex 0660の扱いはowner判断。古いseedを再投入しない。Pod再作成後の同PVC/更新保存検証は別承認のcanary。
6. **小規模canary**: 対象provider/CLI/UID/config/実行window、request数/費用・timeout上限、出力allowlistを特定して別承認する。秘密や本作業を含まない公式CLIの最小runを一回。独自provider API probeを作らない。失敗ならholdのままowner調査、再試行予算を増やさない。
7. **明示再開**: 方式・期限・有効性・排他・永続化が確認でき、canary成功を安全なrun ID/固定結果だけ残した後、ownerが対象providerの再開を明示する。期限取得不能ならunknown継続、healthyへ推測で戻さない。hold解除とretry budgetの新epochはownerの再開指示にだけ紐付ける。停止した票の再実行はrunner契約で行う。

## 未確定事項と承認packetの入力

boxpへのレビュー事項: 正式運用owner/代行、local state/Notesの保持期間と権限、期限取得の版対応、1h/72h/24h/3回15分/30秒/60秒の初期値、直列streamの待機上限、独立session発行可否、Codex維持例はPUBLICのarchへ適用不可であること。外部通知は未承認。今このPRで操作の承認を求めていない。

後続packetはprovider、対象commit、配置/UID/HOME/config、全利用者、subscription方式、具体的操作（読取り/公式login/公式更新/Secret注入/rollout/canaryを区別）、UTC期限、request上限、rollback、再開責任者を含める。agentがpacketのowner名を書くだけでは承認にならない。API keyへの切替はpacketでも候補に入れない。

## BOXP-204受入条件との対応

| AC | 成果物 |
| --- | --- |
| provider別棚卸し/未確認の区別 | design: Codex棚卸し・Claude棚卸し |
| PVC/seed/並列/RWO | design: Source・配備・並列利用 |
| 5状態、statusと有効性、期限なし | design: 診断契約 |
| 1時間・72h/24h・local/Notes/dedupe | design: 出力・通知・進行中run |
| provider別停止/unknown有界retry/再開 | design: 診断契約・進行中run、本書runbook |
| subscription限定/API key/独自OAuth禁止 | plan・design冒頭、本書分割/復旧/packet |
| 許可項目とfake sentinelテスト定義 | design: 出力契約、本書Fakeテスト |
| arch/lolice/owner分割/BOXP-202境界/導入/rollback | 本書実装分割・段階導入・runbook |

現在のprovider認証がhealthyになったこと、非対話維持が可能なこと、監視メトリクスや全配備digestを確認したことは、この設計成果からは主張しない。
