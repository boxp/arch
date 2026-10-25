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
- 手元 codex review 追加指摘 P2: 「ID 正規表現は 4 桁までだが一覧は 10,000 行以上を生成しうる」→ 一覧を 9999 行（`max-amend-line-ids`）までに制限し、解決できない ID を提示しないようにした。

## 9. 記録（2026-10-25 run 20261025T130730Z-cf62a756-3283-46fa-b73d-d0543b833f12、PR gate codex-review 再試行 2/2）

- codex review（PR #14016）P2: 「`fit-amend-line-lists` は初回リクエストだけを `:max-prompt-chars` まで埋めるが、拒否後の修正ラウンドでは元の行一覧に加えてモデル出力と `correction-request` を積むため上限を超えて即 `localllm-context-exceeded` になる。主目的の『引用符不一致 → 行 ID で修正ラウンド』が上限近傍のプロンプトでは機能しない」。
- 対策（修正時に一覧を再構成して上限内に収める方式。初回の固定予約は採らない: 応答長は max_tokens 由来で文字数が確定せず、予約しても超過を保証できないため）: 修正ラウンドでは会話末尾（これまでの assistant 応答 + 修正依頼）の文字数を `:max-prompt-chars` から差し引いた上限で `fit-amend-line-lists` を再実行し、user 文（計画・本文・行一覧・指示）を再描画して `[system, user', …末尾]` を送る。行 ID は先頭からの接頭辞なので、縮小後も提示されている ID は同じ行を指す。解決可能な ID は再描画した一覧（ctx の `:line-lists` を loop で持ち回り）に限定する。一覧を空にしても上限を超える場合は従来どおり「修正ラウンドの送信内容が … 字で上限 …」で停止（他モードと同じ）。縮小は log に `line-ids=提示/全体 -> 提示/全体` で記録する。
- テスト `test_canon_amend_correction_round_refits_the_line_listing_to_the_cap`（black-box）: 節 203 行の合成 fixture で (1) 上限なしで groom → amend（引用符不一致 → 修正ラウンドで L1）を通し、初回 amend リクエストの総文字数を取得、(2) その値を `CODEX_TASK_BOARD_LOCALLLM_MAX_PROMPT_CHARS` に与えて同じ流れを実行 → context-exceeded にならず修正ラウンドが送信され（2 リクエスト）、2 回目の最初の user 文は省略付き一覧で L1 を含み、全メッセージ合計 ≤ cap、log に `203/203 -> N/203`、L1 だけ置換され 200 行目・小見出し不変、Review 到達。fake server に全メッセージ合計長 `:all-chars` と最初の user 文のフラグを追加（従来の `user` は最後のメッセージ＝修正依頼文のため）。
- 結果: 新テスト単体 pass（実測 203 → 184 行、総 19,677 字 ≤ cap 20,373 相当）。全体 suite・手元 codex review の結果は PR 本文と Notes に記載。

## 10. 記録（2026-10-25 run 20261025T133540Z-799575d3-fe22-480f-8664-0a2adb3c85c2、PR gate codex-review 再試行）

