# BOXP-360: コハコ/Task Board 共通 AI 運用品質 SLI と観測基盤 — 設計・baseline・合成 pilot

- 作成: 2026-10-29 (claude-opus, Task Board run 20261029T021309Z)
- Owner 向け要約の正本: Obsidian `Projects/ai-operations-observability/owner-summary.md`
- 本 PR の範囲: **設計 + 既存 metadata による実測 baseline + 合成 E2E pilot のみ**。本番の配備、runner や Hermes の変更、新しい secret、外部送信は含まない。

## 1. 目的と非目的

- 目的: Kohako(Hermes) と Task Board 上の各モデル (Claude CLI / Codex CLI / localLLM) の「差戻し・救援・重複・遅延」を、同じ意味の event と相関 ID で数えられるようにする。SLI/SLO はその後で決める。
- 非目的: provider SDK の一律差し替え、subscription を API-key 課金に変えること、本文の中央収集、個別モデルのランキング、いきなり 99.9% のような SLO を決めること。

## 2. 既存観測の live 棚卸し (詳細: `infra-inventory.md`)

| 対象 | 実測 | 本件での扱い |
|---|---|---|
| Prometheus (prometheus-operator) | retention 31d、Longhorn PVC 60Gi、req 500m/2Gi、limit mem 4Gi、`otlp-write-receiver` 有効、PrometheusRule 11 | SLI counter と alert に再利用する (低 cardinality のみ) |
| Loki 3.4.2 | TSDB+filesystem、retention 168h、PVC 100Gi | 7 日で消えるので SLI の正本にはしない。調査用だけ |
| Grafana 13.2.2 / Alloy (DaemonSet 7) | Alloy は pod のファイルログだけを Loki へ送る。`otelcol.receiver` なし | dashboard は再利用。OTLP trace の受け口は今はない |
| Tempo / Jaeger / OTel collector / Langfuse / ClickHouse / Postgres | 全 namespace で workload/service が見つからない (名前・image での検索) | 新しく作るなら構築・backup・保守のコストが増える |
| Hermes `sha-88638ef` | lifecycle hook (`pre/post_llm_call`, `pre/post_tool_call`, `pre_approval_request`/`post_approval_response`, `on_session_*`, `on_kanban_*`, `post_gateway_admission` など) と plugin dispatch は**配備版コードに実在**。`observability/langfuse` は catalog plugin への参照を確認したが、限定した探索 (`/opt/hermes/plugins` 一覧と `/opt/data/plugins/*langfuse*`) では plugin 本体を確認できず、存在・有効性は unknown。config の `plugins.enabled` は値を表示していないため、どの plugin が有効かも unknown (infra-inventory.md と同じ扱い)。同梱の `shared_metrics` の送信先は `telemetry.nousresearch.com` (外部) で、config 上は未設定 | Hermes 側の取得経路は既存 hook を使う metadata-only plugin にする。独自 hook は新設しない。shared_metrics は外部送信なので使わない |
| Task Board runner | `runs/<ticket>/<run>/summary.edn` (1466 件)、`delegation.json` (127)、`outbox/*.edn` (223、2026-10-22 以降、`event-id`/`revision`/`redeliveries`/`hermes-status` あり) | 既存の metadata だけで baseline を取る |
| 未確認 (unknown) | codex-workspace から Prometheus/Loki/dashboard への HTTP は timeout、`pods/exec`・`portforward`・`metrics.k8s.io` は Forbidden → 既存 series 名、PVC 使用量、scrape 対象数、ノードの空き資源、Grafana 認証、Alertmanager の通知先 | 「無い」ではなく unknown として扱う。導入判断の前に Owner 権限での確認が要る |

## 3. 共通 event schema `ai-ops-event/v0`

全 agent に同じ SDK を使わせるのではなく、同じ意味の項目と相関 ID で join する。

