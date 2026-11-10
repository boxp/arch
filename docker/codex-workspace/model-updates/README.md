# Claude モデルの自動追従 (BOXP-487)

Task Board と Novel Board の Claude 担当 (`claude-fable` / `claude-opus` / `claude-sonnet`) が使う model ID を、
同じ family の正式版へ追従させる仕組みです。差分が無い日は LLM を呼びません。

## 正本

- `docker/codex-workspace/model-catalog.edn` (image では `/opt/codex-workspace/model-catalog.edn`):
  role ごとの `:model` (現 pin)、`:previous` (旧正常版)、`:min-cli`、`:source`、`:verified-at`、`:history`。
- 両 runner は run 開始時に一度だけ model を解決し、起動引数の `--model` と run summary の
  `:model` / `:model-source` (`:catalog` / `:hold` / `:builtin`) に固定します。実行中の run は差し替えません。
- catalog が読めない、または role の model が `claude-<family>-<major>-<minor>` でない場合は runner 内蔵の既定値を使います。
  別 family の model は受け付けません。

## 日次 check (`model_updates.bb tick`)

codex-workspace の cron job `model-updates` (agent なし) が実行します。lock で同時実行を防ぎ、UTC の日付で 1 日 1 回に抑えます。

1. 公式 `models/overview.md` の `Claude API ID` 行から ID を読みます。取得や解析に失敗したら `catalog-error` で何もしません。
2. 同じ family で、(major, minor) を数値で比べて現 pin より新しい最大の ID を候補にします。preview、日付付き、別 family は候補にしません。
3. 公式 `api-and-data-retention.md` の保持条件 (30 日保持が必要な model の一覧) に、候補と現 pin が同じ扱いで載っているかを比べます。
   差がある、または読めない場合は `policy-diff` で更新しません (privacy 条件の変更は Owner 判断)。
4. 配備中の CLI バイナリが候補 ID を内蔵していなければ `waiting-cli` とし、CLI の更新を含む更新票を 1 枚作ります。 更新票が既にあっても、CLI が対応した後は候補 canary に合格するまで `proposed` にしません。
5. 内蔵していれば、実 CLI で短い canary (stream-json、Bash tool 1 往復、`modelUsage` が候補だけ、
   `unrecognized_model` 警告なし) を実行し、合格したら更新票を 1 枚作ります。同じ role と候補では 2 枚目を作りません。
6. 更新票の担当 agent は `model_updates.bb pin` で catalog を更新し、通常の PR、review、CI、merge を通します。pin は候補 canary の合格記録 (`:candidate-verified`) が無ければその場で canary し、不合格なら catalog を変えません。waiting-cli の票は先に CLI 更新だけを配備し、tick で候補が `proposed` になってから pin します。
   image が配備されると、次の tick が新しい pin を canary で検証します。

## 配備後の検証と rollback

- 配備中の pin が state の検証済み (`:verified`) と違えば、その pin で canary を実行します。
- 合格: `:verified` と `:history` を更新します。自動で入れた hold があれば外します。
- 不合格: `:previous` へ自動 hold し (`:auto-hold`)、更新票へ記録します (手動 hold が既にあればそれを維持し上書きしません)。新規 run は旧正常版で動きます。
- 手動: `hold --role R --model M` (M は catalog の `:model` か `:previous` だけ) と `release --role R`。手動 hold は自動では外しません。 hold / release / pin は tick と同じロックを待ってから state を更新するため、実行中の tick に上書きされません。
- 恒久的に戻すときは catalog を戻す PR を通常どおり出します。

状態は `~/.codex-task-board/model-updates/state.edn`、canary の判定項目は `canary/` に保存します (応答本文や認証情報は保存しません)。
`status` で確認できます。lock の競合は `lock-events.jsonl` に残します。

## 権限と費用の境界

- 既存 subscription の `claude` CLI と既存の Task Board 起票だけを使います。canary は `ANTHROPIC_API_KEY` などの API 経路の環境変数を外して実行し、有料 API へ fallback しません。
- 新しい account、資格情報、課金、別 family への昇格、role の追加はしません。
- Hermes 本体や cron job の model 設定は変えません。
