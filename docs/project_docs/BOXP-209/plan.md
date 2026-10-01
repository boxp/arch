# BOXP-209: Task Board runner に完了チケットの run workspace 自動 prune を追加する

## 背景

Task Board runner（`docker/codex-workspace/task-board/task_board_runner.bb`）は run ごとに
`~/.codex-task-board/workspaces/<ticket>/<run-id>/` と worktree、ブランチ
`codex-task-board/<ticket>-<run-id>` を作るが、削除する処理がなかった。BOXP-208 では
`/home/boxp` PVC（50Gi）が 87% まで埋まり、手動で 615 run・約 15.7G を削除した。通常ペースで
月 5〜6G 増えるため、runner 自身が定期的に掃除する。

## 何を消すか

次をすべて満たす run workspace だけを削除する。1 つでも判定できないものは残してログに出す。

| 条件 | 補足 |
| --- | --- |
| チケットファイルがあり `status: done` | done 以外でも `closed` が残っているチケットがあるため、必ず `status` と組み合わせる |
| `closed` が今日（UTC）から保持日数以上前 | 既定 3 日 |
| run-id 先頭のタイムスタンプも保持日数以上前 | 古い `closed` のまま再オープン → 再 done されたチケットの猶予を守る。UUID なしの旧形式 run-id（`20260709T124714Z`）も読める |
| `locks/<ticket>.edn` がない | 判定と削除は `with-ticket-lock-guard` の中で行い、`acquire-lock!` と排他 |
| run 配下の全 checkout で `git status --porcelain` が空 | checkout は `.git`（ファイル / ディレクトリ）を持つディレクトリ。`ghq/github.com/<owner>/<repo>` 以外に agent が作った clone も含む。checkout の中も `.git` 以外は探索を続けるので、親から gitignore された入れ子の clone / worktree も 1 つの checkout として検査する（親の `git status` には出ないため）。symlink はたどらない |
| 各 checkout の `git rev-list HEAD --not --remotes` の全コミットが GitHub 上にある | `gh api repos/<owner>/<repo>/commits/<sha> --jq .sha` の出力が SHA と一致したときだけ「ある」と扱う |

チケットで決めた条件に加えて、データを失わない側に 4 点だけ厳しくしている。

- remote 追跡 ref は古かったり GitHub 以外の remote のものだったりするので、それだけでは GitHub 上に
  あることの証明にしない。`rev-list` の結果が空でも、`HEAD` のコミット自体は必ず `gh api` で確認する
  （tip が GitHub にあれば祖先もすべてある）。SHA ごとにキャッシュするので、同じ `main` から切った
  run が多くても呼び出しは 1 回で済む。
- run の中に git ディレクトリごと置かれた独立 clone は、run を消すとローカルの ref と stash も
  すべて消える。そのため独立 clone では `HEAD` に加えて全 ref（`--all`。ブランチ、タグ、その他の ref）を確認し、
  stash があれば保留にする。worktree は元リポジトリ側にブランチと stash が残るので `HEAD` だけを見る。
- `git reset --hard`、`commit --amend`、rebase で捨てたコミットは reflog から復元できるが、reflog は
  run（独立 clone なら全 reflog、worktree ならその worktree の `HEAD` の reflog）と一緒に消える。
  そのため reflog に載っているコミット（`git log -g`）とその祖先も確認対象にし、GitHub にないものが
  1 つでもあれば保留にする。push 済みのコミットを amend / rebase した場合は、元のコミットも GitHub に
  残っているので保留にならない。
- `gh api` で確認が必要なコミット（tip、reflog のコミット、remote 追跡 ref にないコミット）が 1 checkout あたり 200 件を超える場合は、1 件も確認せず保留にする
  （remote ref が無い clone で API を使い切らないため）。

### 保留（hold）の理由

`prune: hold <run パス> reason=<理由> [checkout=<run からの相対パス>]` の形で 1 行ずつ出る。

