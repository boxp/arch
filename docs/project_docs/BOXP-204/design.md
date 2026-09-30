# Subscription認証の診断・受付停止設計

## 決定と証拠の扱い

Codex / Claude Codeはsubscription認証限定。API key、API key環境変数、provider API key fallback、課金方式切替は設計・実装・復旧のすべてで禁止する。独自OAuth更新APIも禁止。CLI公式更新で安全に維持できない場合は受付を止め、ownerの公式subscription再ログインへ誘導する。

本書は2026-09-30 UTC時点の設計。現在のprovider側の有効性は未確認。BOXP-204の前runで記録済みのメタデータを使用し、今回credential本文・Secret data・生ログを読まず、CLI auth status/login/refreshやmodel probeを実行していない。環境変数が未設定という過去観測は、全利用者の方式の証明ではない。

## Codex棚卸し

| 項目 | 既知の事実/仕様 | 未確認・後続の安全な確認 |
| --- | --- | --- |
| CLI/版 | 前run runtime `/usr/bin/codex` 0.159.2。main a46e4e43dのDockerfile既定も0.159.2。runner/cronのCodexコマンドはPATH解決 | 全container・対話CLIの実際のbinaryとversionを許可項目で照合 |
| UID/HOME/config | 前run UID/GID 1000、HOME `/home/boxp`、CODEX_HOME `/home/boxp/.codex` | workspace、runner、cron、外部端末ごとの実効値。独立stream導入後は別CODEX_HOMEを照合 |
| 供給元/優先順位 | file/keyring/auto/ephemeralとhost供給を区別する。CLIが選択した方式を正とする。保存ファイルの存在だけでsubscriptionと判定しない | config override、managed requirements、host token、custom providerを含む版固有の優先順位は未検証。`codex login status`の安全な抽出をfakeで確認後に採用。未解決はunknown |
| 許可方式 | 公式subscription loginのChatGPT-managed auth。公式内蔵refreshのみ | external-token hostやenterprise access tokenを今回の維持候補としない。API key環境変数/保存済みAPI key/custom provider keyの存在は値を表示せずpolicy拒否。自動削除しない |
| 保存/権限 | 前run候補 `$CODEX_HOME/auth.json` 存在、0660、UID/GID 1000。OS store利用可否は未確認 | fileを実際に選択しているか、親directory/ACL/symlink/書込権限。0660のgroup書込をownerが評価、今回chmodしない |
| 更新主体 | 公式CLIが利用時に更新する候補。管理者の公式loginは別操作 | last_refreshは更新時刻でありログイン有効期限ではない。固定日数から有効期限を捏造しない |
| 期限検出 | 版対応adapterが期限の種類と取得元を区別。access/JWT期限だけでログイン更新不能を判定しない | login/refresh可能期間の取得方法は未確定。読取り承認後にプロセス内抽出、なければunknown |
| 失効/更新拒否 | CLIが公式更新不能を示した場合はexpired-or-revoked、provider受付停止 | 401一回はrefresh後に回復し得る。401/権限拒否/ネットワーク/CLI失敗だけからrevokedを断定しない |

