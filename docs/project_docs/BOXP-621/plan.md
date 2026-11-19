# BOXP-621: runner テストの棚卸しと coverage 不足の補填

前段: [BOXP-616](../BOXP-616/plan.md)（runner の安全境界 22 関数にミューテーションテストを導入）/
[BOXP-613](../BOXP-613/plan.md)（kohako-home の検出力点検と整理）

## 何をどこまでやるか（担当判断）

1. **計測の信頼性（616 残件）**: `task-board-mutation.bb` の coverage 計測は、失敗・timeout したケースを
   黙って捨てていた。到達したはずの関数が「どのテストも届かない」「生存」に見え、スコアが不正確になる。
2. **runner 全体の coverage**: 616 の 100% は選んだ 22 関数の変異スコアで、runner（465 関数）全体の
   coverage ではない。全関数について「どれかのテストが到達するか」を実測し、到達しない重要な振る舞いを補填する。
3. **不要・重複の棚卸し**: 根拠（到達集合・アサーション・変異の検出）を持って重複だけを整理する。
   固有の仕様・異常系・安全境界の検出力を失わないことを変異で実測する。

範囲外: runner 本体（本番コード）の変更。変異は隔離コピーでだけ実行し、本番 runner・実 vault に入れない。

## 1. coverage 計測の是正

- 計測で pass しなかったコマンドは 1 回だけ単独で再実行し、なお失敗なら **停止**（理由と出力末尾を表示）。
  `--allow-coverage-failures` を付けたときだけ続行し、summary に失敗ケースを明記する。
  到達判定（未到達/生存）は pass したケースだけから計算する（以前は失敗ケースの到達も「到達」に数えていた）。
- 計装は複数 arity の **全 arity** に probe を入れる（以前は最初の arity だけ。`([] (f nil))` のような
  便宜 arity がある関数は、本体の arity からの呼び出しがすべて未到達に見えていた。初回計測で `prompt-for`
  `await-agent!` `prune-workspaces!` などが未到達と出たのはこのため）。
- probe は関数名をプロセス毎に 1 回だけ書く（system property で記憶）。全 465 関数を計装しても e2e が遅くならない。
- 自己テスト（`--self-test`）に追加: 全 arity への probe、計装後も多 arity 関数が動くこと、
  変数が無いときは何も書かないこと、別プロセスで実行して各関数が 1 回だけ記録されること、
  失敗ケースは捨てずに報告/停止すること。

## 2. runner 全体の関数 coverage（`--fn-coverage`）

```sh
bb tests/codex-workspace/task-board-mutation.bb --fn-coverage --jobs 2 --out /tmp/fncov   # ローカル 2CPU 約 20 分
```

runner の全 defn を計装し、e2e 全ケースと runner を読み込む直接テスト 7 本
（boundary / same-file-review / todos / vault-writer / harness-eval / ai-subscription-usage / localllm-docs）を流す。
結果は `fn-coverage.md`（未到達関数の一覧）と `fn-coverage.edn`（ケース毎の到達集合と所要時間）。

| 計測 | テスト | 到達関数 | 未到達 | 失敗コマンド |
|---|---|---|---|---|
| 変更前（e2e 179 + 直接 7、先頭 arity のみ計装） | 186 | 452/465（97.2%） | 13 | 0 |
| 変更後（e2e 175 + 直接 7、全 arity 計装） | 182 | **463/465（99.6%）** | 2 | 0 |

変更前の未到達 13 の内訳:
- 計装の漏れ（多 arity の先頭だけに probe）: `recover-planned-shutdown-locks!` `prompt-for` `await-agent!`
  `codex-model-profile-args` `prune-workspaces!` の 5（全 arity 計装で到達と確認）。
- テストが無かった: `recheck-reserve!` `recheck-cancel!` `recheck-audit` `close-corrupt-lock!`
  `run-localllm-coder!` `localllm-coder-models-src` → 4 章で補填。
- 残り 2（下記「残る未確認」）。

e2e だけに頼らず直接テストだけが到達する関数が 15 ある（marker・gate 判定など 616 で足した直接テスト）。

## 3. 不要・重複の整理

### 判断基準

- 到達集合（関数単位）が別ケースに **包含** されること（固有に到達する関数が無い）。
- 入力の違いが **純粋な判定関数だけ** に流れ、その先の経路・アサーションが同一であること。
- 削除するケースが検出する変異を、残すテストがすべて検出すること（変異で実測）。
- 入力ごとの仕様は直接テストへ同じ入力のまま移す。

### 削除（7 ケース）

| ケース | 根拠 |
|---|---|
| `test_review_{p2,p1,clean}_with_unstructured_lines_stops` / `_finding_without_severity_stops` / `_malformed_finding_stops` / `_conflicting_result_marker_stops`（6） | codex review の出力文だけが違い、setup・アサーションは同一。`:invalid` は reason 名だけを書く同一分岐（本文は Notes に載らない）。到達集合 232 関数はすべて残す `test_review_with_codex_review_issue_is_blocked` / `test_review_unknown_severity_output_stops` に含まれる（固有到達 0）。 |
| `test_review_p0_finding_blocks` | `test_review_p1_finding_retries_and_consumes_budget` と到達集合が同一（235 関数）、アサーションはその部分集合。P0 が P1 と同じく blocking であることは直接テストが固定済み。 |

