# BOXP-405 段階 3: ハーネス劣化の対照評価（固定課題群 + harness_eval.bb）

設計の正本は Obsidian `Projects/ai-operations-observability/redesign.md` 第 3 章（定義版 `harness-eval/v1-draft`）。本書は arch 側の範囲・検証手順・やらないことを記録する。段階 1（`plan.md`、#14461）と段階 2（`stage2-runner-plan.md`、#14462）とは独立に merge できる。

## 目的と問い

「更新されるモデルの能力を、現行ハーネスが制限していないか」を、実運用の時系列から因果を断定せずに測る。同じモデル revision・同じ固定課題・同じ安全条件で、

- arm A（最小の仕組み）: 課題の要件・受入手順・許可ファイルだけを渡す
- arm B（現行ハーネス）: `task_board_runner.bb` が実際に使う契約文（routing policy・委譲契約・進捗記録・Task Board contract）で同じ課題を包む

を対照比較する。成功はエージェントの自己申告ではなく、課題同梱の独立受入（`accept.sh`）と許可外変更の検査で判定する。

## 範囲（本 PR）

| 成果物 | 内容 |
|---|---|
| `docker/codex-workspace/task-board/harness_eval.bb` | `plan` / `run` / `compare` / `prom` / `contract` |
| `docker/codex-workspace/task-board/harness-eval-tasks/T01..T06` | 公開・非機密の固定課題（`task.edn` / `base/` / `solution/` / `accept.sh`）。easy 5・medium 1 |
| `tests/harness-eval/fake_agent.bb` | CI 用の偽エージェント（solve / noop / break / sleep / garbage / error、arm B だけ別 mode 可） |
| `tests/harness-eval/test_harness_eval.bb` | fixture テスト 12 件（CI remaining suite） |
| `.github/workflows/test-codex-task-board-runner.yml` / `ci-partition-test.py` | suite と path filter に追加 |

### 予算（試行前に `budget.edn` へ記録。超過は exit 2 で何も作らない）

課題 ≤ 10、繰返し ≤ 3、arm ≤ 2、1 試行 ≤ 900 秒、合計 ≤ 60 試行。`plan` が記録した値を `run` が読む。`--stop-file` が現れたら残りを `aborted` として記録し、試行数には入れない。

### 1 試行の流れ

1. 一時ディレクトリに `base/` を複製し `git init` + 初期 commit（`base-sha` を記録）。
2. arm ごとの prompt を stdin で agent-cmd に渡し、cwd = 隔離 repo、`setsid` で起動。timeout で process group ごと停止 → `timeout`。
3. 終了コード非 0 → `error`。`git status --porcelain --untracked-files=all` に `:allowed-files` 以外があれば `fail`（accept は走らせない）。それ以外は `accept.sh <repo>` の exit 0 を `pass`、他を `fail`。
4. events（stream-json）から `init` の model と `tool_use` の回数（read / explore / edit / bash / other）だけを数える。1 行でも読めなければ `events-readable? false` にして回数は nil（壊れた記録から数えない。受入結果は変えない）。
5. `trials/<task>-<arm>-<rep>.edn` に metadata だけを保存し、一時ディレクトリ（events / stderr を含む）は削除する。prompt 本文・エージェント出力・課題文は出力 DIR に残さない。

### arm B の契約文の取り方

`harness_eval.bb contract` が別プロセスで `task_board_runner.bb` を `load-file` し（`babashka.file` が本ファイルなので runner の main は起動しない）、`prompt-for` が `:implement` で並べる順に `claude-policy-prompt` / `delegation-prompt` / `append-note-instruction` / `lane-contract` の出力と、`prompt-for` 内の固定文を組み立てる。`prompt-for` 自体は vault と ticket を要求するので呼ばない。使った関数名は trial の `:harness-contract-fns` に残す。契約文の変更は `harness_version`（arch の短 SHA）で追う。

両 arm に同じ安全条件（作業ディレクトリ外の変更・ネットワーク・secret・Task Board・vault・委譲ヘルパー・GitHub を使わない）を付ける。契約文が要求する委譲や Notes 追記は、この安全条件で「実行しない」と明示する。これは arm B の「指示の矛盾を処理するコスト」を含めた比較で、安全条件を外して勝たせる比較ではない。

### 判定（暫定。断定しない）

- 判定は両 arm で試行された同じ「課題 × 繰返し」の組だけで行う（途中停止などで片方にしかない試行は除外し、`excluded_unpaired_trials` に件数を残す）。
- 比較できる組が 3 未満 → `insufficient`。
- arm B の合格が arm A より 2 件以上少ない、または所要時間 p50 が 1.5 倍超 → `suspected`。それ以外 → `no_regression`。
- `compare` は根拠（pass_gap / p50_ratio / timeout_gap / tool_calls_total_gap / prompt_chars_gap）と「同条件での再評価を推奨」の注記を付ける。

### Prometheus 系列（`prom` が stdout に出す。ledger への連結は後続）

```
ai_ops_harness_eval_info{definition_version}
ai_ops_harness_eval_generated_timestamp_seconds
ai_ops_harness_eval_budget{part}
ai_ops_harness_eval_trials{model_rev,harness_version,arm,task,outcome}   pass/fail/timeout/error を 0 件でも出す
ai_ops_harness_eval_seconds{model_rev,harness_version,arm,quantile}       試行 0 なら出さない
ai_ops_harness_eval_tool_calls{model_rev,harness_version,arm,kind}        読める試行が無ければ出さない
ai_ops_harness_eval_regression{model_rev,harness_version,status}         insufficient / no_regression / suspected
```

## 検証手順

```
bb tests/harness-eval/test_harness_eval.bb      # 12 tests / 101 assertions
python3 tests/codex-workspace/ci-partition-test.py
```

テストが確認すること: 予算超過の拒否と記録、両 arm solve = `no_regression`、arm B noop = `suspected`、課題 2 件 = `insufficient`、timeout が分母に入る、許可外変更は accept 合格でも `fail`、exit 非 0 は `error`、壊れた events でも受入結果は保つ、stop-file で `aborted`、記録済み試行の再実行なし、出力 DIR に prompt / 課題文 / 契約文が無い、契約文が runner から取れる。

偽エージェントでの手元実行例（実モデルなし）:

```
bb docker/codex-workspace/task-board/harness_eval.bb plan --out /tmp/he --reps 3 --trial-timeout-seconds 60
HARNESS_EVAL_FAKE_ARM_B_MODE=noop bb docker/codex-workspace/task-board/harness_eval.bb run --out /tmp/he --agent-cmd "bb $PWD/tests/harness-eval/fake_agent.bb"
bb docker/codex-workspace/task-board/harness_eval.bb compare --out /tmp/he
```

## やらないこと・後続

- 実モデルでの初回評価（≤ 60 試行、既存の Claude Code / Codex subscription 経路のみ）は Owner の別判断（Obsidian `redesign-owner-summary.md` 未決事項 3）。新 provider・従量 API・GPU 試験は始めない。旧モデルが使えなければ「未比較」と記録し補完しない。
- `ai_ops_ledger.bb` への連結（`sli.prom` への追記と `ai_ops_harness_eval_export_ok`）と lolice の `AiOpsHarnessEvalRegression` rule は、#14461 の merge 後に別 PR で行う。
- 既定の agent-cmd は Claude Code の headless 実行（`--dangerously-skip-permissions`）。実行時は隔離 repo 以外への書込みを前提にしないが、OS レベルの sandbox は本評価器では追加しない（既存の codex-workspace の実行条件に従う）。
