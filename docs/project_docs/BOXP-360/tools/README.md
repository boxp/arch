# ai_ops_sli.bb (BOXP-360 pilot)

```sh
# 既存 Task Board metadata -> 共通 event (summary.edn / delegation.json kind / outbox / ticket frontmatter のみ読む)
bb ai_ops_sli.bb extract ~/.codex-task-board "$CODEX_TASK_BOARD_VAULT" > /tmp/events.jsonl
bb ai_ops_sli.bb aggregate /tmp/events.jsonl   # SLI/guardrail/coverage (EDN)
bb ai_ops_sli.bb prom /tmp/events.jsonl        # 低 cardinality Prometheus exposition (SLI が unknown のときは率の部品を出さず ai_ops_sli_determinable=0)
# 生成元 bounded buffer + privacy gate + collector 停止 (index 10..20) の模擬
bb ai_ops_sli.bb emit-sim --synthetic fixtures/synthetic-events.jsonl 4 10 20 > /tmp/collected.jsonl
./test.sh                                      # 合成 E2E と回帰 check
```

pilot 用であり runner / Hermes には未接続。extract と emit-sim は allowlist key のみ出力し、不正な値を redact し、不正な event_id の event は拒否する。stderr の privacy-redacted-values / privacy-rejected で件数を確認できる。aggregate は入力を再検証し、追加の拒否件数を coverage.privacy-rejected-invalid-id に記録する。coverage.connected の ID は `cov-<source>-<8桁の16進数>` の形式を使い、宣言ごとに一意にする。短い識別子以外の文字列は保持しない。

zero-tolerance は対応する effect.applied / 許可された severity 付き event または coverage.connected event（coverage_target に duplicate-effects / critical-safety-events）を観測した場合にのみ件数を報告し、それ以外は unknown。Prom 出力は zero-tolerance メトリクスを公開しない。first acceptance は最初の受入以前（同時刻を含む）の agent 起因または原因不明の是正を対象とし、その時刻不明は不合格として扱う。人による再分類は元の是正の時刻と ID を保持する。

privacy gate は key ごとの許可値・ID・時刻・型を検証し、認証情報や長い英数字列も redact する。未実行の request も task 総数、outcome、未完了と Owner rescue の分母に含め、never-run を別掲する。review 到達を対象とする SLI の分母は変えない。

受入履歴の網羅性は `coverage.connected` の `acceptance-history` がなければ reopen-after-accept を unknown とする。closed が残る未完了 ticket は受入と再オープンの証拠として抽出する。duplicate-effects は effect 観測時または coverage 接続時に全 task の effect_key を横断して余分な適用数と関与 task 数を数え、宣言がない場合は coverage を partial/undeclared とし、承認も approval_key ごとに横断集計し、重複承認率は有効な approval_key 付き承認イベントの余分な件数を全承認イベント数で割る。

run 履歴の無い受入済み ticket（accepted-without-run-history、受入後に再オープン中のものを含む）は是正有無を観測できないため、first acceptance / 是正率の分母に入れず別掲する（合格扱いしない）。run 履歴があっても有効な受入時刻がない受入済み task は first acceptance の分子・分母から除き、`accepted-without-acceptance-time` として全体と層別に別掲する。受入時刻が日粒度 (`occurred_precision=day`) の場合は当日内の前後を確定できないため、同日の是正がある task を `acceptance-day-ambiguous` として分子・分母から除き別掲する（日粒度受入と同日の時刻付き受入が混在する場合も、時刻付き受入を最初の受入と確定せず両者の間の是正を前後不明とする）。summary.edn は使用 field の型も検証し、不正型は欠落入力 (`run.unreadable`) として扱う。原因 unknown の是正を含む task は agent-system の是正も含む場合でも unknown として数える。reopen-after-accept は受入履歴 source 接続時のみ、現在の状態にかかわらず受入イベントがある全 task を分母に計上する。

合成データの短い ID を許可するには、`emit-sim`、`aggregate`、`prom` のコマンド直後に `--synthetic` を指定する。入力の `synthetic` フィールドだけでは ID 制約は緩和されず、`extract` は常に厳格に検証する。
受入後の最新イベントが `task.reopened` の場合は未完了（in-flight）とし、同時刻の受入より再オープンを優先する。