| reason | 意味 |
| --- | --- |
| `uncommitted-changes` | 未コミット変更または untracked ファイルがある |
| `commit-not-on-github sha=…` | GitHub が 404 / 422 を返した（reflog にだけ残っているコミットも含む） |
| `github-check-failed sha=…` | `gh` が認証切れ・rate limit・ネットワークエラー・タイムアウトなどで確認できなかった |
| `origin-not-github` | origin がない、または GitHub の URL ではない |
| `stash-present` | 独立 clone に stash がある |
| `too-many-unpushed-commits` | 確認が必要なコミットが 200 件を超える（ちょうど 200 件までは確認する） |
| `git-error` / `git-toplevel-mismatch` | git コマンドが失敗した、または `.git` が壊れている |
| `run-id-timestamp-unparseable` | run-id からタイムスタンプを読めない |
| `unsafe-path` | 実パスが `<root>/workspaces/<ticket>/<run-id>` と一致しない（symlink など） |
| `worktree-remove-failed` / `delete-failed` / `error` | 削除中の失敗 |

## 削除の手順

1. 元リポジトリが run の外にある worktree は `git --git-dir <元リポジトリ> worktree remove --force` で外す。
   入れ子になっている場合は深い方から外す。
2. run ディレクトリを `fs/delete-tree` で削除する。直前に、実パスが
   `<root>/workspaces/<ticket>/<run-id>` と一致することを確認する。独立 clone、gitignore 済みの
   ビルド成果物、run 直下に置かれたメモ類は run ごと消える。
3. その run のブランチ `codex-task-board/<ticket>-<run-id>` を、tip が GitHub 上にあるときだけ
   `git branch -D` する。ブランチを消すとブランチの reflog も消えるので、reflog に GitHub にない
   コミットがある場合（または 200 件を超える場合）もブランチを残す。それ以外の名前のブランチには触らない。
4. 全チケットの処理後、空になった `workspaces/<ticket>/` を非再帰の delete で削除する
   （チケットファイルがない・done でないチケットの空ディレクトリも対象。空でなければ触らない）。
5. worktree を外した元リポジトリごとに `git worktree prune` を実行する。

`runs/`、`state.edn`、`locks/`、`owners/`、`terminating-owners/`、vault は読み取りだけで、書き込まない。
`lock-guards/<ticket>.lock` は guard の取得で使う（既存ファイルの内容は変えない。無ければ空ファイルが
作られる）。

## 排他

- ロック確認・チケット状態の再確認・checkout の検査・削除は、run 1 つごとに `with-ticket-lock-guard`
  の中で行う。`acquire-lock!` は同じ guard の中でロックファイルを作るので、削除中に同じチケットの
  run が始まることはない。
- guard を取る単位を run にしているのは、guard が JVM 内の stripe ロックを兼ねており、同じチケットの
  frontmatter 更新（毎 tick の `sync-ticket-statuses!`）が待たされるため。待ちは run 1 つ分の検査と
  削除の時間に収まる。
- 手動の `prune-workspaces` と loop の prune、ロールアウト中の新旧 Pod は、同じ guard（FileLock）で
  直列化される。

## 実行タイミング

- `loop` の各 tick の後に、前回の開始から
  `CODEX_TASK_BOARD_WORKSPACE_PRUNE_INTERVAL_SECONDS` 以上経っていれば別スレッド（future）で起動する。
  起動直後の 1 回目は最初の tick の後に走る。
- 前回の prune がまだ動いていれば起動しない。draining 中（`prepare-shutdown` 後）は起動せず、
  実行中の prune も次の run に進む前に止まる。
- prune 中の例外はログに出して握りつぶし、runner は落とさない。
- 最終実行時刻は JVM 内の atom だけで持つ（`state.edn` は `pr-gate-retries` と共有で書き込みが
  非アトミックなため）。Pod 再起動のたびに 1 回走るが、冪等なので問題ない。
- one-shot の `tick` では prune しない。

## 環境変数

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `CODEX_TASK_BOARD_WORKSPACE_PRUNE` | 有効 | `0` / `false` / `no` / `off` で loop 中の自動 prune を止める。手動の `prune-workspaces` には効かない |
| `CODEX_TASK_BOARD_WORKSPACE_RETENTION_DAYS` | `3` | done から削除までの保持日数。0 以上の整数 |
| `CODEX_TASK_BOARD_WORKSPACE_PRUNE_INTERVAL_SECONDS` | `21600` | loop 中の実行間隔（秒）。1 以上の整数 |

不正な値のときは既定値を使い、`prune: warning invalid <変数>="<値>", using default <既定値>` を
値ごとに 1 回だけ出す。既定値のまま動くので `boxp/lolice` の manifest 変更は不要。

## 手動実行

```
task_board_runner.bb prune-workspaces [--dry-run]
```

