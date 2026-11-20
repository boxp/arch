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