通常モードの ID は `ai_ops_sli.bb` の `prod-*-re` で定義した生成元ごとの固定パターンに限定し、自由形式の英数字は許可しない（短い秘密値が token denylist をすり抜けるのを防ぐため）。最大128文字で token パターンは禁止する。

- `event_id` / `parent_event_id` / `evidence_event_ids`: (a) ticket 形式 `<大文字>-<数字>` に `/` `:` `-` 区切りの segment を0〜4個、(b) `cov-(acceptance|effects|safety|hermes|approvals)-<8桁16進>`、(c) 会話 ID (`req-` / `conv-` + 16進8桁、続けて `-` + 16進4桁を0〜3個、任意で `-` + 16進12桁) に `/` `:` 区切りの segment を0〜3個。segment は run_id、固定語彙 (`id-words`、末尾に数字0〜3桁可)、16進8〜16桁、数字1〜6桁、英小文字1字+数字0〜3桁のいずれか。
- `task_id`: ticket 形式または会話 ID。`request_id`: `req:<ticket形式>` または会話 ID。`run_id`: `YYYYMMDDTHHMMSSZ` + 任意で `-<UUID>` か `-<16進1〜8桁>` + 任意で `-groom`。`effect_key` / `approval_key`: `(op|pr|merge|deploy|notify|lane|approval|effect):<16進8〜16桁>`。
- 許可例: `BOXP-1:started`、`BOXP-360/20261029T051836Z-1b92f7db-efb5-4eb3-82b5-6de5c60183fa/fin`、`cov-effects-12345678`、`req-abcdef01`、`conv-0123abcd/accepted`、`conv-abcdef01/event:1`
- 拒否例: `conv-short`、`conv-ABCDEFGH`、`conv-passwordhunter2`、`BOXP-1:password-hunter2`、`cov-password-12345678`、`req-abcdef01/sk-secretvalue`

これらの例は `test.sh` で privacy gate の判定と一致することを検証している。

状態は時刻付き遷移を時刻順に評価し、抽出時の現在状態を示す `snapshot=current` は履歴より優先し、その他の時刻なし snapshot は時刻付き状態 event が存在しない場合に限り使用する。時刻不明の agent 起因または原因不明の是正は first acceptance を不合格とする。是正 origin が省略または不正な場合は有効な class 分類から補い、それも不正なら unknown として数える。有効な origin は優先する。`approval.resolved` は保持するが重複承認の分母には含めない。

`coverage.hermes-conversation` は、source が `synthetic:hermes` 等の Hermes、runtime が `hermes`、または `coverage.connected` の対象が `hermes-conversation` のイベントを観測すると `connected`、それ以外は `not-connected` とする。合成イベントも接続として扱う。`by-stratum` の `accepted` と `first-pass` は全体の first-acceptance-conformance と同じ受入時刻を確認できる観測済み受入タスクを対象とし、それぞれ分母と分子に対応する。

emit-sim は配信済みイベントを標準出力し、統計を標準エラーに出す。入力末尾でも collector が停止中の場合、バッファ内のイベントは配信せず `undelivered-buffered` に件数を記録する。collector が稼働中ならバッファを配信し、同件数は 0 になる。 drop 件数と未配信件数は、本文と ID を持たない marker 行（`{"collection_lost":"buffer_dropped"}` / `{"collection_lost":"undelivered"}`）として標準出力にも出す。aggregate は件数を `coverage.collection-lost` と `ai_ops_collection_lost_events_total{reason=...}` に記録し、1件以上あれば coverage 宣言済みでも critical-safety-events / duplicate-effects を unknown にする（観測件数は下限）。

`lane.changed` の `lane_to`（ready / review / blocked / backlog / in-progress）も時刻付き状態遷移として outcome 判定に含め、`lane_to=review` は Review 到達とする。`lane_to=done` は受入とみなさない（受入は `task.accepted` / done snapshot で判定）。

