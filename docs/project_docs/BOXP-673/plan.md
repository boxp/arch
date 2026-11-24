# BOXP-673: 仕様に沿う Lean モデルと実装照合を標準の進め方へ組み込み、PR gate 失敗予算へ広げる

> 票ごとの記録。いま適用されている内容は Obsidian vault の
> `Projects/lean-spec-driven-testing/standard.md`（標準手順）と `Projects/task-board-gate-budget/spec.md`（失敗予算の仕様）。
> リポジトリ側の手順は [tests/codex-workspace/MODELS.md](../../../tests/codex-workspace/MODELS.md)。

## 何を決めたか

| 項目 | 決定 | 理由 |
|---|---|---|
| 最初に広げる領域 | PR gate 失敗予算（ticket pool・PR 数に応じた上限・grant・除外）と run 開始の予約 | 票の第 1 候補「予算の予約・消費・返却」に当たる。規則が文章（BOXP-369 / 448 / 450）で既にあり、実装からではなく仕様からモデルを起こせる。関数が 1 操作ずつ呼べる形になっている |
| 規則の出どころ | 3 つの plan の文章。実装は「どの関数を呼ぶか」の対応づけにだけ使う | 実装を写した期待値にしない |
| CI | 既存の必須 check（`status-check` ← job `lock-model`）を全モデル対応にし、手順の再生も同じ経路へ移す。合否に影響しない job `lock-trace` は消す | 新しい必須 check を増やさない。同じ再生を 2 回動かさない（BOXP-671 の重複の所見と同じ向き） |
| 重い検査の頻度 | Lean はモデルを変えた PR だけ。再生はモデル・再生テスト・runner を変えた PR だけ | 毎回の CI に巨大な列挙と 3GB の道具を載せない |
| 標準の契約の置き場 | runner の prompt（実装・レビュー修正・再開）、リポジトリの `MODELS.md`、vault の標準手順 | 担当が毎回読む場所に置く |
| 適用外の扱い | 理由を 1 行書く。PR 本文の機械検査はしない | 形だけの Lean 添付を生まない |
| 仕様書の置き方（TD-02） | 文書に「現行 / 案 / 履歴」の印を付け、機能ごとの索引を 1 つ置く。フォルダの木への移動はしない | 既存資料を壊さず、取り違えを機械で検査できる。比較は vault の標準手順 3 章 |

## 作ったもの

| 場所 | 中身 |
|---|---|
| `tests/codex-workspace/gate-budget-model/GateBudgetModel.lean` | モデル、定理（規則 10 件）、手順の生成器。Lean 本体だけ |
| `tests/codex-workspace/gate-budget-model/gate-budget-traces.txt.gz` | 生成済みの手順 26,034 本（142,239 操作。圧縮後 約 0.11MB） |
| `tests/codex-workspace/gate-budget-model/README.md` | 規則と定理の対応、操作と実装の対応、扱わないもの、再現の手順 |
| `tests/codex-workspace/task-board-gate-budget-trace-test.bb` | 手順を runner の実関数に再生して比べる（bb だけ、約 40 秒） |
| `.github/workflows/test-task-board-lock-model.yml` | job `lean`（全モデル）と job `replay`（全再生テスト）。どちらも必須の経路 |
| `.github/workflows/wc-path-filter.yaml`・`test.yaml` | 出力 `model-replay` を足し、`lock-model` job に `lean` / `replay` の要否を渡す |
| `.github/workflows/test-codex-task-board-runner.yml` | 合否に影響しない job `lock-trace` を削除。`spec-index-test.bb` を 1 行追加（BOXP-675 の suites の分割には触れていない） |
| `docker/codex-workspace/task-board/task_board_runner.bb` | `spec-first-contract-prompt` を実装・レビュー修正・再開の prompt に追加 |
| `docker/codex-workspace/task-board/spec_index.bb`、`tests/codex-workspace/spec-index-test.bb` | 現行仕様の索引を読む・検査する道具とそのテスト |
| `tests/codex-workspace/MODELS.md` | 進め方、CI、モデルの足し方 |

