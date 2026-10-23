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

## 追加要件: scaffold 生成ノートのメタ文言を TBD 化（2026-10-19 owner 指示）

- 課題: `Templates/Novel Management.md` の運用説明（Workflow / 同期正本 / 連作設定 / Draft Preview / References 書式 / NSFW 解説 / 空の Requirements チェックリスト）が各作品ノートへ複写され、本文と無関係なノイズになっていた。
- 方針:
  - テンプレートは機械用 frontmatter（型は不変）、作品見出し、README への 1 行案内、parser 依存の 6 見出し（Draft Preview / Requirements / Outline / Review Instructions / Change History / Run History）と `TBD` だけにする。運用説明は `Novels/README.md` に集約。
  - runner に `placeholder-line?` / `section-content` を追加。`TBD` / `TODO` / `N/A` / `未記入` / `未定`（箇条書き・括弧付き可）と旧テンプレートの空 `- Title:` 行は未記入として扱う。
    - `section-filled?` が placeholder を内容と誤認しない → `TBD` だけの Review Instructions で改稿を起動しない（`:review-instructions-empty`）。Requirements / Outline の placeholder を執筆条件完成と誤認しない。
    - prompt（note-brief / 改稿指示）と参照解決（`reference-targets`）は `section-content` を使い、`TBD` を参照ファイルとして解決しない。
    - `append-history!` は Run History が placeholder だけなら最初の実記録で置き換える。Draft Preview / Requirements / Outline は既存の全置換で `TBD` が消える。
  - 既存 NOVEL ノートは一括変更しない。NOVEL-6 はテンプレート由来と厳密一致する未編集説明だけを差分確認の上で整理する。
- テスト: 自己テスト 4 件（TBD 判定、Review ゲート、参照除外、テンプレート描画）、black-box に scaffold 簡潔性・TBD 置換・TBD Review ゲートの assertion を追加。
- 配備順序: image 配備（placeholder 判定を含む runner）→ live vault の `Templates/Novel Management.md` と `Novels/README.md` を seed 同内容へ更新 → 隔離 scaffold で生成物確認。旧 runner に新テンプレートを渡さない（`TBD` を内容と誤認するため）。
