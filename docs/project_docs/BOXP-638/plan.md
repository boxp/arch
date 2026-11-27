# BOXP-638: 作業領域の容量対策 S2 以降の段階実装

仕様の正本は Vault `Projects/codex-workspace-disk-growth/fable-review-BOXP-493.md`（案2 / S1〜S4）。
S1（BOXP-494: 継続 run の引継ぎと計測）は 7 日観察まで完了済み。BOXP-519 で dist/node_modules の限定回収・
追跡ファイルの dehydrate・checkout 外の origin blob 一致コピー回収が実装済み。本票はその上の残りを段階的に足す。

## 着手時の実測（2026-11-20 06:5xZ）

- PVC `/home/boxp` 158.4GB、空き 64.6GB。guard（8GiB）まで余裕あり。
- prune の hold は 230 run・計 22.6GB（du 実測）。
  - checkout 外 9.5GB（大半は 603 の rec dump などの唯一成果、ツール binary、ログ）
  - ignored 5.8GB（studio dist 2.1 / node_modules 1.05 / ansible `.venv` 1.6 ※uv cache と hardlink 共有で回収効果は小 / build 0.6）
  - 追跡ファイル 1.5GB、入れ子 `.git` 2.4GB
- 既存の内容証明つき回収は「最新 run 保護（latest-run）」で止まっている: generated reclaim の skipped-runs latest-run 182、
  outside-copy の latest-run 225。hold の 94% は Done 票。

## 段階

| 段階 | 内容 | 状態 |
|---|---|---|
| S2a | Done かつ保持期間後（closed と run 開始がともに retention-days 超、lock なし、Done カード 1 枚）の run に限り、内容証明つき回収（node_modules / dist / origin blob 一致の checkout 外コピー）の latest-run 保護を外す。prune が clean なら run ごと削除している範囲と同じ。証明・process/mount/symlink/hardlink/入れ子 git 等の hold はそのまま | 本 PR |
| S4 | hold run の唯一成果（未 push commit の bundle、未保存差分、小さな未知ファイル）を目録・hash 付きで退避し、退避物から復元して原本と一致を確認してから run を回収。退避物の最終廃棄はしない。dry-run → 実回収の順 | 次 PR |
| S3 | 段階 guard（新規 checkout が要る run だけ先に待たせる段）と容量対策印の票の低容量起動、bytes 予算の観測。閾値は実測から決め根拠を正本へ記録 | S4 の後 |

## S2a の安全条件と rollback

- 対象は `retained-done-run?` が真の run のみ。票の再オープン（status/カードが Done 以外）、lock、保持期間内は従来どおり latest-run で保護。
- 削除直前の lock 下再確認（generated-recheck / outside-copy の status 再確認）も同じ判定を通るため、計測中の再オープンは回収しない。
- rollback: `$ROOT/generated-reclaim.edn` に `:retained-done-latest false`、または env `CODEX_TASK_BOARD_GENERATED_RECLAIM_RETAINED_DONE=off`。再起動不要。
- 計測: 該当回収は metrics の `:basis :retained-done-latest`、summary の `:retained-done-latest-allocated-bytes`。

## 検証

- fixture: `test_generated_reclaim_retained_done_latest`（旧版 Red / 新版 Green）。flag off・env off・保持期間内・非 Done・lock では残り、
  条件成立時のみ node_modules と origin 一致コピーを回収、唯一成果（ignored の notes）と追跡ファイルと run 自体は残る。
- 回収・prune・再利用・dehydrate・outside-copy 系 37 ケースがローカルで pass。
- 配備後: prune summary の latest-run skip 数の減少、回収 bytes（`:basis :retained-done-latest`）、空きの前後、通常票の継続を確認。

## S4 実装方針（退避 → 復元確認 → 回収）

