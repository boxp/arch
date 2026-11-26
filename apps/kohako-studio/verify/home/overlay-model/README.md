# 返答の表示モデル

現行仕様: vault `Projects/kohako-home/reply-dismiss-spec.md`。規則1・2は `overlay_preserves`、規則4の内部操作は `inside_preserves`、規則3は `outside_closes`、規則4の新返答は `fresh_shows`。深さ3の全64通りを `lean --run ReplyDismiss.lean > traces.txt` で生成する。

モデルは適格な保持返答の表示だけを扱い、通信、音声、DOM、同時入力、押下とクリックの個別の位置を抽象化する。証明はモデルについての保証であり、実装との一致は生成手順の再生範囲に限る。仕様自体の妥当性は人が判断する。

画面照合は `overlay647.mjs` が生成物から実画面で実行可能な4列を選択して再生する（各画面）。残り60列の実装照合は行わない。`overlay` は履歴の開閉、`inside` は本文クリック、`outside` は舞台余白へのクリック/タップ、`fresh` はBFFモックの新返答に対応する。詳細なイベント位置・音声・通信・同時入力はモデル外。


| 仕様規則 | 定理 |
|---|---|
| 1・2: オーバーレイの操作で表示状態を変えない | `overlay_preserves` |
| 3: 独立した外側操作で閉じる | `outside_closes` |
| 4: 内側操作は保持 | `inside_preserves` |
| 4: 新返答は再表示 | `fresh_shows` |

Lean 4.36.0（`lean-toolchain`）で定理を検査する。`lean --run ReplyDismiss.lean | cmp - traces.txt` で生成物を照合できる。実装側は選択した4列の最終状態に加え各操作後も確認する。途中状態は、残りをモデル上の恒等操作 `overlay` で埋めた生成列の出力から得る。証明は全ての入力状態に対する各遷移の性質であり、具体的DOMによる操作分類や実装全体の正しさの証明ではない。
