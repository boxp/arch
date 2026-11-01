# BOXP-360 案 A 第 1 段階: 生成元 metadata ledger + 既存 Prometheus

2026-10-29 に Owner が案 A の本番反映を承認した。承認範囲は、本文なしの allowlist metadata の収集、通常の review/CI/merge と配備、Hermes の再起動 1 回まで。新しい secret・課金・外部送信・Langfuse・生の本文の収集は承認範囲に含まない。

## 構成

| 生成元 | 出力 (PVC 上) | Prometheus | 変更先 |
|---|---|---|---|
| Task Board runner (`task_board_runner.bb` から `ai_ops_ledger.bb` を遅延 load) | `~/.codex-task-board/ai-ops/ledger/events-YYYY-MM-DD.jsonl`、`ledger-stats.edn`、`metrics.prom` | `ai-ops-metrics` sidecar (:9464, read-only) → ServiceMonitor `codex-workspace-ai-ops-metrics` | arch (runner)、lolice `argoproj/codex-workspace` |
| Hermes (`plugins/boxp-ai-ops-observer`、既存 kohako-g2-context と同じく bootstrap で配置・有効化) | `/opt/data/ai-ops/ledger/events-*.jsonl`、`metrics.prom`、`salt` | `ai-ops-metrics` sidecar (:9464、PVC の `ai-ops` subPath だけを read-only で mount) → ServiceMonitor `hermes-agent-ai-ops-metrics` | lolice `argoproj/hermes-agent` |

- 共通 schema は `ai-ops-event/v0`。`tools/ai_ops_sli.bb aggregate` に両方の ledger と既存 metadata の extract をそのまま渡して join できる。Hermes の会話は `conv-` 形式の opaque ID (local salt の SHA-256) を task/request に使う。ticket の無い会話にも ticket の起票を求めずに request_id が付く。
- runner ledger の event_id は `:ledger:<word>` を含み、extract/outbox と同じ run の同じ事実 (run.started/finished/interrupted・correction・同じ lane_from/lane_to の lane.changed) を別 ID で持つ。aggregate はこの論理 key が一致する ledger event を除外して非 ledger 側を正とし、除外件数を `input.ledger-merged` / `ai_ops_ledger_merged_events_total` で出す (両入力の join で run/retry/是正が二重計上されない)。ledger にしかない事実はそのまま数える。correction は run_id ではなく「どの run の review gate 失敗か」で照合する (ledger はその run 自身の gate 失敗、extract の derived 是正は review-fix run 開始時に導出され原因は evidence の直前 run `:finished`)。同じ run に両方あっても別の gate 失敗なら両方数え、原因 run を特定できない是正は統合しない。
- runner は開始時に card を実際に Ready/Review/Blocked から In Progress へ移した場合、`run.started` に加えて `lane.changed` (`:ledger:lane-start`) も記録する。
- Prometheus の label は enum 値 (event_type / reason / runtime / status / gate / origin / class) だけに限る。ticket・run・session の ID は ledger 側に置く。
- 観測の失敗で業務を止めない。runner はすべての呼び出しを try で包む。Hermes は callback で bounded queue (1000) に `put_nowait` するだけにし、書き込みは daemon worker が行う。queue 溢れ、日次 file の上限 (8 MiB)、privacy による拒否、書き込みエラーはすべて件数として metrics に出す。retention は 90 日。
- sidecar の `/metrics` は、file が無い・古い場合を `ai_ops_metrics_file_present` / `ai_ops_metrics_file_age_seconds` で示す。scrape の受領だけで「収集できている」とは扱わない。

## 何を取るか (v1)

runner (`definition_version=ledger/v1`)
- `run.started`: `lane_from` を持つ。`ready` は Ready からの受領 (ack) 時刻を表す。
- `correction`: review gate の失敗。classifier=rule、暫定分類。ci / codex-review は agent-system・high。mergeability / conflict / pr-url は agent-system・medium。それ以外は unknown・low。
- `run.finished`: status succeeded / retrying / blocked / superseded、result、exit_code、idle_timeout。
- `lane.changed`: runner が実際に lane を動かしたときだけ出す。
- `run.interrupted`: 計画停止。
- 加えて gate の pass/fail を件数で数える。

