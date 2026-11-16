# SLO 案の定義と再現手順（slo-draft/v2）

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
# 移行で Done になった票は除く (ai_ops_sli は frontmatter の closed を受入として読む)。BOXP-387 は Owner の受入が移行と同じ日にあるので残す
grep -E '^\| \[\[Tickets' "$V/Projects/task-board-review-retirement/migration-ledger.md" \
  | awk -F' \\| ' '$3=="Done"{print $1}' | grep -oE 'BOXP-[0-9]+\]\]' | tr -d ']' | grep -vFx BOXP-387 | sort > /tmp/migrated.txt
jq -r 'select(.event_type=="request.received" and .occurred_at>="2026-10-06")|.task_id' /tmp/events.jsonl | sort -u | grep -vFxf /tmp/migrated.txt > /tmp/c.txt
jq -c --rawfile ids /tmp/c.txt '($ids|split("\n")) as $l | select((.task_id//"") as $t | ($l|index($t)))' /tmp/events.jsonl > /tmp/ev.jsonl
bb $T/ai_ops_sli.bb prom /tmp/ev.jsonl | grep -E '^ai_ops_(first_acceptance|lead_time|stratum_tasks)'
```

Prometheus は `$GRAFANA_URL/api/datasources/proxy/uid/<prometheus uid>/api/v1/query` の read-only 経路で確認した。

## 各目標と source

| 目標 | source | 状態（2026-11-03） |
|---|---|---|
| 救援なし完了 | `owner_rescue`（continue の停止）。定義は `rescue-class`（合成 14 ケース）。`ai_ops_sli_determinable{sli="owner_rescue"}` は 0 のまま | 今後のみ測定（BOXP-395 の切替 2026-11-03 21:16Z 以降）。観測 0。Blocked は未分類 |
| 既承認の停滞 | `approved_work_stall`（continue の停止）。旧定義の代理は `review_stops` / `stall_reference`。ほかに `instructed_not_started` / `ready_queue` | 今後のみ測定。2026-11-03 21:26 UTC 時点の観測は 1 件で、率として読まない。Blocked は未分類 |
| 初回適合 | `ai_ops_first_acceptance_*`、`ai_ops_stratum_tasks` | 累積は測定済み。28 日窓は上の手順 |
| 所要時間 | `first_run_to_first_outcome`（秒精度、全層まとめ）、`ai_ops_lead_time_*`（日精度） | 測定済み。層別と baseline は未実装 |
| 重大事象 | `critical_safety_events` / `duplicate_effects` / `private_leak` | unknown |

## 値の読み方

- `coverage` は欠けた入力の件数で、`complete` が false なら値は欠測を含む。読めない run（summary 未作成の実行中 run を含む）は Review 停止だったか不明なので停止に数えないが、同じ task の読める run の停止は残す。読めない run は終了時刻が分からないので、次の run が窓より前に始まっているときだけ窓の外とする。次の run が無い run や次の run の開始時刻が分からない run は、窓より前に始まっていても数える。
- `resume_last_contact.unknown-unreadable` と `instructed_not_started.unevaluated_stops` は ticket が読めず接触の有無が不明な停止で、接触なしには数えない。
- `first_run_to_first_outcome` は最初の run 開始から、最初に `review` / `continue` / `owner-acceptance` / `done` で正常終了するまで。`unevaluated` は最初の結果を特定できない task で、分位にも打切りにも入れない。
- `review_stops` は切替前の系列で、今後は増えない。`open` は Done 以外のレーンにある、再開していない Review 停止で、正当な Owner 待ちを含む。`closed_by_migration` は移行で Done になった票のうち Owner の受入が無い票で、`closed_by_acceptance` と分ける。受入が Notes にある BOXP-387 と BOXP-215 は `migrated-owner-accepted` に固定した ID で受入へ数える。BOXP-215 は受入が 10-07 で closed が移行日の 11-03 なので、依頼→受入の時間を歪めないよう 28 日窓の手順では除く。移行 ledger が読めない、または票の行を 1 件も認識できないときは、両方を null にして `closed_unclassified` へ出し、`coverage.complete` を false にする。
- `continue_stops` は gate を通って既承認の残作業がある停止。次 run がすぐ始まるのが正常で、`*_over_15m` が救援の猶予、`*_over_24h` が停滞の基準。`approved_work_stall` の `status` が `no_observations` のときは 0% ではなく観測なし。`owner_rescue` の猶予は再開前の最後の Owner 接触で判定するので、猶予内の接触のあとに猶予を過ぎて再度接触して再開した停止は救援に入る。
- `blocked_stops` は Blocked で止まった run。status が `blocked` の run に加え、`result` が blocked の `succeeded` と、exit≠0 の `failed` を含む（`effective-result` の規則。Ready へ進む groom は含まない）。`by_category` は runner の分類で、`agent-reported-blocked` は Owner 判断待ちか外部 hold か新 scope かを区別できない。救援にも停滞にも入れず、`excluded_unclassified_blocked` に件数を出す。
- `owner_acceptance_stops` は Owner の確認を待つ停止で、停滞に入れない。
- `stall_reference.with_open_as_stalled` は開いた停止をすべて停滞と置いた参考値で、真の率でも下限でもない。
- `instructed_not_started` は、停止中の最初の Owner 経由または監督 note から、次の run 開始または現在までの時間で数える。note の内容は見ないので、指示なのか状況確認なのかは区別しない。
- `ready_queue.card_ticket_assignee_mismatch` はカードの担当が `boxp` 以外で ticket の担当と異なる Ready カード。runner は ticket 側の担当を読むので起動しない。担当 `boxp` の ticket を意図して Ready に置いている場合もあるため、候補として扱う。
- `first_run_to_first_outcome.censored` は結果に未到達の task で、分位に入れない。
- 日精度の依頼→受入は p50 が 24h 単位でしか動かず、10% の悪化を検出できない。

## 今後のみ測れるもの

BOXP-395 で `continue` と `owner-acceptance` は result そのものになったので、追加の記録なしで測れる。切替より前の停止は `review_stops` に残し、過去へ補完しない。

残る欠けは `agent-reported-blocked` の理由だけ。案 1 が承認された場合、runner は `blocked` で終わる agent の最終出力の次の 1 行を allowlist で検証し、`summary.edn` へ保存する。

```
TASK_BOARD_WAIT_REASON: owner-decision | external-hold | new-scope | agent-recoverable
```

記録開始より前の Blocked と、記録がない Blocked は unknown のままで、救援なしに数えない。

## v1 からの変更（BOXP-395）

| 項目 | v1 | v2 |
| --- | --- | --- |
| 停止の対象 | `review` だけ。切替後の停止を黙って落とす | `review`（切替前）、`continue`、`owner-acceptance` を分ける |
| 既承認の停滞、救援 | unknown | continue の停止で測定。Blocked は unknown |
| 所要時間の到達 | `review` のみ。`done` で終わった task が打切りに入っていた | `continue` / `owner-acceptance` / `done` を追加 |
| 移行で Done の票 | 受入に混ざる | Owner の受入が無い票を `closed_by_migration` へ分ける。受入がある 2 票は受入に残す。初回適合は手順で BOXP-387 以外を除く |
