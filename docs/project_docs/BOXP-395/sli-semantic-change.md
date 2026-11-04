# BOXP-395: Review 廃止に伴う SLI/SLO の意味の変化

BOXP-360（SLI）と BOXP-385（SLO）への連絡事項。過去の Review 系列は変更しない。切替時点より前は旧定義、後は新定義として読む。

切替時点は Task Board の `## Review` を削除した時刻とし、BOXP-395 の Notes と `migration-ledger.md` に記録する。

| 指標 | 切替前 | 切替後 |
| --- | --- | --- |
| Review 到達（`reached_review`、`first-review`） | result `review` の成功 run | `owner-acceptance` の成功 run と、過去分の `review` |
| `run.finished` の `result` | `review` | `continue`（過去分の `review` は残す） |
| `lane.changed` の `lane_to` | `review` あり | `ready` / `blocked` / `done` のみ |
| Review 停滞（`review-wait`） | Review 到達から次 run まで | 新規には発生しない。0 ではなく「対象なし」として扱う |
| マーカーなしの成功 run | `review` として読む | 2026-11-03 21:12 UTC（新 runner の最初の run）以降に終わった run は `continue` として読む |
| 継続 run の分類（insight v1） | `reopen_after_review` | `continuation`。是正に数えない |
| 現在状態 `awaiting-review` | Review の票 | 新規には発生しない。残るのは過去 snapshot のみ |

## 注意

- `continue` で続く run は Owner の差戻しではないので、reopen に数えない。
- 移行で Blocked / Done へ動いた票は `ledger` に lane 遷移が記録されない（helper 経由のため）。過去の Review 票が受入済みに見えても、`migration-ledger.md` で終了種別を確認する。
- 新しい観測基盤は作らない。BOXP-385 の `slo_snapshot.bb`（PR #14447）が Review の定義に依存する場合は、この表に合わせて同 PR 側で調整する。
