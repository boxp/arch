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
