# BOXP-204: agent CLI の再ログイン期限前アラート

## 目的

家経由の Owner 要望「agent CLI は認証が切れると手動ログインが必要。切れる前に再認証できるよう期限前にアラートを鳴らしたい」に応える。旧設計（Obsidian `Projects/codex-task-board-runner/auth-expiry-prevention/`）のうち、非秘密メタデータによる観測・unknown の区別・重複抑制・通知だけを今回導入する。受付停止（enforcement）・独自 refresh・自動 login/logout は含まない。

## 棚卸し（2026-11-19、値は記録しない）

| CLI | 利用経路 | 認証の共有単位 | 再ログイン期限 | access token |
| --- | --- | --- | --- | --- |
| Claude Code (`/usr/bin/claude`) | runner（claude-opus/fable 等）、review、子 agent、cron、対話 | codex-workspace の home PVC `~/.claude/.credentials.json`（全 container 共有、1 session） | `refreshTokenExpiresAt` が公開されている → 72h/24h 前に通知 | `expiresAt`（数時間、CLI が自動更新）→ 通知しない |
| Codex (`codex`) | runner（codex-*）、codex review gate、delegate、cron | 同 PVC `~/.codex/auth.json`（auth_mode=chatgpt、1 session） | 非公開 → unknown。`last_refresh` が 10 日止まったら停滞として通知 | JWT exp（約 10 日、CLI が自動更新）。token は読まない |
| Antigravity (`agy`) | runner（antigravity、BOXP-630） | 同 PVC。保存場所・期限は読まない（Terms と BOXP-630 の契約） | unknown。run のログイン失敗で通知、次の成功 run で解除 | 読まない |
| Hermes（openai-codex sign-in） | hermes-agent Pod | 別 Pod・別 PVC の独立 session | 今回は対象外（この exporter からは見えない） | — |
| cursor-agent / pi | 対話・委譲 skill のみ（runner 経路なし） | HOME 内の各ファイル | 今回は対象外 | — |

## 実装

- arch `docker/codex-workspace/task-board/agent_auth_expiry.bb`: 認証ファイルを process 内で読み、許可した数値と enum だけを `ai-ops/agent-auth.prom` に書く。例外メッセージは捨て、固定 enum（missing/unreadable/unsupported/policy_disallowed/not_read）にする。ログインはあるが期限判断に使う項目（Claude の refreshTokenExpiresAt、Codex の last_refresh）が欠落・解析不能なら `incomplete` とし、`ok` にしない（期限前通知が働かないため観測不能として通知する）。`status` で人向けの確認（再ログイン後の回復確認）。
- runner: 既存の 60 秒ごとの metrics 書き出しで呼ぶ（`CODEX_TASK_BOARD_AGENT_AUTH_METRICS=false` で停止）。antigravity run の結果がログイン失敗か成功かを時刻だけ記録。
- lolice: ai-ops-metrics が新ファイルを配信、PrometheusRule `agent-auth-expiry-rules.yaml`、Alertmanager の `component="agent-auth"` route（Hermes = 家と Telegram、1 日 1 回まで再送、解除も送る）。

## 通知の時期と頻度（担当判断）

- 72h 前（1 回目）: 週末・外出で 1 日以上ログインできなくても間に合う余裕。24h 前（2 回目）: 当日中の行動を促す。期限切れ: 再ログインが必要と明示。
- 同じ通知の再送は 24h ごと、静音時間（02:00-09:00 JST）は送らない（critical にしない）。帯が変わると alertname が変わるので 1 回ずつ届く。
- 再ログインで期限が延びると解除が届く = 回復の確認。

## 安全境界

token / refresh token / API key / account 識別子を出力・保存しない。CLI の login/logout/refresh を呼ばない。API key や別課金への切替をしない。期限が公開されていない provider は unknown のまま推測しない。利用枠不足（AiProviderQuota*）や通信の一時失敗とは別の alert にする。

## 検証

- `tests/ai-observability/test_agent_auth_expiry.bb`: fake credential の sentinel が metadata・exposition・status・CLI 出力に出ないこと、access と再ログイン期限の区別、失敗の enum 化。
- lolice promtool テスト: 72h/24h/期限切れの帯、再ログイン後の解除、古い観測、Codex 停滞、agy の失敗→成功。
- 配備後: 実 Prometheus で系列を確認し、Hermes 経路で実通知試験。

## Rollback

lolice PR の revert（ルールと route）、または `CODEX_TASK_BOARD_AGENT_AUTH_METRICS=false`。認証自体には触れないので認証の復旧手順は不要。