`--dry-run` は同じ判定（`gh api` の確認を含む）を通し、削除系のコマンドだけを実行しない。

## ログ形式

```
prune: start retention-days=3 dry-run=false
prune: delete <run パス>
prune: delete-branch <元リポジトリの git dir> <ブランチ>
prune: keep-branch <元リポジトリの git dir> <ブランチ> reason=tip-not-on-github sha=<sha>
prune: keep-branch <元リポジトリの git dir> <ブランチ> reason=reflog-commit-not-on-github sha=<sha>
prune: hold <run パス> reason=<理由> checkout=<相対パス>
prune: delete-empty <チケットディレクトリ>
prune: summary deleted=N held=M skipped=K recent-runs=R branches=B empty-dirs=E dry-run=false skipped-detail=locked:1,not-done:31,within-retention:17
```

- `skipped` は対象外にしたチケット数（run が 1 つ以上あるもの）。内訳が `skipped-detail` に出る。
- `recent-runs` は、チケットは対象だが run-id が保持日数内だった run の数。
- dry-run では `delete` / `delete-branch` / `delete-empty` の行末に ` (dry-run)` が付く。
- 保留 run は prune のたびに出る。チケットの Notes には書かない。

## テスト

- `task_board_runner.bb test`: 対象判定（チケット / run）、origin URL の解釈、設定値のパース、
  起動判定の純粋関数テスト。
- `tests/codex-workspace/task-board-runner-test.sh`: 一時 git リポジトリ + worktree と fake `gh`
  （指定した SHA だけ成功を返す）で、次を確認する。
  - 古い done の clean な run が消え、ブランチ・worktree 登録・空のチケットディレクトリも消える
  - 猶予内の done / done 以外 / ロック中 / チケットファイルなし / 再 done 後の新しい run は残る
  - 未コミット変更あり / GitHub にないコミットあり / origin が GitHub でない / 独立 clone に
    push されていない別ブランチまたはタグあり / HEAD が古い remote 追跡 ref にしかない / `gh` がエラー、
    の run は残り、理由がログに出る
  - HEAD は push 済みだが run ブランチの tip が GitHub にない場合、run は消えてブランチは残る
  - `git reset --hard` で捨てて reflog にだけ残る未 push コミットがある独立 clone / worktree は残る。
    amend 前のコミットも GitHub にあれば消える。run ブランチの reflog にだけ未 push コミットがある場合、
    run は消えてブランチは残る
  - `--dry-run` は何も消さない。one-shot `tick` は prune しない
  - `runs/`、`locks/`、`state.edn` は変わらない。2 回目の実行は冪等
  - 不正な設定値は警告 + 既定値。`loop` は間隔ごとに prune を繰り返し、`…_PRUNE=0` で止まる

## 入れないもの

- review / blocked チケットの gitignore 済みビルド成果物の自動削除（`.env` など再生成できない
  ファイルが混ざり得て、一律の `git clean -X` は安全に判定できない）。
- 未コミット変更が残る run の自動破棄。保留としてログに出すだけ。
- 削除済み run に対応しない `codex-task-board/*` ブランチの整理、`~/ghq` 直下の手動 worktree の整理。
- PVC 容量アラート（BOXP-94）、`write-lines!` のアトミック化（BOXP-93）。

## 既知の制限

- どの ref からも reflog からも到達できない dangling オブジェクト（`git stash drop` 後の stash、
  reflog の期限切れ後のコミットなど）は確認しない。git 自身が gc で消す対象であり、通常の操作では
  復元できないため。
- 独立 clone の中の linked worktree の reflog は、clone 側の `--reflog` で確認する。run の外に
  git ディレクトリを置いた checkout（`--separate-git-dir`）は run を消しても ref と reflog が残るので、
  worktree と同じく `HEAD` とその reflog だけを見る。

- run の中の bare リポジトリ（`.git` を持たない）は checkout として検査せず、通常のファイルと
  同じく run ごと削除する。
- `git worktree remove` の途中で Pod が強制終了されると、その run は中途半端な状態で残り、
  次回以降 `uncommitted-changes` などで保留になることがある。その場合は手動で消す。

## デプロイ

`boxp/arch` の image 更新だけで反映される（image は `:latest` + `imagePullPolicy: Always` なので、
Pod の再起動が必要）。反映後、sidecar ログに `workspace prune enabled, …` と `prune: summary …` が
出ることを確認する。
