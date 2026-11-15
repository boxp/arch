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

### 6. 途中結果（2026-11-13 01:10Z）
- 場所別の記録は配備済み。初回記録: 使用76.31GiB中75.25GiB（98.6%）を場所別に説明、走査58秒。作業領域35.27GiB（24h新規21.49GiB）、作業領域外39.98GiB（24h新規4.89GiB、うち `ghq` 2.75GiB・`.codex` 1.10GiB）。
- 急増（P1）: PR#14898 配備後の約11時間で `studio-dist-public-diff` による新規checkoutは0件。同じ条件で dist を捨てて再利用した run が8件あり、仕組みが実際に働いたことを run の `workspace-reuse.edn` で確認。容量記録にはこの理由が残っていなかったので追補で記録する。
- 作業領域外の既存物: 完了票の検証用複製のうち、origin/main の blob と一致するファイル・再生成できる ignored な出力・clean な clone だけを1回回収（空き +3.68GB、明細は vault の `outside-reclaim-ledger-BOXP-519.md`）。
- 唯一の成果（b441work 10.20GiB、vault 6.00GiB、`.codex/sessions` 5.28GiB）は24h新規がそれぞれ 0 / 0.36 / 0.06GiB で増加の主因ではないと分かったため、扱いの相談は不要と判断し保持のまま。
- 残り: 「最低空きまでの日数」は20時間以上前の記録が基準に要るため、最初の値は 2026-11-13 21:10Z 以降。作業領域外の新規書き込みは目標1GiB/日に対しまだ4.89GiB/日（置き場所の指示は 00:41Z 配備で、24時間の窓がまだ入れ替わっていない）。

## 既存の占有データの整理（2026-11-13 03:30Z, Owner質問への回答）

03:09Z の1回走査で使用 69.0GiB = 作業領域 28.9GiB + 作業領域外 40.0GiB。

| 区分 | 量 | 扱い |
|---|---|---|
| 完了票run内の checkout 外にある origin/main と同一内容の複製 | 6.29GiB | 実施済み（ハッシュ照合・台帳付き、空き +6.75GB） |
| 未コミット変更や未push commit で保持中の完了票runにある、原本と同一の追跡ファイル | 約4.4GiB | 次の実装: 変更のあるファイルには触れず、index と一致する大きな追跡ファイルだけ脱水（再開時は自動復元） |
| 完了票の最新runに残る検証済み dist / node_modules | 約4.4 / 1.7GiB | 最新run保護の内側。Owner の選択があれば対象に加える |
| 作業中・blocked・ready の票 | 5.1GiB | 保持 |
| 固有成果（b441work 10.2 / セッション記録 9.1 / vault 6.0） | 25.3GiB | 保持。直近24hの増加は合計0.5GiB未満。減らすには Owner の選択が必要 |
| 共有 Git・ツール・キャッシュ（ghq 7.2 / .cache 2.9 / .local 1.6 ほか） | 約13GiB | 保持（共有repoと実行に必要なもの） |

容量記録が 01:09Z 以降書かれていなかった不具合（走査の時間切れで記録ごと消失）は PR #14939 で修正。成功基準の判定はこの記録に依存するため、配備後に判定時刻を引き直す。

## 観察期限後の判定と次の手（2026-11-14 01:00Z）

### 判定（成功基準3点）
| 基準 | 実測 | 達否 |
|---|---|---|
| 最低空き8GiBまでの日数 30日以上 | 2.2日（00:20Z記録。20.1時間で使用 +23.36GB） | 未達 |
| 作業領域外の新規書き込み 1GiB/日未満 | 24h新規 2.66GiB（純増は20時間で +1.15GiB） | 未達 |
| 再利用拒否による新規checkout 12時間で5件以下 | 準備100件中 拒否1件、素材差分による拒否0 | 達成 |

### 増加元
作業領域が 21.46→40.62GiB。再利用拒否ではなく、各runが checkout の外に作る検証用のサイト複製（`deploy/site`、`build-old`/`build-new`、`dist-dbg` など、1本0.5〜1.1GB）。checkout 外の64KiB超ファイル 20.7GiB を全数ハッシュ照合したところ 16.4GiB が origin 既定ブランチの blob と完全一致（作業中票 14.67GiB、完了票 1.71GiB）。既存の prune は「checkout 外に固有物がある run」を丸ごと保持し続け、既存の脱水は checkout 内の追跡ファイルだけが対象のため、この複製には届かない。11-13 03:27Z に手動で回収した 6.75GB と同じ種類が1日で再発した。

### 次の手
1. 定期処理に「checkout 外の同一複製の回収」を追加する。
   - 対象run: 既存の stale prune と同じ判定（最新2本の外、12時間超、票lockなし、プロセスなし）。票の状態は問わない。保持本数・期間は変えない。
   - 対象ファイル: checkout（nested を含む）の外にある64KiB以上の通常ファイルで、hardlink でなく、symlink の参照先でもなく、共有 clone の origin 既定ブランチ（remote-tracking）の blob と生バイトのハッシュが一致するもの。
   - 削除は票lock下で再ハッシュしてから1ファイルずつ。先に台帳 `metrics/outside-copy-reclaim-ledger.tsv` へ path→blob を記録する（復元は `git cat-file blob`）。固有ファイル・ディレクトリ・run・checkout は残す。
   - 1回の処理は既定600秒まで。一致しなかったファイルは `metrics/outside-copy-scan-cache.edn` に覚えて再ハッシュしない。
   - 戻し方: `generated-reclaim.edn {:outside-copies false}` または `CODEX_TASK_BOARD_OUTSIDE_COPY_RECLAIM=off`。
2. 担当向け指示に「追跡済みの素材を検証用に複製しない（checkout を参照するかリンクする）。複製したら run 終了前に消す」を1文追加し、発生側を減らす。
3. 成功基準は変えない。配備後に同じ記録で再判定する。最新2本・12時間以内の複製（現 9.5GiB）は保護のまま残るため、発生側の指示が効かない場合は作業中の量として残る。

### 追補 (2026-11-14 01:30Z): 実行中の票の古い run も対象にする

- 実データの削除なし試行で、回収見込みの大半 (BOXP-525 の古い run) が票 lock で丸ごと飛ばされた。
- 既存の定期 prune は、実行中の票でも「実行中 run 以外の古い run (最新2本の外かつ12h超)」を削除対象として扱う (locked-active 経路)。新処理も同じ扱いに揃える。
- lock が実行中 run を名指しする票: その run は `active-run` として保持、他の古い run のみ対象。状態の再確認だけ guard 下で行い、ファイル削除は guard の外 (実行中 run の heartbeat を止めない)。
- lock が読めない票は従来どおり全体を飛ばす。
- 削除なし試行 (01:26Z): 8 run / 8947 ファイル / 7193325568 B が対象、実行中 run 5件は保持。
