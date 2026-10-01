# BOXP-201 I3 契約: 共通vault writerとcontrol store mock

どちらのlibraryも実行を認可しない。結果は `{:ok? boolean :diagnostic {:category keyword :code string}}` を基本形とし、失敗時にファイル内容・要求本文・credential・例外文・pathを含めない。

## vault_writer.bb（namespace `vault-writer`）

`open-writer` は vault、制限された state dir（lockとjournal）、writer世代、`:verify-generation`（現在世代のときだけ `true` を返す関数）を受け取る。verifierがない、`true` 以外を返す、例外を投げる場合はいずれも書込まない。

| 操作 | 内容 |
| --- | --- |
| `with-vault-lock` | `<state-dir>/vault-writer.lock` の排他lock。JVM内はmonitor、process間はFileLock。同一thread内は再入可能 |
| `atomic-write!` | 同一directoryのtempへ書いてfsyncし、atomic renameで置換。既存permissionを引き継ぐ |
| `update-ticket!` | frontmatterの単純scalar更新とNotesへの1行追記。`:expected-revision` は投影された `control_revision` とのCAS |
| `transition!` | カードのlane移動とticketへの投影。`:from-lane` と `:expected-revision` をlock内で再確認する |
| `write-state!` | state dir直下の単純なファイル名に限ったEDN stateの直列化swap。lock・journalは対象外 |
| `recover!` / `pending-transitions` | 未完了transitionの解決と一覧 |

### transition journal

`<state-dir>/transitions.journal` は `<sha256> <EDN>` の追記専用行。`transition!` は次の順で進む。

1. lock内で世代・未解決journal・`:guard`（lease保持の確認など）・カードが1枚であること・lane・revisionを確認する。
2. `:prepared` recordを追記してfsyncする。
3. 世代を再確認してBoardを書く。Board laneが正であるため先に書く。世代が変わっていたら以後journalを含め何も書かず、entryは `:prepared` のまま現在世代の `recover!` に委ねる。
4. 世代を再確認してticket（frontmatterの `status` と指定key、Notes 1行）を書く。
5. `:committed` recordを追記する。

`recover!` は現在世代のwriterだけが実行でき、各ticket書込みと各journal追記の直前にも世代を再確認して、失効した時点で中断する。`:prepared` のまま残ったentryを**現在のlane**と照合する。

| 現在の状態 | 結果 |
| --- | --- |
| カードが `from-lane` のまま | `:aborted`。何も適用されていないので書込まない |
| カードが `to-lane` で、`control_revision` の投影が記録時と同じ | `:recovered`。ticketへの投影を冪等に完了する（他writerが追記したNotesは保持） |
| laneまたは `control_revision` が別の値へ変わった | `:superseded`。再生しない。現在のlaneが正 |
| カード重複・カード欠落・ticket欠落 | 未解決のまま報告する。自動修復しない |

未解決entryがあるticketへの新しい `transition!` / `update-ticket!` は `:unresolved-journal` で拒否する。他ticketは継続できる。

末尾の壊れた行は中断された追記として無視し、次の追記前に切り詰める。途中の破損と未知の `journal-version` は `:journal-corrupt` とし、以後の書込みをすべて止める。journalはrunnerの既存state（`locks/`、`runs/`、`state.edn`）とは別ファイルで、旧writerは読まない。

### 制約

- lockは協調するwriter間でのみ有効。Obsidian等の非協調な編集とは直列化されない。CAS（lane / `control_revision`）で検出できる範囲に限る。
- FileLockがnode・container間で有効かは共有volumeの実装に依存する。state dirの配置とlockの実効性確認はI7のwriter inventoryで扱う。
- `recover!` がカードの現在laneを `to-lane` と観測した場合、それが中断したwriterの書込みか第三者の同一移動かは区別しない。v2 ticketでは `:expected-revision` を必須にする（I2）ことで、ownerのcontrol変更を伴う移動を `:superseded` にする。
- journalは追記のみで圧縮しない。保存期限と削除手順は別ticket。

## autonomy_control.bb（namespace `autonomy-control`）

