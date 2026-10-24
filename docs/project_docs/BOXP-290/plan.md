# BOXP-290: localllm を通常 Board 操作へ（Backlog groom・実バース既定参照・docs-mode 省略・Review 改稿）

- チケット: vault `Tickets/BOXP-290`（Owner 依頼: 「Backlog->Ready の grooming も出来ないということですか？ Review からの再修正とかも出来ませんか？ docs-sources はひとはこさんバース固定で良いので付与しなくても使えるようにしたいのと、docs-mode も不要にしたい」）
- 非公開の正本: vault `Projects/task-board-localllm-docs/README.md`（「通常 Board 操作」節）、`evidence/e2e-BOXP-290/`。本 plan と PR には原典・提案本文・要約を載せない（path と件数のみ）。

## 現行との差分（2026-10-24 調査）

| 要件 | 現行（arch `1f39e177` = 配備 Pod と sha256 一致） | 本票 |
| --- | --- | --- |
| Backlog groom | `candidate-action` が `localllm` の `backlog` を nil にし未対応（README「Backlog の groom はしない」、test `test_backlog_localllm_is_not_groomed`） | `:docs-groom` を追加。モデル呼出も文書書込も無い決定的 groom で用途・種別・corpus・必読候補 path・制約・AC・Plan を票に書き、`docs-mode` / `docs-kind`（propose なら `docs-target`）を frontmatter に固定して **Ready + assignee boxp**（既存 groom の人間承認方針と同じ）。不明瞭なら具体的な質問 1 つで Blocked |
| Review 改稿 | 既対応: Review の票は `:docs-edit`（`:revise`）で同票の own note / 提案節を置換し assignee boxp へ戻す。再走防止は assignee flip だけ | 維持。加えて Review 再走で **最後の localllm 結果 Note 以降に人の Note が無い** ときはモデルを呼ばず Blocked（新規 Owner 指示判定） |
| docs-sources 省略 | lolice env `DEFAULT_SOURCES="."`（vault 全域）、`READ_ROOTS="."` | lolice で `DEFAULT_SOURCES` を `ひとはこさんバース` に（`READ_ROOTS` は `.` のまま）。参照可能範囲と既定の探索対象を分離。明示 `docs-sources` は従来どおり優先（旧票を無言で切替えない）。UTF-8 env の往復は配備 Pod の bb で確認済み |
| docs-mode 省略 | 未設定 = transcribe 固定。create / propose は明示必須 | `resolve-docs-mode`: 明示 `docs-mode` → そのまま / `docs-target` あり → 従来 transcribe（旧票互換）/ 同票の own note あり → create 改稿 / 題名 → Summary の種別語で create / 加筆語 + wikilink 1 件（書込許可内に解決）で propose / 曖昧・両方・範囲外は質問で Blocked（モデル呼出なし） |

## 境界（変えないもの）

- 読取許可（READ_ROOTS `.`、隠し dir / Tickets / Boards / Templates / proposals / `localllm-proposal` ノートの除外、秘匿行除去）と書込み root（pilot + proposals）は広げない。canon 書換はしない。
- cloud 担当・外部 API・通知へ資料本文は送らない。groom も Notes も path / 件数 / 構造情報だけ。
- 有限 retry・修正ラウンド 1 回・file lock・claim 排他・競合検出・journal / rollback は既存のまま。groom は文書を書かない（rollback 対象なし。票の節の追記だけ）。

## 変更（boxp/arch）

- `docker/codex-workspace/task-board/localllm_docs.bb`
  - `resolve-docs-mode`（用途推定、`:how` を audit に記録）、`resolve-docs-kind` を題名優先に（制約文の「人物」で曖昧化しない）。
  - `review-instruction-state`: Review 再走時の新規 Owner 指示判定（`localllm-no-new-instruction`）。
  - `groom-ticket`: 決定的 groom（corpus 件数・フォルダ・必読候補 path・制約・AC・Plan・frontmatter 固定値・Blocked 質問）。
  - `runner-note-pattern` に `localllm groom run` を追加。
- `docker/codex-workspace/task-board/task_board_runner.bb`
  - `candidate-action`: `localllm` の `backlog` → `:docs-groom`。
  - `run-localllm-groom!` + `update-ticket-sections!`（票の AC / Context / Plan をテンプレのときは置換、記入済みなら追記。lifecycle commit 内で書く）。`:docs-groom` の最終 status は ready / blocked。
- `tests/codex-workspace/localllm-docs-test.sh`: groom → Ready → 実行 → Review → Notes 指示で改稿 → Notes 未変更で再走せず Blocked、用途推定（create 自然文 / propose wikilink / 曖昧 / 両方 / 範囲外 / canon 書換依頼 / corpus 無し）、旧票互換（docs-target だけ = transcribe、明示 docs-sources 優先）。runner inline test の localllm candidate 表を更新。
- `docs/project_docs/BOXP-290/plan.md`（本書）。

## 変更（boxp/lolice）