- 対象: prune(done) で、hold 理由が全 checkout とも `uncommitted-changes` / `commit-not-on-github` のみの run（lock なし）。
- 退避物: checkout 毎に `staged.patch`・`worktree.patch`（binary/full-index）・`untracked.tar`（ignored 除外）・HEAD と GitHub に無い commit を GitHub 既定ブランチ上の commit まで含めた `commits.bundle`（境界 commit、bundle 不要時は HEAD が GitHub 既定ブランチの祖先であることを compare API で確認。GitHub に存在するだけの削除済みブランチ上の commit は fresh clone に含まれないため境界にしない）。目録 `manifest.edn` に sha256・bytes・head・復元手順。
- 検証: alternates 付き一時 repo で index 一致、変更/untracked ファイルの bytes・実行 bit・symlink 一致、bundle verify / list-heads を確認できた場合のみ `$ROOT/salvage/<票>/<run>/<時刻>/` へ atomic move し、既存の削除経路へ。
- 保護継続: stash・git 操作中・process 使用中・予算超過（既定 64MiB/run）・GitHub 照会失敗・境界 commit 不在。未 push tip の branch は共有 repo に残す。退避物は runner が削除しない（最終廃棄は範囲外）。
- 段階: mode `off` / `dry-run`（既定、件数と bytes のみ計測）/ `on`。`generated-reclaim.edn` の `:salvage` が env `CODEX_TASK_BOARD_SALVAGE_RECLAIM` より優先。配備後 dry-run で would-salvage 件数・bytes を実測してから on。

### S4 改訂: 列挙方式から fail-closed 方式へ（review 3 回連続指摘の根本原因対応）

- 根本原因: 「残すものを列挙し、列挙から漏れたものが削除される」設計。ref の列挙（境界 commit / ローカルブランチ / タグ・リモート追跡 ref）と退避範囲の列挙（空白名ファイル / checkout 外のファイル）で同じ型の漏れが毎回見つかっていた。
- ref: run 内に ref を持つ repo（run 所有 clone、run 内 common dir の worktree）は **全 ref（名前空間を問わない）・HEAD・全 reflog** を `refs/salvage/<refname>` / `refs/salvage/HEAD` / `refs/salvage/reflog/<sha>` に写し、ローカルの GitHub 既定ブランチ commit との差分を丸ごと bundle 化。tip の分類はしない。外部 repo の worktree は HEAD・HEAD reflog・per-worktree ref のみ（共有 ref は残る）。
- 復元可能性: その既定ブランチ commit が GitHub 既定ブランチ上にあることを 1 回確認し、bundle ヘッダの prerequisite すべてがその祖先であることをローカルで確認。bundle に載らない ref（既定ブランチが到達済み）は祖先確認のうえ `refs.txt` に名前と sha を保存。shallow repo は保護。
- 範囲: 退避するのは checkout 内の追跡差分と untracked のみなので、run 内の checkout 外のファイル（`outside-checkout`）や再生成可能でない ignored ファイル（`ignored-unknown` 等）が一つでもあれば run を保護。
- 対象 checkout: hold のある checkout だけでなく run 内の **全 checkout** を退避対象にする（clean な run 所有 clone も削除済みブランチの ref 等を唯一保持し得るため、checkout の選別も列挙しない）。どれか一つでも退避・検証できなければ run を保護。

## S4b: shallow 共有 checkout の worktree も退避対象にする (2026-11-20)

- 配備後 dry-run(09:14Z〜) 1 pass: 対象 118 run のうち would-salvage 37 run(退避 9.6MB、回収見込み 0.16GB)、
  保護 81 run の最大理由は salvage-shallow-repository 52 run/2.58GB。共有 checkout `~/ghq/github.com/boxp/arch` 自体が shallow のため。
- shallow の graph は実 graph の部分 graph なので、ローカルで「祖先である」と出れば GitHub 上でも真。
  scratch repo は shallow 一覧を持たないので、履歴が shallow 境界をまたぐ bundle は作成に失敗して hold(fail-closed)。
  よって一律 hold を外し、manifest に `:shallow` を記録する。
- 試験: BOXP-709(shallow worktree の local commit → 退避・既定ブランチ clone から復元一致)、
  BOXP-710(depth 1 で取得した境界越え tip → `salvage-verify-failed bundle` で保護)。

## S4c: 後から shallow になった共有 clone の古い run も退避対象にする (2026-11-20)

- S4b 配備後・退避有効化後の実 prune(11:02Z): salvaged 40 run / 削除 43 run、空き 64.95→65.39GB(11:59Z 65.90GB)。
  残る退避不可 75 run の最大理由は `too-many-unpushed-commits` 42 run / 1.33GB(全て共有 `boxp/arch`)。
