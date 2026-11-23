# 仕様に沿う Lean モデルと実装への照合（標準の進め方・リポジトリ側）

Task Board runner の「少数の操作が色々な順で来る」部分は、仕様の規則を Lean の小さなモデルにし、
モデルから作った手順を実装に流して比べる。標準手順の正本（適用する変更・しない変更、仕様書の置き方、対象の順位）は
Obsidian vault の `Projects/lean-spec-driven-testing/standard.md`。ここにはリポジトリで手を動かすときの決まりだけを書く。

## いまあるモデル

| 対象 | ディレクトリ | 再生テスト | 仕様の正本 |
|---|---|---|---|
| ticket lock・計画停止・再起動（BOXP-650 / 652） | [lock-model/](lock-model/README.md) | `task-board-lock-trace-test.bb` | `lock-model/README.md` の規則表 |
| PR gate 失敗予算（ticket pool）と run 開始の予約（BOXP-673） | [gate-budget-model/](gate-budget-model/README.md) | `task-board-gate-budget-trace-test.bb` | vault `Projects/task-board-gate-budget/spec.md` |

## 進め方（新しい振る舞い・振る舞いの変更）

1. **仕様**: その機能の現行仕様の note（vault。`bb docker/codex-workspace/task-board/spec_index.bb show <機能名> --vault <vault>` で場所が出る）に、
   番号つきの規則と具体例を書く。状態と順序が効くなら状態の移り変わりの図と条件・例外も書く。
2. **モデル**: 規則を `step`（1 操作の後の状態）と定理にする。規則と定理は 1 対 1。README に対応表を置く。
3. **手順**: モデルを実行して生成物（`*-traces.txt.gz`）を作り直す。期待値はモデルが出す。実装を読んで写さない。
4. **実装**: 再生テストが不一致 0 になるまで直す。先に不一致（Red）を見る。

適用しない変更（入力→出力の関数、外部の応答で決まる流れ、文面・設定・文書だけ、規則が言えないもの）は、
PR 本文か Notes に 1 行で理由を書く。形だけの Lean ファイルを添えない。

## 書き分けること（混ぜない）

- 仕様が正しいか: 人が読んで確かめる。
- モデルの証明: モデルが、全ての順序で規則を守る。実装には届かない。
- 実装への照合: 実装が、生成した手順の範囲でモデルと同じ結果になる。より長い並び・モデルが省いた要素・実際の同時実行は範囲外。

README には毎回「モデルが扱わないもの」「手順の長さ」を書く。

## CI

main の必須 check は `status-check`（`.github/workflows/test.yaml`、`pull_request_target`）。
そこから `test-task-board-lock-model.yml` を job `lock-model` として呼ぶ。

| job | 中身 | 動く条件（`wc-path-filter.yaml`） | 目安 |
|---|---|---|---|
| `lock-model / lean` | 全モデルの定理の検査（`sorry`・足した公理があれば失敗）と、生成物がモデルから作り直したものと同じか | `lock-model`: モデルのディレクトリ、検査の workflow、`wc-path-filter.yaml`、`test.yaml` | Lean の取得を含め 5 分前後 |
| `lock-model / replay` | 生成物を runner の実関数に流す（bb だけ） | `model-replay`: 上に加えて、再生テストと `docker/codex-workspace/task-board/**` | 1〜2 分 |

- どちらかが失敗すると `status-check` が失敗し、merge できない。対象外の PR では job は skip され、`status-check` に影響しない。
- runner だけを変えた PR では Lean は入れず、再生だけが動く。モデルを変えた PR では両方が動く。
- 必須の検査は **base（main）側の workflow** で PR の中身を調べる。モデルの一覧（`models=`）と再生テストの一覧（`tests=`）は
  workflow の中にあるので、PR が自分でモデルを一覧から外しても、その PR の検査は変わらない。
- workflow 自体を変える PR では、変更後の定義を merge 前に試すために同じ検査が `pull_request` でも 1 回動く（必須 check ではない）。
- 以前あった合否に影響しない job `lock-trace`（`test-codex-task-board-runner.yml`）は、必須の `replay` に置き換えて消した（同じ再生を 2 回動かさない）。
- 時間切れで job が cancel 扱いになると `status-check` は失敗にならないので、各 step に上限を置いてある。

## モデルを足すとき

1. `tests/codex-workspace/<名前>-model/` に `<Module>.lean`、生成物、README（規則と定理の対応、操作と実装の対応、扱わないもの、再現の手順）を置く。
   Lean の版は全モデル共通で `lock-model/lean-toolchain` と `lock-model/lean-linux.tar.zst.sha256`。
2. 再生テスト `tests/codex-workspace/task-board-<名前>-trace-test.bb` を置く（隔離: 一時ディレクトリ、`env` の差し替え、テスト用フックの拒否）。
3. `test-task-board-lock-model.yml` の `models=` と `tests=`、`wc-path-filter.yaml` の `lock-model` と `model-replay` に足す。
   検査は base 側の定義で動くので、**足した PR 自身では新しいモデルは必須の検査に入らない**（`pull_request` 側の実行で確かめる）。次の PR から必須になる。
4. この表と、vault の `Projects/lean-spec-driven-testing/standard.md` の対象表を直す。
5. 検出力を測る: `task-board-mutation.bb --config <対象関数と再生テストだけの設定>` で、既存テストだけの場合と比べる。
   手順の深さは、検出できる変異が増えなくなる所と再生の時間で決める（毎回の CI に巨大な列挙を載せない）。