critical-safety-events は `coverage.connected`（対象 `critical-safety-events`）がある場合のみ `coverage=connected` で件数を確定し、宣言なしで有効な severity の event だけを観測した場合は観測件数に `coverage=partial/undeclared` を付ける（0件でも「重大 event なし」とはしない）。どちらもない場合は unknown。

是正率 / corrections-per-task / first acceptance は、task に紐付けられない欠落 event (破損行・privacy 拒否・drop・未配信・読めない入力) が 1 件でもあれば `status unknown` とし、観測値を `observed`、件数を `lost-events` に出す。生成元の拒否 marker は許可 enum の `event_type` だけを保持し、notify / owner.rescue / approval.* / effect.applied / coverage.connected の拒否は是正 SLI を unknown にしない。

### Prometheus スナップショット

runner は `CODEX_TASK_BOARD_VAULT` が設定されている場合、全履歴から SLI を再集計して `ai-ops/sli.prom` に保存し、`ai-ops/metrics.prom` に追記する。更新間隔は `CODEX_TASK_BOARD_AI_OPS_SLI_INTERVAL_SECONDS`（既定 900 秒、0 で無効）、タイムアウトは `CODEX_TASK_BOARD_AI_OPS_SLI_TIMEOUT_SECONDS`（既定 120 秒）。失敗時は前回の値を保持し、`ai_ops_sli_export_*` で状態を確認できる。

`ai_ops_sli_info`、`ai_ops_sli_generated_timestamp_seconds`、`ai_ops_sli_determinable`、`ai_ops_sli_source_connected` と、first acceptance・correction・lead time・runs・stratum・guardrail の各系列を出力する。分子・分母を併記し、unknown の値は公開しない。unknown の SLI / coverage には `ai_ops_sli_unknown_info{sli,category,reason_code}` を 1 行出し、`category` は Owner 向けの 4 分類 (`not_connected` 未接続 / `history_missing` 履歴欠損 / `unclassifiable` 分類不能 / `out_of_scope` 対象外)、欠落・拒否・読めない run などの件数は `ai_ops_sli_unknown_detail{sli,detail}` に出す (`unknown-classification`)。是正率が確定していても、原因 unknown の再開 task 数は `unclassifiable` として件数を出す。値は全履歴から再計算したスナップショットであり `rate()` / `increase()` を使わない。

### Hermes ledger の join (mirror)

runner は `CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_COMMAND` が設定されている場合、SLI 再集計のたびにそのコマンド (`sh -c`、stdout が JSONL) で Hermes の metadata-only ledger を取り込み、`ai-ops/hermes-ledger/snapshot.jsonl` を置き換えて集計入力に連結する (join)。本番の値は `kubectl exec -n hermes-agent deploy/hermes-agent -c hermes-agent -- sh -c 'cat /opt/data/ai-ops/ledger/events-*.jsonl'` で、codex-workspace の ServiceAccount が既に持つ hermes-agent namespace の Role `codex-workspace-debug` (pods/exec) を使う。新しい権限・secret・外部送信・Hermes の再起動は要らない。未設定なら何もしない (hermes_conversation は not-connected のまま)。

