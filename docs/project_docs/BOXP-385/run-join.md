# Task Board run 単位の親子 usage join（2026-11-03、claude-fable）

既存の run artifact（`<root>/runs/<票>/<run>/events.jsonl`、`summary.edn`、`delegation.json`）と `~/.codex/sessions` だけを read-only で結合し、run ごとの親（runner が起動した CLI）と子（`delegate.py` の Codex 子）の usage を metadata-only で出す。新しい collector・常駐・権限・外部送信はない。実装は `scripts/ai-observability/run_join.py`、テストは `tests/ai-observability/test_run_join.py`（子 Codex `gpt-6.1-terra` へ委譲し、親が run-id 形式・exempt の扱い・review gate 欠測を修正）。

## join の根拠と二重計上の扱い

| 経路 | 根拠 | 合算可否 |
|---|---|---|
| Codex 親 | `turn.completed.usage`（input に cached、output に reasoning を内包） | total = input + output。内数は足さない。旧 Sol run で session file 末尾の `total_token_usage` と一致を確認 |
| Claude 親 | `result.usage`（input / output / cache_read / cache_creation は互いに排他）。**segment 単位で main session のみ**（下記「Claude run の usage 規則」） | 全 `result` の項目別の和。assistant message ごとの usage は stream snapshot なので別掲し、result と足さない |
| Claude subagent | 最後の `result.modelUsage`（session 累積、subagent 込み）− 親の和 | 親と非重複。累積が欠落/減少/負なら unknown（`claude_subagent_usage_unknown`）で run total も unknown |
| Codex 子 | `delegation.json.thread` → session file 末尾の累積 `total_token_usage` | 親とは別 session なので親 + 子は非重複。両方既知のときだけ `run_total_known` |
| exempt 委譲 | 子は存在しない | 親 total をそのまま run total とする（0 ではなく「不在」として `child_absent`） |
| failed 委譲 | 子が途中まで消費した可能性 | unknown（`delegation_failed`）のまま。0 にしない |
| codex-review gate | 2026-11-03 09:05Z 以降の runner は `<artifact>-usage.jsonl` へ記録（下記「review gate usageの記録」）。それ以前は thread id も usage も残っていない | 記録済み分のみ加算。未記録は `review_gate_usage_unrecorded` で、run total は gate 分を含まない下限 |

thread id・model 文字列・tool 名・本文・path は出力しない。model と agent は固定 allowlist で enum 化し、外れ値は `other`。`--no-ids` で票番号と run id も通し番号へ置換する。欠測は null。

## 実データ coverage（2026-11-03 07:40 UTC 頃、再実行で変わる）

| 指標 | 値 |
|---|---:|
| 走査 run | 1,753 |
| runtime 判定 codex / claude / unknown | 405 / 46 / 1,302 |
| 親 usage 既知 | 386 |
| 子 usage 既知 | 157 |
| 親 + 子 既知（exempt 含む） | 39 |
| events.jsonl が無い/JSON でない | 1,299 |
| delegation.json 無し | 1,362 |
| review gate usage 未記録 | 1,753（全件） |

unknown 1,302 の大半は、stream-json 化前の runner が平文で記録した Claude run と localllm run で、usage は取得不能。Claude run の `result.usage` が残るのは最近の 46 run だけ。したがって claude-fable / claude-opus / fable の run 総量は大半が unknown であり、Codex 系との比較に使えない。

### agent × 終了状態の既知親 total（token、exempt を含む run total ではなく親のみ）

| agent | status | run 数 | 親既知 | 親 total 合計 | 親子既知 | 中央値 | p90 |
|---|---|---:|---:|---:|---:|---:|---:|
| codex-sol | succeeded | 57 | 57 | 279,858,947 | 14 | 2,662,944 | 26,102,565 |
| codex-sol | retrying | 27 | 27 | 96,977,536 | 4 | 4,290,783 | 12,247,448 |
| codex-sol | blocked | 19 | 18 | 61,577,768 | 3 | 2,792,732 | 5,226,269 |
| codex-astra | succeeded | 14 | 14 | 28,070,342 | 0 | — | — |
| codex | succeeded | 25 | 25 | 24,138,260 | 0 | — | — |
| codex | retrying | 30 | 30 | 77,957,156 | 0 | — | — |
| claude-fable | succeeded | 174 | 8 | 13,279,154 | 8 | 1,276,555 | 5,051,469 |
| claude-fable | retrying | 142 | 8 | 61,659,017 | 8 | 8,592,946 | 13,056,273 |
| (agent 未記録) | succeeded | 98 | 98 | 135,805,953 | 0 | — | — |

中央値と p90 は親子既知 run の `run_total_known` に対する値。Claude 側は 8 件ずつしかなく、分布としては扱えない。retrying（gate 差戻し後の再実行）の run は succeeded より中央値で 1.6〜6.7 倍大きい。失敗・中断・blocked の消費はそれぞれの行に残し、成功分母から外した上で分子からは捨てていない。

### 本票の run 自身

| run | 親 | 子（terra） | 合計 |
|---|---:|---:|---:|
| 旧 Sol run（20261103T053610Z） | 6,176,431（input 6,138,089 うち cached 6,003,328 / output 38,342 うち reasoning 10,854、51 turn） | 1,230,270 | 7,406,701 |
| 本 Fable run（20261103T071657Z） | 終了まで unknown（result は run 終了時に記録） | 331,614（input 325,485 うち cached 288,768 / output 6,129） | unknown |

