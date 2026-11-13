# BOXP-519: 完了票の古いrunの再生成可能 dist/node_modules 限定自動回収

正本: Obsidian `Projects/storage-alert-triage-20261112/approved-generated-output-auto-reclaim`（Owner A承認, BOXP-518 event）。

## 背景
- 既存 prune は done 票の run を `within-retention`（閉票から3日）/ stale 側 12h・最新2本保持で丸ごと保持する。
  done 直後の大容量 run（Studio dist/node_modules）は数時間〜数日回収されない。
- BOXP-518 は手動で20件4.729GiBを回収した。本票はその限定規則を runner の正規 prune に統合する。

## 方針（run/worktree 全体の保持期間は変えない）
prune-workspaces! の通常パス後に `generated-reclaim` パスを追加し、以下を全て満たす場合のみ checkout 内の生成物ディレクトリだけを削除する。

### 票/run 条件（削除直前に lock guard 下で再確認）
- 票の lock ファイルが無い（active run なし）、Board 上カードがちょうど1枚で Done レーン、frontmatter `status: done`。
- run-id が解析可能、票内の最新 `keep-latest-runs`（既定2）本に含まれない、開始から `CODEX_TASK_BOARD_GENERATED_RECLAIM_MIN_AGE_HOURS`（既定1h）以上経過。
- `safe-run-workspace-path?`、stale-process-hold（mount/cwd）なし。

### 対象（これ以外は一切削除しない）
- `node_modules/`：git が ignored と判定した完全一致ディレクトリ。同階層の `package.json` とロックファイル（package-lock.json / npm-shrinkwrap.json / pnpm-lock.yaml / yarn.lock）が追跡かつ未変更。
- `apps/kohako-studio/web/dist/`（boxp/arch）：既存 `studio-dist-hold` が nil（public と byte 一致、入力追跡）かつ入力が未変更。
- `apps/kohako-studio/bff/dist/`（boxp/arch）：既存 `bff-dist-hold` が nil かつ入力が未変更。

### 保持（候補単位で fail-closed）
- 候補内に追跡ファイル / ネストした checkout / hardlink（nlink>1）/ symlink 自体の候補 / 実パスが checkout 外。
- run 内（候補外）の symlink が候補内を指す（共有依存）。
- 入力の dirty、git エラー、計測・走査失敗。
- 未知 ignored やそれ以外の dirty/未push 成果は削除対象外として残す（run 全体は既存 prune の規則のまま）。

### 運用
- モード: `~/.codex-task-board/generated-reclaim.edn` `{:mode :off|:dry-run|:on}` が env `CODEX_TASK_BOARD_GENERATED_RECLAIM` より優先。既定は `on`（PR 前に実環境 read-only dry-run で候補/保持理由とエラー無しを確認済み）。`{:mode :dry-run}` で非削除観察に切替可。
- rollback: flag を `{:mode :off}`（即時）または PR revert。
- 計測: 候補ごとに du allocated（hardlink 除外のため一意）を `metrics/workspace-capacity.edn` に `:generated-reclaim` event、パス毎に `:generated-reclaim-summary`（件数/bytes/保持理由/fs-free 前後）。1パスの削除上限あり。

## 検証
- Red/Green 回帰: 安全 Done 旧 run で対象のみ回収・原本存続、最新/lock/非Done/複数カード/dirty入力/未知/hardlink/symlink依存/ネストgit/内容不一致は保持、dry-run 非削除、再実行冪等、削除直前の票状態変化で非削除。
- 既存 prune/stale/BFF/carryover テスト維持、CI。
- merge → image 配備 → dry-run 実候補 → `:on` → 実回収台帳/前後df/保護存続/業務継続 → 複数tick観察。

## 実環境 dry-run（PR 前, 2026-11-12 09:5xZ, metrics off, 非削除）
- summary: would-reclaim 0 / held 0、skipped-tickets ticket-missing 13・not-single-done-card 32・locked 1、skipped-runs latest-run 118・run-id-timestamp-unparseable 7。
- 現存 Done 票の run は既存 stale prune（12h・最新2本）と BOXP-518 応急回収で最新2本のみ残存しており、本パスの現時点の対象は 0（成功の捏造ではなく対象不在）。
- 残存 dist/node_modules は 非Done 票（BOXP-407/276/425/391 等）、checkout 外の検証素材（pwarms/pwv 等）、検証規則の無い `apps/hitohako/dist` で、いずれも設計どおり保持。
- 効果が出るのは Done 後 12h 以内に古い run が複数残る局面（BOXP-510 の 13 run のような burst）。配備後の複数 tick で gross 生成/回収/純増を観察する。

---

## TD-01 再計画（2026-11-12 Owner「再計画して対応して」）