control原本のinterfaceと、actor・revision・世代の契約を固定するlocal mock。実際の認証済みcontrol API/storeの実装・配置・credential分離はI7。mockはtrust設定に登録されたcredentialからactorを決め、自己申告の名前やvaultの投影を使わない。認証機構ではなく、temp fixture以外に置かない。

`init-store!` で空のevent logを明示的に用意する。読取・要求はlogを作成しないため、原本が無い場合は空として扱わず `:unavailable` になる。

| 要求（`request!`） | actor | 条件 |
| --- | --- | --- |
| `:issue-writer-generation` | owner | `:expected-generation` が現在値と一致。+1のみ |
| `:issue-control` | owner | 世代発行済み、ticketにcontrolが無い。revision・世代・digestはstoreが決める |
| `:update-control` | owner | `:expected-revision` のCAS。intent / route / scope / budget / requirements / `:new-budget-epoch` |
| `:restrict-intent` | runner | 現在世代、revisionのCAS。`pause` / `cancel` / `wait-human` への変更のみ。`cancel` からは変更不可 |
| `:consume-budget` | runner | 現在世代、idempotency key。stepの予約は `run` intent・revision一致・残budget内のみ |

- 未登録credentialは `:unauthenticated`、権限のないroleは `:forbidden`、古いrevisionは `:conflict`、古い世代は `:stale-generation`。agent roleは読取のみ。
- 保存するcontrolはすべてI1の `validate-control` を、store側に設定した許可repo/pathで通過したものに限る。
- requirementsの変更は `ticket_version` を進め、digestを再計算する。decision / retry contractは `control_revision` に固定されているため、revisionの更新で旧版は無効になる。
- budget消費はticketとbudget epochに累積する。revisionの更新では戻らず、ownerが明示した `:new-budget-epoch` だけが新しいepochを開始する。過去epochのidempotency keyは再利用できない。
- eventは `seq`・`event-id`・actor subject/role・`previous-revision`・`revision` を持ち、行ごとのhash chainで連結する。再生時に連番、世代+1、revisionの連続を検査し、不整合は `:unavailable`。監査用の `events` はこれらの帰属情報だけを返し、保存したcontrol（requirements snapshotを含む）は返さない。
- `read-control` / `verify-writer` / `authorize-write` は呼出側が保持する `:min-revision` / `:min-generation`（既に観測した最大値）を受け取り、storeがそれより小さい値を返したら `:rollback-detected`。
- `authorize-write` は起動・書込み直前の照合で、store世代・controlの `writer_generation`・要求の世代・revisionがすべて一致した場合だけ成功する。世代を進めた後、旧世代で発行したcontrolはownerが再発行するまで使えない。
- `verify-projection` はticket frontmatter（`autonomy_version` / `execution_intent` / `control_revision`）と原本の一致を確認する。一致は何も許可せず、不一致は起動を止める。

## runner / helperのopt-in lock

`TASK_BOARD_VAULT_WRITER_LOCK_DIR` を設定した場合だけ、runnerのBoard/ticket書込みとhelperの書込commandが同じ `vault-writer.lock` を取得する。未設定なら従来どおり。runnerでは既存のJVM内mutexの内側、helperでは既存のper-file lockの外側で取得する。opt-in時の `sync` は、ticketごとにlock内でBoardのlaneを読み直してから `status` を投影する。lock内から他のlockを取らないこと。全writerを同時に切り替える手順はI7で扱い、一部のwriterだけにopt-inした状態を本番で作らない。

helperの `control-intent` / `control-decision` / `control-retry` は `--dry-run` 専用で、control APIへ送る要求と必要なactor（owner / runner-or-owner）を表示するだけ。vaultには書込まない。

## 検証

```bash
bb tests/codex-workspace/autonomy-control-test.bb
bb tests/codex-workspace/vault-writer-test.bb
bb tests/codex-workspace/autonomy-policy-test.bb
tests/codex-workspace/task-board-runner-test.sh
tests/codex-workspace/recurring-events-test.sh
```

`vault-writer-test.bb` は別processのworker 4本、helper 2本、runner `sync` を同じtemp vaultへ同時実行し、Notes・frontmatter・カードの消失や重複がないことを確認する。journalの各write間でprocessをhaltさせた後の回復、owner変更との競合、世代切替、lease喪失、helper dry-runの不変も含む。
