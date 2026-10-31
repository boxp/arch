# BOXP-372: Grafana AIダッシュボードにClaude Code / Codex の subscription 利用枠と予算消費を追加する

## 目的

既存 dashboard `ai-ops-quality` に、Claude Code と Codex それぞれの subscription 利用枠（rate limit）の消費率・集計窓・リセット時刻と、追加利用（予算）の状態を、鮮度つきで表示する。

## 責務分担 (BOXP-360 との関係)

- BOXP-360: ai-ops ledger / SLI / token・cost 指標。本票はこれらに手を入れない。
- BOXP-372 (本票): subscription 利用枠と追加利用の状態だけを扱う。別ファイル `ai-ops/subscription-usage.prom` に出力し、`ai_subscription_*` 名前空間を使う。
- API 単価換算の金額（Claude の `total_cost_usd` など）は出さない。subscription の消費を金額として表示しない。

## 取得元 (公式出力・実環境で確認済み, 2026-10-30)

| CLI | 取得元 | 取れる値 | 取れない値 |
|---|---|---|---|
| Claude Code 2.1.311 | `claude -p --output-format stream-json --verbose` の `rate_limit_event`（Agent SDK の公式 message 型） | `unifiedWindows.{five_hour,seven_day,...}.{utilization,resetsAt,status}`、`overageStatus`、`overageDisabledReason`、`isUsingOverage` | 追加利用の金額（上限と消費額）。公式出力には金額がない |
| Codex 0.164.0 | `~/.codex/sessions/**/rollout-*.jsonl` の `event_msg`/`token_count` に CLI が記録する `rate_limits` | `primary`/`secondary` の `used_percent`・`window_minutes`・`resets_at`、`credits.{has_credits,unlimited,balance}`、`plan_type`、`spend_control_reached`、`rate_limit_reached_type` | 金額。credits は件数 (balance) で、USD ではない |

- 追加の model 呼出し（probe）はしない。Claude は task-board runner の通常 run を観測し、Codex は CLI が書く rollout を読むだけにする。
- rollout は `token_count` 行の `rate_limits` だけを抽出する。会話本文・資格情報は読まず、出力もしない。
- Codex は対象 rollout 全体からイベント時刻でバケットごとの最新値を選び、時刻を解析できない場合はファイルの更新時刻を使う。
- 非公式 endpoint（claude.ai usage endpoint など）や認証情報の外部送信には依存しない。

## 実装

### arch (`docker/codex-workspace/task-board/`)

1. runner の Claude 起動を `--output-format stream-json --verbose` に変更する。
   - `last-message.md` は `result` event の `.result` から作る。stream-json でない出力の場合は従来どおり raw をコピーする。
   - 最新の `rate_limit_event` から数値と enum だけを `ai-ops/subscription/claude.json` に atomic に保存する（観測時刻つき）。
2. 新 module `ai_subscription_usage.bb`
   - Claude snapshot と、Codex の最新 rollout の `rate_limits` を読み、`ai-ops/subscription-usage.prom` を書く。
   - 失敗しても run に影響させない。取得できない場合は `ai_subscription_source_up=0` と理由 label を出す。取得できない窓を 0% として出力しない（`ai_subscription_window_used_percent` 自体を出さず、`source_up` / `window_present` で未取得と区別する）。公式出力が実際に 0% を返した場合はそのまま 0 を出力する。
   - `resets_at` を過ぎた窓の利用率は出さず、expired=1 にする。
3. 既存の 60 秒周期の metrics 書き出しから呼ぶ。
4. テストを追加する。

### lolice

1. ai-ops-metrics sidecar (`server.py`) で `subscription-usage.prom` も配信し、file の present/age を出す。
2. dashboard に「subscription 利用枠」row を追加する。
   - 内容: 利用率 (%)、集計窓、リセット時刻、観測からの経過時間、取得状態と理由、追加利用の状態、Codex credits。
   - rate limit・token・金額を同じ panel に混ぜない。

## 予算 (budget) の意味の候補と推奨

1. 追加利用 / credits の状態（推奨・実装済み）: Claude は `overageStatus`、Codex は credits の有無と残数。subscription の枠を超えた利用が可能かどうかと、その残量を示す。
2. 追加利用の金額上限と消費額: Claude は公式出力に無いため取得できない（`/usage` の画面にのみ表示）。Codex も金額は出力されない。
3. API 単価換算コスト: subscription を API 単価に換算することになるため扱わない（Owner 指示）。

→ 1 を採用し、2 は「取得不能」と理由を dashboard に明記する。2 が必要なら、非公式 endpoint を使わない取得方法が出るまで保留とする（Owner 判断事項）。

## 検証

- 単体テスト / runner テスト / CI
- 配備後、`/metrics` の実値、Prometheus query、Grafana panel の表示を照合する

## Fable 専用枠 (G2 追加依頼)

Claude Code 2.1.312 の公式 stream-json `rate_limit_event` は、モデル専用の週次枠を `unifiedWindows.seven_day_overage_included` として通知する。CLI の表示名は「Fable limit」で、レスポンスヘッダーは `anthropic-ratelimit-unified-7d_oi-*` 系列。この窓は応答に含まれるアカウントでのみ提供される。`seven_day_opus` / `seven_day_sonnet` はトップレベルの `rateLimitType` にのみ存在し、窓ごとの利用率としては提供されない。

コレクターは `name="fable_7d"` の独立した系列と `ai_subscription_window_present` を出力し、窓がない場合は未提供と表示する。未提供の窓を 0% と偽らず、共有窓からも推測しない。probe、追加のモデル呼び出し、新たな課金は発生させない。

### 観測時刻と読み取りの効率化

- Claude の stream を実行中に追跡し、完結した rate limit event の受信時刻を記録する。終了後に残りを読み、既存 snapshot より古い観測は同一プロセス内のロックで比較・書き込みを直列化して破棄する。
- Codex は８日以内の全候補をイベント時刻で比較する。ファイルのサイズと更新時刻が変わらなければ、そのファイルのバケット別最新値と読み取りエラー状態を再利用し、候補から外れたキャッシュを破棄する。

### レビュー指摘の対応

- Claude の stream-json は保存前に tool 入出力・thinking・permission_denials・session_id / uuid を除去し、各行を即時 flush する。rate limit は受信時刻で記録する。
- subscription metrics の無効化時は既存の Prometheus ファイルを削除する。