6 ケースの入力は `task-board-runner-boundary-test.bb` の `invalid-review-outputs-name-only-a-fixed-reason` に
同じ文字列のまま移した（verdict と reason を固定）。

**検出力の実測**（`classify-codex-review` / `codex-review-findings` の 81 変異、隔離コピー）:

| テスト | 検出 | 生存 | 所要 |
|---|---|---|---|
| 削除した 6 e2e ケースだけ | 13 | 68 | 28 分 28 秒（1 並列、他計測と競合） |
| 直接テスト（boundary）だけ | 76 | 5（616 で等価と判定済みの 5 件） | 31 秒 |

6 ケースが検出する 13 変異はすべて直接テストも検出し、等価扱いの 5 件を 6 ケースが検出することも無い
（等価判定の裏付けにもなる）。削除で失う検出力は無い。

### 残置（根拠付き）

- 到達集合が同一のケース群は他にも 27 群あるが、本文を読むと入力・観測点（lane、Notes 文言、budget、
  prompt、outbox 等）がそれぞれ固有の仕様を表すため残した。到達集合の同一は重複の十分条件ではない。
- runner に到達しない 7 ケース（`root_guard_test`、helper の排他・並行書き込み等）は helper（`task-board.bb`）の
  テストで、runner の coverage で不要とは言えない。
- `todo-real-worker-canary.sh` / `novel-board-regroom-e2e.sh` / `even-terminal-smoke-test.sh` は CI 外の手動 canary/
  image smoke で、冒頭に用途が書かれている。
- 本文の行一致率（Jaccard 0.5 超）で見た近似重複は上の codex review 群と prompt の append-note 2 件
  （implement / groom で別 action の prompt を検証）だけだった。

## 4. coverage 不足の補填（未到達だった重要な振る舞い）

| 追加したテスト | 対象（以前は到達 0） | 変異での検出 |
|---|---|---|
| `test_recheck_manual_reserve_cancel_audit` | Owner の手動再確認 `recheck-reserve` / `recheck-cancel` / `recheck-audit`: 不正 instant・未対応 assignee・余分な引数・revision 不一致・boxp 以外の担当は拒否、pending/firing 中の二重予約拒否、期限前は発火しない、取消は 1 回だけ、audit は agent 自身が報告した block だけを挙げる | 36/36 |
| `test_corrupt_lock_is_cleared_and_noted` | 読めない lock ファイル（`close-corrupt-lock!`）: 消して Notes に記録し、ticket は再開できる | 1/1 |
| `test_localllm_coder_without_worktree_never_starts_pi` | `run-localllm-coder!`（部品は単体テスト済みだが本体は未到達）: repo worktree が無ければ pi を起動せず blocked、根拠（category）を run の証跡に残す | （本体は大きいため変異計測は未実施） |

観察（本番コードは変更していない）: localllm-coder の前提条件失敗は `localllm-coder.edn` に
`no-repo-worktree` 等の category が残る一方、card の blocker category は汎用の `agent-process-error` になる。
patch は出さないので安全側だが、Owner が理由を読むには run の証跡を開く必要がある。

## 前後比較

| 指標 | 変更前 | 変更後 |
|---|---|---|
| e2e ケース数 | 179 | 175（削除 7、追加 3） |
| runner 全関数の到達 | 452/465（97.2%、計装漏れ込み） | 463/465（99.6%） |
| runner-gates 22 関数の変異（直接テスト、CI と同じ経路） | 224/224（等価 6） | 224/224（等価 6） |
| 再確認予約 CLI 3 関数の変異 | 未到達（0 テスト） | 36/36 |
| `close-corrupt-lock!` の変異 | 未到達 | 1/1 |
| codex review 判定 2 関数の変異（直接テスト） | 76/81（等価 5） | 76/81（等価 5、e2e 6 件削除後も同じ） |
| 削除/追加ケースの実行時間（計装付き計測時の実測） | 削除 7 件 計 38 秒 | 追加 3 件 計 13 秒 |

e2e 全体の合計時間は計測時の負荷で ±20% 以上揺れる（共通ケースの合計が同じコードで 1291 秒/992 秒）ため、
合計の前後比較には使わず、削除/追加したケース自身の時間で示した。差し引き約 25 秒（e2e 合計の約 2%）短い。
目的は時間短縮ではなく、同じ経路を入力違いで何度も通す e2e を、入力ごとの仕様を固定する直接テストへ寄せること。

## 残る未確認

- `gate-budget-granted`（line 2026）: 呼び出し元が無い（runner 内で参照 0）。grant の集計は `gate-budget-status`
  側で行われており、これは使われていない関数。本番コードは変えない方針のため削除は別判断に残す。
- `localllm-coder-env!`（line 3916）: localllm-coder が pi を実際に起動する成功経路でだけ呼ばれる。
  repo worktree と model 一覧応答の偽物が必要で、今回は前提条件の fail-closed だけを e2e にした。
  env の allowlist 自体（`localllm-coder-base-env`）は既存テストが到達している。
- 関数単位の到達は「呼ばれた」ことしか示さず、分岐や値の検証までは示さない。検出力の裏付けは
  616 の 22 関数＋今回の 4 関数（再確認予約 3・破損 lock 1）の変異だけ。`run-localllm-coder!` 本体の変異計測はしていない。
- 到達集合が同一の 27 群は読んで残したが、変異で各ケースの固有性を全件測ってはいない
  （全ケース × 全関数の kill matrix はローカルで数時間以上かかる）。
