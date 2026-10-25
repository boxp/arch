# BOXP-302: BOXP-301 の置換案照合失敗と Ready 確認経路を調査・是正し安全に再計画する

- チケット: BOXP-302（Obsidian vault `Tickets/BOXP-302.md`）、対象の実票: BOXP-301
- 担当: claude-fable（Task Board runner）
- 対象: `docker/codex-workspace/task-board/localllm_docs.bb`、`tests/codex-workspace/localllm-docs-test.sh`
- 取扱い: 原典本文・モデル出力の本文は cloud に転送しない。調査は run artifacts の非本文メタデータと、本文を読まないローカル数値診断（出現数・文字数・最長共通部分列・差分文字の code point）だけで行った。

## 1. 観測（BOXP-301）

| run | action | 結果 |
| --- | --- | --- |
| 20261025T112925Z-19416124-9bfd-403a-9be0-57c908942c60 | docs-groom（gemma4-26b、content-search） | ready。対象 `ひとはこさんバース/キャラ設定/モブ/高嶺花学院ヒロイン部.md` の節『### セリフ例』、read 1 |
| 20261025T113426Z-5dc16b01-50b6-4945-9f01-7faa30815406 | docs-edit（amend） | blocked `localllm-invalid-proposal`。`:corrections 1`（修正ラウンド 1 回も同じ理由）、`:decision apply`、`:amend {:auto-conflicts 0}`、書込なし |

- 配備中 runner（Pod 内 `/opt/codex-workspace/task-board/*.bb`）は arch main（7f31ca604）と同一。
- 拒否箇所: `interpret-amend` → `change-in-plan-section`（replace-text の old_text が計画の節本文に `count-occurrences = 1` でない）。モデルに渡した本文（`view`、自票 span 除去済み）と検査に使う本文は同一（`snap'`）なので、本文側の差異ではない。

## 2. 原因（確定）

ローカル数値診断（`/tmp/diag.bb` 相当、本文は表示しない）:

| 指標 | 値 |
| --- | --- |
| 対象ノート | 1096 字 / 33 行、『### セリフ例』本文 19 行（`####` 小見出し 4 行、`- 「…」` 形のセリフ行 12 行） |
| モデルの old_text | 40 字、改行なし、行頭 `- `、節内出現 0 件、ノート全体でも 0 件、空白・箇条書き正規化後も 0 件 |
| 最長共通部分列（節本文と） | 36 字 = 対象行（40 字）から `- 「` と `」` を除いた中身と完全一致 |
| 共通でない文字 | old_text 側: `U+002D U+0020 U+0022 … U+0022`、原文側: `U+002D U+0020 U+300C … U+300D` |

**結論: Gemma 4 はセリフ行の本文 36 字を一字違わず再現したが、鉤括弧「」(U+300C / U+300D) を JSON 文字列内で ASCII の二重引用符 (U+0022) に置き換えて出力した。** exact 照合は正しく 0 件と判定し、修正ラウンドも同じ形で失敗した。節内 12 行すべてが `- 「…」` 形なので、この票では原文引用方式の replace-text は成立しない（モデル固有の引用符正規化。要約・創作・見出し範囲違い・重複・既存マーカーのいずれでもない）。

## 3. 対策（最小・実証あり、曖昧一致なし）

`localllm_docs.bb`:

1. **行 ID 置換**: amend プロンプトに『計画の節の行一覧』を追加（節内の空行・見出し行・コードフェンス以外を `L1..Ln` で列挙）。replace-text の old_text に ID だけを書く規則を system prompt に明記（引用し直すと引用符が変わるため）。`interpret-amend` は ID を**その行の原文に厳密解決**してから既存の全検査（計画節内一意・マーカー・禁止語・長さ・執行側 `apply-change` の全文一意）を通す。ID が行一覧に無ければ拒否。fuzzy / 正規化一致は入れない。
2. **拒否理由の数値化**: 0 件と複数件を区別し、`本文での出現 n 件、old_text m 字` を理由に含める（本文は従来どおり `untrusted` 扱いで Notes には出ない）。0 件のときは行 ID の範囲（L1〜Ln）を案内し、修正ラウンドがそのまま構造化エラー修復になる。
3. **見出し行の置換を拒否**（堅牢化）: 節内の `####` 小見出しは section body に含まれ、従来は一意なら置換できてしまった。old_text に見出し行が含まれる replace-text を拒否。
4. audit `:amend` に `:line-ids`（ID 解決した変更数）を記録。

変更しないもの: backup / diff / 計画 hash（stale 検査）/ 他節不変 / rollback / accept / モデル選択（Gemma4 既定・Qwen `docs-model`）/ 修正ラウンド数（`max-corrections` 1）/ cloud 非切替。

