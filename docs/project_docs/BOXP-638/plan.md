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
