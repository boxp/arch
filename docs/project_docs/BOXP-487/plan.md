# BOXP-487: Task Board runner の Fable 5.2 対応と同系列正式版への自動追従

## 調査結果 (2026-11-10)

| 項目 | 結果 |
| --- | --- |
| runner の固定値 | `claude-fable` → `claude-fable-5-1` (task / novel 両 runner と self-check に重複) |
| 配備 CLI | image 同梱 `@anthropic-ai/claude-code` 2.1.319。`claude-fable-5-2` を内蔵していない |
| 2.1.319 + `--model claude-fable-5-2` | 既存 subscription 認証で成功。ただし stderr に `[claude-code:unrecognized_model]` |
| 2.1.321 (npm 最新, 2026-11-09) + `--model claude-fable-5-2` | 警告なしで成功。`modelUsage` のキーは `claude-fable-5-2` |
| 公式 catalog | `https://platform.claude.com/docs/en/about-claude/models/overview.md` の `Claude API ID` 行に `claude-fable-5-2` / `claude-opus-5-5` / `claude-sonnet-5-5` |
| 引数互換 | runner は `--model` と `--output-format stream-json` 等だけを渡し、temperature / tool_choice を渡さない。API 側の 400 条件は CLI 経路に影響しない |
| 保持条件 | Fable 5.2 は 30 日保持必須・ZDR 不可。Fable 5.1 も同じ指定 (Covered Models) で、現行条件から変化なし |

## 変更

1. `docker/codex-workspace/model-catalog.edn` を role → model の正本にする。
   各 role に `:family`、`:model`、`:previous` (旧正常版)、`:min-cli`、`:source`、`:verified-at`、
   `:history` を持たせる。task / novel 両 runner はここから読み、無い場合は内蔵既定値を使う。
2. `claude-fable` を `claude-fable-5-2` に更新し、image の CLI を 2.1.321 に上げる。`claude-opus` / `claude-sonnet` と
   legacy の `fable` (`--agent fable`) は変えない。
3. runner の self-check は「role の集合が固定」「model が同じ family の `claude-<family>-<major>-<minor>` 形式」を検査する。
   別 family への昇格や role 追加は従来通り review 必須で失敗させる。
4. runtime hold: `~/.codex-task-board/model-updates/state.edn` の `:hold {role model}` があれば、新規 run はその model を使う。
   hold に指定できるのは catalog の `:model` か `:previous` だけ。run は開始時に解決した model を
   起動引数と summary に固定し、実行中の run は差し替えない。
5. `docker/codex-workspace/model-updates/model_updates.bb` (agent なし cron job):
   - `tick`: 1 日 1 回だけ動く (lock と日付で重複抑制)。公式 overview.md の `Claude API ID` 行と、
     配備 CLI バイナリが内蔵する model ID を照合し、承認済み family で現 pin より新しい
     (major, minor を数値比較) stable ID を候補にする。preview、日付付き、未知 family、取得失敗は候補にしない。
   - 候補があれば公式 `api-and-data-retention.md` の保持条件一覧で候補と現 pin の扱いを比べ、差か取得失敗があれば更新せず理由を記録する
     (Fable 5.1 の model page には保持条件の行が無いため、model page 同士の比較は使わない)。
   - 配備 CLI が候補を内蔵していなければ、CLI 更新を含む更新票を 1 枚作る。
   - 条件を満たす候補だけ、短い canary (stream-json、Bash tool 1 往復、`modelUsage` 一致、警告なし) を実 CLI で実行する。
     成功すると Task Board に更新チケットを 1 枚作る (同じ role / 候補で重複しない)。
     担当 agent は `model_updates.bb pin` で catalog を更新し、通常 PR、review、CI、merge を通す。
   - 配備後、catalog の pin が state の検証済みと違えば canary を実行する。成功で検証済みと履歴を記録し、
     失敗なら `:previous` へ自動 hold してチケットへ記録する (rollback)。後の canary が合格すれば自動 hold だけ外す。
   - `status` / `canary` / `pin` / `hold` / `release` サブコマンドを持つ。
6. 観測の model 名対応 (`scripts/ai-observability/run_join.py`) に `claude-fable-5-2` を追加する。

## 権限と費用の境界

- 使うのは既存 subscription の `claude` CLI と既存 `gh` 認証だけ。API key、有料 API fallback、新 account、自動 top-up は使わない。
- 日次 check 自体は LLM を呼ばない。canary は候補が見つかった時と配備後の検証時だけ。
- 別 family への昇格、role の追加、Hermes 本体や cron job の既定 model 変更はしない。
- 保持条件・privacy 条件の差、CLI 未対応、canary 失敗は更新せず旧正常版を維持し、理由を記録する。

## 検証

- fixture: 新旧、候補なし、同一候補、新版 CLI 非対応、catalog 取得失敗、古い応答、同時 check、hold / rollback、
  別 family / preview 除外、保持条件の差。
- 既存 runner / novel runner test の model 期待値を更新して全件実行。
- merge 後、image 配備を待ち、配備 Pod の CLI 版と catalog、`claude-fable` 担当の実 run の `modelUsage` を確認する。
- cron job `model-updates` を vault の jobs.edn へ登録し、`tick` の実動作 (候補なし・重複抑制) を確認する。
