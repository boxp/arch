# BOXP-249: Novel Board の管理ノート assignee 変更で起動できるようにする

## 背景

- owner が `Novels/NOVEL-6.md`（管理ノート）の frontmatter `assignee` を変更したが起動しなかった。
- 現行 runner は Board カードの `assignee::` を唯一の正本とし、毎 tick で管理ノートをカード値へ無言で巻き戻していた（診断: vault `Projects/novel-board-revival/NOVEL-6-diagnosis.md`）。
- owner 指示: Task Board と同様に `.md` 側の担当変更でも動作するよう揃える。対象は assignee のみ。レーン / NSFW / Done 承認の正本は変更しない。

## 方針（最小構成）

- `assignee` を「カードと管理ノートの双方向同期」にする。片側を無条件正本に反転しない。
- 状態 `~/.novel-board/assignee-sync/NOVEL-N.edn` に「最後に両側で一致させた値」を持ち、
  - 両側一致 → 状態を更新するだけ
  - 状態なし（初回導入 / 旧ノート） → カード優先（古いノート値で最新カードを巻き戻さない）
  - ノートだけ変化 → カードへ反映（Task Board と同じ操作感）
  - カードだけ変化 → ノートへ反映（従来どおり）
  - 両方変化（同時編集 / Sync 遅延） → カード優先、Run History に 1 回だけ記録
- active run（lock あり）の間は調整しない。run 完了時に runner が `boxp` へ戻す際、ノートが run 中に別 agent へ変更されていればそれを保持し、次 tick でカードへ反映して新担当へ渡す。
- Backlog=groom / Draft=write / Review=指示ありのみ / Done=再実行なし の起動境界は不変。
- 併せて scaffold タイトルの先頭 `- [ ]` 混入（Kanban UI で二重になる）を除去し、`]` を含むタイトルでも `card-title` が壊れないようにする。

## 変更ファイル

- `docker/codex-workspace/novel-board/novel_board_runner.bb`
- `tests/codex-workspace/novel-board-runner-test.sh`（回帰テスト追加）
- `docker/codex-workspace/novel-board/vault-seed/{Templates/Novel Management.md,Novels/README.md,Boards/Novel Board.md}`（説明文更新。live vault も同内容へ）

## 検証

- `bb novel_board_runner.bb test`（純関数）と black-box テスト全件 PASS。
- 配備後、sidecar ログと隔離 fixture で `.md` assignee 変更 → カード同期 → 期待 action 起動を確認。NOVEL-6 実カードは owner 意図 agent 不明のため割り当てない。
