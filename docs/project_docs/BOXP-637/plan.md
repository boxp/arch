# BOXP-637: Antigravity の subscription 利用枠を既存の監視・表示へ統合する

## 目的
BOXP-630 で導入した Antigravity CLI (`agy`) の subscription 利用枠を、Claude Code / Codex と同じ経路
（runner → `subscription-usage.prom` → ai-ops-metrics → Prometheus → Grafana / 家の表示 BFF）へ載せる。

## 取得方式（公式 CLI）
- `agy -p /usage --output-format json`。changelog 明記の「print mode の read-only slash command」で、
  agent turn を起動せず quota を消費しない（実測: `num_turns 0` / `total_tokens 0`）。
- 応答は `command.data.groups[].buckets[] = {id, window(weekly|5h), remaining_fraction, reset_time}`。
  群（Gemini 群 / Claude・GPT 群 / Argon）の中のモデルは 5h・週次枠を共有する → 群×窓を 1 制約として扱い、モデル別に重複加算しない。
- BOXP-630 CD-03 を維持: task-board runner（bb）が公式バイナリを直接起動。資格情報ファイルは読まない。
  `GEMINI_API_KEY` 等の API 鍵・ADC・gateway env は除去、`--settings {"useG1Credits":false}`、stdin 空。
  Claude/Codex 等の agent や delegate.py からは呼ばない。

## 実装
- arch `docker/codex-workspace/task-board/ai_subscription_usage.bb`
  - `maybe-refresh-antigravity!`: `CODEX_TASK_BOARD_ANTIGRAVITY_USAGE=true` の opt-in。既定 600s（最小 300s）に 1 回、
    snapshot の file lock 下で試行時刻を先に確保し複数プロセスでも重複起動しない。90s timeout。
  - snapshot `ai-ops/subscription/antigravity.json`: id/窓/残量/リセットだけ保存（説明文は捨てる）。
    失敗時は前回の値を観測時刻ごと残し `last_state` に理由。
  - 出力: `provider="antigravity"` の `ai_subscription_window_*`（used% = 100×(1−残量)、reset、duration、observed、present）、
    `source_up` / `source_state`（ok, no_snapshot, parse_error, not_installed, timeout, auth_required, unsupported_auth, command_failed, invalid_output）、
    `attempt_timestamp_seconds`。残量 0 のときだけ status=rejected（CLI は status を返さない）。リセット超過は expired で used% を出さない。
- arch runner: metrics tick で refresh を呼ぶ（非同期、one-shot tick は同期）。
- arch kohako-studio BFF / web: 群ごとの pool（Antigravity Gemini群 / Claude・GPT群 / Argon）。取得失敗は pool の注記に理由。
- lolice: codex-workspace runner に opt-in env、Grafana ai-ops-quality の説明文・row 名更新（パネルは provider 汎用なので自動表示）。
- アラート（AiProviderQuota*）は Claude の route 判断用のため変更しない（Codex と同じ扱い）。

## 検証
- `tests/codex-workspace/ai-subscription-usage-test.sh`（偽 agy: 引数・env 除去・秘密文字列不出力・失敗理由・間引き・runner tick 統合）
- BFF/web vitest・biome、runner `test`、lolice `scripts/ai-ops-dashboard/test.sh`
- 配備後: Pod 内 `subscription-usage.prom` と Prometheus / Grafana / 家 BFF の値が一致することを確認。