`localllm-docs-test.sh`: 合成・非露骨 fixture『部員たち.md』（`### セリフ例` + `####` 小見出し + `- 「…」` 行）を追加し、
`test_canon_amend_replace_text_accepts_a_line_id_and_refuses_headings` で (a) 1 回目 ASCII 引用符の old_text → 0 件理由と ID 範囲の案内 → 修正ラウンドで `L1` → 当該行だけマーカー付き置換、他行・小見出し不変、accept でマーカー除去、(b) 小見出し `#### …` の置換 → 拒否・無変更、(c) 無い ID `L9` → 拒否・無変更、を検証。

## 4. Ready 確認経路の調査結果

- Owner gate は **ticket frontmatter の `assignee`** だけで判定する（`process-card!` は `ticket-frontmatter` を読む）。groom 終了の lifecycle commit は `status: ready` + `assignee: boxp` を同一コミットで書く。runner は card の `assignee::` 属性を**一切更新しない**（`normalize-card-line` は status / done のみ）ため、card `assignee::localllm` と ticket `assignee: boxp` の不一致は構造的で、bypass の証拠ではない。
- groom の ready 結果は outbox event を出さない（kohako への通知は Blocked 時のみ、`outbox/done/…-blocked.edn` が唯一）。runner / kohako 経由の自動再開経路は無い。
- docs-edit が 11:34:26 に Ready から開始したためには、11:31:08（groom commit）以降に誰かが frontmatter の assignee を `localllm` に戻している必要がある。runner のコードにその経路は無く、記録も無い（Obsidian 側の編集履歴は vault に無い）。Owner が Obsidian で assignee を戻した（= 通常の確認操作）可能性が最も高いが、本票では断定しない。
- lock / claim: `locks/` は空、`state.edn` に 301 の claim 無し、run 2 件とも summary `finished-at` あり。元 run は正規に終了・解放済み（重複実行・lock 削除・強制 tick は不要）。
- 是正: 本票ではコード変更しない（gate 自体は迂回されていない）。card の assignee 同期は Board 表示の改善であり別票で扱う。

## 5. 検証・配備

- black-box: 新テスト単体 pass。全体 `tests/codex-workspace/localllm-docs-test.sh` は本 run で実行（結果は下の記録節）。
- 実モデル再確認: 合成 fixture vault（原典不使用）で実 gemma4-26b により groom → amend を runner そのもので実行し、行 ID 置換が通るかを確認（記録節）。
- 配備: arch PR → CI → merge → image → Pod 再作成（通常経路）。配備後に Pod の `localllm_docs.bb` sha256 が main と一致することを確認してから 301 を再計画する。

## 6. BOXP-301 の安全な再計画手順（Owner 向け）

1. 配備完了後、BOXP-301 を **Backlog** に置き、frontmatter の `assignee` を `localllm` にする（`docs-mode` / `docs-target` / `docs-plan` は groom が再固定する）。
2. groom が対象・節・予定差分を Ready（assignee boxp）で提示する。**Owner が計画を確認し、assignee を localllm に戻したときだけ** docs-edit が走る（今回の Blocked 報告はこの確認の代わりにはしない）。
3. docs-edit は『### セリフ例』の行を ID で置換し Review で停止する。Owner が Obsidian で差分を見て `localllm-accept` / Notes で改稿指示 / `localllm-rollback`。
4. 本票（302）は手順提示までで、口調修正の完了は報告しない。

## 7. 記録（2026-10-25 run 20261025T114129Z-9eacaae6-0749-4ddc-9c32-7322b00343ab）

- codex review（`codex review --base origin/main`）: P2「行 ID 一覧が `truncate-text 12000` の対象外で長い節では `max-prompt-chars` を超える」→ `:amend-line-list-chars`（env `CODEX_TASK_BOARD_LOCALLLM_AMEND_LINE_LIST_CHARS`、既定 12000）で一覧を先頭から予算内に制限し、提示していない行の ID は解決しない（見せていない行を指させない）ように修正。
- black-box 全体 `tests/codex-workspace/localllm-docs-test.sh`: 78 テスト pass（exit 0）。review 反映後に amend 関連 3 テストを再実行し pass。
- 実モデル再確認（合成 fixture vault `/tmp/real-e2e-out`、原典不使用、実 gemma4-26b、runner `tick` そのもの）:
  - groom: 自然文票から `Refs/verse/キャラ設定/モブ/部員たち.md` の節『### セリフ例』を選定 → Ready + boxp（llm 65 s）。
  - amend: `:corrections 1`（1 回目は従来どおり拒否、修正ラウンドで行 ID に切替）→ `:line-ids 3`、replace-text×3 がマーカー付きで適用され Review 停止（llm 180 s）。小見出し `####` 2 行・他ノートは不変、backup / after-sha256 記録あり。
  - 観測: 3 件中 1 件は old == new の無変更置換（モデルの品質問題、runner は Review で Owner 判断に委ねる。別途 no-op 置換の自動拒否を検討する余地あり）。
