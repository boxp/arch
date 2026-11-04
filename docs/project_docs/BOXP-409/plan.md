# BOXP-409: Task Board hook の夜間調整と通知を分離する

正本: Obsidian `Projects/task-board-hook-follow-through/request.md`。BOXP-270（既存配備）の後続。

## 原因（HOOK-01）

- 407 の 02:17 / 03:06 JST イベントは欠落していない。`outbox/pending/` に `:status :pending attempts=0` で実在し、
  dispatcher log は `pending event(s) deferred by quiet hours`、gateway.log の該当 event 参照は 0 件。
- 02-09 JST は `flush-pending!` が POST 自体を止めるため、通知だけでなく調整も止まる（設計どおりの動作が Owner 方針と不一致）。
- route prompt も手順1で 02-09 は何もしない、手順5で Ready 化を一律禁止し、cron 410f の最新 Owner 常設方針と矛盾する。

## 設計

### 状態遷移（dispatcher が正本）

`pending -> accepted -> (done | notify-pending -> digest に集約 -> done)`。未処理 / 処理済み / 継続操作 / 配信保留 / 配信済みを区別する。

| marker の result | 意味 | dispatcher |
|---|---|---|
| notified / question | 通常時間に通知 | done（既存） |
| silent | 処理済み・通知不要 | done |
| continued | 既承認の継続を helper で実施し readback 済み | done |
| deferred | 処理済み・朝に本人判断/重要成果を回収 | notify-pending |

- 夜間も POST する。payload に `notify_mode`（`defer|normal`）を載せる。
- 静音終了後の最初の tick で notify-pending を 1 digest（`BOXP-N-digest-<ts>-<hex>`、N は最古の項目）に集約し、票ごとに最新 event のみを項目化する。
- digest の完了は、handled marker に加えて Hermes の配信 receipt が `sent` であること。marker だけで未配信を消さない。
  receipt が `uncertain` / 不在のまま timeout したら unhandled/ へ移し、180m cron が一度だけ回収する。盲目的な再送はしない。

### 夜間のハードゲート（Hermes patch）

LLM の判断に依存せず、静音時間の task-board 最終送信を止める。本文は保存せず metadata receipt `quiet-held` のみ残す。
dispatcher は `quiet-held` を notify-pending に戻す（01:59 開始・02:01 応答の境界も落とさない）。

### 継続契約（HOOK-03）

hook / cron 410f / runbook を同じ文言の条件にそろえる: 登録済み scope のみ、active 尊重、終了/claim 解放確認、同一票排他、版別 TODO 受領、1 event で状態変更最大 1 件、dry-run → 限定実行 → readback。
本人実機確認待ちは再 queue せず deferred。helper 失敗時は票を直接 patch せず、副作用なしで deferred に診断を残す（marker の file-tool fallback は廃止）。

### 段階有効化と復元

outbox の `night-processing.edn` がない限り従来の静音保留のまま（既定 off）。restart なしで有効化/停止でき、`:only-tickets` で fixture に限定した canary が可能。
順序: Hermes（patch + route）→ codex-workspace image → fixture canary → 全体有効化。復元はファイル削除のみ。

## 再起動（Owner 別確認）

merge すると image updater の自動 rollout が起きるため、merge 前に対象・回数を確認する: Hermes 1 回、codex-workspace 1 回（実行中 run は planned shutdown）。

## 範囲外

他のメール/生活 cron の静音方針、180m の cron 間隔、BOXP-270 の履歴、407/408 の実装内容。

## 実装時に確定した点

- `quiet-held` は `updated_at` が現在の `accepted-at` 以降のときだけ有効。昼の再配信で実送信された event を digest へ戻さない。
- notified / question の marker は送信より先に書かれるため、静音開始の 600 秒前からは timeout まで完了を保留し、02:00 境界の保留通知を落とさない。
- 関連 PR の boxp/lolice 側は route prompt と annotation の更新で、merge すると Hermes が 1 回 rollout する。
