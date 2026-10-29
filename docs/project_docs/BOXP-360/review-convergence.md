# BOXP-360 レビュー収束性の棚卸し (2026-10-29 05:30 UTC)

Owner 指示 (2026-10-29 05:15 UTC、レビュー反復過多の是正) に基づく棚卸し。レビュー gate を弱める提案ではない。

## 1. 事実

- codex-review の gate 失敗は 58 回、指摘は合計 96 件 (P1 60 / P2 36)。各 run の review artifact は `~/.codex-task-board/runs/BOXP-360/*/codex-review-14223.md`。
- 修正のたびに回帰テストを追加し、test.sh は 20 件から 123 件まで増えた。テスト件数が増えたことは品質や有益性を示す証拠にはしない。
- 02:40 UTC 以降に修正した約 50 件のうち、実 baseline (extract → aggregate) の SLI 値を変えたものは 4 件だけ。
  - 05:05 の first acceptance 母集団変更
  - 03:52 の日粒度受入と同日の是正を前後不明に変更
  - 03:45 の保守的分母
  - 03:12 の unknown-cause 重複除外
- 残りは、未接続 source (approval/rescue/effect/safety/Hermes) や破損・不正入力、synthetic でしか到達しない入力を扱う修正。修正前後で live aggregate 出力は完全に一致した。

## 2. 指摘の分類

| 区分 | 定義 | 件数 (概数) | 例 |
|---|---|---|---|
| ① 今回必須 | 漏えい・誤った 0 件報告・実 baseline の値誤り | 約 20 | extract/Prom の privacy gate 迂回 (02:13, 02:33)、未接続 source の 0 件報告 (02:13)、再オープンの状態判定、first acceptance の母集団 (05:03)、日粒度受入 (03:52)、baseline 数値の不一致 |
| ② 将来改善 | 現在の scope では未接続、または到達できない入力 | 約 65 | 不正 severity・event_type・effect_key、collector 停止 marker、人再分類の evidence 照合、keyword/文字列の型揺れ、正確な受入時刻と日粒度是正の組み合わせ (05:15、今回修正) |
| ③ 文書・nit | 文書と数値の不一致、表記 | 約 10 | plan.md/README/owner-summary の数値ずれ (live データ増分による再生成の往復) |

②の大半は「入力が不完全なら SLI を unknown にする」という同じ不変条件を、SLI ごと・入力種別ごとに局所 patch したものです。設計上の問題は 1 つにまとまります。各 SLI がそれぞれ独自の欠落判定を持ち、時刻の精度も event 種別ごとに個別に扱っているため、新しい組み合わせを作るたびに reviewer が新しい穴を見つけられる構造になっています。

## 3. 設計是正案 (後続、本 PR では実施しない)

1. **入力完全性の一元判定**
   - 全 event を `{complete | lost(reason) | unverifiable(field)}` に分類する関数を 1 つにする。
   - 各 SLI は「依存する event 種別集合」だけを宣言し、unknown 判定はその集合と欠落集合の積だけで決める (決定表)。
2. **時刻は全 event を区間 `[earliest, latest]` で表す**
   - 精度は ns/second/day とする。前後関係は区間比較の 3 値 (`before` / `after` / `indeterminate`) に統一する。
   - 今回の修正で、是正側には `corr-interval` として導入済み。
3. **property/invariant テスト**
   - 生成 event 列に対して次の不変条件を検査する。
     - 任意の event を削除・破損させても SLI が unknown か不変で、合格数は増えない。
     - 入力順序や再送に依存しない。
     - 分母を黙って減らさない。
   - 個別の回帰ケースを積み増す方式を置き換える。
4. **baseline は固定入力 snapshot とコード版で再現する**
   - live データの増分による毎回の再生成と文書修正の往復をやめる。

## 4. 反復が止まらない原因 (runner、read-only 調査)

- `/opt/codex-workspace/task-board/task_board_runner.bb` の `retry-fingerprint` は `url | gate | sha256(:message)` で、`:message` には codex-review の要約本文が入る。
- そのため、指摘内容が毎回変わると fingerprint も変わり、`count` が毎回 1 から始まる。`~/.codex-task-board/state.edn` の `:pr-gate-retries "BOXP-360"` には fingerprint が 58 件あり、すべて `count 1` だった。
- 結論として、retry-limit 2 は「同一文面の指摘」にしか効かず、ticket や PR をまたいだ連続ラウンドの予算は存在しない。
- 正式修正案 (runner 側の別票で扱う。本 run では上限の迂回も変更もしない):
  - fingerprint から review 本文 hash を外し、`url | gate` 単位で累積 count を持たせる。
  - それとは別に、ticket 単位の連続 gate 失敗上限を設ける (例: 10)。超えたら Blocked と triage 要求にして自動続行を止める。
  - PR head の変更では count をリセットしない。

## 5. 判断依頼

- 合意事項: ②③を後続リストとして扱うことに reviewer (codex-review) と Owner が合意すれば、①は修正済みなので本 PR は収束扱いにできる。
- 合意を得るまで: 本 ticket は自動の再レビューループを止め、Blocked (triage 待ち) で返す。
- 承認待ち境界は維持する: 新しい本番 instrumentation、再起動、新基盤の導入は引き続き Owner の一点承認待ち。