- Ready gate: コード変更なし（§4）。
- 未実施（本 run の範囲外 / 後続）: PR merge → image → Pod 再作成 → 配備確認（sha256）→ §6 の手順で BOXP-301 を Backlog から再 groom。

## 8. 記録（2026-10-25 run 20261025T121943Z-60569f39-bb30-4d60-8f72-f03689011a34、PR gate codex-review 再試行 1/2）

- codex review（PR #14016）P2: 「行一覧の 12,000 字上限が対象ノートごとに適用され、最大 3 target では一覧だけで約 36,000 字、本文（各 12,000 字）と合わせ `:max-prompt-chars` 60,000 を容易に超え、正当な複数対象 amend が LLM 呼出前に block される」。
- 対策: 行一覧の予算を **全 target 共有** にした。`amend-line-lists` が計画順に 1 つの予算を配分（前の target が使った残りを次に渡す）し、`amend-line-list-budget` でその予算を `min(:amend-line-list-chars, :max-prompt-chars − 一覧なしプロンプト長 − 1000)` に抑える。プロンプト生成・行 ID 解決・拒否理由の ID 範囲はすべて同じ `line-lists`（ctx）を参照し、提示した行だけが解決される（fuzzy なし、従来どおり）。予算が 0 の target は一覧なしとなり、本文一意の原文引用による replace-text のみ有効（拒否理由の ID 案内も出さない）。
- テスト `test_canon_amend_line_listing_shares_one_budget_across_targets`: (a) 3 target × 5 行に予算 150 字 → 配分 [5 3 0]、合計が予算内、予算関数の 3 ケース（残余で抑える / cap で抑える / 残余なし→0）。(b) black-box: 2 target、2 つ目の節に約 13,000 字の行、`MAX_PROMPT_CHARS=20000` で amend tick → block されず Review 到達、一覧は省略付き、送信 prompt 文字数 ≤ 20,000（旧実装では本文 12,000 + 一覧 12,000 で超過し block）。
- 結果: amend 関連 4 テスト pass。全体テストの結果は PR 本文に記載。
- 手元 codex review 追加指摘 P2: 「固定 1000 字の予約では path / 節見出し長が無制限な一覧ヘッダーを保証できない」→ `fit-amend-line-lists` で実際に描画した request 長（system + user、ヘッダー込み）が `:max-prompt-chars` に収まるまで予算を超過分だけ縮めて再描画（予算は単調減少で 0 に到達し終了）。固定予約は撤廃。単体確認: 長 path 900 字 + 見出し 400 字 + 200 行、cap 9000 で素朴配分は 10,445 字に超過、fit 後は 8,999 字で 24 行提示。
- 手元 codex review 追加指摘 P2: 「一覧が途中省略される節で、省略行は ID 不可・原文引用は『一覧の無い節のみ』と書かれ、モデルが従える指定方法が無い」→ checker は従来から本文一意の原文を受理しているため、system prompt / 一覧ヘッダー / 省略注記の文言を実挙動に合わせた（一覧にある行は ID、一覧の無い節または省略行だけ一度だけ現れる原文をそのまま）。コード経路の変更なし。
- 手元 codex review 追加指摘 P2: 「節内に同一本文の行が複数あると、行 ID で正しく解決しても後続の一意性検査（出現 1 件）で拒否される」→ ID 解決時に行位置 `:line-index` を保持し、節内検査は「節の範囲内かつその位置の行が解決した本文と一致」で判定、apply も位置で 1 行を差し替える（位置の行が一致しなければ拒否、fuzzy なし）。位置指定の置換は同一ノート内で先に、下から順に適用し先行変更による行ずれを防ぐ。原文引用の replace-text は従来どおり一意性必須。テスト `test_canon_amend_line_id_replaces_one_of_two_identical_lines`: 同一行 2 本の fixture で `L3` → 2 本目だけ置換・1 本目保持・accept 後も同じ、原文 `- 「はい」` 指定は出現 2 件で拒否・無変更。
- 手元 codex review 追加指摘 P2: 「モデル応答に `line-index` を混入させると位置指定を偽装できる」→ resolve 前に change をスキーマの 5 キー（path / op / heading / old_text / new_text）に絞り、`:line-id` / `:line-index` は runner が行 ID を解決したときだけ付与。テスト（dup-raw モード）で `line-index` 混入応答が従来どおり出現 2 件で拒否されることを確認。