- **相関 ID**: `request_id` (論理的な依頼。ticket の無い会話にも付ける。ticket を新しく作らせない) → `task_id` (ticket、または会話の request) → `run_id` / `attempt` → `event_id` (生成元で安定させ、再送時も同じ値) + `parent_event_id` / `evidence_event_ids`。非同期 queue、再起動、別 repo の PR でも同じ ID を引き継ぐ。
- **event ID の形式**: 通常モードでは ticket 形式、`cov-<source>-<8桁の16進数>`、または `req-<英小文字・数字・ハイフン8〜64文字>` / `conv-<同8〜64文字>`（任意で `/` と英数字・`:`, `_`, `-` の接尾辞）を使う。最大128文字で token パターンは禁止。parent / evidence ID も同じ制約。
- **event_type**: `request.received` `run.started` `run.finished` `run.interrupted` `correction` `task.reopened` `approval.requested` `approval.resolved` `effect.applied` `owner.rescue` `lane.changed` `task.accepted` `task.cancelled` `task.state` `notify.run-finished` `coverage.connected`
- **区別して保持する状態**: run の終了 ≠ task の受入、Ready ≠ 受領 (ack)、agent の自己申告 ≠ 環境の state、再送 (`redelivery`) ≠ 新しい依頼、reopen / 取消 / 阻害 / 保留 / 未観測。これらを成功の分母から黙って外さない。
- **差戻し分類** (`correction_class` / `correction_origin` / `classifier`=rule|human|model / `classifier_version` / `confidence` / `evidence_event_ids`):
  - agent-system 起因: `instruction_violation`、`source_mismatch` (原典不一致)、`done_claim_without_execution` (未実施を完成扱い)、`assignee_regression` (担当復帰)、`gate_defect` (CI / codex review の指摘)
  - 非 agent 起因: `preference_adjustment`、`scope_addition`、`unavoidable_safety_decision`、`external_failure`
  - `unknown`: 分子にも成功にも入れず、別に掲げる。否定的な返事や Review への移動をすべて失敗とは数えない。担当 model 自身の判定だけで確定しない。origin が省略または不正な場合は有効な class から補い、それも不正なら unknown とする。有効な origin は優先する。人の訂正 (`classifier=human`) は同じ evidence に対する分類のみを上書きし、元の是正の時刻と ID を保持する。同じ evidence の rule/model 判定がない人の reopen は再分類ではなく実際の再オープンとして状態遷移に反映する。Owner に毎回の採点は求めず、曖昧な例だけを少量校正する。
- **privacy gate (生成元で適用)**: allowlist にある key だけを通す (`ai_ops_sli.bb` の `allowed-keys`)。許可値も短い識別子に限定し、本文、認証情報、query 付き URL、改行などの不正値を redact し、不正な event_id は event ごと拒否して件数を stderr に出す。extract と emit-sim の両方に適用する。server 側の masking には頼らない。通常の会話本文は中央 DB へ copy しない。
- **token / cost**: provider が返した値だけを記録する。subscription CLI は `cost_source=unknown` とし、API 単価を掛けて実請求に見せない。

## 4. SLI 候補 (式と分母)

| SLI | 式 | 分母 / 注意 |
|---|---|---|
| agent-system 是正 task 率 | agent-system 起因の是正を 1 回以上含む task / review に到達した task | unknown 原因の task は agent-system 起因との重複を含め別に掲げる |
| 1 task あたり是正往復 | agent-system 起因の是正 event 数の分布 | n<20 なら分位点は参考値 |
| first acceptance 適合率 | 最初の受入以前（同時刻を含む）に agent 起因または原因不明の是正がない受入済み task / 受入済み task | 受入後の是正は reopen 側に計上。時刻不明の agent 起因または原因不明の是正は保守的に不合格。有効な受入時刻がない task は分子・分母から除き、未評価として別掲 |
| reopen-after-accept | close 後に是正が入った task / 受入済み task | late feedback を拾う |
| Owner 救援率 | 状況の催促や同じ承認の繰り返しが起きた task / 全 task | source が未接続なら unknown |
| Ready→ack 遅延 / 詰まり率 | ack 時刻 − Ready 時刻 | **現状は unknown** (Ready への遷移時刻の event が無い) |
| 同 scope 重複承認率 | 重複する `approval_key` の余分な承認イベント数 / 有効な `approval_key` 付き承認イベント総数 | |
| 実成果確認の完走率 | readback event がある受入 / 受入 | 未接続 |
| lead time | queue / active / approval / user wait / external blocked に分解し、wall time も保持 | 現状は日粒度の wall time だけ |
| usage / delegation depth | delegated / exempt、委譲の深さ | |
| **zero-tolerance** | 二重実行 (`effect_key` の重複)、安全・権限違反、private leak | 統計 SLO の error budget で相殺しない。各 source 未接続なら unknown。対応 event または coverage.connected 宣言がある場合のみ件数を報告 |
| guardrail | 通知や確認の抑制、未完了の放置、task の細分化 (tasks/request)、source 差異 | 低い差戻し率を見かけ上つくることを防ぐ |

