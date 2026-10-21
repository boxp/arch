# BOXP-261: Task Board: 明示承認した緊急票を groom 後も担当 agent へ継続する opt-in 追加

## 背景

Task Board runner（`docker/codex-workspace/task-board/task_board_runner.bb`）は Backlog の
対応済み assignee 票を groom し、完了後は無条件に `Ready` + `assignee: boxp` へ戻す。
`Ready` で `boxp` の票は候補にならないため、緊急対応でも人間が assignee を付け直すまで
実装が始まらない（BOXP-259 / BOXP-260 で顕在化）。

通常の人間承認（Ready は human review point）は default のまま維持し、owner が票単位で
明示的に opt-in と承認 scope を書いた票だけ、groom 正常完了後に担当 agent を保持して
Ready に置き、既存の `Ready → implement` claim で In Progress まで自動で進める。

## 仕様

### ticket frontmatter（opt-in は 3 点セット、fail-closed）

| key | 値 | 意味 |
| --- | --- | --- |
| `groom_continue` | `true` / `false` / `consumed` / 空 | `true` のときだけ継続を要求する。runner は継続後に `consumed` へ書き換える（一回限り） |
| `groom_continue_scope` | 1 行の文字列 | owner が承認した対応範囲。空なら opt-in 無効 |
| `groom_continue_approved_by` | 承認者名 | `CODEX_TASK_BOARD_GROOM_CONTINUE_APPROVERS`（既定 `boxp`）に含まれないと権限不足で無効 |

既存票は key が無いので従来どおり（default-off）。

### runner の判定（action = groom のときだけ）

1. run 開始前（lock 取得直後）に frontmatter を snapshot する。agent が run 中に自分で
   opt-in を書き足しても無効。
2. groom 正常完了（exit 0 かつ `TASK_BOARD_RESULT: review`）で、snapshot と run 後の
   frontmatter の両方が有効な opt-in（同じ scope / 承認者）なら継続する。
3. 継続時: カードを `Ready` へ、frontmatter `status: ready`、`assignee` は担当 agent のまま、
   `groom_continue: consumed`。Notes に継続理由（承認者・scope）を記録。次 tick の通常
   `Ready → In Progress` claim（lock 付き）で implement が始まる。
4. 停止（`Ready` + `assignee: boxp`、`groom_continue` はそのまま）にするケースと Notes 記録:
   - agent が `TASK_BOARD_GROOM_CONTINUE: hold` を出力（要確認）
   - result marker が `review` 以外
   - scope 空 / 承認者が許可リスト外（権限不足）
   - run 中に opt-in が外された・変更された（opt-out）
   - `CODEX_TASK_BOARD_GROOM_CONTINUE=false`（runner 全体の kill switch）
5. groom 失敗（exit != 0）は従来どおり `Blocked`。opt-in は消費しない。
6. 重複 run / クラッシュ復帰は既存の ticket lock・stale lock 回収・planned shutdown 回収に
   乗る。継続後の implement claim も同じ lock 経路なので二重起動しない。
7. 判定と書込みは原子的に行う: `Ready` へ置く frontmatter 書込み（status / assignee /
   `consumed`）は、run 後の opt-in 再読込と同じ read-modify-write（ticket mutex +
   共有 vault-writer lock）で行う。agent 終了後に owner が `--no-groom-continue` で
   取り消した場合、その取消しが判定に見えるか、`consumed` 書込みの後に直列化されるかの
   どちらかになり、古い比較結果で取消しを上書きすることはない。
   commit 後に直列化された取消し(`consumed` + `Ready` + agent assignee)は helper CLI 側が
   検出し、`assignee: boxp` に戻して Notes に記録する(`--assignee` 明示時はそれを優先、
   他レーンは `groom_continue: false` のみ)。これで取消し後に implement が自動起動しない。
   さらに runner は ticket lock 取得後に frontmatter の assignee と Board レーンを再読し、
   lock 取得前に選んだ候補(action / assignee / status)と違えば lock を解放して見送る
   (別 tick が古い assignee で implement を起動する TOCTOU を塞ぐ)。再検証と Ready/Review/
   Blocked → In Progress の遷移は Board lock + ticket lock(helper と同じ順: vault → Board →
   ticket)を保持したまま 1 箇所で行い、遷移途中で失敗したら lock 内でカードを元レーンへ戻す。
   `sync-board-statuses!` も同じ Board file lock で囲む。`sync-ticket-statuses!` は lock
   取得前の Board 読みを巡回対象の列挙にだけ使い、ticket ごとに同じ Board lock + ticket lock
   (`with-board-and-ticket-locks`)の中で Board を再読込してから lane を frontmatter に投影する
   (helper `update` 直後に古い lane で ticket を上書きしない)。prune が ticket lock guard 内から
   呼ぶ `board-card-lanes` は board-mutex を取らない(Board 書込みは atomic rename で torn read が
   無く、ticket → board の逆順取得で sync/claim と deadlock しないため)。
   既定配備では vault-writer lock が無効(未設定)なので、runner は helper CLI と同じ
   per-file lock(`<tmpdir>/task-board-locks/<sha256(canonical path)[0:16]>-<name>.lock`)を
   frontmatter 更新・Notes 追記・Board 書換で常に取得し、同一ホスト上の helper 書込みと
   直列化する(取得順は helper と同じく vault-writer lock 外側・per-file lock 内側)。
   ticket / Board の書込みは temp file + atomic rename にし、別プロセスの途中読み
   (frontmatter 欠落)を防ぐ。