### 再測定（2026-11-12 10:20 UTC, codex-workspace-home ext4 98.3G）
- 使用 80.66GiB / 空き 17.6GiB。上位: `.codex-task-board/workspaces` 40.84GiB、`b441work` 10.22GiB（既知保護）、`ghq` 7.54GiB、`.codex` 6.56GiB、`Documents` 5.92GiB。
- workspaces 内訳（票status別）: done 203 run 31.75GiB（>100MB の 49 run で 30.16GiB）、blocked 102 run 8.41GiB、ready 0.94GiB。
- 増加元: boxp/arch の run worktree 1本あたり追跡ファイル約 0.52GB。うち `apps/kohako-studio/web/public`（Live2D/png）497MB、
  256KiB 以上の追跡ファイル 384 個で 497MB。run ごとに Git object と同一内容の複製が作られ、Done 票の最新run保護（latest-run, keep 2）の間ずっと残る。
- 旧 generated-reclaim（dist/node_modules, 非最新run限定）は対象 0。Done 票の非最新 run は既存 stale prune が丸ごと削除済みのため。

### 方針: 完了票 run の大きな追跡ファイルの「脱水」（run/worktree の保持本数・期間は変えない）
- 対象: generated-reclaim と同じ票条件（lock 無し・Board の Done 単一カード・status done）、run は safe path・process hold 無し・
  開始から MIN_AGE 以上。**latest-run でも対象**（worktree/branch/ignored/untracked は残し、再開時に自動復元するため）。
- checkout 条件: `git status --porcelain --untracked-files=all` が空、merge/rebase 等の進行中操作なし、nested checkout 内でない。
- ファイル条件: 追跡の通常ファイル（mode 100644/100755、symlink/submodule 除外）、サイズ >= `CODEX_TASK_BOARD_DEHYDRATE_MIN_BYTES`（既定 262144）、
  link 数 1、既に skip-worktree でない、`git hash-object` が index blob と一致（内容一致の証明＝正本は共有 Git object。gc は worktree index を到達根として扱う）、
  run 内 symlink の参照先でない。
- 実行（ticket lock guard 下で全条件を再確認後）: per-worktree git dir に marker `codex-task-board-dehydrated`（NUL区切りパス一覧）を書く →
  `git update-index --skip-worktree` → ファイル削除。`git status` は clean のまま。
- 復元: reuse / carryover の前に marker があれば、パスが存在しない場合のみ `--no-skip-worktree` + `git checkout-index` で復元し、
  status clean と marker 削除を確認。存在するパスがあれば上書きせず reuse を reject（新規 worktree に fallback）。
- prune: marker のあるcheckoutで脱水パスにファイルが存在する場合は `dehydrated-path-present` で保持（skip-worktree が新規内容を隠すのを防ぐ）。
- フラグ: `generated-reclaim.edn` の `:mode`（off/dry-run/on）に従う。追加で `:dehydrate false` で脱水のみ無効化可能。rollback は `{:mode :off}` または `:dehydrate false`。
  既に脱水済みの run は再開時に自動復元されるため rollback 後も業務影響なし。
- 計測: `:generated-reclaim` イベントに `:kind :tracked-dehydrate`、`:files`、`:allocated-bytes`、サマリに前後 df。

### 期待効果と検証
- Done 票の arch run（約 49 run）× 約 0.5GB ≒ 20GiB 前後を、保持本数/期間を変えずに回収見込み（dry-run で実数確定）。
- 生成重複抑制: 完了後に複製を即時脱水し、再開時のみ復元するため、Done 票の保持期間中に複製が残らない。新規 run 作成時の取得は変えない（作業に必要なため）。
- RedGreen: 脱水→status clean→reuse で復元・status clean、dirty/untracked/hash 不一致/hardlink/symlink 参照/lock/非Done/active は保持、
  脱水パス存在時の prune 保持・reuse reject、dry-run 非削除、冪等（2回目は対象0）。
- 対象外: b441work、blocked/in-progress/ready 票、秘密/session、共有 repo の設定変更（sparse-checkout/worktreeConfig は使わない）、保持期間/本数短縮、Longhorn/拡張。

## 追加: reuse時の検証済みdist破棄による生成重複抑制 (2026-11-12 13:20 UTC)