- codex review（PR #14016）P2: 「`heading-line?` が行頭 `#` のみを見ており、CommonMark で有効な先頭 1〜3 空白の ATX 見出しを見出しとして扱わない。行 ID 一覧に `  #### 小見出し` が載り、ID 経由で置換できてしまい、『見出し構造を変更しない』制約と今回の見出し置換 hardening を迂回する」。
- 対策: `heading-line?` を先頭 0〜3 空白（空白のみ、タブは不可: 4 空白以上はコードブロック）許容の `^ {0,3}#{1,6}\s+\S.*` にし、`heading-level` も先頭空白を除いて数える。判定関数は 1 つなので、節終端（`section-end` / `heading-indexes`）、行一覧からの除外（`plan-section-lines`）、replace-text old_text の見出し拒否、append-section の heading 検査が同じ基準になる。fuzzy 一致や正規化は加えない。
- テスト: `test_canon_amend_replace_text_accepts_a_line_id_and_refuses_headings` に mode `amend-quote-indented-heading` を追加。fixture の `#### 副部長` を 2 空白字下げに書き換え、round 0 はモデルが字下げ見出しを原文で old_text に書く → 「見出し行が含まれています」で拒否（fake server が修正依頼文の理由を `:correction-mentions-heading?` で記録）、修正ラウンドは見出しが一覧に載っていれば得たはずの `L4` を書く → 「行一覧（L1〜L3）にありません」で拒否、Blocked、字下げ見出し・本文・他ノート不変、cloud 呼出なし。修正を外した状態では同ケースが（置換が通って Blocked にならず）失敗することを確認した。
- 結果: 新ケース含む対象テスト pass。全体 suite・手元 codex review の結果は PR 本文と Notes に記載。
- 手元 codex review（`--base origin/main`）の追加指摘 P2: 「行一覧から省略された行を原文で置換するとき、その行が `L3` のように ID パターンに一致すると必ず ID と解釈され、表示済みの別の `L3` があれば別行を置換してしまう」。対策: old_text が ID 形のとき、計画の節本文に同じ内容（trim 一致）の行があれば ID として解釈せず拒否し、理由にその行が一覧に載っている ID（例: L3）を示す（載っていなければ「この run では置き換えられない」と明示）。スキーマや prompt の契約（ID は `L<n>` のまま）は変えないので、実 gemma4-26b で確認済みの経路に影響しない。テスト mode `amend-quote-id-shaped-line`: fixture の 3 行目を `L1` に書き換え、モデルが `L1` を書く → 「ID として解釈できません。…行一覧の ID（L3）」で Blocked、1 行目のセリフと `L1` 行が不変。再 review はクリーン。

## 11. 記録（2026-10-25 run 20261025T142636Z-6be2ccbf-9de4-412c-86e9-b1381aa16c34、配備確認と BOXP-301 再 groom）

- Owner 承認（Telegram「進めて」、302 Notes 14:10 UTC）に基づき前 run が PR #14016 を merge（merge commit 7b25cf18f、14:19:57 UTC）。Pod 入替で前 run は planned shutdown により interrupted、本 run が継続。
- 配備確認: 新 Pod `codex-workspace-557fd77c88-qnjww` の `/opt/codex-workspace/task-board/localllm_docs.bb` sha256 `ac4e7fbd08fe…` が merge 後 `origin/main` と一致（merge 前は `f3a46b39…`）。`locks/` は 302 自身のみ、301 の lock / claim なし。
- §6 手順 1 を実施: BOXP-301 を helper CLI で Backlog + frontmatter `assignee: localllm` にし、runner が通常経路で groom run `20261025T142848Z-14ba5115-c8b2-475c-8e16-3abbe87c4ebd` を開始。結果はモデル呼出・書込なしで即 Blocked: `localllm-invalid-target`「許可 root 外の path（許可: Projects/task-board-localllm-docs/pilot, proposals）」。原典は読まれておらず、書込もない。
- 原因（コード確認、本文非読取）: 前回 groom が固定した frontmatter `docs-mode: amend` / `docs-target` / `docs-plan` が残っているため、`groom-ticket` の `resolve-docs-mode` は `:declared amend` を返し、BOXP-296 の select 経路（`groom-select`）に入らない。汎用 `:else` 経路は `snapshot-targets` を **canon roots を含まない** `:docs-roots`（提案 root のみ）で検証するため、canon 配下の対象を拒否する。初回 groom は `docs-mode` 未設定で select 経路に入ったので成功していた。§6 の「`docs-mode` / `docs-target` / `docs-plan` は groom が再固定する」は現行コードでは成立していなかった（Ready→Backlog の再計画経路が未検証だった）。
- 対策（最小）: `groom-ticket` に分岐を追加し、declared `amend` は canon roots 設定時に `groom-select` へ回して対象選定と計画の再固定を行う（`set-frontmatter-key` は既存キーを置換するので `docs-plan` は新 run id に更新される）。canon roots の無い runner では「docs-mode: amend は CODEX_TASK_BOARD_LOCALLLM_CANON_ROOTS が設定された runner でだけ使えます」の質問で停止（書込・モデル呼出なし）。amend 実行側（`run-docs-amend!`）、plan hash / stale 検査、行 ID 置換、Ready gate は変更なし。
- テスト `test_canon_amend_card_back_in_backlog_is_regroomed_by_content_search`（black-box、合成 fixture）: groom → Ready（docs-plan=run1）→ status/assignee を Backlog + localllm に戻し tick → 新 run で再 groom され Ready + boxp、`docs-plan` が run2 に置換（重複なし）、`docs-target` / `docs-mode` 維持、selection request 1 回、amend request なし、原典 byte 不変、提案ノート 0 件、`localllm-groom.edn` に `:mode-resolution :content-search`、「許可 root 外」が Notes に出ないこと。canon roots 無しの runner では `localllm-invalid-mode` の質問で Blocked。修正を外すと同テストが失敗（status が ready にならない）ことを確認。
- 後続: 本 PR の merge → image → Pod 再作成（本 run は再び interrupted になる）→ 配備確認（sha256）→ BOXP-301 を Backlog + localllm に戻して再 groom → Ready + boxp で計画提示（§6 手順 2 以降は Owner 確認）。

