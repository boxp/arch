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
| notified / question | 通常時間に通知 | 配信 receipt `sent` で done。`uncertain` は unhandled、timeout まで receipt なしは notify-pending |
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

## 再起動（Owner 承認済み）

merge すると image updater の自動 rollout が起きる。Owner が通常反映に必要な Hermes / codex-workspace の再起動を承認済み（Obsidian `Projects/task-board-hook-follow-through/rollout-owner-authorization.md`）。この PR の merge で Hermes と codex-workspace が各 1 回 rollout する見込みで、実回数は配備後に記録する。

## 範囲外

他のメール/生活 cron の静音方針、180m の cron 間隔、BOXP-270 の履歴、407/408 の実装内容。

## 実装時に確定した点

- receipt は `updated_at` が現在の `accepted-at` 以降のときだけ有効。古い receipt は今回の配信の証拠にしない。
- notified / question の marker は送信より先に書かれ、送信が遅れて静音に入ることがある。そのため marker だけでは完了せず、gate が全 event に書く receipt で判定する。timeout まで receipt がなければ done にせず digest で回収する（二重通知はありうるが欠落はしない）。
- 静音保留は receipt が唯一の証拠なので、書き込みに失敗したら gate は送信成功を返さない。
- gate の receipt を前提にするため、配備順は Hermes を先にする。Hermes が古いままだと notified の event は timeout 後に digest へ回り、二重通知になる。
- 静音保留された digest は同じ event ID で再送しない。Hermes が ID で重複排除するためエージェントが再実行されず、朝の通知が欠落するから。元 ID から決定的に導いた新 ID で発行し直し、項目を新 digest に付け替え、元 digest は `:superseded` で done へ移す（marker の有無を問わない）。中断しても次 tick で再開でき、digest は増えない。
- digest の完了は `sent` か、gate が意図的な [SILENT] を確認して書く receipt `silent`（marker も silent の場合）に限る。silent marker だけでは未配信のまま完了しない。
- 静音時間の正本は dispatcher の `CODEX_TASK_BOARD_EVENT_QUIET_HOURS` / `CODEX_TASK_BOARD_EVENT_TIMEZONE`。別コンテナの Hermes gate が同じ値を使えるよう、dispatcher が tick ごとに vault の `Projects/task-board-events/quiet-policy.json` へ公開する（変更時のみ書込み）。初回公開前は gate も同じ env 名と既定値を使う。解釈不能な時間指定は dispatcher と同じく静音なし、不正な timezone は gate が保留する。
- 関連 PR の boxp/lolice 側は route prompt の更新だけで、annotation の変更は外した。route は Pod 起動時に PVC へコピーされるため、lolice を先に merge し、この PR の Hermes image rollout で反映する。
- `deferred` marker は最終応答より先に書かれるため、marker だけでは digest へ回さない。gate が [SILENT] を確認して書く receipt `silent` を待ち、timeout まで証拠がなければ digest で回収する。digest 以外の event で `deferred` marker の後に本文が来た場合、gate は時刻を問わず静音と同じく保留し送信しない（報告は digest に一本化する）。遅い応答・送信直後の crash による二重通知はこの経路では起きない。
- `deferred` marker でも本文が送信済み（receipt `sent`）なら digest に再掲載しない。timeout 後に未解決へ移し、180m cron が回収する。digest に組み込まれる前の項目に後から `sent` / `uncertain` が届いた場合も未解決へ移す。
- digest の `silent` receipt は、同じ event の `sent` / `uncertain`（vault と Hermes ローカルの両方）を上書きしない。