- 原因: 共有 clone は run 開始時は完全履歴で、後に `fetch --depth 1` で shallow 化した。origin/main の履歴は境界で切れる一方、
  古い run branch は根まで完全履歴を持つため `tip --not origin/main` が全祖先(例 BOXP-122: 12919 commit)を数える。
- 対応: 上限を超える tip ごとに first-parent 祖先を 0,1,3,7,... の位置で GitHub compare に問い、既定ブランチ上と確認できた最初の
  commit を追加境界にする(bundle commit 数は実未push数の高々約2倍)。prerequisite と bundle 外 ref は「既定ブランチ commit か
  追加境界のいずれかの祖先」であることをローカルで確認(shallow graph の祖先関係は実 graph でも真)。確認できなければ従来どおり hold。
- 本番 BOXP-122 run で読み取り確認: 位置15の commit が main 上(compare=ahead)、境界以降は 34 commit で上限内。
- 試験: BOXP-711(完全履歴で開始→後で depth 1 fetch で shallow 化、205 commit 先行に見える run)が旧版で保護・新版で退避→
  既定ブランチ clone へ bundle 適用・復元一致。

## S4 の実測（配備後）

- 11:02Z: 退避 40 run・削除 43 run、空き 64.95→65.39GB。
- S4c 配備後 12:50Z: 退避 33 run・削除 42 run、保護 75→43（too-many-unpushed 42→0）、空き 65.90→67.18GB（df 実測）。
- 残る保護 43: checkout 外の唯一成果 20、bundle 検証失敗 11（fail-closed）、不明 ignored 8、git 操作中 2、ほか 2。いずれも内容証明が通らないため保護を維持する。

## S3a 段階 guard と容量対策印

- 既存: 空き 8GiB 未満で新規 run を全停止（`CODEX_TASK_BOARD_MIN_FREE_BYTES`）。停止中は容量対策の票も起動できず、復帰に SSH の手作業が要った。
- 変更:
  - hard（8GiB 未満、従来どおり）: 通常票は止める。frontmatter に `capacity_relief: true` を持つ票だけ、空き 4GiB 以上（`CODEX_TASK_BOARD_RELIEF_MIN_FREE_BYTES`）かつ inode 余裕ありなら、repo checkout なしで起動する。prompt で clone/build/install をしないよう伝え、repo 変更が要るなら blocked で通常 run に渡す。
  - soft（16GiB 未満、`CODEX_TASK_BOARD_SOFT_MIN_FREE_BYTES`）: run workspace をまだ持たない新規票だけ待たせ、継続中の票は進める（作業途中の票が終わり回収対象になれる）。
- 閾値の根拠（2026-11-20 実測）: run 1 つの実割当は p50 17MB・p90 0.55GB・p99 0.97GB・最大 2.25GB（workspace-size-cache 121 run）。soft = hard 8GiB + 最大級 run 3〜4 本分。relief 起動は checkout なしで runs/ のログ程度（runs 全体で 0.70GB）のため 4GiB を下限とする。新規 checkout 自体の追加量は p99 3.4MB と小さく、増加は run 中の生成物が主。
- rollback（再起動のみ・ロジック差し戻し不要）: `SOFT_MIN_FREE_BYTES` を MIN 以下にすると soft 段なし、`RELIEF_MIN_FREE_BYTES` を MIN 以上にすると relief 起動なし（従来の全停止）。
- 印は Owner / coordinator が票 frontmatter に付ける。印があっても checkout は作らず、空き 4GiB 未満・inode 不足では起動しない。
- localllm-coder 担当票は repo worktree が無いと起動前検査（no-repo-worktree）で失敗するため、hard 段の checkout なし起動の対象外とし通常票と同様に待たせる（codex review P1）。soft 段では従来どおり checkout ありで起動できる。
- 次段 S3b: bytes 予算（票ごと・workspaces 全体）の観測と超過票だけの新規 checkout 停止。数値は 1 週間の実測から決める。

## S3b 票ごと・全体の bytes 予算の観測（観測のみ）