層別は creative / dev / infra / research / assistant。必要に応じて model、runner、prompt/skill の版を付ける。条件が同じでなければ model を順位付けしない。

状態遷移は時刻付き event を時刻順に評価し、抽出時の現在状態と明示された snapshot は履歴に優先し、その他の時刻なし snapshot は時刻付き状態 event がある場合に上書きしない。同時刻では再オープンを受入より優先する。時刻なしの agent 起因または原因不明の是正は first acceptance を不合格とする。

## 5. 実測 baseline (既存 metadata のみ)

正本は `baseline-2026-10-29.edn`。抽出時刻は **2026-10-29 03:12頃** (UTC)。README の extract と aggregate を実行した。extract の privacy gate でも不正 event ID を拒否し、不正値を redact した。baseline の coverage にある拒否数は後段 aggregate での追加拒否数であり、extract で既に拒否された件数は含まない。

- ticket 360、run 1467、event 4443 (done ticket の現在状態 snapshot を追加)。run 履歴のない ticket は 70。
- outcome: accepted 280、awaiting-review 32、in-flight 24、blocked 11、backlog 13 (現在の lane snapshot を再open履歴より優先して再集計)。
- agent-system 是正 task 率: **43/284 (15.1%)**。原因 unknown の是正を含む task は 141 (agent-system 起因との重複を含む。旧集計は重複を除いた 107)、unknown 是正 event は 206。
- first acceptance 適合率: **94/223 (42.2%)**。未評価を不合格として含めると 94/283 (33.2%)、未評価 60、受入時刻不明の受入済み task 0。run 履歴の無い受入済み 57 件は観測不能として分母外。再オープン済みの task は未評価にも含めない。reopen-after-accept は受入履歴 source 未接続のため unknown。
- run の信頼性: interrupted 133 (実行中 run は interrupted に含めない)、retrying 561、idle-timeout 7。delegation は delegated 72、exempt 56。
- extract の order-inversions 814 は glob の読み取り順から出たもので、実際の到着順ではない。
- **unknown**: Owner 救援、重複承認、Ready→ack、二重実行、安全 event、private leak、token/cost、Hermes 会話。

## 6. 合成 E2E pilot (`tools/test.sh`)

`fixtures/synthetic-events.jsonl` (7 task、42 event) で次を確認する: 重複、順序の逆転、時刻ずれ、late feedback (close 後の是正)、pending/Ready、reopen、人の訂正による上書き、途中の再起動、取消、外部要因の blocked、ticket の無い会話、承認の重複、二重実行 (critical)、本文・引数・Bearer を含む event、collector の停止 (bounded buffer cap=4 で 7 件 drop、業務の emit は 42 件とも継続)、Prometheus に ID を出さないこと。追加の一時 fixture で extract の redact、coverage と受入前後の是正も検証する。

## 7. 基盤候補の比較

| 案 | 構成 | 追加の依存 / 資源 | backup / retention | 評価 |
|---|---|---|---|---|
| A 既存の再利用 (推奨・第 1 段階) | 生成元で metadata-only JSONL ledger (runner PVC、Hermes `/opt/data`) → 集計 → Prometheus の低 cardinality metric と recording/alert rule、Grafana | 新しい workload なし | ledger は 180 日保持して既存の backup 対象に含める。Prometheus は 31d | 最小。trace UI と annotation UI は無い |
| B A + Tempo | Alloy に `otelcol.receiver.otlp` を追加し、Tempo (filesystem) で trace を見る | Tempo 1 つ、PVC 数十 Gi | trace は 14d 程度 | trace link が要るようになったら |
| C Langfuse self-host | Langfuse v3 web/worker + Postgres + ClickHouse + Redis + S3 互換 storage | 依存 4 つ以上、メモリは数 GiB 規模 | DB 2 種の backup と retention の設計が要る | annotation/eval UI が要ると実証できたときだけ。Hermes catalog plugin の導入と再起動、新しい secret が要る → Owner 承認 |
| D Langfuse Cloud | SaaS | 外部送信 | 外部 | 本文を集めない前提でも外部送信になるので、現段階では採らない |

