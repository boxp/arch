# SLO 案の定義と再現手順（slo-draft/v1）

提案であり、正式な SLO ではない。Owner 向けの説明と判断事項は vault の `Projects/ai-operations-observability/slo-owner-decision.md` にある。ここには再現に必要なことだけを置く。

## 再現

```sh
R=~/.codex-task-board; V="$CODEX_TASK_BOARD_VAULT"
bb scripts/ai-observability/slo_snapshot.bb "$R" "$V" --since 2026-10-06   # 件数だけの JSON
bb scripts/ai-observability/slo_snapshot.bb "$R" "$V" --ids                # ready_queue.mismatch_ids を付ける
bb tests/ai-observability/test_slo_snapshot.bb                             # 合成データのテスト

# 初回適合と依頼→受入の 28 日窓 (依頼日で絞る。Prometheus は累積なのでこの手順で再現する)
T=docker/codex-workspace/task-board
bb $T/ai_ops_sli.bb extract "$R" "$V" > /tmp/events.jsonl
jq -r 'select(.event_type=="request.received" and .occurred_at>="2026-10-06")|.task_id' /tmp/events.jsonl | sort -u > /tmp/c.txt
jq -c --rawfile ids /tmp/c.txt '($ids|split("\n")) as $l | select((.task_id//"") as $t | ($l|index($t)))' /tmp/events.jsonl > /tmp/ev.jsonl
bb $T/ai_ops_sli.bb prom /tmp/ev.jsonl | grep -E '^ai_ops_(first_acceptance|lead_time|stratum_tasks)'
```

Prometheus は `$GRAFANA_URL/api/datasources/proxy/uid/<prometheus uid>/api/v1/query` の read-only 経路で確認した。

## 各目標と source

| 目標 | source | 状態（2026-11-03） |
|---|---|---|
| 救援なし完了 | `ai_ops_sli_determinable{sli="owner_rescue"}`=0。定義は `rescue-class`（合成 14 ケース） | 定義のみ |
| 既承認の停滞 | 停止理由の記録が必要。代理は `review_stops` / `stall_reference` / `instructed_not_started` / `ready_queue` | 定義のみ。代理は測定済み |
| 初回適合 | `ai_ops_first_acceptance_*`、`ai_ops_stratum_tasks` | 累積は測定済み。28 日窓は上の手順 |
| 所要時間 | `first_run_to_review`（秒精度、全層まとめ）、`ai_ops_lead_time_*`（日精度） | 測定済み。層別と baseline は未実装 |
| 重大事象 | `critical_safety_events` / `duplicate_effects` / `private_leak` | unknown |

## 値の読み方

- `review_stops.open` は Done 以外のレーンにある、再開していない Review 停止。正当な Owner 待ちを含む。
- `stall_reference.with_open_as_stalled` は開いた停止をすべて停滞と置いた参考値で、真の率でも下限でもない。
- `instructed_not_started` は、停止中の最初の Owner 経由または監督 note から、次の run 開始または現在までの時間で数える。note の内容は見ないので、指示なのか状況確認なのかは区別しない。
- `ready_queue.card_ticket_assignee_mismatch` はカードの担当が `boxp` 以外で ticket の担当と異なる Ready カード。runner は ticket 側の担当を読むので起動しない。担当 `boxp` の ticket を意図して Ready に置いている場合もあるため、候補として扱う。
- `first_run_to_review.censored` は Review に未到達の task で、分位に入れない。
- 日精度の依頼→受入は p50 が 24h 単位でしか動かず、10% の悪化を検出できない。

## 今後のみ測れるもの

案 1 が承認された場合、runner は agent の最終出力の次の 1 行を allowlist で検証し、`summary.edn` へ保存する。

```
TASK_BOARD_WAIT_REASON: agent-continue | owner-decision | owner-acceptance | external-hold | new-scope
```

記録開始より前の停止は `unknown` のままで、過去へ補完しない。記録がない停止を救援なしに数えない。