- capacity-attribution（毎時 prune 後、50 分間隔の find 走査）の同じ走査で、`.codex-task-board/workspaces/<票>/<run>/...` を票ごとに集計し、
  `:workspace-tickets`（大きい順 30 票の bytes / 24h 内 fresh-bytes / run 数）と `:workspace-ticket-stats`（全票の件数・合計・p50/p90/p99/max・fresh 合計）を記録。
  追加の走査はしない。停止・起動判定には使わない（予算超過票だけの新規 checkout 停止は 1 週間の記録から数値を決めてから別 PR）。
- 着手時の参考値（2026-11-20 14:1xZ, du 実測）: 113 票・計 39.39GB、票あたり p50 52MB・p90 1.06GB・p99 2.34GB・最大 5.70GB（BOXP-603、rec dump などの唯一成果）。
- 確認: `task_board_runner.bb workspace-metrics` 相当の出力に `workspace-ticket-stats=` / `workspace-top-tickets=` が出る。

## S3c bytes 予算の警告（7 日間の記録から閾値を決定、警告のみ）

- 記録（capacity-attribution, 2026-11-20 15:33Z〜11-27 15:12Z, 155 回）:
  - workspaces 合計: 通常 38〜48GB。11-26 06:48Z に 55GB、11-27 00:54Z→10:24Z に 48.7→69.2GB（24h 内新規 21GB）。
  - 票あたり p99: 2.33→3.35〜3.75GB（大半の期間）→ 5.0〜5.4GB（11-26 以降）。最大 5.0〜7.9GB。
  - 11-27 の急増の内訳: BOXP-725（done）1 run 7.7GB（checkout 外の Hugging Face モデル cache 6.4GB + venv 1.1GB）、
    BOXP-704（done）38 run 4.8GB、BOXP-740/727/738/733 が各 1.2〜1.8GB。いずれも保持期間内（3 日）で、prune の対象外。
  - 空き: 68.1GB（11-20）→ 22.5GB（11-27 15:12Z）。soft guard（16GiB）まで約 5GB。
- 仕様（例つき）:
  - 票ごと予算 4GiB（`CODEX_TASK_BOARD_TICKET_BUDGET_BYTES`, 既定 4294967296）。票の workspace bytes が予算を **超えた** 票を `:over-tickets` に記録。
    例: 7.88GB の BOXP-725・5.36GB の BOXP-714 は超過、4.29GB ちょうどは超過でない、1.9GB の BOXP-740 は超過でない。
  - 全体予算 56GiB（`CODEX_TASK_BOARD_WORKSPACES_BUDGET_BYTES`, 既定 60129542144）。workspaces 合計が超えたら `:total-over? true`。
    例: 11-27 の 68.1GB は超過、11-20〜26 の 38〜55GB は超過でない。
  - どちらかが超過したら `capacity-budget: warning over-tickets=<票>:<bytes>,... ticket-budget=.. workspaces=.. workspaces-budget=.. total-over=..` を log し、
    `:workspace-budget` を capacity-attribution に記録。`workspace-metrics` に `workspace-budget=` を表示。
  - 0 を指定するとその予算は無効（rollback、再起動のみ）。起動・停止判定には使わない（停止は既存の段階 guard が担う）。
- 根拠: 票ごと 4GiB は通常期の p99 を上回り外れ値（唯一成果や大きな cache を持つ票）だけを拾う。全体 56GiB は通常期の最大 48GB と急増時の 69GB の間で、
  soft guard まで約 1 日分（24h 新規の上側 ~20GB を除いた余裕 ~14GB）の猶予がある時点で気付けるようにした。
- Lean/状態機械: 対象外（閾値比較だけの純関数で、直接の試験で期待値を仕様の例から与えた）。
- 未解決（別段）: checkout 外の再ダウンロード可能 cache（HF hub blobs は sha256 名で内容検証可能）の内容証明つき回収は未実装。保持期間内の増加は回収できないため、急増時は guard 頼み。
- 追補（#15827 review P2）: 走査がタイムアウト・非0終了で部分結果のとき、合計は下限値になる。超過判定はそのまま正しいが「予算内」は断定できないため、
  `:workspace-budget` に `:complete? false` を記録し `capacity-budget: unknown scan-incomplete ...` を log する（完全走査では `:complete? true`）。
  例: timeout した走査 → `:complete? false`・`:total-over? false` かつ unknown 警告あり。完全走査で予算内 → 警告なし。