役割分担: **SLI/SLO と alert は Prometheus** (sample しない counter)。**trace、annotation、eval は将来 Langfuse か Tempo** (sample 可、opaque な相関 ID で join)。Langfuse の score は暫定の annotation であり、品質の真実としては扱わない。

## 8. 段階的な導入案

1. (Owner 承認後) runner が `ai-ops-event/v0` を `~/.codex-task-board/ai-ops/events-YYYYMMDD.jsonl` に追記する。Ready/ack/approval の時刻も出す。bounded buffer と drop counter を付け、書き込みに失敗しても業務は止めない。
2. (同じ承認の範囲) Hermes の既存 hook を使う metadata-only plugin (`post_llm_call`, `post_tool_call`, `pre_approval_request`/`post_approval_response`, `on_session_end`) を作る。本文と引数は生成元で落とす。有効化には Hermes の再起動が 1 回要る。着手前に、有効な plugin と Langfuse catalog plugin 本体の有無 (現時点 unknown) を read-only で確認する。
3. 集計を CronJob にし、`ai_ops_*` の metric を Prometheus に出す (ServiceMonitor を lolice に追加)。label は source/event_type/stratum/outcome/origin だけにし、ID は label にしない。
4. 代表的な業務で 2〜4 週の baseline を取る。曖昧な差戻しだけを Owner が少量校正する。
5. baseline が揃ってから、rolling 28d、最小 sample 数、error budget policy、burn-rate alert を提案する。BOXP-357 などの修正は待たせず、変更前後を version/event で比べる。

retention / access / privacy: ledger は 180d で、Owner と runner の SA だけが読む。削除依頼は request_id 単位で ledger から消し、集計し直す。trace は sample してよいが、SLI counter は sample しない。

`emit-sim` の標準エラー統計には、入力末尾で collector が停止中のため未配信となったバッファ内イベント数を `undelivered-buffered` として記録する。配信済みイベントのみを標準出力に出す。

`duplicate-effects` は、`effect_key` が欠落または privacy gate で redact された `effect.applied` が 1 件でもあれば重複の有無を確定できないため `status unknown` とし、観測できた重複数を下限 (`observed-duplicates-lower-bound`)、検証できない effect 数を `unverifiable-effects` として別掲する (coverage 宣言済みでも 0 件と報告しない)。人による是正/再オープンの再分類は、集計と状態判定のどちらも「同じ evidence を持つ rule/model 判定がある」ことだけを条件にし、evidence event 自体が入力に無くても同じ扱いにする。

入力の破損行 (JSON として解釈できない行や object でない行) は黙って捨てず `input.malformed-lines` と Prometheus の `ai_ops_input_malformed_lines_total` で数える。破損行が 1 件でもあれば、その行に重大 event や effect が含まれていた可能性があるため、`critical-safety-events` と `duplicate-effects` は coverage 宣言済みでも `status unknown` とし、観測できた件数は下限として別掲する。人の再分類の対象は `classifier` が `rule` または `model` の判定に限り、classifier の無い是正/再オープンは独立した event として扱う。

privacy gate で拒否した event (不正な event_id や task/request/run ID) も、破損行と同じように中身を検証できない。そのため、1 件でもあれば `critical-safety-events` と `duplicate-effects` は coverage 宣言済みでも `status unknown` とし、観測できた件数は下限として、拒否件数は `rejected-events` として別掲する。実 baseline の拒否は 0 件で数値は変わらない。