## 結果

### 実装との食い違い

手順 26,034 本を今の runner に再生して **不一致 0**。新しい runner の不具合は見つかっていない。
規則は仕様の文章から起こしたが、文章も実装も同じ人たち（過去の担当）が書いているので、0 件は「仕様どおりに実装されている」ことの確認で、仕様そのものが正しいことの証拠ではない。

### モデルを書いて見つかった仕様の穴（実装の不具合ではない）

1. **開始後に知った PR は排他されない。** 「同じ PR を 2 つの ticket が同時に触らない」（BOXP-369）は、予約が「開始時点で失敗歴のある PR（と本文の PR）」だけを見るので、run が開始後に初めて触った PR には効かない。BOXP-369 の plan は「PR URL を参照しない新 ticket」の場合を書いているが、同時実行については書いていない。定理（規則 10）を書くために「予約」を状態として置いたところで分かった。直すかどうかは未決定で、vault の仕様に穴として記録した。
2. **上限の式の `max(1, N)` は効いていない。** `unit × max(1, N)` を `unit × N` に変えても、`unit + 旧 grant` の側が必ず unit 以上なので上限は同じ（変異 `1 -> 0` が生き残って分かった）。仕様の書き方が冗長というだけで、挙動は変わらない。
3. **除外で「上限 ＜ 失敗の数」になる。** 「失敗の数は上限を超えない」は除外をしない場合にだけ成り立つ（定理の前提に明記）。除外は水増しを戻す操作なので意図どおりだが、どの plan にも書かれていなかった。

### 検出力（変異テスト）

BOXP-616 の道具（`task-board-mutation.bb`）で、失敗予算に関わる **14 関数** の式を 1 か所ずつ変えた **70 件** を作り、同じ 70 件を別々のテストで判定した。
変異は道具が作る隔離コピーの中だけで、checkout・稼働中の runner・実際の vault と予算ファイルには書いていない。

対象の関数: `gate-failure-budget-limit` `canonical-pr-id` `gate-budget-usage` `gate-budget-scope-prs` `gate-budget-status`
`record-gate-pr-registrations!` `gate-budget-exclude-pr!` `record-gate-failure-budget!` `gate-budget-ticket-pr-ids`
`gate-budget-exhausted-in?` `gate-budget-exhausted-for-ticket?` `gate-budget-reservation-live?` `reserve-gate-budget-run!` `gate-budget-grant!`

| テスト | 検出 | 見逃し | 検出率 |
|---|---|---|---|
| 既存の直接テスト（`task-board-runner-boundary-test.bb` と runner 内蔵の `test`） | 56 | 14 | 80.0% |
| 生成した手順（初期状態から深さ 5 だけ。最初の版） | 58 | 12 | 82.9% |
| 生成した手順（出発点 3 つを足した今の版） | 60 | 10 | 85.7% |
| 直接テストか生成した手順のどちらかが検出 | 67 | 3 | 95.7% |

| 内訳（直接テスト × 今の生成手順） | 件数 |
|---|---|
| 両方が検出 | 49 |
| **直接テストは見逃し、生成した手順が検出** | **11** |
| 直接テストが検出、生成した手順は見逃し | 7 |
| 両方が見逃し | 3 |

**直接テストは見逃し、生成した手順が検出した 11 件**（うち 10 件は既存の e2e が検出する。下の「e2e での確認」）

| 関数 | 変異 | 壊れる規則 |
|---|---|---|
| `reserve-gate-budget-run!` | 6 件（`filter`↔`remove` 3、`and`→`or`、`(not x)`→`x` 2） | 上限に達したら始めない（規則 4）、同じ PR を同時に予約しない（規則 10）、生きている予約だけを数える |
| `gate-failure-budget-limit` | 2 件（`max`↔`min`） | unit は設定で下げることしかできない |
| `record-gate-failure-budget!` | `some`→`every?` | 失敗を処理した後に上限へ達したかの返り値 |
| `gate-budget-ticket-pr-ids` | `filter`→`remove` | 予約するのは自分が失敗した PR |
| `gate-budget-grant!` | `when-not`→`when` | grant は正の数だけ |