- 実測: 脱水配備後 df avail 19.95GB(12:18)→9.34GB(13:20)。主因は同一票(BOXP-523)の連続runが毎回 `mode=:new-checkout reason=studio-dist-public-diff` で約1.09GB(追跡public 498MB + 検証済みdist 498MB)の新規checkoutを作り、旧runが最新保護/stale保持で残ること。
- 対策: `try-reuse-repo-worktree!` で `studio-dist-public-diff` / `bff-dist-src-diff` となる場合、ticket lock所有を確認し `studio-dist-hold`/`bff-dist-hold`/`inspect-ignored` で全再生成可能を再検証できたときだけ旧worktreeのdistを削除し、通常reuse(worktree move + base switch)を行う。結果は新規checkoutと同じ「distなし」状態で、追跡ファイル・未知/固有ファイル・branchは不変。
- 監査: `:reuse-base-reason "studio-dist-dropped"` / `"bff-dist-dropped"` を workspace-reuse.edn に残す。
- rollback: `~/.codex-task-board/generated-reclaim.edn` に `{:reuse-drop-dist false}`（または `{:mode :off}`）で従来の拒否動作に戻る。

---

## Fable 再計画（2026-11-13、Owner「見直し方針そのものから考えてほしい」）

この節が最新の方針。上の「限定回収」「脱水」は実施済みの履歴として残す（撤回はしない）。

### 1. 問題の捉え直し
これまでは「消せるものを探して消す」ことを対策にしていた。実測すると、逼迫の原因は消し残しではなく次の3つで、それぞれ効く手段が違う。

| | 何が起きているか | 実測（2026-11-13 00:19Z、使用87GiB/147.5GiB） | 効く手段 |
|---|---|---|---|
| P1 急増 | 作業領域の再利用が拒否されると、run ごとに約1.09GB（Live2D素材0.5GB＋そのビルド複製0.5GB）の新しいcheckoutができ、12時間は残る | 11/12 に20回発生＝約22GB。作業領域内の同一素材の複製は53個・25.8GiB | 再利用の拒否を減らす（PR#14898で主因は修正済み、実効は未確認） |
| P2 作業中の量 | 動いている票ごとに0.5〜1GB | 最新runの合計 約10GiB | 票の数で頭打ちになるので対策不要 |
| P3 管理外の蓄積 | 作業領域の**外**に置かれた物は誰も回収しない | 作業領域外47GiBのうち33GiBが直近7日の書き込み（1日あたり約4GiB）。vault内の検証画像5.3GiB、`.codex/sessions` 5.3GiB、`~/ghq` 直下に作られた別worktree、`~/.cache` の検証用複製、b441work 10.5GiB | 置き場所を回収対象の中に寄せる＋増え方を毎時記録する |

- 回収しても楽にならなかった理由: 100Gi のときは「作業領域外45＋作業中20＋急増1回25＝90GiB」が、上限98GiB−最低空き8GiBに収まらなかった。完了票の残り物（脱水で約12GiB）を消しても、同じ12時間に急増がそれ以上を書き込んでいた。
- 150Gi になった現在は収まる。ただし P3 が1日4GiBのままなら、空き60GiBは2週間ほどで再び尽きる。次の再発はここから来る。
- 既存の計測 `new-bytes-est` は生成量をほぼ0と報告していた（共有checkoutのHEADが8月の古いコミットで、素材を含まない木を数えていた）。このため生成量が見えていなかった。

### 2. 方針
1. **増え方を毎時「場所ごと」に記録し、あと何日で最低空きに届くかを出す**（runner の定期処理に追加）。次に増えたとき、調査なしで原因の場所が分かるようにする。
2. **置き場所の規律を発生源に入れる**: runner が担当へ渡す指示に「一時的なclone・追加worktree・cache・検証コピーは run の作業領域内に置く（自動回収される）」を明記する。
3. **作業領域の回収の仕組みはこれ以上増やさない**。既存3件（限定回収・脱水・再利用時のdist破棄）は維持し、P1 は再利用拒否の件数で監視する。
4. **作業領域外に既にある物**は、1の記録で場所と量を確定してから、内容一致・別の正本・非使用を個別に示せる物だけ回収する。vault の検証画像と b441work は唯一の成果なので消さず、扱いは量と増え方を示して Owner に1回だけ相談する。

### 3. 成功の基準（回収量の累計は基準にしない）
- 毎時の記録で、使用量の増減の9割以上が場所ごとに説明できる。
- 「最低空き8GiBまでの日数」の予測が、7日間の観察で30日以上を保つ。
- 作業領域外の新規書き込みが 1日4GiB → 1GiB未満。
- 再利用拒否による新規checkoutが12時間で5件以下、`studio-dist-public-diff` は0件。

### 4. やらないこと
Longhorn/snapshot/容量の変更、保持期間・保持本数の短縮、最低空きの緩和、唯一の成果や未push・dirtyの削除、動作中の票の作業領域への介入、hardlinkによる素材共有（書き換えが他の票へ伝わる危険があるため不採用）。

### 5. 戻し方
記録は `CODEX_TASK_BOARD_CAPACITY_ATTRIBUTION=off` で止まる（読み取りのみで削除はしない）。指示文の追加は PR revert。