Hermes (`definition_version=hermes-observer/v1`)
- turn: `pre_llm_call` で 1 turn に 1 回 `run.started`、`on_session_end` で `run.finished` (succeeded / failed / interrupted) を出す。
- 承認: `pre_approval_request` → `approval.requested`、`post_approval_response` → `approval.resolved`。`approval_key` は pattern key の salted hash で、同じ承認の再要求 (重複承認率) を数えるのに使う。
- `api_request_error` は件数だけを数える。
- callback は必要な metadata 引数だけを宣言する。`**kwargs` は使わない。配備版の dispatcher (`hermes_cli/plugins_dispatch.py` `_hook_callback_kwargs`) は宣言された名前の引数だけを渡すことを確認済みなので、本文・履歴・command・tool args は plugin に渡らない。

## 既知の限界 (coverage は別に報告する)

- Ready に入った時刻は runner が観測しない。Ready→ack の遅延を出すには、board-diff 由来の Ready 遷移時刻との join が要る (次段階)。
- Hermes の承認 hook は `session_key` だけを持ち、turn hook は `session_id` を持つ。そのため承認と turn は同じ task に join されない。同じ承認の重複は session_key の中で数える。
- Hermes の `approval.resolved` の choice (許可/拒否) はまだ取らない。Owner 救援 (催促) は metadata だけでは判定できないので、引き続き unknown とする。
- Hermes の counter は plugin を起動してからの値で、再起動すると 0 に戻る (Prometheus は counter reset として扱う)。複数の Hermes process が plugin を load した場合、`metrics.prom` を書くのは `metrics.lock` を flock で取得した 1 process だけになる。ledger にはすべての process が追記し、PVC 上に永続する。
- ledger の SLI を Prometheus に出す処理 (ledger + extract の aggregate を定期実行する) は、2〜4 週の baseline 収集と並行して次段階で行う。第 1 段階で Prometheus に出すのは、生成元の counter と収集の健全性。

## 配備と確認

1. arch PR (runner) を merge する → codex-workspace image を build → image updater が反映する (codex-workspace pod が再起動する。runner は計画停止の経路を通る)。
2. lolice PR を merge する → Argo CD が同期する。hermes-agent pod は ConfigMap の hash が変わるので 1 回だけ再起動する (Recreate)。codex-workspace pod も sidecar の追加で再起動する。
3. readback で次を確認する。
   - 実 run 後に ledger の行と `ledger-stats.edn` が更新されている。
   - Hermes の turn 後に `/opt/data/ai-ops/ledger` に行がある。
   - Prometheus の `up{job=~".*ai-ops-metrics"}`、`ai_ops_ledger_events_total`、`ai_ops_hermes_events_total` が query で取れる。
   - `ai_ops_metrics_file_age_seconds` が小さい。
   - aggregate で runner/Hermes の ledger と extract が join できる。

Hermes の plugin API は配備版を read-only で調べた (`hermes-plugin-investigation.md`)。

## review gate 指摘への対応 (2026-10-29 07:20 UTC)