**直接テストが検出し、生成した手順が見逃した 7 件**

| 関数 | 変異 | 見逃した理由 |
|---|---|---|
| `gate-budget-status` | `+`→`-`（PR の旧上限）、`0`→`1` / `-1`（amount のない grant の予備の値）、`1`→`0` | PR への grant と壊れた記録はモデルの対象外。`1`→`0` は上の「仕様の穴 2」で、挙動が変わらない |
| `gate-budget-reservation-live?` | `or`→`and`、`and`→`or` | lock が空・読めない場合の予備と、別の run の lock が残る場合。モデルの対象外 |
| `canonical-pr-id` | 正規表現の大文字小文字 | PR URL の表記ゆれはモデルの対象外 |

**両方が見逃した 3 件**: `gate-failure-budget-limit` の下限 `1`→`0` / `2`（unit を 1 未満に設定した場合。再生は unit = 2 固定）、
`reserve-gate-budget-run!` の「上限到達」のログ出力の分岐（挙動は変わらない）。

### 出発点を足した経緯（生成したテスト自身の Red → Green）

最初の版（初期状態から深さ 5 の 22,535 本）は不一致 0 で通ったが、変異テストで
`reserve-gate-budget-run!` の「他 ticket の予約だけを見る」を逆にした変異（`remove`→`filter`）と、「上限に達していない **かつ** 衝突がない」を「または」にした変異が生き残った。
つまり **規則 10（同じ PR を同時に予約しない）は、モデルでは証明されているのに、実装に対しては 1 度も試されていなかった**。
衝突の場面は最短でも 8 手かかり、深さ 5 にも深さ 6（72,581 本・再生 約 130 秒）にも入らない。

- Red: 上の変異 2 件を入れた runner に対して、最初の版の手順は通ってしまう（見逃し）。
- 対応: モデルに「途中の状態から始める手順」（`seeds`、3 つ）を足し、再生側は予約の判定を毎回通すようにした。
- Green: 作り直した 26,034 本は、元の runner で不一致 0、変異 2 件はどちらも不一致として検出。`reserve-gate-budget-run!` の検出は 7 件中 4 件 → 6 件（残る 1 件はログ出力だけ）。

深さを上げるのではなく出発点で補ったので、再生は約 30 秒 → 約 40 秒の増加で済んだ。

### e2e での確認

上の 11 件がある 5 関数の変異 16 件を、失敗予算を扱う既存の e2e 12 ケース（`test_gate_failure_budget_*`、1 回 約 170 秒）だけで判定した。

- 11 件のうち **10 件は e2e が検出**した。直接テストの穴を e2e が埋めている。
- **e2e も直接テストも見逃し、生成した手順だけが検出したのは 1 件**: `gate-budget-ticket-pr-ids` の `filter`→`remove`
  （予約する PR が「自分が失敗した PR」ではなく「他の ticket が失敗した PR」になる。規則 10 が壊れ、無関係な ticket 同士が止め合う）。
- 既存のテスト全体（直接 + e2e 12 ケース）で見ると、70 件のうち 66 件を検出し、生成した手順は 60 件（合わせると 67 件）。**この領域では既存のテストの方が広い。**
  生成した手順の利点は、(a) 既存が見逃す 1 件、(b) e2e が数分かけて見つける 10 件を 約 40 秒の再生で見つけること、(c) 規則と 1 対 1 の定理があること。
  lock の領域（BOXP-650: 既存が見逃して生成手順が検出 10 件）ほどの差はない。失敗予算は BOXP-369 のときに e2e を厚く書いてあったため。
- 直接テストが見逃した 14 件は全て e2e でも判定した（上の 16 件に含まれる）。直接テストが検出済みの 56 件は e2e では測っていない。

### 道具（`spec_index.bb`）の Red → Green

