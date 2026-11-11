# BOXP-504: kohako-home に agent 利用枠と進行中タスク数を表示する

## 目的

kohako-home (https://kohako-home.b0xp.io/) の時計と同じ情報帯に、各 agent の subscription 利用枠（実測の使用率・reset・観測鮮度・共有枠ラベル）と Task Board の In Progress 件数（agent 別 / 全体合計）を表示する。

## データ源（既存の正本のみ・読み取り専用）

| 項目 | 正本 | 経路 |
| --- | --- | --- |
| 利用枠 | codex-workspace の `subscription-usage.prom`（BOXP-372 collector、quota/v1-draft） | `codex-workspace-ai-ops-metrics.codex-workspace:9464/metrics`（Prometheus が scrape しているのと同じ exposition） |
| 進行中タスク | Obsidian `Boards/Task Board.md`（lane が正本） | 既存 read-only projection `codex-task-board-kohako.codex-workspace:8090/api/kohako/board`（BOXP-329） |

- codex-workspace の ConfigMap/Pod は変更しない（Pod 再起動による run 中断を避ける）。lolice 側の変更は Calico NetworkPolicy（kohako-studio → 8090/9464）のみ。
- provider credential・Prometheus・管理 API をブラウザへ公開しない。BFF は本人認証（既存 Access JWT / verifier）後の `GET /kohako/api/v1/status` で派生値だけを返す。

## 表示の意味

### 利用枠（pool 単位で 1 回だけ表示し、agent ごとに複製しない）

- **Claude 共有（Opus/Fable）**: `shared_5h`（5 時間）・`shared_7d`（7 日）。Opus と Fable の双方を拘束する同じ残高。
- **Fable 専用上限**: `fable_7d`（`seven_day_overage_included`）。Fable には共有枠に加えてこれも効く。
- **Opus 専用**: collector が窓ごとの利用率を出さないため「未提供」と表示（推測しない）。
- **Codex 共有（codex / sol / astra）**: `primary`（7 日）。
- **localllm**: subscription limit が無いため「対象外」。boxp は人のため利用枠は対象外。
- 未提供（present=0）・未観測・24h 超の古い観測・reset 経過後未観測（expired）・取得失敗は、それぞれ文字で明示し 0% にしない。token 量や価格から % を換算しない。

### 進行中タスク

- Task Board の `In Progress` lane のカードを一意 ticket ID で数え、カード assignee 別内訳と全体合計を示す。Ready/Blocked/Backlog/Done は含めない。重複カードは 1 件として扱い、同 ID で assignee が食い違う場合は「整合不明」を示す。
- projection は 30 件で切り詰められるため、30 件すべてが In Progress かつ truncated の場合は「30 件以上（全件は不明）」と表示する。
- 実行中 run 数とは別物。今回は run 数を表示しない。

## 更新周期・負荷

- BFF はサーバー側で 60 秒キャッシュ（失敗時も短期キャッシュ）し、上流へのリクエストは timeout 3 秒。
- Web は 60 秒ごとに取得し、`document.hidden` の間は停止、失敗時は指数 backoff（最大 10 分）。LLM 呼び出しは無し。

## UI

- PC: 時計の下に小さなステータス帯（利用枠 pool と進行中件数）。
- スマホ: 1 行の要約ボタン（折畳み）→ 詳細を展開。キャラ・吹き出し・入力・停止・承認を隠さない。
- 色だけに頼らず文字ラベル（「古い」「不明」「対象外」等）を付ける。

## 検証

- BFF 単体テスト: exposition parse、pool 構成、未提供/古い/expired/取得失敗が null + 状態文字列になること、In Progress の一意集計・重複・食い違い・truncated。
- Web 単体テスト: 表示文言（0% 置換が無い、合計 = 内訳和）。
- 配備後: verifier 経路で `/kohako/api/v1/status` を読み、同時刻の `/metrics` と board projection（および Task Board.md）と一致することをプログラムで照合。実ブラウザで PC/スマホ描画と会話/停止/接触の非退行を確認。

## rollback

- arch PR を revert → image 再ビルドで UI/endpoint が消える。lolice PR を revert → BFF からの到達が遮断され、UI は「取得できません」と表示（他機能に影響なし）。