- runner の `loop` と手動 `tick` など、別 process が同じ root に書くことがある。`ledger-stats.edn` の read-modify-write と固定名の一時ファイルが衝突し、count が失われていた (旧実装では 4 process × 25 件で emitted 24/100、write-errors 5)。`<root>/ai-ops/ledger.lock` の FileLock (プロセス内は `locking` と併用) で ledger 追記・stats 更新・metrics 書き出しを直列化する。一時ファイル名には pid と thread id を付ける。4 process を同時に動かす test を追加した。
- `TASK_BOARD_REVIEW_PR: none`、または merge 済み PR しかない場合は、gate が何も確認していない。この場合 `ai_ops_review_gate_total{gate="all"}` に `result="skip"` として数え、`pass` には混ぜない。
- gate が失敗した場合も `ai_ops_review_gate_total{gate="all",result="fail"}` に数え、全体の失敗率の分母から失敗が抜けないようにする。
- 個別 gate（`pr-url` / `mergeability` / `conflict` / `ci` / `codex-review`）は失敗時だけでなく、評価した結果を `pass` / `fail` / `skip` 別に数える。gate 別の失敗率を算出するとき、分母から成功が抜けて失敗が過大に見えないようにするため。CI 不要 repo の CI と merge 済み PR の各 gate は `skip` とする。
- gate 失敗による是正の暫定分類: CI check の失敗と codex review の指摘は `agent-system` (confidence high)、merge 状態の失敗と PR URL の欠落は `agent-system` (medium) とする。CI 待ちのタイムアウト、codex review コマンドの異常終了、gate API エラー、種別の分からない失敗は、成果物の欠陥が確認されていないため `unknown` (low) とする。

## review gate 指摘への対応 (2026-10-29 08:20 UTC)

- ledger の correction と extract の derived 是正を統合するとき、発生時刻 (`occurred_at` / `occurred_precision`) は ledger 側を正とする。ledger 側の時刻は実際に gate が失敗した時刻である。derived 側の時刻は次の review-fix run の開始時刻なので、間に受入があると受入前の失敗が受入後の是正として数えられてしまう。ledger 側に有効な時刻が無い場合だけ derived 側の時刻を残す。ID と evidence は従来どおり derived 側を残す。
- lock 待ちのタイムアウトで stats に書けなかった write error は、`<root>/ai-ops/pending-write-errors/` に件数 1 件につき空の marker file を 1 つ作って記録する。一意な名前の file を作るだけなので lock は要らない。手動 `tick` のような短命な process が flush せずに終了しても、件数は失われない。次に lock を取った process (どの process でもよい) が emit / write-metrics の際に stats へ合算し、marker を消す。marker を作れなかった場合は、従来どおり process 内の counter に残す。

## review gate 指摘への対応 (2026-10-29 08:40 UTC)

