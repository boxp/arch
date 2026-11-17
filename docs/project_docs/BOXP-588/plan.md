# BOXP-588: 再試行低減 B1（Notes 入力の抑制 ① と同一ファイル重大指摘の設計見直し誘導 ③）

正本: Obsidian `Projects/model-usage-attribution/retry-loop-reduction.md` 4章①③・7章、owner-summary。Owner は B1 を選択（BOXP-586 配送 event 経由）。

## 範囲
- runner（`docker/codex-workspace/task-board/task_board_runner.bb`）の prompt 生成と記録の追加のみ。
- 変えないもの: retry 指紋・上限、gate 失敗予算とその履歴、P0/P1 判定、CI/PBT、排他・停止条件、既定担当/モデル。B3（修正範囲の限定）は含めない。

## ① prompt に入れる Notes の上限
- `prompt-for` の「Ticket contents」部分だけを `prompt-ticket-text` で縮める。停滞判定（`stagnation-prompt` 等）は全文のまま。チケットファイルは変更しない。
- 上限 `CODEX_TASK_BOARD_PROMPT_NOTES_LIMIT_KB`（既定 40、0 で無効＝従来どおり全文）。上限以下の票は byte 単位で不変。
- Notes 以外（frontmatter/Summary/AC/Context/Plan、Notes の後の節）は常に保持。Notes は日付付き bullet を 1 エントリとし、続く行（`- 計算:` 等）は同じエントリに含める。
- 残す範囲（判定できる区分で書く。全称の約束はしない）:
  - 必ず残す: Notes 以外の節、最新 3 エントリ（最新訂正の保護）、Owner の返答経路の印があるエントリ（`[hermes-agent]`/`[owner]`/`[boxp]` の source、`家経由`、`reply_id`、`gate-budget-grant`、停滞レビュー依頼／結果）。
  - できる範囲で残す: Owner やその別名（本人/オーナー/user/利用者/ユーザー/依頼者 等）に言及するエントリ。語彙ではなく「誰についての記録か」で判定。
  - 残らない: 上のどれにも当たらない古い自由記述。**制約や判断が書かれていても省略される**（例: 誰の決定か書いていない「承認範囲は runner のみ。本番操作は禁止」）。設計正本 5 章が「わからないこと」として 2 週間の観測に回したリスク。
  - 補う手段: 省略があるときだけ、省略見出しで「merge・配備・本番操作・外部送信の前と承認範囲の判断時は全文ファイルを rg 等で検索して確かめる」と指示する。この制限と指示はテスト `notes-unattributed-constraint-is-omitted` で固定。
- 残りは新しい順に上限まで入れ、省いた連続区間は「N 件・K KB 省略、全文 path」の 1 行に置換。`## Notes` 直後に省略の説明行を入れる。

## ③ 同じ PR・同じファイルへの P0/P1 連続
- codex-review の blocking 指摘の場所からファイルを取り出し、チケット×PR×ファイルの連続回数を `same-file-review-streaks.edn` に記録（履歴は `same-file-review-history.jsonl` に追記）。review 通過・merge 済みで解除、別ファイルだけの指摘で連続が切れる。CI 等の他 gate 失敗は影響なし。
- 閾値 `CODEX_TASK_BOARD_SAME_FILE_REVIEW_STREAK_THRESHOLD`（既定 3、0 で指示を無効。記録は観測用に継続）以上で、次の implement/review-fix/blocked-retry の prompt に根本設計の見直し指示を追加。同根判定は近似なので「無関係なら理由を Notes に書いて通常修正」「承認範囲を超える設計変更は自動承認せず blocked(owner-decision) か停滞レビュー」を明記。

## 検証（配備前、モデル呼出しなし）
- 単体テスト（`tests/codex-workspace/task-board-prompt-budget-test.bb`）: 上限以下不変、無効時不変、Owner 決定保持、省略表示と全文 path、2 回非発火・3 回発火、解除、閾値 0。
- 既存 runner テスト全 shard の回帰なし。
- オフライン再生: 過去 run の実チケット（428/476/525/501・小型票）で縮小後サイズと保護エントリの保持を確認。BOXP-586 の `runs-cls.tsv` の review 指摘列を時系列再生し、発火 run と誤検知候補を数える。

## 配備後
- 通常 CI/review/merge → codex-workspace image 配備 → runner 復帰と実 prompt の読戻し（省略行が入ること、小型票で不変）。
- 2 週間、自然発生票で観測（品質、本人差戻し、総 token・未 cache、同根連続長、完走 run、親子 review）。架空の比較 run は作らない。観測開始/終了時刻と期限後の再確認予約を Notes に記録し、日本語で報告。

## 切戻し
- ① `CODEX_TASK_BOARD_PROMPT_NOTES_LIMIT_KB=0`、③ `CODEX_TASK_BOARD_SAME_FILE_REVIEW_STREAK_THRESHOLD=0`（別々に戻せる）、または revert PR。状態ファイルは追加のみで既存形式の移行なし。
