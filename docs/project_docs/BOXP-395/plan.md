# BOXP-395: Task Board Review レーン廃止

正本は Obsidian `Projects/task-board-review-retirement/owner-summary.md`。ここには実装判断だけを残す。

## 新しい結果契約

| agent / runner の結果 | gate | 遷移先 | 担当 |
| --- | --- | --- | --- |
| `continue`（旧 `review`、マーカーなしも同じ） | PR gate 実行 | pass: Ready / 修正可能な失敗: In Progress / 上限: Blocked | pass と修正可能な失敗は維持、Blocked は boxp |
| `done` | なし | Done | boxp |
| `blocked` | なし | Blocked | boxp |
| `owner-acceptance`（localllm の適用済み結果） | なし | Blocked（本人確認待ち） | boxp |
| groom | なし | Ready | boxp |

- PR URL の報告漏れは既存の有限の gate 再試行対象とする。その他の PR gate と codex review は変更しない。
- `TASK_BOARD_REVIEW_PR: none` は PR review の話なので名前を変えない。
- Ready に戻すのは既存 scheduler に任せるため。新しい常設レーンも新 cron も作らない。

## 無限継続の防止

- `continuation-budget.edn` に票ごとの自動継続回数を持つ（既定上限 8、`CODEX_TASK_BOARD_CONTINUATION_LIMIT`）。
- 記録は遷移より先に行う。crash で多く数えることはあっても、rollout や移行で減ることはない。
- 同じ run の二重計上はしない。
- 消すのは Done と Blocked からの明示再開（`blocked-retry`）だけ。

## 旧データの扱い

- 旧 `review` マーカーは `continue` として読む。
- 旧 Review 見出しの下に残ったカードは読めるが、Review へは移動できない。
- runner の move-card、helper、vault writer はすべて Review を移動先として拒否する。
- 配信待ちの旧 `review` イベントは配信する。Review からの移動はレーン差分で通知しない（移行の連投防止）。
- localllm の旧 commit journal の `review` は Blocked（本人確認待ち）として完了させる。
- Novel Board は別実装で変更しない。`localllm_docs.bb` の内部状態 `:review` も Novel が使うので残す。

## 移行の順序

1. arch / lolice / dotfiles の PR を CI と gate 通過後に merge
2. image 更新と workspace rollout を確認（argocd-image-updater）
3. 移行ツールの dry-run で ledger と現在の Board を比較
4. 小バッチで移行し、Ready は同時起動数を抑える
5. 全件照合後に `## Review` を Board から削除

## ロールバック

- コード: 該当 PR を revert すると image が戻る。新 runner が書いた `continue` / `owner-acceptance` は旧 ledger では未知の result だが、run には影響しない。
- 票: `migration-ledger.md` に元のレーンと担当を残す。Notes は追記だけなので履歴は失われない。