OpenAI公式の[Authentication](https://learn.chatgpt.com/docs/auth)を根拠に、subscription login・保存方式・内蔵更新を候補とする。[CI/CD auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth)の維持例は信頼されたprivate環境と直列streamを前提とし、public/open-source repoでは使わない制約がある。GitHubのread-only照会でboxp/archはPUBLICと確認したため、このrepoのworkflow向け維持jobに同例を適用しない。owner承認でも公式の適用制約を覆さない。他の適用可能なprivate運用を検討する場合も別設計・別承認とする。API key推奨は本票では採用不可。通常runからの更新と定期read-only診断は別物である。

## Claude Code棚卸し

| 項目 | 既知の事実/仕様 | 未確認・後続の安全な確認 |
| --- | --- | --- |
| CLI/版 | 前run Task Board `/usr/bin/claude` 2.1.284。main Dockerfileも2.1.284。main runnerはCODEX_TASK_BOARD_CLAUDE_BIN（既定claude）、cronはPATHのclaude | Deployment側固定設定、各container、対話HOME版を照合。image固定版へ統一する別実装案 |
| UID/HOME/config | 前run UID/GID 1000、HOME `/home/boxp`、CLAUDE_CONFIG_DIR未設定 | 各利用者の実効config directory。statusのconfigDirectoryを保存せず、承認済みdirectoryと一致するbooleanへ変換 |
| 供給元/優先順位 | 公式優先順位にはcloud/env bearer/env API key/helper/長期subscription token/profile/保存subscription loginがある。gateway選択は別に優先され得る | 版固有挙動・managed/user/project settings・profile/federationも調査。キー/helperは実行せず設定の存在だけ検出し拒否、方式不明はunknown |
| 許可方式 | 公式subscription login。setup-tokenはsubscription由来の固定長期tokenという別候補 | API key・Console login・cloud/gateway/profileからの代替は禁止。長期tokenの非対話自動更新は根拠未確認、期限時はowner公式再発行/再ログイン待ち |
| 保存/権限 | 前run `~/.claude/.credentials.json` 存在、0600、UID/GID 1000。Linuxはconfig directory内に保存 | 使用中のsourceと保存候補の一致、親directory/ACL/symlink、外部端末の同一session利用は未確認 |
| 更新主体 | 保存loginは公式CLI更新経路とownerの公式再ログイン。固定長期tokenは別扱い | refresh環境変数を独自に注入・利用しない。setup-tokenの実行は秘密値を端末に出すのでowner専用の別承認 |
| 期限検出 | 公式login期限警告と安全に抽出した期限。`claude auth status`は方式・ローカルログイン状態の候補 | access expiresAtとlogin expiryを混同しない。公式のschema/版差をfake検証。期限なしはunknown |
| 失効/更新拒否 | login expired/refresh拒否ならexpired-or-revoked。refresh lock競合は別reason | 同時refresh lock失敗はbounded retry対象で直ちにrevokedと断定しない。stdoutのみの失敗分類はBOXP-202担当 |

Claude公式[Authentication](https://code.claude.com/docs/en/authentication)で保存/供給順位と期限前警告を確認。[CLI reference](https://code.claude.com/docs/en/cli-reference)のstatus成功はローカル状態の根拠に限定する。[Error reference](https://code.claude.com/docs/en/errors#login-expired)を基にlogin失効と並列lockを分ける。`forceLoginMethod`だけで全経路のsubscription利用を保証したとみなさず、選択方式も検査する。

## Source・配備・並列利用

| 根拠 | 観測/照合と限界 |
| --- | --- |
| 提供arch HEAD e53ce4e8f | 旧CLI設定。現main a46e4e43dへcleanな専用ブランチだけfast-forward。調査結果はmain基準 |
| 前run配備sha-cee9e99 | ローカルcommit cee9e99117535cbffd5d21c8dddf60ed7c75698e。mainとのworkspace差分はDockerfileの版更新。本runではlive digestを再確認していない |
| 前runlive | generation 211、1 replica/Recreate、7/7 Ready、restart 0、home PVC Bound/RWO/50Gi。Readyはprovider認証の証明ではない |
| lolice deployment source | workspace / cron-scheduler / task-board-runnerが同じhome PVC。Pod再作成/image更新時も同じPVCをmountする設計。別PVC切替・削除時の継承は保証しない |
| arch entrypoint | 設定・skills配置はあるが、調査範囲でcredential seedの毎回コピーは未発見。インフラSecret参照とCLI認証供給源を混同しない |
| 未確認 | 全sidecar digest、過去Pod、credential作成経路、init/別jobのseed、外部machine利用、各processの実効環境。適用前にmetadata-only確認 |

**RWOと1 replicaはプロセス間排他ではない。** cronのjob別lock、Task Boardのticket/repo lockもprovider sessionの排他ではない。workspace対話CLI、cron、runner、委譲CLI、維持job、外部machineを同じ認証sessionの利用者として数える。

初期案は認証sessionごとの全利用者直列化。同sessionの全利用者が同じPVCの同一lock/stateを使う場合に限り、共有PVC内の安定したlock fileにflock等を取り、診断→実際の公式CLI利用→更新済みauth保存→終了まで保持する。refreshだけでなくrun全体を直列化し、CLIの子processも同じ所有期間に含める。待機は最大15分、起動せず延期し、Boardはrunner契約で処理する。lock fileを消して復旧せず、所有process終了とdrainを確認する。PVC filesystemのlockセマンティクスをfake/隔離canaryで検証する。別machineやwrapperを迂回する利用者が残れば安全な直列化とはみなさず導入停止。

外部の委譲CLIは同じsessionの親CLIが生きたまま起動しない。親がlockを保持して子の再取得を待つ形は禁止し、lock継承だけで親子のAPI並列利用を許す形も禁止する。同sessionの後続CLIは親をcheckpoint/終了しlock解放後に直列起動する。並行委譲が必要なら独立発行sessionを割り当てる。異providerも親の利用lockを持ちながら別provider lockを取得して子を待たない（入れ子取得禁止）。review gateは本作業CLI終了・lock解放後に実行する。公式CLI内部のsubagent機構と外部CLI委譲を区別し、内部並列を安全に制御できない維持streamは採用しない。

代替はownerが公式ログインで独立発行したsessionごとのCODEX_HOME/CLAUDE_CONFIG_DIR・保存領域。**同じrefresh tokenを別directoryへコピーしても独立sessionにならない。** 実効sourceを確認してから切り替える。Codexの更新ファイルは同じPVCへ残し、古いSecret seedで毎起動上書きしない。missingの場合も自動seed復元せずowner復旧にする。

## 認証sessionの共有状態と導入条件

lock・retry budget・hold・有効性根拠・通知dedupeの管理単位は、provider名やHOMEではなく**認証session**。ownerが非秘密の不透明な`session_ref`（ランダムUUID）を割り当て、providerと利用者の対応を管理する。出力/path構築ではUUID形式とowner台帳の登録を検証し、任意の入力文字列は採用しない。token/hash/fingerprint/account IDから生成しない。同じsessionを別HOME/config/PVCへコピーした場合も同じrefを使う。独立発行を確認できたsessionだけ別refにする。対応が不明な利用者はunknown/holdで、勝手に新refと新budgetを作らない。provider受付はrouteのsession状態を参照し、他providerには伝播させない。

正本は、同sessionの全利用者が到達する**共有・耐久ストア**のsession recordとする。retry counter/初回時刻/deadline、hold latch、owner再開epoch、validity evidence、sink別dedupe/再送予算をまとめて保持する。通常のhealthy/expiringの定期検査を再診断予算の消費にしない。session利用lock内の初回検査でunknownになった時点（検査crash/timeoutを含む）をattempt 1としてatomicにepisode開始を記録し、初回時刻からdeadlineを固定する。未完了の初回検査予約は次の利用者がunknown episodeとして回収し、なかったことにしない。episode中の利用者は再検査開始前にatomicにattemptを予約し、失敗・timeout・process crashもその一回に数える。予約後にcounterを戻さない。deadlineとepochを各利用者が初期化せず、ownerの明示再開だけが新epochを作る。定期診断/run preflight/cron/ticket/review/対話CLIが同じrecordを参照する。新HOME・新Pod・別PVC・別machine・別ticketでも予算やholdをリセットしない。

全利用者が同一PVC上で動く限定構成では、owner指定の共通絶対path（候補 `/home/boxp/.codex-workspace/auth-health/sessions/{session_ref}.json`）を正本にできる。`$HOME`から利用者ごとに解決しない。0600・親0700、同一UIDまたは承認済みアクセス方式、安定したsession lockとatomic replaceで更新し、filesystemの排他/耐久性を検証する。ローカルHOMEのcacheは表示専用で受付判断に使わない。

別machine/別PVCも同sessionを利用する構成で、このPVCのlock/stateを共有できなければローカルfile方式は採用不可。別途承認する共有controller/storeが、session単位の排他lease・fencing、transaction/CASによる予算予約、耐久hold/dedupe、時計/deadlineと障害回復を保証する必要がある。CLI利用中も同じ排他domainでlockを保持し、lease喪失時は新requestを止めてdrainする。stale cache/local lockへのfallback、ネットワーク分断時の両側実行は禁止。

**enforcement導入条件**はownerが同sessionの全利用者を列挙し、lockと状態の共有範囲が一致し、全起動経路が迂回せず参加することをfake/隔離canaryで証明すること。到達不能な利用者、未管理の外部machine、wrapper迂回、session対応不明が一つでも残る場合、そのsessionにはenforcementを導入せずread-only shadowまでに留める。先に利用者を停止/drainするか、ownerが独立sessionを発行し、再確認する。導入後のstore到達不能/破損/書込不能/lease喪失はunknown/holdとして新規本作業と再診断予約を停止し、ローカルの新予算を作らない。状態喪失も新規初期化で復旧せずowner待ちにする。

## 診断契約

診断はprovider別。定期1時間と各run開始前に実施する初期案。初期shadowはread-only、既存本作業をgateしない。enforcement採用後はlock内で開始前診断を取り直す（定期cacheだけで通さない）。credential読取り・status/有効性確認が未承認ならunknownを返す。期限を読む実装も秘密値を保持するプロセス内だけで処理し、外部の自作endpointへ送信しない。

| 状態 | 必要な根拠 | enforcement時の新規本作業 |
| --- | --- | --- |
| healthy | subscription方式確認、既知のlogin/長期token期限が72h超、現在の有効性の承認済み根拠があり、更新不能/競合/不明なし | 許可 |
| expiring | healthyと同じ根拠があり、既知のlogin/長期token期限まで0超〜72h。24h以下を別通知band | 通知し許可、期限時に停止 |
| expired-or-revoked | login/固定tokenの確定期限経過、または公式CLIが更新不能/失効を確定 | 該当providerだけ停止 |
| missing | 許可された認証sourceが存在しないと確定（単一候補file不在だけでkeyring等を無視しない） | 該当providerだけ停止 |
| unknown | 期限情報なし/未取得、形式/schema/権限/時計/CLI非対応、ネットワーク、方式不明、lock競合、未承認の検査、期限と有効性の証拠不一致 | bounded再診断後owner待ち。待機中も本作業を開始しない |

状態とは別に`admission=allow|hold`を返す。禁止方式/環境変数/helper/custom providerは`unknown + hold + policy-disallowed`とし、retryせずowner修正待ち。値を消して別認証へ自動fallbackしない。他providerの診断・受付は独立させる。

`status` exit 0、access tokenの未来期限、JWT exp、ファイルmtime、Pod ReadyだけをAPI有効性の証明にしない。`validity=confirmed|unverified`は別項目。confirmedは承認された公式CLI canary/通常runの成功から得る短期証拠（初期TTL 1時間、future timestampはunknown）。期限情報なしはconfirmedでもunknown。local metadataだけの初期shadowではhealthyを出せない場合があることを許容する。恒常unknownを避けるために自動probeを追加しない。

access期限経過だけではexpiredにしない。公式内蔵refreshの余地があるがrefresh可能期間/成功根拠がなければunknownで停止。明示承認を受けた更新確認だけ実施可。独自refresh・無意味な定期model request・public repo向け維持例の転用は不可。

unknown再診断は最初の検査を含め最大3回、初回から15分以内（例0分/5分/10分、各検査timeout 30秒）。ネットワーク/429/5xx/lockを含む。認証sessionの共有耐久recordでcounter/deadlineを全利用者が共有し（上記のatomic予約）、cronの次回・Pod再作成・新ticketでbudgetをリセットしない。unknown episode開始後は診断がhealthyに戻ってもholdを自動解除せず、owner再開まで同じbudgetを保持する。15分経過か3回で再診断を停止しowner待ち。形式/権限/非対応/禁止方式は最初からowner待ち。認証失敗をPR gate retryやidle retryに渡して再起動しない。

## 出力・通知・進行中run

出力は自由文をredactするのでなく**許可項目から再生成**する。共通schemaはprovider(enum)、session_ref(owner割当の非秘密ref)、method(enum subscription-login/subscription-long-token/unconfirmed)、cli_version(数値版だけ)、checked_at(UTC)、state(enum)、admission、reason(enum)、expiry_kind(login/long-token/access/unknown)、expiry_known(boolean)、expiry_at(検証済みUTC/null)、validity、evidence_at、attempt_count、retry_deadline、notification_band(72h/24h/expired/none)のみ。未知fieldは捨てる。値の不正も固定reasonへ変換し、入力文字列を例外に埋め込まない。

初期reasonは`expiry-unknown`、`login-expired`、`refresh-rejected`、`credential-missing`、`permission-denied`、`schema-unsupported`、`cli-unsupported`、`network-unverified`、`refresh-contention`、`clock-unverified`、`policy-disallowed`、`inspection-unapproved`、`session-unmapped`、`state-unavailable`、`lease-lost`、`internal-error`。path/email/org/account ID/生stderr/stdout/credential本文/token/refresh token/API key/cookie/認証URLは出さない。CLI subprocessのstdout/stderrはboundedなメモリpipeで受け、tee/tempfile/log保存をしない。shell tracingを無効にしcore dumpも抑止。B統合では認証起動診断のstdout/stderrを既存events.jsonl/stderr.log/last-messageへ書く前にメモリ内で分類し、認証失敗出力は固定schemaに置き換える。認証診断を既存生ログ経路へ流したままenforcementを有効にしない。後続はBOXP-202の安全分類を再利用し、そのAPIが未完成なら統合を待つ。

状態の正本は上記session共有ストア。schema出力とcontroller情報だけを保存し、credential fingerprint/hashも保存しない。shadowのローカル出力は観測用で、全利用者の予算/holdを共有できた証拠にはしない。書込不能/壊れたstateはunknown/hold、過去healthyを信頼しない。TTL切れはhold。記録と通知のlockは短く、長いsession利用lockと同じ順序で取りdeadlockを防ぐ。

既知login/長期token期限72h/24h前と確定失効/状態変化をローカル状態・対象ticket Notesへ通知する初期案。同じsession_ref/owner再開epoch/provider/state/reason/expiry_kind/期限/band/sinkをdedupe keyとし、一度だけ出す。初回観測が24h以下なら24h通知一件、過去72h通知を追送しない。定期診断は固定owner向けローカル状態へ、runのholdは該当Notesへhelperで一度追記。dedupeは正本でatomic予約し、別HOME/別machineの通知もまとめる。sink失敗/送信後crashでは厳密な一回配送を保証できないため、sinkのidempotency対応を確認し、非対応なら不確定送信をowner確認待ちにして自動再送しない。再起動後もdedupeを保持し、sink失敗は成功扱いにせず有界再送、失敗で本作業を再起動しない。外部通知はboxpが経路・内容・頻度を別承認するまで無効。

進行中runは期限接近だけで強制killしない。確定失効/失効疑いを受けた場合は新しいprovider request/委譲開始を止め、既に返ったローカル成果をcheckpointしてdrainする。制御できないCLIは既存runner停止機構で上限付き終了（初期grace 60秒、process group終了を確認）し、部分成果と固定reasonだけ記録する。認証変更は全利用者drain後。認証エラーでの無限retry、他providerへの自動route切替、課金方式切替は禁止。実装はrunnerの終了/lock/finally経路へ統合し、helper/診断からBoardを直接動かさない。再開はownerの公式再ログイン、方式/保存/有効性の確認、承認済みcanary成功、明示再開指示をすべて満たした時だけ（自動healthy復帰だけではhold解除しない）。