生成元 (extract/emit-sim) の privacy gate で拒否した event は、本文や ID を出さずに `{"privacy_rejected":"upstream"}` という marker 行だけを JSONL に出す。aggregate はこの marker を `coverage.privacy-rejected-upstream` と Prometheus の `ai_ops_privacy_rejected_events_total{stage="upstream"}` で数え、1 件でもあれば zero-tolerance 指標を unknown にする (stderr の統計だけに残して集計で 0 件になる経路を塞ぐ)。また severity が不正 (redact 済み) の event があれば重大度を検証できないため、`critical-safety-events` は coverage 宣言済みでも unknown とし、件数を `unverifiable-severity` として別掲する。実 baseline は拒否・不正 severity とも 0 件で数値は変わらない。

- 2026-10-29 追記 (codex-review): emit-sim の bounded buffer drop / 未配信件数を stderr だけでなく本文・ID なし marker 行で aggregate へ引き継ぐ。aggregate は `coverage.collection-lost` と `ai_ops_collection_lost_events_total{reason}` で計数し、1件以上あれば zero-tolerance 指標 (critical-safety-events / duplicate-effects) を coverage 宣言済みでも unknown にする。
- 2026-10-29 追記 (codex-review): event_type が欠落/不正 (privacy gate で redact 済み) の event は effect や重大 event だった可能性を否定できないため、`duplicate-effects` / `critical-safety-events` を coverage 宣言済みでも unknown にし、件数を `unverifiable-event-types` として別掲する。また `status` の許可値に `cancelled` を追加し、privacy gate を通る `aggregate*` 経由でも `task.state status=cancelled` が取消 outcome になることを回帰 test で確認する。
- 2026-10-29 追記 (codex-review): extract で読めない run `summary.edn` を黙って除外せず、パスから ticket/run を特定して `run.unreadable` event を出す。該当 task は差戻しを見落とし得るため、是正率と first acceptance の分子・分母から除き `unevaluated-input-missing` として全体/層別に別掲する (合格扱いしない)。読めない outbox や vault に無い ticket の破損 summary は本文なし marker `{"collection_lost":"input_unreadable"}` として出し、`ai_ops_collection_lost_events_total{reason="input_unreadable"}` で計数、zero-tolerance 指標を unknown にする。また `task.state` / `task.cancelled` / `task.reopened` だけを持つ task も存在の証拠として集計に含め、取消数・未完了数の過少計上を防ぐ。実 baseline は破損入力 0 件で数値不変 (是正task 43/284、first acceptance 94/223)。
- 2026-10-29 追記 (codex-review): EDN として読めても内容が不完全な `summary.edn` (map でない、`:status` 欠落、`:ticket` / `:run-id` がディレクトリ名と不一致。例: `{}`) も読めない summary と同じく `run.unreadable` としてディレクトリの ticket に紐付け、該当 task を `unevaluated-input-missing` にする (`:action` は既存 summary 133 件で欠落しているため必須にしない)。また `task.state status=accepted` を `done` / `closed` と同じく受入 outcome として判定し、privacy gate 経由の回帰 test を追加。実 baseline は不完全 summary 0 件で数値不変 (是正task 43/284、first acceptance 94/223)。
- 2026-10-29 追記 (codex-review): EDN として読めても必須field (`:event-id` / `:event-type` / `:ticket-id`) を欠く outbox map (例: `{}`) を黙って捨てず、読めない outbox と同じく `{"collection_lost":"input_unreadable"}` marker として計数し zero-tolerance 指標を unknown にする。回帰 test 追加 (修正を戻すと失敗することを確認)。実 baseline は不完全 outbox 0 件で数値不変。
- 2026-10-29 追記 (codex-review): outbox の event-type は既知の `task-board.lane-changed` / `task-board.run-finished` のみ変換し、空/未知の種別は `notify.run-finished` に化けさせず `input_unreadable` marker として計数する。frontmatter を読めない ticket (`BOXP-<数字>.md`) も黙って除外せず `run.unreadable` event を出して該当 task を `unevaluated-input-missing` にし、その ticket の正常な run も保持する。ticket の glob は `BOXP-<数字>.md` に限定 (`BOXP-144-*.md` 等の添付ノート 7 件は ticket ではない)。回帰 test 追加 (修正前実装で失敗を確認)、test.sh 78/78 ok。実 baseline は修正前と extract 出力が完全一致 (4471 行) で数値不変。