仕様の決まり（vault の標準手順 3 章）からテストを先に書き、実装がない状態で 18 件の失敗を確認してから実装した（0 件）。
独立レビューの指摘（索引が壊れていても `show` が答えてしまう）も、テストを先に足して 7 件の失敗を確認してから直した。
入力→出力の検査なので Lean は適用していない。

### CI で確かめたこと（merge 前）

- workflow の検査手順を手元で通しで実行: 2 モデルとも定理・生成物の一致が合格。
- 失敗の確認: 失敗予算のモデルに `sorry` の定理を 1 件足した版で同じ手順を実行し、`bogus_rule depends on [sorryAx]` で失敗すること、lock のモデルは合格のままであることを確認。
- PR 上: 変更後の workflow（`pull_request` 側）で job `lean` と `replay` が合格。
- 必須の経路（`pull_request_target`）は base 側の定義で動くため、この PR 自身では新しいモデルと再生は必須に入らない。merge 後に確認用 PR で確かめる（下の「残り」）。

## 保守の手間

- **最初に作る手間**（run の時刻からの概算）: 仕様 3 文書の読み込みからモデル・定理 10 件・再生器・最初の再生まで約 2 時間半（うち証明の調整が約 40 分）。モデル 約 410 行、再生器 約 160 行。
- **モデルの変更 1 回**（実際にやった「出発点を足す」。概算）: モデル 約 30 行、再生器 約 20 行、生成し直し、再生、README の更新で 約 20 分。定理は壊れなかった。
- **毎回の CI**: runner だけを変えた PR に、bb の再生 2 本（lock 約 25 秒 + 失敗予算 約 40 秒、bb の取得込みで 1〜2 分）が足される。Lean（取得込みで 3〜5 分）はモデルを変えた PR だけ。
  合否に影響しない job `lock-trace`（約 1 分）は消したので、runner を変える PR の実行数は増えていない。
- **証明の書き方で分かったこと**: 場合分けを先に全部やってから自動証明に渡すと時間切れになる。`step` の分岐を先に割ってから渡す形にして、全体で約 35 秒に収まった。

## 保証の範囲（混ぜない）

| 何を | どこまで |
|---|---|
| 仕様が正しいか | 人が読む。今回、穴を 3 つ記録した |
| モデルの証明 | ticket 2 件・PR 2 件・unit 2 のモデルについて、全ての状態（規則 9・10 は全ての操作順と長さ）で規則 1〜10 が成り立つ |
| 実装への照合 | 初期状態から最長 5 手と、3 つの出発点から最長 3 手の 26,034 本の範囲で、実装がモデルと同じ結果になる |
| 範囲外 | より長い並び、ticket 3 件以上・PR 3 件以上、unit の他の値、実際の同時実行、本文が参照する PR、lock の期限切れによる予約の失効、停止の報告と Blocked への遷移 |

## 適用しなかったもの

- **自動継続の回数**（`consume-continuation!`）: 当初は一緒にモデルにする案だったが、失敗予算とは独立した 1 つのカウンタで、同じモデルに入れると状態の数だけが増える。次の対象の第 1 候補にした。
- **通知の配送と返信の待ち行列**: BOXP-667 の改修が進行中。所有者と調整してから。
- **GPU の実行時切替**: 実機の応答に依存する部分が多く、モデルにできる範囲の切り出しが先。
- 既存コードの遡っての形式化、本番への欠陥の注入、無関係な進行中の票の停止はしていない。

## 残り（merge 後）

1. 確認用 PR で、必須の経路が効くことを見る: 証明を壊す / 生成物を古くする / runner を壊して再生が食い違う、の 3 通りで `status-check` が失敗し、無害な変更で通ること。確認用 PR は閉じる。
2. codex-workspace の image 更新後、稼働中の runner の prompt に標準の順序が入っていること、`/opt/codex-workspace/task-board/spec_index.bb check` が vault に対して通ることを読み返す。
3. vault の標準手順にある「未反映」の注記を消す。
