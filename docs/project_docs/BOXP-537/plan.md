# BOXP-537: 時間経過待ちの再確認予約を必須にし Blocked 票の放置を防ぐ

## 背景
時間経過待ち(観察窓・配備反映待ちなど)で担当が blocked を返すと、runner は票を Blocked + boxp へ移すだけで、
期限が来ても誰も元担当へ戻さない。Notes に「◯◯以降に再開」と書かれても実予約が無く、BOXP-453/491/497 などが
期限後も放置され、家経由の手動再投入が必要になっていた。

## 方式 (runner 内の永続予約)
外部 cron ではなく、常駐している task_board_runner の tick で処理する永続予約にする。
runner は PVC 上の `$ROOT/recheck-reservations.edn` に予約を保存し、毎 tick 期限を確認する。

1. 予約の作成
   - 担当が時間待ちで blocked を返すときは `TASK_BOARD_RECHECK_AT: <UTC ISO-8601>` を 1 行出す (prompt で必須化)。
   - runner は agent-reported-blocked の Blocked 遷移後に予約を作る。
     - wait-reason が owner-decision / new-scope の場合は予約しない (本人判断待ちを尊重)。
     - 期限は now+5分〜now+14日に制限。範囲外/不正値は予約漏れ扱い。
   - 予約漏れ回収: wait-reason=external-hold で RECHECK_AT が無い/不正な場合は fallback 予約 (既定 24h, env で変更可) を作り Notes に明記。
   - 連続自動再確認の上限 (既定 5 回、env で変更可)。上限到達時は予約せず Owner 確認を Notes に残す (盲目的 retry 防止)。
   - 票へ残す: Notes に `再確認予約: id=…; 期限=…; 再開担当=…; 種別=agent|fallback|manual; 連続=n/max`、
     frontmatter に `recheck_id` / `recheck_at` / `recheck_assignee` / `recheck_state`。
2. 期限到来時の正規再投入 (tick の候補選定前)
   - 条件: 票が Blocked・frontmatter status=blocked・assignee=boxp・board_rev が予約時と同一 (担当変更/レーン移動/再割当が無い)・
     実行中 lock が無い。
   - 条件を満たせば Blocked のまま担当を元担当へ戻し (新 rev)、通常の blocked-retry 候補として runner が起動する
     (同票排他・gate budget・quota hold・停滞レビュー hold はそのまま適用)。
   - 予約起点の blocked-retry では continuation budget をリセットしない (予算リセットなし)。
   - 票が変更済みなら予約を superseded として取消し Notes に一度だけ記録 (最新停止・担当変更の尊重、重複起動なし)。
   - runner 停止中に期限を過ぎた予約は次 tick で回収 (期限超過分を Notes に記録)。
3. 運用 CLI
   - `recheck-list` 予約一覧、`recheck-reserve BOXP-N --at ISO --assignee AGENT --by NAME` 既存 Blocked 票への手動予約、
     `recheck-cancel BOXP-N --by NAME` 取消、`recheck-audit` 予約の無い時間待ち Blocked 票の一覧。

## 先行救済票
- 453/491/497 は家経由で再投入済み、519 は Hermes cron job 4d130448f261 予約済みのため runner 予約は作らない (重複回避)。
- 242/409/494 は最新 Notes を確認し、本人入力不要かつ解除可能なものだけ回収する。

## 検証
- runner 単体テスト・black-box テストに予約作成/期限到来/取消/上限/予算非リセットを追加。
- merge→配備後、実票 (またはテスト票) で予約作成と期限後の再投入を確認する。
