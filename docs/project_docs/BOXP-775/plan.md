# BOXP-775: Task Board runner が未解決のレビュー指摘を票へ自動記録する

現行仕様: Obsidian vault `Projects/task-board-review-findings/spec.md`

## 問題
PR gate の codex review が P0/P1 を返しても、票の Notes には「inspect the referenced run artifacts」としか残らず、
所見は run 成果物（`*-blocking.md` / `pr-gate-diagnostic.edn`）にしかなかった（BOXP-727/765/769）。

## 方針
- runner の lifecycle commit 内（lock 所有確認の後、レーン移動・最終 Notes・通知の前）で、
  `review-findings:<id>` 印つきの安全な 1 行要約を Notes に書く（blocking / unavailable / low-only / resolved）。
- 生出力は写さない。P1 は 1 行・伏字・160 文字、P0 は場所と件数のみ。
- id は PR・head・所見・停止状態の hash。印の確認と追記は ticket の書き込み lock 内で行い重複しない。
- 書けなければ `review-findings-pending.edn` に保留し、次の記録時と runner tick で再送。run の `review-findings.edn` にも結果を残す。
- gate 評価後に例外で落ちた場合も例外経路で記録する。lock を失った run は書かない。
- レビュー判定・予算・再試行・通知の判断は変更しない。

## 検証
- `tests/codex-workspace/task-board-review-findings-test.bb`（合成データ）: 内容・伏字・P0 非記載、停止状態ごとの id、取得不能の明示、
  重複なし・再処理、書き込み失敗→保留→再送、8 並行で 1 行、lifecycle 内の順序・lock 喪失・異常終了。
- Lean モデルは作らない: 単一関数の冪等追記で、順序の組み合わせは直接テストで列挙する（実並行性は単一プロセスのスレッドのみ）。
- 配備後、実 run の票で記録を確認する。