- ledger が容量超過や書き込み失敗で event を書けなかったとき、日次 file に本文・ID の無い marker 行 `{"collection_lost":"ledger_dropped"}` を追記する。これまでは `ledger-stats.edn` の counter だけが増え、ledger を集計する `ai_ops_sli.bb` からは欠落が見えなかった。そのため、是正などが失われても是正率や first acceptance を確定値として出してしまっていた。
- `ai_ops_sli.bb` は `ledger_dropped` を collector の drop と同じ種別不明の欠落として数える (`coverage.collection-lost.ledger-dropped`、`ai_ops_collection_lost_events_total{reason="ledger_dropped"}`)。1 件以上あれば、是正率、first acceptance、zero-tolerance 指標を unknown にする。
- marker は容量上限を超えても書くが、超過は上限 + 64KiB までに抑える。日次 file の欠落を unknown にするには marker が 1 行あれば足りる。正確な件数は従来どおり stats と metrics に出す。marker 自体を書けない障害の場合、欠落は metrics (`ai_ops_ledger_lost_events_total`) にだけ残る。この制約は既知のものとして扱う。
- flush 中に欠落 marker の追記に失敗した場合、これまでは spool を削除し、再試行情報をプロセス内の atom にだけ残していた。そのため、短命な `tick` が終了すると marker が作られないままになっていた。現在は、損失日ごとの義務ファイル `<root>/ai-ops/pending-lost-markers/<date>` を残してから spool を削除する。以後の lock 保持者が flush するたびに追記を再試行し、書けた時点で義務ファイルを削除する。件数 (`write-errors`) は従来どおり 1 回だけ数える。
- CI が失敗しても mergeability が pass していた場合は、`:gate-results` に `["mergeability" "pass"] ["ci" "fail"]` を残す。CI 待ちタイムアウトでも同様に扱う。これまでは失敗した gate だけが計上され、mergeability の pass が分母から抜けていた。
- `emit!` の容量超過時や書き込み失敗時にも、欠落 marker の追記に失敗したら同じ義務ファイル `pending-lost-markers/<date>` を残す (`mark-lost!`)。これまでは、marker の追記だけが一時的に失敗し、その後の stats 更新が成功すると再試行の情報が残らなかった。その結果、復旧後も集計側が欠落を検知できず、SLI を確定値として出していた。headroom を使い切った file は既に marker を含むため、追記済みとして扱う (義務ファイルが永久に残らないようにする)。
- runner は run 完了時に `lane.changed` (`lane_to: "done"`) を出すが、`task-outcome` は done への lane 遷移を状態判定に含めていなかった。そのため ledger 単独で Ready → In Progress → Done を集計すると最後の Done が無視され in-flight になっていた。done 遷移も時刻付き状態遷移として扱い outcome=accepted とする (現在状態 snapshot は従来どおり優先、done 後の再 open/lane 遷移は未完了に戻る)。first acceptance は受入履歴 (`task.accepted`) を基準とするため、lane の done だけでは受入時刻を持たず合格扱いにはしない。
- codex-review指摘(P2): Backlogから開始したgroom/docs-groom runは開始時にIn Progressへ移らないため、終了時lane.changedのlane_fromを実際のlane(`ai-ops-run-lane`: Ready/Review/Blocked→in-progress、それ以外は開始時lane)で記録する。run.startedのlane_toも同様。回帰test `test_ai_ops_ledger_groom_from_backlog_records_actual_lane`。
- codex-review指摘対応: 単発 `tick` 実行後にも `metrics.prom` を更新する（従来は `loop` のpoll毎のみ）。`claude-opus-5-5` 等のバージョン付きClaude model IDは基本担当名（`claude-opus`）へ正規化し、agentを欠落させない（reasoning suffix付きも同様）。

#### SLI の Prometheus 公開

runner は vault 設定時、既定 900 秒ごとに全履歴の SLI を再集計し、既存 `ai-ops/metrics.prom` に追記する。`CODEX_TASK_BOARD_AI_OPS_SLI_INTERVAL_SECONDS=0` で停止でき、タイムアウトは `CODEX_TASK_BOARD_AI_OPS_SLI_TIMEOUT_SECONDS`（既定 120 秒）。`ai_ops_sli_determinable` / `ai_ops_sli_source_connected` と分子・分母で unknown を区別し、`ai_ops_sli_export_*` で更新状態を確認する。SLI 値はスナップショットなので `rate()` / `increase()` を適用しない。

集計入力は extract の出力に runner ledger の日次 file (`ai-ops/ledger/events-*.jsonl`) を連結したもの。review gate の是正や `ledger_dropped` 欠落 marker は ledger にしか無いため、これを含めないと欠落があっても SLI を確定値として公開してしまう。ledger と extract が同じ事実を出す場合は `merge-ledger-events` で非 ledger 側に統合する。追記途中の末尾行 (改行なし) は読み込まない。再集計は runner の poll loop を止めないよう別 thread (`refresh-sli-async!`) で実行し、同時に 1 つしか走らせない。

#### 公開 SLI の v1 系列と unknown の理由 (2026-10-31)

Owner の指摘「dashboard の unknown が多すぎる」への対応。`refresh-sli!` は v0 の `prom` 出力が成功した後に `ai_ops_insight.bb prom <root>` (correction-rules/v1、runs/ の summary.edn のみ・vault は読まない) を呼び、`ai_ops_v1_*` 系列を sli.prom に連結する。v1 側の失敗・タイムアウト・容量超過は `ai_ops_v1_export_ok 0` として出し、v0 の出力は止めない。 容量は実際に追記するバイト数で判定し、`export_ok 0` の行すら入らなければ何も追記しない (v0 を上限超えにしない)。読めない run を持つ task は v1 の全集計から除外し `ai_ops_v1_snapshot{part="unevaluated_tasks"}` に件数だけ出す。v1 は内部 gate 再作業 (`gate_rework`、Owner に届く前) と Owner に見える是正 (`owner_visible`、succeeded した review-fix run または Review 後の再開) を別系列にし、v0 (`ai_ops_correction_tasks`) は比較用に残す。review 反復ループ・gate 別の再作業・Review 停滞 (p50/p90/24h 超) も件数のみで出し、ticket ID は label に出さない。

