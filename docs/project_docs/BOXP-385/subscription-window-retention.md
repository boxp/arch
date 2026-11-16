# Claude 利用枠の窓単位保持（2026-11-03、claude-opus）

## 障害

Grafana `ai-ops-quality` の Fable 専用枠（`seven_day_overage_included`）が全欄空になった。

原因: `rate_limit_event` は窓の一部だけを含む（Opus run では `seven_day` のみ）。`record-claude-rate-limit!` は `claude.json` を event ごとに全置換していたので、Opus の event で Fable 窓が消え、`window_present` が 0 になった。枠が解消したわけではない。実 snapshot（10:09Z）の `unifiedWindows` は `seven_day` のみだった。

## 変更

- event は窓単位で merge する。含まれない窓は、自身の `observed_at_ms` と `account_scope` を持ったまま残す。
- `ai_subscription_window_observed_timestamp_seconds` は窓ごとの観測時刻を返す。provider 全体の時刻で古い窓を新しく見せない（旧形式の窓だけは file の時刻を継承する）。
- 順不同 event: 古い event は新しい窓や top-level を上書きしない。後続観測のない窓だけ埋められる。
- `ai_subscription_window_status` を失効窓では出さない。失効窓の警告を現在の警告に見せないため。
- 複数 runner process の更新消失を防ぐため、`claude.json.lock` の file lock を追加した。

Grafana 側の変更は不要で、既存の窓別 observed/expired/present をそのまま使う。

## 状態の区別

| 状態 | Prom 上の見え方 |
|---|---|
| 未観測 | `window_present=0`、used なし（0 にしない） |
| 過去観測 | `present=1`、used あり、`time() - window_observed_timestamp` が古い |
| 失効（reset 通過） | `present=1`、`expired=1`、used/status なし、observed と reset は残る |
| 別 account へ切替 | 新 account の新しい event で旧窓を削除し、未観測に戻す |

## account 境界

event に account 識別子はない。`~/.claude.json` の `oauthAccount.accountUuid` の SHA-256 先頭 16 桁を 0600 の snapshot にだけ保存し、Prom へは出さない。他の profile field は読まない。

runner は Claude プロセスの起動直前に scope を固定し、その run の event をこの scope に帰属させる。受信時の login で判定すると、A の run の後続 event が B の値になるため。実行中の login 切替後は、プロセスが旧 token のままか新 login へ追従したかを event から判別できない。そのため、受信時の login が既知で起動時 scope と異なる event（起動時 scope が不明な場合も含む）は記録しない。この event の値は `events.jsonl` にだけ残り、Prom では既存の窓の観測時刻が古くなる形で現れる。login が一時的に読めないときは起動時 scope で記録する。

取得できないとき（nil）は境界を判定できないので窓を保持し、更新・追加した窓には直前の既知 scope を引き継ぐ。引き継がないと、その後の account 切替で旧窓を削除できず、新 account の値に見えてしまう。既知 scope が一つもない窓だけは切替後も残る。

## 限界

過去観測の used は最終観測値で、現在値ではない。他端末や Fable 以外の経路の消費は次の観測まで反映されない。

## 反映後の復元手順（1回のみ）

既存の公式観測は sanitize 済み `events.jsonl` に残っている。反映前の runner では次の event で再び消えるので、反映後に実行する。観測時刻は保守的に元 run の開始時刻（2026-11-03T09:17:39Z、BOXP-387 run 091739Z）とする。過去 max 84 などの Prom 集計値は使わない。

    jq -c 'select(.type=="rate_limit_event" and (.rate_limit_info.unifiedWindows.seven_day_overage_included != null))' \
      "$CODEX_TASK_BOARD_ROOT/runs/BOXP-387/20261103T091739Z-a1272891-af96-483d-82b6-88ac6fdb4e49/events.jsonl" | tail -1 >/tmp/fable-event.json
    bb -e '(load-file "/opt/codex-workspace/task-board/ai_subscription_usage.bb")
           ;; 3 引数形は現在の login の scope を付ける。元 run と同じ account であることを先に確認する
           (ai-subscription-usage/record-claude-rate-limit!
             (System/getenv "CODEX_TASK_BOARD_ROOT")
             (cheshire.core/parse-string (slurp "/tmp/fable-event.json") true)
             (.toEpochMilli (java.time.Instant/parse "2026-11-03T09:17:39Z")))'

既にそれより新しい Fable 窓があれば、merge 規則によって何も変わらない。