- 上限: `CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_TIMEOUT_SECONDS` (既定 30 秒) と `CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_MAX_BYTES` (既定 8 MiB)。取り込みは SLI 全体の deadline から `CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_RESERVE_SECONDS` (既定 45 秒、後続の集計 `prom` / v1 export のための予約) を引いた時刻までしか待たず、残り時間が予約以下ならコマンドを実行しない (`no_time`)。超過・コマンド失敗・空出力・有効な hermes-observer event が 1 件もない出力 (`no_events`: 途中行だけ・他 source だけ・全行破損/拒否) は失敗として `status.edn` に記録し、前回成功時の snapshot を残す。SLI refresh 自体は失敗にしない。`no_events` のうち検出した本文・ID なしの欠落 marker (`privacy_rejected` / `input_unreadable`) は `hermes-ledger/failed-pull-markers.jsonl` に残し、次に取り込みが成功する (ledger 全体を読み直す) まで集計入力へ付ける (全行の ID が不正になった等の拒否を集計側が認識できず、関連 SLI が確定したままになるのを防ぐ)。連続して `no_events` で失敗した場合は前回の marker を上書きせず積み上げる (是正の拒否が後の承認拒否で消えると是正 SLI が確定してしまう)。行数上限 `CODEX_TASK_BOARD_AI_OPS_HERMES_LEDGER_FAILED_MARKER_MAX_LINES` (既定 10000) を超えた分は `ai_ops_hermes_mirror_failed_pull_markers_overflow_total` に計数し、保持分は下限 (1 件でも残れば関連 SLI は unknown のまま)。件数は `ai_ops_hermes_mirror_failed_pull_marker_lines`。
- 保存前の検証: snapshot には集計側と同じ allowlist の key だけを、集計側の本番モード gate と同じ値形式検証 (enum・ID 固定パターン・時刻・数値範囲・token 形状 denylist) を通して保存する。形式外の値は `"redacted"` に置換し、`event_id` / `task_id` / `request_id` / `run_id` が形式外の event は本文・ID なしの `{"privacy_rejected":"upstream"}` marker (許可 enum の `event_type` のみ付く) に置換する。集計側はこれを upstream 拒否として計数し、是正に影響し得る種別なら SLI を unknown にする。
- 失敗中または partial (`last-result` が ok でない) は、前回 snapshot に続けて本文・ID なしの marker `{"source_stale":"hermes-observer"}` を集計入力に付ける。aggregate は `coverage.hermes-conversation.coverage` を `partial/stale` にし、Prometheus では `ai_ops_sli_source_connected{sli="hermes_conversation"} 0` / `ai_ops_sli_source_partial{sli="hermes_conversation"} 1` / `ai_ops_source_stale_snapshot_markers{source="hermes-observer"}` になる (接続済みにも 0 件にも見せない)。この marker は欠落 event ではないので zero-tolerance・是正 SLI は変えない。ただし承認 event の source は現状 Hermes ledger だけなので、stale の間は失敗中に起きた承認 (重複を含む) が入力に無い。重複承認率は確定値を出さず `unknown` (理由コード `stale_source_snapshot`、観測値は `observed-lower-bound`、coverage `partial/stale`) にする。観測済み承認が 0 件でも承認だった可能性のある欠落 (拒否・破損等) があれば「未接続」ではなく欠落 (`lost-events`) として報告する。 snapshot が一度も取得できていない (初回の取り込みがタイムアウト/コマンドエラー) 間も、前回分の無い stale marker だけを集計入力に付け、他 source の承認があっても重複承認率は確定しない (承認 0 件でも「未接続」ではなく stale として報告)。この場合 `coverage.hermes-conversation` は `not-connected` のまま `coverage` を `missing/stale` にし、unknown の理由は未配線 (`hermes_ledger_not_joined`) ではなく `history_missing` / `stale_source_snapshot` になる。会話の判定は `runtime=hermes` または `source` が `hermes-observer` (synthetic:hermes 含む) のどちらかで行う (runtime が欠落/redact された event も Board の task・run 集計に混ぜない)。
- snapshot に入れるのは `source` が `hermes-observer` の JSON 行だけ。JSON でない行は `{"collection_lost":"input_unreadable"}` marker に置き換える (黙って落とさない)。他 source の JSON 行はコマンドの誤設定なので落として `foreign-lines` に数える。追記途中の末尾行 (改行なし) は落とすが、落とした取り込みは成功 (`ok`) にせず `partial` として記録する: snapshot は最新の完全な行で置き換えつつ stale と同じく `source_stale` marker を集計入力に付け、末尾が書き込み途中の承認 event だった場合でも重複承認率を確定しない (次の完全な取り込みで `ok` に戻る。`ai_ops_hermes_mirror_partial_pulls_total`、`_snapshot_lines{kind="truncated_tail"}`)。本文・ID の検証は集計側の privacy gate が従来どおり行う。
- snapshot に保存する key は集計側と同じ allowlist (本文・引数・header 等の未知 key は取り込み時点で落とし `dropped-keys` に数える)。値は scalar か 256 文字以内の文字列だけで、超える値は `redacted`。取り込みはメモリ内で上限バイト数まで読み、超えた時点でコマンドを止める (一時ファイルを書かず、タイムアウトまで待たない)。
- turn だけの会話 (opaque な `conv-` ID で event が `run.*` / `approval.*` のみ、ticket と join できず outcome を持ち得ない) は ticket を作らず request_id 単位のまま保持するが、Board の task 集計 (`tasks.total` / outcome / 層別 / `guardrails` / 救援率の分母 / `run-reliability` / `delegation`) には入れず、`tasks.conversations` と `guardrails.conversations-unobserved` に件数を分ける。`event_type` が欠落/redact (種別不明) の event を含む会話も Board task には昇格させず、その件数を `coverage.hermes-conversation.unverifiable-event-types` / `ai_ops_hermes_conversation_events{kind="unverifiable_type"}` に別掲する (種別不明 event 自体は全体の欠落として関連 SLI を unknown にする)。`request.received` / `task.*` / `correction` 等を持つ ticket なしの依頼は従来どおり request_id 単位の task として数える。会話数・turn 数・承認 event 数は `coverage.hermes-conversation` と `ai_ops_hermes_conversations` / `ai_ops_hermes_conversation_turns{kind}` / `ai_ops_hermes_approval_events{kind}` に出す。Hermes 由来の `approval.*` は重複承認 SLI の入力に残る。ticket 形式の task_id を持つ Hermes event は会話扱いにしない。
- mirror の健全性: `ai_ops_hermes_mirror_enabled` / `_last_success_timestamp_seconds` / `_last_attempt_timestamp_seconds` / `_failures_total` / `_partial_pulls_total` / `_stale` / `_snapshot_lines{kind=hermes|malformed|foreign_source|rejected|truncated_tail|dropped_keys|redacted_values}` / `_failed_pull_marker_lines` / `_failed_pull_markers_overflow_total` (metrics.prom。`_snapshot_lines` は成功した snapshot がある時だけ出す)。

