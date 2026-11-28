# BOXP-753: Fable の停滞レビュー後に元票の自動再試行枠を更新する

## 背景

- BOXP-749 は 06:24 に停滞レビュー BOXP-751 を依頼し、06:27 に Fable が結果（案 A）を返した。
- 06:28 に元票が `停滞レビュー受領: BOXP-751` を記録した時点で、票の gate 失敗予算は 9/10（PR 1 件 × 10）。
- 同じ run（案 A の実装）が codex-review で落ちて 10/10 になり、`gate-failure-budget-exhausted` で停止した。
  レビュー前の消費だけで、新しい方針を 1 回しか試せずに止まった。

## 方針（現行仕様: vault `Projects/task-board-gate-budget/spec.md` 規則 11）

元票の Notes に `停滞レビュー受領: <レビュー票>` があり、そのレビュー票が `stagnation-review-of:: <元票>` で結び付いて
status が done のとき、runner はそのレビュー 1 件について 1 回だけ「補充」を判定する。

- 補充すると ticket 上限 = その時点の失敗の数 + 基本枠（unit × max(1, N)、既定 10 × 実 PR 数）。残りがちょうど基本枠になる。
- 条件（全部）: 上限に達していない / 前回の補充（なければ記録の始まり）より後に失敗が 1 件以上 / 補充が 2 回未満 / 失敗の数 + 基本枠 ＞ 上限。
- 判定の時点: run の開始（`reserve-gate-budget-run!`）、失敗の計上の直前（`record-gate-failure-budget!`）、Owner の ticket grant の直前（`gate-budget-grant!`）。
- 判定の結果は `gate-failure-budget.edn` の `:stagnation-refreshes` に追記（補充した/しなかった・理由・その時点の数）。同じレビューは二度と判定しない。
- 補充しない: 依頼を作っただけ、再配送・重複、補充後に失敗のないままの次のレビュー（同じ方針の繰り返しの近似）、3 件目以降、止まった後に受け取ったレビュー。
- 維持するもの: 失敗の履歴、既存の grant（旧 grant / 追加 grant）、PR の登録・除外、PR 単位の排他、CI・P0/P1 の判定、停止の報告。
- BOXP-749 は現在 10/10 で停止中。この変更は止まった票を動かさない（grant の直前の判定でも上限到達中なので補充しない）。実票の台帳の手編集・個別増枠・再開はしない。

## 手順（spec-first）

1. 仕様: vault の現行仕様 note に規則 11、具体例 9 行、状態図の遷移、扱わないことを追記。
2. Lean: `tests/codex-workspace/gate-budget-model/GateBudgetModel.lean` を `step = core ∘ pre` に分け、操作 `review`・`redeliver` と
   規則 11 の定理（`refresh_restores_base` `exhausted_no_refresh` `no_refresh_without_new_failure` `no_refresh_over_cap`
   `refresh_once` `review_does_not_raise` `refresh_bounded`）を追加。規則 1〜10 の定理は `pre` が崩さないことを示して維持。
3. テスト: runner self-test に仕様の例から期待値を取った 14 件（実装前 7 件失敗 → 実装後全件成功）。
   モデルから手順を生成し直し、再生テストに `v`（受領）・`w`（再配送）を対応させる。
4. 実装: `task_board_runner.bb` の予算関数。プロンプトの「未受領レビュー」行に、受領後の自動補充と Owner grant 不要を一文追加。
5. 通常 CI・codex review → merge → workspace image 配備 → Pod 内 runner の読戻しと CLI での確認。

## 保証の範囲（混ぜない）

- 仕様が正しいか: Owner と担当が読んで確かめる。
- モデルの定理: ticket 2 件・PR 2 件・unit 2 のモデルについて全ての状態・操作順で成り立つ。
- 実装とモデルの一致: 生成した手順（深さは README の値）の範囲だけ。実際の同時実行、レビュー票・Notes の書き方のゆれは self-test の範囲。

## 戻し方

- PR を revert して image を戻す。`:stagnation-refreshes` は追記だけの新しい key で、旧 runner は読まない（上限は補充前の式に戻る）。