## 12. 記録（2026-10-25 run 20261025T145257Z-71320d06-5483-4cc6-8ab3-cb2fcbd15509、PR #14027 codex-review gate 再試行 1/2）

- 指摘（P2）: §11 の分岐は `docs-mode: amend` の票を無条件に `groom-select` へ回すため、利用者が手で書いた `docs-target` も再選定され別の原典が選ばれ得る。「select groom が生成した pin の再 groom」と手動指定の amend を識別していない。
- 対策: pin の生成元を runner 自身の記録で限定する。`docs-plan` がこの票の run ディレクトリにある `localllm-groom.edn`（`load-plan`）に解決でき、計画の decision が `target` で、計画の対象集合が `docs-target` と一致するときだけ groom 由来の pin とみなし `groom-select` で再固定する。それ以外は明示 `docs-target` を保持し、canon roots を含めた root で `snapshot-targets`（存在・root・サイズ）を検証した上で質問停止する: 対象が計画と異なる → `localllm-plan-mismatch`（「手動で変えた対象は再選定しません」）、計画が無い / target 以外 → `localllm-plan-missing`（「手動指定の対象は再選定しません」）、`docs-target` が無い → `localllm-plan-missing`。canon roots 無しの runner は従来どおり `localllm-invalid-mode`。いずれもモデル呼出・書込なし。`run-docs-amend!` 側の plan / hash / 対象一致検査は不変。
- テスト（`test_canon_amend_card_back_in_backlog_is_regroomed_by_content_search` に追加、合成 fixture）: (a) 再 groom 後に `docs-target` を手で別ノート（ユウ）に変えて Backlog へ → 新 run で `localllm-plan-mismatch`、`docs-target` は手で変えた値のまま、`docs-plan` は不変、selection request なし、原典 byte 不変。(b) 手動の `docs-mode: amend` + `docs-target` だけの票 → `localllm-plan-missing`、`docs-target` / `docs-mode` 保持、`docs-plan` なし、「許可 root 外」は出ない、モデル呼出 0 回。生成元検査を外す（常に再選定）と (a) が失敗（再選定されて Ready になる）ことを確認。
- 結果: 対象テスト pass、手元 codex review（`--base origin/main`）クリーン。全体 suite の結果は PR 本文と Notes に記載。
