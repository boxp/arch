# BOXP-652: Lean の証明・生成物整合性検査を merge の必須条件にする

前段: [BOXP-650](../BOXP-650/plan.md)（限定試行。Lean の検査は合否に影響しない CI として導入）

## 変更前の現物（2026-11-21 確認）

- main の merge 判定: ruleset `status-check`（id 4136226）と `block main branch`（id 508838）。どちらも必須 check は
  `status-check`（GitHub Actions）の 1 つだけ。branch protection（旧方式）は無い。
- `status-check` は `.github/workflows/test.yaml`（`pull_request_target`）の job。`needs` に並べた job のどれかが失敗すると失敗し、
  そうでなければ skip（= 通過）になる。
- Lean の検査 `Test Task Board Lock Model / lean` は別 workflow（`pull_request`）で、必須 check ではなく、
  しかも定理が通らなくても生成物が食い違っても warning を出して成功で終わっていた。
- Task Board runner の PR gate は PR の check に失敗が 1 つでもあると通さない（`ci-state`）。ただし上の通り Lean の job は失敗しなかった。

## 方式

ruleset は変えず、既存の必須 check `status-check` に Lean の検査をつなぐ（`test-ansible` と同じ型）。

| 変更 | 中身 |
|---|---|
| `test-task-board-lock-model.yml` | 定理が通らない、または生成物が食い違うと失敗する。`workflow_call` を足す。各 step に時間の上限。Lean の版と sha256 はモデルのディレクトリから読む |
| `wc-path-filter.yaml` | 出力 `lock-model`（モデルのディレクトリ、上の workflow、`wc-path-filter.yaml`、`test.yaml` の変更で true） |
| `test.yaml` | job `lock-model`（`lock-model` が true のときだけ上の workflow を呼ぶ）を足し、`status-check` の `needs` に入れる |
| `tests/codex-workspace/lock-model/lean-linux.tar.zst.sha256` | Lean の配布物の sha256（workflow から移した） |

選ばなかった方式: ruleset の必須 check に Lean の job を直接足す方式。必須 check は「報告されない」と全 PR が待ちになるため、
全 PR で動く job が要り、既に開いている PR（Renovate 多数）が更新されるまで merge できなくなる。無関係な PR への影響が大きい。

### 素通りを防ぐ点

- 必須の検査は base（main）側の workflow 定義で動く（`pull_request_target`）。PR の中で workflow を書き換えても、その PR の判定は変わらない。
- 検査 step は `continue-on-error` を使わず、定理と生成物の両方を調べてからどちらかが駄目なら exit 1。
- job の時間切れは cancel 扱いで `status-check`（`if: failure()`）に数えられないため、step ごとの上限で失敗にする。
- path-filter 自体が失敗した場合は `status-check` が失敗する（祖先 job の失敗）。
- 対象外の変更では job は skip で、`status-check` に影響しない。

### 変えていないもの

- ruleset・bypass の設定、他の job、`status-check` の条件式。
- 手順の再生（`lock-trace`）と変異テストの報告は合否に影響しないまま。対象のモデルも広げていない。
- runner の実装。

## 確認の計画

1. merge 前: この PR では `test-task-board-lock-model.yml` が変わるので、変更後の定義が `pull_request` で 1 回動く（成功の確認）。
   定理を壊した commit・生成物を変えた commit を別の確認用 branch で流し、job が失敗することを見る（確認用 PR は merge しない）。
2. merge 後（実経路）: main の `test.yaml` に対して確認用 PR を作り、
   定理を壊した PR・生成物を変えた PR で `status-check` が失敗して merge が止まること（`mergeStateStatus=BLOCKED`）、
   モデルだけの無害な変更で通ること、対象外の変更で `lock-model` が skip されることを見る。確認用 PR は閉じる。強制 merge はしない。
3. `test.yaml` を変えるので、merge 直後に `scripts/list-blocked-workflow-runs.sh` で BOXP-207 の hold が起きていないかを見る。

結果は確認後にこの文書へ追記する。

## 残る制限

- 既に開いている PR は、次に更新されるまで新しい判定が走らない。
- repository の admin は ruleset を bypass できる（既存の設定。変えていない）。
- `pull_request_target` で PR のモデル（Lean）を実行する。渡す権限は `contents: read` だけで secret は渡さない（`test-ansible` と同じ扱い）。