unknown は `ai_ops_sli_unknown_info{sli,category,reason_code}` で 4 分類 (未接続 / 履歴欠損 / 分類不能 / 対象外) に分け、`ai_ops_sli_unknown_detail{sli,detail}` に件数 (拒否 event・読めない run・欠落 marker 等) を出す。分類は aggregate* の理由文と欠落の内訳 key から決め、確定している SLI には出さない。unknown を 0 や成功へ置き換えない。dashboard 側 (lolice `ai-ops-quality`) は測れる指標を先頭に、未計測の指標と理由の表を末尾に置く。

## Hermes ledger の SLI 入力 join (2026-11-01、claude-fable)

- 経路: runner (`ai_ops_ledger.bb`) が SLI 再集計のたびに `CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_COMMAND` (lolice の codex-workspace Deployment で `kubectl exec -n hermes-agent deploy/hermes-agent -c hermes-agent -- sh -c 'cat /opt/data/ai-ops/ledger/events-*.jsonl'`) を上限付き (30 秒 / 8 MiB) で実行し、`ai-ops/hermes-ledger/snapshot.jsonl` を置き換えて集計入力へ連結する。pull 方式にしたのは、Hermes 側 sidecar の HTTP を開けると NetworkPolicy の緩和 (新しい到達経路) が要るのに対し、codex-workspace の ServiceAccount は hermes-agent namespace の Role `codex-workspace-debug` (pods/exec) を既に持っているため。Hermes 側の変更・再起動はない。
- 取り込むのは Hermes plugin が生成元で allowlist 済みの metadata (本文なし、`conv-` opaque ID)。runner 側の snapshot は同じ内容の複製で、集計側 privacy gate をもう一度通る。
- 失敗時: 前回 snapshot + `{"source_stale":"hermes-observer"}` marker → `hermes_conversation` は `partial/stale` (connected=0, partial=1)。runner は止めない。 初回の取り込み失敗 (前回 snapshot 無し) でも stale marker だけを入力に付け、重複承認率を他 source の承認で確定しない (`hermes_conversation` は `missing/stale`、理由 `stale_source_snapshot`)。mirror の失敗回数・stale・snapshot 行数は metrics.prom に出る。
- 会話と task の関係: turn だけの会話 (event が `run.*` / `approval.*` のみ) は ticket と join できない (ID 設計上)。request_id 単位のまま保持する (ticket の起票は求めない) が、Board の task 集計 (総数・outcome・層別・未完了 guardrail・救援率の分母・run 数・委譲数) には混ぜず、会話数/turn 数/承認 event 数を別掲する。snapshot には集計側と同じ allowlist の key だけを保存し、取り込みはメモリ内で上限バイト数まで読んで超えたら止める。会話を join しても v0 の SLI (是正率・first acceptance・zero-tolerance・lead time) と v1 (runs/ 由来) は変わらないことを live データで確認した (unknown の理由表から「Hermes ledger join 未接続」が消え 10→9)。
- 2026-11-01 追記 (Codex review 2 回目の指摘 3 件): (1) snapshot 保存前に集計側と同じ値形式検証を適用し、形式外の値は redact・ID 形式外の event は本文なし `privacy_rejected` marker に置換する (長さだけの検証では 256 文字以下の本文・秘密値が永続 snapshot に残り得た)。(2) 取り込みは SLI deadline から後続 `prom`/v1 の予約 (`..._RESERVE_SECONDS`、既定 45 秒) を引いた時刻までしか待たず、残り時間が無ければ実行せず前回 snapshot で続ける (extract が時間を使った後に mirror が deadline まで待つと prom を実行できず SLI 更新全体が失敗していた)。(3) 有効な hermes-observer event が 0 件の出力 (途中行だけ・他 source だけ・全行破損/拒否) は成功とせず前回 snapshot を保持する (空で置き換わり stale にもならなかった)。回帰 test は ai-ops-ledger-test (値形式 redact/拒否 marker と集計側 gate での再 redact 0 件、no_events 4 ケース、no_time・予約超過の打ち切り、遅い mirror でも refresh-sli! が成功)。
- 2026-11-01 追記 (Codex review 3 回目の指摘 2 件): (1) mirror が失敗して前回 snapshot を使っている (stale) 間は、承認 event の source (Hermes) で失敗中に起きた承認が入力に無いため、重複承認率を確定値にせず unknown (`stale_source_snapshot`、観測値は下限、coverage `partial/stale`) にする。観測済み承認 0 件でも承認だった可能性のある欠落があれば「未接続」でなく欠落として報告する。(2) `no_events` で失敗した取り込みが検出した拒否・破損 marker は `failed-pull-markers.jsonl` に残し、次の成功まで集計入力へ付ける (全行の ID が不正になった場合に拒否 event が集計へ渡らず、是正・zero-tolerance・承認 SLI が確定したままになっていた)。metrics `ai_ops_hermes_mirror_failed_pull_marker_lines`。回帰 test: tools/test.sh (stale + 承認で unknown、失敗中に重複が増えても確定値へ戻らない)、ai-ops-ledger-test (全行 approval.requested で ID 不正 → marker 2 件が入力に付き集計で unknown、途中行だけなら marker を保持、成功で削除)。
- 2026-11-01 追記 (Codex review 5 回目の指摘 2 件): (1) 取り込み出力の末尾が改行のない途中行 (書き込み中の event) だった場合、その行を落とした snapshot は最新の完全な行で置き換えるが、取り込みは `partial` (`:last-result "partial"`、`:truncated-tail-lines 1`、`:partial-pulls` 加算) として記録し `mirror-hermes-ledger!` は false を返す。stale と同じく集計入力に `source_stale` marker を付けるため、末尾が書き込み途中の `approval.requested` でも承認を欠いた snapshot で重複承認率を確定しない (次の完全な取り込みで解消)。metrics `ai_ops_hermes_mirror_partial_pulls_total`、`_snapshot_lines{kind="truncated_tail"}`、`ai_ops_hermes_mirror_stale` は partial でも 1。(2) 集計側の会話判定 `turn-only?` は `event_type` が欠落/redact (mirror の gate が enum 外を置換) の event を「turn 以外」と見なさない。同じ会話に有効な `run.started` があっても Board task に昇格させず (task 総数・run 数・救援率の分母を変えない)、件数を `coverage.hermes-conversation.unverifiable-event-types` / `ai_ops_hermes_conversation_events{kind="unverifiable_type"}` に別掲する。種別不明 event は従来どおり全体の `unverifiable-event-types` / `lost-events` として zero-tolerance・是正・救援 SLI を unknown にする (黙って捨てない)。回帰 test: ai-ops-ledger-test (途中行で partial・stale marker・集計で重複承認率 unknown・完全な取り込みで解消)、tools/test.sh (種別不明 event を含む会話の分離と coverage 別掲)。旧実装で失敗を確認。live の Hermes ledger (343 行) は末尾改行あり・種別不明 0 件で集計値は不変。
- 残る限界: Hermes の承認 hook は `session_key` だけを持つため承認と turn は同じ会話に join されない (件数の別掲まで)。Owner 救援・同承認再要求は metadata では判定できず unknown のまま。これらに新しい収集内容が要る場合は Owner に一点ずつ相談する。