## ai_ops_insight.bb (correction-rules/v1)

実体は `docker/codex-workspace/task-board/ai_ops_insight.bb` (ここは symlink)。`report` は分析専用、`prom` は runner image から 15 分ごとに呼ばれ公開 SLI の v1 系列を出す。

```sh
bb ai_ops_insight.bb report ~/.codex-task-board 20261030T065040Z   # run-id 上限で固定 snapshot を再現 (上限の長さで先頭比較: 時刻だけなら同じ秒の run を含む)
bb ai_ops_insight.bb report ~/.codex-task-board 20261030T140906Z "$CODEX_TASK_BOARD_VAULT"  # vault を渡すと Review 停止からの再開契機 (Notes 見出しの時刻/source のみ) も出す
bb ai_ops_insight.bb prom ~/.codex-task-board                       # 公開 SLI の v1 系列 (ai_ops_v1_*)。runner の refresh-sli! が呼び sli.prom に連結する。件数のみで ticket ID は出さない。vault は読まない。読めない run を持つ task は全集計から除外し unevaluated_tasks に別掲
./insight-test.sh                                                   # 本票の実例を本文なしで再現する回帰 eval (test.sh からも実行)
```

summary.edn の status / action / result / blocker-category / agent / 時刻 / review-gate の gate 名と診断 category だけを読み、
run 間の遷移を v0 (公開中の SLI と同じ規則) と v1 で並べて分類する。v1 は gate 失敗の retrying を内部再作業 (`gate_rework`) として数え、
groom→implement・中断/blocked からの再開を是正から外し、Review 後の再開は原因 unknown のまま残す。
gate_rework の件数は失敗 run 自体で数える (後続 run 未開始の最新失敗は `pending` として別に示す)。
連続 10 回以上の gate 失敗 (gate 情報のない retry は系列を区切る) はレビュー反復ループ (`review-loops`) として検出する。公開 SLI と Prometheus 出力は変更しない。
結果と読み方は `../insight-2026-10-30.md`。
