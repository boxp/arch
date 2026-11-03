# Task Board run 単位の親子 usage join（2026-11-03、claude-fable）

既存の run artifact（`<root>/runs/<票>/<run>/events.jsonl`、`summary.edn`、`delegation.json`）と `~/.codex/sessions` だけを read-only で結合し、run ごとの親（runner が起動した CLI）と子（`delegate.py` の Codex 子）の usage を metadata-only で出す。新しい collector・常駐・権限・外部送信はない。実装は `scripts/ai-observability/run_join.py`、テストは `tests/ai-observability/test_run_join.py`（子 Codex `gpt-6.1-terra` へ委譲し、親が run-id 形式・exempt の扱い・review gate 欠測を修正）。

## join の根拠と二重計上の扱い

| 経路 | 根拠 | 合算可否 |
|---|---|---|
| Codex 親 | `turn.completed.usage`（input に cached、output に reasoning を内包） | total = input + output。内数は足さない。旧 Sol run で session file 末尾の `total_token_usage` と一致を確認 |
| Claude 親 | `result.usage`（input / output / cache_read / cache_creation は互いに排他） | 4 項目の和。assistant message ごとの usage は stream 再出力で重複し得るため別掲し、result と足さない |
| Codex 子 | `delegation.json.thread` → session file 末尾の累積 `total_token_usage` | 親とは別 session なので親 + 子は非重複。両方既知のときだけ `run_total_known` |
| exempt 委譲 | 子は存在しない | 親 total をそのまま run total とする（0 ではなく「不在」として `child_absent`） |
| failed 委譲 | 子が途中まで消費した可能性 | unknown（`delegation_failed`）のまま。0 にしない |
| codex-review gate | runner は `codex exec --output-last-message` で別 session を起動し、thread id も usage も run dir に残さない | 全 run で `review_gate_usage_unrecorded`。run total は gate 分を含まない下限 |

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
python3 -m unittest discover -s tests/ai-observability -v                                       # 11 件
```

集計 JSON は `run-join-2026-11-03.json`（`--no-ids`、rows なし）。