- `argoproj/codex-workspace/deployment.yaml` の `task-board-runner` sidecar: `CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES` を `ひとはこさんバース` に。`READ_ROOTS` は `.` のまま。

## 検証

1. black-box（fake LLM、CI）: 上記テスト + 既存全件。
2. 配備後 E2E（実 Gemma4、配備済み loop runner の通常 tick、`docs-*` 無し・assignee localllm と自然文だけ）: 新キャラ / 新怪獣の各 1 票を Backlog → groom → Ready（Owner 承認 = assignee を localllm に戻す）→ In Progress → Review → Notes に修正指示 + assignee 戻し → 同一ノート改稿 → Review。`localllm_source_check.bb` で読んだ資料 / 出典がすべて `ひとはこさんバース/` 配下・合成 fixture 0 を path だけで確認。Notes 未変更での assignee 戻しは Blocked（モデル呼出なし）。
3. 配備は arch merge → image → lolice bump（Recreate rollout で本 run は中断、後続 run が Notes から継続）。

## 結果（2026-10-24 UTC）

- 実装・gate: arch PR #13893（codex review 3 回、black-box 全件 pass、CI pass）→ main `ba1cf2e9`。lolice PR #883（`DEFAULT_SOURCES=ひとはこさんバース`）→ main。
- 配備: image `sha-ba1cf2e` → argocd-image-updater bump → Recreate rollout（途中の run 2 回が planned shutdown で中断、Notes から継続）。15:27 UTC 起動の Pod `codex-workspace-f9bb7669c-dm247` で runner 7 ファイルの sha256 が main と一致、env `DEFAULT_SOURCES=ひとはこさんバース` / `READ_ROOTS=.` を確認。
- 配備後 E2E（実 Gemma4、配備済み loop runner の通常 tick、frontmatter は `assignee: localllm` だけ・題名 + Summary の自然文）: 新キャラ票 BOXP-291 と新怪獣票 BOXP-292 で、Backlog → groom（約 20 秒、Ready + boxp、モデル呼出なし）→ assignee 戻し → create → Review → Notes 未変更で戻すと即 Blocked（`localllm-no-new-instruction`、モデル呼出なし）→ Notes 指示 1 行で同一ノート改稿 → Review、の全経路が両票で成功。
- 境界（path / 件数のみ）: 4 回の model run すべてで read / 出典が `ひとはこさんバース/` 配下のみ（`localllm_source_check.bb` PASS、合成 fixture / pilot / proposals の read 0）、原典 28 ノートの sha256 は E2E 前後で一致、新規ノートは 2 件だけで重複新案 0、旧提案ノート無変更。llm 所要 531 / 588 / 367 / 332 秒。
- 記録: vault `Projects/task-board-localllm-docs/evidence/e2e-BOXP-290/README.md`（run id、件数、rollback コマンド）、同 README の「現状」表と「未実施」。
- 限界 / 未確認: (1) groom の必読候補は題名・path の語で選ぶため、Summary の自然文に書いたノート名 1 件（BOXP-291）が候補に入らず未読のまま Review に進んだ。必読を強制するには `docs-sources` の明示か、今後 `docs-required-sources` 相当の対応が必要。(2) Board カードの `assignee::` 表示は groom / Review 遷移の frontmatter 変更に追従しない（既存の claude groom と同じ。runner は frontmatter を参照）。(3) 提案本文の意味品質（原典との整合、全年齢、改稿指示の反映度）は cloud 担当では読まず、Owner の Obsidian での確認が最終受入。(4) BOXP-292 の案は BOXP-289 の既存提案と発想が近い（同一 corpus からの類似案。提案ノートは corpus 外で名前近接検査の対象外）。

## 追補: Review gate の merged PR 判定（2026-10-24 UTC）

- 現象: 前 run が docs PR #13905 を CI pass 後に squash merge してから `TASK_BOARD_RESULT: review` を返したところ、runner の PR gate が `mergeability` で失敗（retry 1/2）。GitHub は merge 済み PR に `mergeStateStatus=UNKNOWN` を返し、`merge-state` がこれを pending 扱いして timeout していた。PR 自体に問題はない。
- 対応（`task_board_runner.bb`）: `pr-view` の取得項目に `state,mergedAt` を追加し、`merge-state` で `state=MERGED` を mergeability pass とする（CI / codex-review gate は従来どおり評価）。fake `gh` に `GH_FAKE_PR_STATE` / `GH_FAKE_PR_STATE_<n>` を追加し、merged PR（`mergeStateStatus=UNKNOWN`）が Review に遷移し `pr-gate-diagnostic.edn` を残さない black-box テストを追加。旧 runner ではこのテストが失敗することを確認。
- 影響: 本票のように「通常 review/CI/merge まで agent が進める」運用で、merge 済み PR を根拠に review を返しても無限 retry / Blocked にならない。配備中の Pod は旧判定のため、本修正の PR が merge → image → Pod 再作成されるまで、最終応答に merge 済み PR の URL を gate 対象として含めない運用で回避。
