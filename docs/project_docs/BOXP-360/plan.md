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
| Hermes `sha-88638ef` | lifecycle hook (`pre/post_llm_call`, `pre/post_tool_call`, `pre_approval_request`/`post_approval_response`, `on_session_*`, `on_kanban_*`, `post_gateway_admission` など) と plugin dispatch は**配備版コードに実在**。`observability/langfuse` は catalog plugin への参照だけで、plugin 本体は配備されていない。有効な plugin は `kohako-g2-context` のみ。同梱の `shared_metrics` の送信先は `telemetry.nousresearch.com` (外部) で、config 上は未設定 | Hermes 側の取得経路は既存 hook を使う metadata-only plugin にする。独自 hook は新設しない。shared_metrics は外部送信なので使わない |
| Task Board runner | `runs/<ticket>/<run>/summary.edn` (1452 件)、`delegation.json` (113)、`outbox/*.edn` (221、2026-10-22 以降、`event-id`/`revision`/`redeliveries`/`hermes-status` あり) | 既存の metadata だけで baseline を取る |
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
  - `unknown`: 分子にも成功にも入れず、別に掲げる。否定的な返事や Review への移動をすべて失敗とは数えない。担当 model 自身の判定だけで確定しない。origin が省略された場合は上記 class から補い、明示された origin は優先する。人の訂正 (`classifier=human`) は同じ evidence に対する rule 判定を上書きする。Owner に毎回の採点は求めず、曖昧な例だけを少量校正する。
- **privacy gate (生成元で適用)**: allowlist にある key だけを通す (`ai_ops_sli.bb` の `allowed-keys`)。許可値も短い識別子に限定し、本文、認証情報、query 付き URL、改行などの不正値を redact し、不正な event_id は event ごと拒否して件数を stderr に出す。extract と emit-sim の両方に適用する。server 側の masking には頼らない。通常の会話本文は中央 DB へ copy しない。
- **token / cost**: provider が返した値だけを記録する。subscription CLI は `cost_source=unknown` とし、API 単価を掛けて実請求に見せない。

## 4. SLI 候補 (式と分母)

| SLI | 式 | 分母 / 注意 |
|---|---|---|
| agent-system 是正 task 率 | agent-system 起因の是正を 1 回以上含む task / review に到達した task | unknown 原因の task は別に掲げる |
| 1 task あたり是正往復 | agent-system 起因の是正 event 数の分布 | n<20 なら分位点は参考値 |
| first acceptance 適合率 | 最初の受入以前（同時刻を含む）に原因を問わず是正が一度もない受入済み task / 受入済み task | 受入後の是正は reopen 側に計上。時刻不明の是正は保守的に不合格。未評価は別掲 |
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

状態遷移は時刻付き event を時刻順に評価し、時刻なし snapshot は時刻付き状態 event がある場合に上書きしない。同時刻では再オープンを受入より優先する。時刻なしの是正は first acceptance を不合格とする。

## 5. 実測 baseline (既存 metadata のみ)

正本は `baseline-2026-10-29.edn`。抽出時刻は **2026-10-29 02:45頃** (UTC)。README の extract と aggregate を実行した。extract の privacy gate でも不正 event ID を拒否し、不正値を redact した。baseline の coverage にある拒否数は後段 aggregate での追加拒否数であり、extract で既に拒否された件数は含まない。

- ticket 360、run 1459、event 4150。run 履歴のない ticket は 70。
- outcome: accepted 280、awaiting-review 22、in-flight 41、blocked 5、backlog 12。
- agent-system 是正 task 率: **43/284 (15.1%)**。原因 unknown の task は 107、unknown 是正 event は 206。
- first acceptance 適合率: **94/223 (42.2%)**。未評価を不合格として含めると 94/283 (33.2%)、未評価 60。run 履歴の無い受入済み 57 件は観測不能として分母外。再オープン済みの task は未評価にも含めない。reopen-after-accept は受入履歴 source 未接続のため unknown。
- run の信頼性: interrupted 135、retrying 553、idle-timeout 7。delegation は delegated 63、exempt 56、failed 1。
- extract の order-inversions 810 は glob の読み取り順から出たもので、実際の到着順ではない。
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
2. (同じ承認の範囲) Hermes の既存 hook を使う metadata-only plugin (`post_llm_call`, `post_tool_call`, `pre_approval_request`/`post_approval_response`, `on_session_end`) を作る。本文と引数は生成元で落とす。有効化には Hermes の再起動が 1 回要る。
3. 集計を CronJob にし、`ai_ops_*` の metric を Prometheus に出す (ServiceMonitor を lolice に追加)。label は source/event_type/stratum/outcome/origin だけにし、ID は label にしない。
4. 代表的な業務で 2〜4 週の baseline を取る。曖昧な差戻しだけを Owner が少量校正する。
5. baseline が揃ってから、rolling 28d、最小 sample 数、error budget policy、burn-rate alert を提案する。BOXP-357 などの修正は待たせず、変更前後を version/event で比べる。

retention / access / privacy: ledger は 180d で、Owner と runner の SA だけが読む。削除依頼は request_id 単位で ledger から消し、集計し直す。trace は sample してよいが、SLI counter は sample しない。