旧 run の「親全体 unknown」は既存 events.jsonl から確定した。eval 83,968 と review 2 回 143,739 を加えた旧 run の既知総量は **7,634,408 token 以上**（review gate 分は未記録）。子の比較（1,230,270 → 331,614）は課題も内容も違うので改善効果ではなく、短い固定 brief で委譲した 1 例の観測にすぎない。

## 上位の無駄候補（根拠つき、まだ変更していない）

1. **gate 差戻し後の再実行**: retrying run の親 total 中央値が succeeded の 1.6 倍（Sol）〜6.7 倍（Fable、n=8）。既存 SLI では gate rework run 720 のうち codex-review 起因 563。改善は BOXP-360/376 の gate 設計領域と重なるため、本票では数値提示に留める。
2. **長い親 session の累積 context**: 旧 Sol run は 51 turn で input 6.1M のうち 97.8% が cache read。subscription の window が cache read をどう重み付けするかは公式に未公開で、API 単価で換算しない。
3. **Hermes cron の 3 時間毎 Sol job**: usage_audit 63 fire で 55.3M token（fire あたり約 878k）。Hermes の既定 model・ユーザー選択・safety gate は変更対象外なので、prompt/取得範囲の見直しは別判断。

## 再現

```sh
python3 scripts/ai-observability/run_join.py --root "$CODEX_TASK_BOARD_ROOT" --no-ids            # 集計のみ
python3 scripts/ai-observability/run_join.py --root "$CODEX_TASK_BOARD_ROOT" --ticket BOXP-385 --rows
python3 -m unittest discover -s tests/ai-observability -v                                       # 16 件
```

集計 JSON は `run-join-2026-11-03.json`（`--no-ids`、rows なし）。P1 修正後の再集計は `run-join-2026-11-03c.json`。

## review gate usageの記録

runner は codex-review の呼び出しごとに `codex-review-<owner>__<repo>-<number>-usage.jsonl` へ1行追記する。許可する項目は schema、記録日時、PR URL、終了コード、所要ミリ秒、thread ID、usage status と、usage の input・cached input・output・reasoning output・cache write input の整数値のみ。プロンプト、差分、レビュー本文、モデル名、パスや生のイベントは保存しない。

join は全 usage ファイルの行数と記録済み行数を数え、記録済み分の input と output を親子の既知合計に加算する。cached と reasoning はそれぞれ input と output の内数として扱う。runner はレビューした PR ごとに codex を1回呼ぶので、期待呼出し数は `checked-pr-urls` の件数に失敗 gate が `codex-review` なら1を足した値（`review_gate_expected_calls`）とする。usage 行数が期待呼出し数に満たない場合（複数 PR の run で一部のファイル書き込みが失敗した場合を含む）や、未記録・不正な行がある場合は `review_gate_usage_unrecorded` を残し、合計は下限となる。レポートに PR URL と thread ID は出力しない。

## Claude run の usage 規則（2026-11-03、claude-opus）

実データ 63 run（本文を読まず数値のみ投影）で次を確認した。

- `result` は 1 run に複数回出る（session が再度起動されるたび）。22 run が該当し、旧実装は `multiple_usage_events` で全部 unknown にしていた。
- `result.usage` は segment 単位で累積しない。`result.modelUsage` は累積で、subagent を含む。各 run で「前回の累積 + 今回の usage = 今回の累積」が成立し、差分は subagent 分と一致する。
- assistant message の usage は `message.id` ごとの stream snapshot で、result より約 1% 低い。そのため下限にしか使わない。

判定: `result` があり、最後の `result` 以降に新しい `message.id` がなく、status が interrupted/running/不明でない場合だけ `usage_completeness: complete`。それ以外は `lower_bound` とし、`parent_usage` と `run_total_known` は null のまま、`lower_bound_tokens`（最後の累積 + 以降の id ごとの最後の snapshot）と `claude_usage_lower_bound_only` を出す。**下限は既知に数えない**。Claude の reasoning token は提供されないので未取得のまま。`message.id` は重複除去にだけ使い出力しない。model は allowlist で enum 化し、外れ値は `other`。

| 指標（Claude stream-json 63 run） | 修正前 | 修正後 |
|---|---:|---:|
| 親 usage 既知 | 29 | 44 |
| 親子 run total 既知（全 runtime 合計） | 54 | 69 |
| `multiple_usage_events` | 22 | 0 |
| subagent 分の過少計上 | 2 run で 477,611 token | 0（加算） |
| 下限のみ（interrupted 17 / running 2） | 値なし | 19 run、96,989,221 token 以上（running 分は集計時点の値で増え得る） |

Codex runtime の行は修正前後で一致した（parent/child/total/review 記録の差分 0）。集計は `run-join-2026-11-03e.json`。1,199 run の平文 Claude は引き続き取得不能。

### 計画停止で中断した Claude run の消費（新しく見えた無駄候補、未変更）

complete 44 run の親合計 196,120,951 に対し、interrupted 17 run の下限は 89,072,407 token で、Claude stream-json 親の既知消費の約 31%（下限ベース）にあたる。17 run すべての中断理由は planned（workspace 計画停止）で、10 票に分布し、発生は 3 日間で 8 時間帯に集中する。中断 run が残した commit/push は後続 run で再利用される場合があるので、全量が無駄とは言えず、成果を伴わない消費の分離は未測定。`docker/codex-workspace/**` の main 反映ごとの image rollout が主因と推定されるが、rollout 時刻との突合は未実施。