8. groom が idle timeout で停止した場合は opt-in を消費せず、summary は `:retrying`
   のまま（`:succeeded` で上書きしない）。カードは `Backlog` に留め assignee を保持し、
   次 tick で groom を再実行する（半端な groom 結果を implement queue に進めない）。

### groom prompt

opt-in 有効時だけ、承認者と scope、継続の挙動、`hold` の出し方、`groom_continue*` を
編集しないことを prompt に追加する。

### helper CLI（`docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`）

- `create` / `update` に `--groom-continue`、`--groom-continue-scope <text>`（または
  `--groom-continue-scope-file`）、`--groom-continue-approved-by <name>`（既定 `boxp`）、
  `--no-groom-continue`（opt-out）を追加。`--groom-continue` は scope 必須、scope は 1 行。
- `create` の frontmatter template に 3 key を追加（既定は空）。
- `show` に `groom_continue` 系の値を含める。
- SKILL.md に実用例と注意を追記。

### 既存仕様との整合

- Ready は引き続き human review point。opt-in 票だけが「owner が Ready 承認を事前に与えた票」
  として扱われる。
- vault `Projects/codex-task-board-runner/spec.md` の Lane Behavior と Mismatch Handling を
  更新する。

## 変更ファイル

- `docker/codex-workspace/task-board/task_board_runner.bb`
- `docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`
- `docker/hermes-agent/skills/obsidian-task-board/SKILL.md`
- `tests/codex-workspace/task-board-runner-test.sh`
- `docs/project_docs/BOXP-261/plan.md`
- vault: `Projects/codex-task-board-runner/spec.md`（arch 外）

## テスト

black-box（fake claude / codex、tmp vault）:

- default-off: opt-in 無しの groom は `Ready` + `boxp`（既存挙動）
- 継続: opt-in 票の groom → `Ready` + agent + `consumed` → 次 tick で implement が開始される
- groom 失敗（exit 1）→ `Blocked`、opt-in 未消費
- 要確認（`hold` marker）→ `Ready` + `boxp`
- 権限不足（承認者が許可外 / scope 空）→ `Ready` + `boxp`
- agent が run 中に opt-in を書き足しても無効
- opt-out（`false`、run 中の取り消し、env kill switch）→ `Ready` + `boxp`
- 重複 run: `Ready` + agent の票に対し 2 つの tick を同時起動しても agent 起動は 1 回
- クラッシュ復帰: stale lock 付きの opt-in 票が回収され、groom 1 回で継続する
- helper CLI: create / update の引数検証と frontmatter 出力
- agent 終了後・commit 直前の取消し（test hook で runner を一時停止し helper CLI で
  `--no-groom-continue`）→ `Ready` + `boxp`、未消費、次 tick で implement が始まらない
- opt-in 票の groom が idle timeout → `Backlog` + agent 保持、未消費、summary は
  `:retrying` + `:groom-continue idle-timeout`、次 tick は groom 再実行で正常継続
- lock 取得直前に人間が `--assignee boxp` へ戻した `Ready` 票は、lock 取得後の再検証で
  見送られ agent は起動しない(lock 解放、run ディレクトリ無し)
- claim 遷移の frontmatter 書込みが失敗(test hook)→ カードは Ready に戻り、lock 解放、
  agent 非起動、次 tick で通常どおり claim
- sync の Board 読み直後(test hook)に helper `update --lane "In Progress"` でカードを動かしても、
  単発 `sync` が lock 内で再読込するため ticket は `in-progress` のまま(旧実装では `ready` に戻る)

## 配備

main merge → `build-codex-workspace-image.yml` → argocd-image-updater が lolice
`argoproj/codex-workspace/.argocd-source-codex-workspace.yaml` の sha tag を更新 →
`Recreate` rollout。rollout は稼働中 runner（本 run を含む）を planned shutdown で止めるため、
merge のタイミングは owner 判断。反映後は新 Pod の image tag と、隔離テスト票での
groom → Ready → In Progress 遷移を確認する。
