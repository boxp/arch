# BOXP-201 I2 契約: execution intent・停止優先・shadow比較

`autonomy_intent.bb`（namespace `autonomy-intent`）は純粋関数だけを持ち、I/Oも起動も行わない。v2は常時offのままで、runnerはこのlibraryをopt-inのshadow比較にだけ使う。結果は固定形のdiagnostic（`{:category keyword :code string}`）を持ち、requirements・ticket本文・credential・例外文を含めない。

## 候補判定 `evaluate`

入力は、Boardのカード（`:ticket-id` `:status`）、ticket frontmatter（投影）、ticket本文、legacy runnerの判定（`:legacy-action`）、control原本の読取結果（`autonomy-control/read-control`）、ownerが選択したcanaryのticket集合、owner側の許可repo/path（`:policy-context`）。canary集合と許可範囲はowner側の設定から渡すもので、vaultや要求からは取らない。

frontmatterに `autonomy_version` / `execution_intent` / `control_revision` のいずれも無いticketは `:legacy-v1`、一つでもあればv2の主張として扱う。v2の主張は、原本と照合できない限りlegacy判定へ戻さず、起動しない。

| mode | 条件 | 結果（diagnostic code） |
| --- | --- | --- |
| legacy-v1 | legacy runnerが候補にしない | 起動なし（`no-legacy-action`） |
| legacy-v1 | assigneeが旧 `fable` | 起動なし（`legacy-route-retired`） |
| legacy-v1 | 上記以外 | legacy runnerと同じaction（`legacy`） |
| v2 | `autonomy_version` が `2` 以外 | `unsupported-version` |
| v2 | laneがDone、または未知のstatus | `lane-terminal` |
| v2 | ownerのcanary集合に無い | `not-canary` |
| v2 | 原本を読めない（未認証・ticket無し・巻戻し検出・store不在を含む） | `control-unavailable` |
| v2 | 原本が別ticket、I1の `validate-control` を通らない、消費量が読めない | `control-mismatch` |
| v2 | controlの `writer_generation` がstoreの現在世代と異なる | `stale-generation` |
| v2 | intentが `run` 以外 | `intent-stopped` |
| v2 | frontmatter投影（version / intent / revision）が原本と不一致 | `projection-mismatch` |
| v2 | ticketの要求部分が原本のobjective snapshotと不一致 | `objective-mismatch` |
| v2 | routeに起動方法が無い | `unsupported-route` |
| v2 | 消費済みstepまたはwall時間がbudget上限以上 | `budget-exhausted` |
| v2 | laneがBlocked | `retry-contract-required`（retry contractはI4） |
| v2 | すべて通過 | Backlog=groom、Ready / In Progress=implement、Review=review-fix（`ok`） |

- 停止（`pause` / `cancel` / `wait-human`）は投影や目的の照合より先に判定する。agentが投影を `run` に書き換えても原本が停止なら起動しない。
- routeとintentは原本から取る。assigneeは表示であり、agent担当へ変えても起動せず、`boxp` へ戻しても停止にならない。
- 要求部分（`requirements-text`）はticketの `## Summary` と `## Acceptance Criteria`。行末空白とcheckboxのチェック状態は正規化する。Notes・lane・assigneeの更新は目的変更にならない。どちらかの節が無い、または空なら不一致。要求を変えるにはownerが `:update-control` で新しい要求版を発行する。
- revisionの更新だけでは消費budgetは戻らない（I3のbudget epoch）。

起動可の結果は `:launch`（起動方法）と `:snapshot`（ticket・revision・世代・route・requirements digest・scope digest）を持つ。

## route `launch-spec`

| route | 起動方法 |
| --- | --- |
| `claude-fable` | Claude CLI、`--model claude-fable-5-1`。`--agent` なし。helperは `~/.claude/skills/...`、Notes sourceは `claude-fable` |
| `codex` / `codex-sol` / `codex-full` / `codex-terra` / `codex-mini`（＋I1が許すreasoning suffix） | Codex CLI。modelはrunnerの既存のroute表で解決する |
| 旧 `fable`、`claude-opus` / `claude-sonnet`、その他 | なし（nil）。別routeへのfallbackはしない |

`launch-spec` は環境変数を読まない。旧 `CODEX_TASK_BOARD_FABLE_*` やCodex用profileでClaudeのmodelは変わらない。runnerのself-testで、runnerが現在 `claude-fable` に渡す引数と `launch-spec` の引数が一致することを確認する。

### 設計からの差分: legacyの `claude-fable`

設計（implementation-tickets I2）を書いた時点のrunnerには `claude-fable` routeが無く、「legacy-v1の `claude-fable` は候補0」としていた。その後mainで `claude-fable` / `claude-opus` / `claude-sonnet` がlegacy routeとして実装・稼働している（このticket自身がそのrouteで動いている）。そのためI2では、legacy-v1 ticketの `claude-fable` はlegacy判定のまま（shadowでも差分なし）とし、v2での `claude-fable` だけをcanary・原本一致・`run` intentに限定した。legacyの `claude-fable` をv2 writerで拒否するかはI7のowner判断に残す。

## lock後の再確認 `confirm-start`

候補のsnapshotを取ってからticket lockを取るまでに状態が動いた場合に備え、lock内で読み直した入力でもう一度 `evaluate` し、両者を比べる。再評価が起動不可ならその理由で、起動可でもaction・revision・世代・route・digestのどれかが違えば `revision-changed` で起動しない。新しいrevisionでの再開は次のtickの新しい候補になる。実際の起動直前には、I3の `authorize-write`（世代とrevisionのfencing）も同じrevisionで通す。

## run終了時 `finish-projection`

run開始時のsnapshot、終了時に読んだ原本、終了時のBoard laneを受け取る。次のいずれかなら結果をlane・ticketへ投影しない（run artifactには残す）。

| 終了時の状態 | code |
| --- | --- |
| 原本を読めない、別ticket | `control-unavailable` |
| writer世代が変わった | `stale-generation` |
| intentが `run` でない（ownerの停止、runnerによる `wait-human` への制限） | `intent-stopped` |
| revisionが変わった（再開済みでも古いrunの結果は使わない） | `revision-changed` |
| カードがIn Progress以外へ動かされた | `lane-changed` |

budget消費の記録（`:consume-budget`）はrevisionを進めないため、投影を妨げない。

## decisionの有効性 `decision-current?`

decision packetを、発行時のcontrol revision・scope digest・artifact headに対してI1の `validate-decision` で照合する。現在のheadを渡さない場合、headが変わった場合、ownerがscopeを変えてrevisionが進んだ場合、`superseded` / `expired` / `issuance: template` は無効。これは有効性の確認だけで、owner回答の認証・承認eventの検証・一回消費はI6。

## runnerのshadow比較

`CODEX_TASK_BOARD_AUTONOMY_SHADOW=true` を設定した場合だけ、tickごとにBoardの全カードを `evaluate` し、legacy判定との比較を `<CODEX_TASK_BOARD_ROOT>/autonomy-shadow/latest.edn` に上書き保存する。未設定（配布環境）では何もせず、libraryも読み込まない。

- legacyの候補はshadowより前に、shadowと無関係に決まる。shadowはticketを起動・停止・再routeしない。vault（Board / ticket）には書込まない。
- 評価に失敗した場合は例外のclass名だけをlogに出し、tickは続行する。
- I7までcontrol APIとownerのcanary選択が存在しないため、runnerは原本を「読めない」、canaryを空として渡す。v2の主張を持つticketはすべて起動不可として記録される（通常は `not-canary`）。
- 保存内容は件数（`:cards` `:legacy-starts` `:shadow-starts` `:differing` `:by-mode` `:by-diagnostic`）と、カードごとの `:ticket` `:status` `:mode` `:legacy-action` `:start?` `:action` `:diagnostic` `:differs?`。ticket本文やrequirementsは含めない。

v2がoffの間、legacy runnerはv2の投影を理解しない。v2の主張を持つticketでも、対応済みassigneeが付いていれば従来どおり起動する（shadowには差分として記録される）。v2 ticketをlegacy runnerの入力から隔離するのはI7のwriter世代切替の責務で、それまで実ticketへv2の投影を付けない。

## このPRで実装していないこと

- `process-card!` へのv2経路の組込み。`confirm-start` / `finish-projection` はmock storeに対する契約とテストまでで、実起動経路からは呼ばない。v2の有効化とcontrol API接続はI7。
- Blockedの条件付き再開（I4）、WIP / lease（I5）、承認eventと通知（I6）。
- 実配布CLIが `claude-fable-5-1` を受け付けるかの確認（I7のCLI smoke）。fake CLIでargvを確認するところまで。

## 検証

```bash
bb tests/codex-workspace/autonomy-intent-test.bb
bb docker/codex-workspace/task-board/task_board_runner.bb test
tests/codex-workspace/task-board-runner-test.sh
```

`autonomy-intent-test.bb` はmock control storeを使い、lane × intent × route × assigneeの全組合せ、agent / runner identityによる停止解除の拒否、投影の書換え、目的snapshotの改変・欠落・別目的、budgetと世代、候補取得後のpause、実行中のpause・lane変更・世代切替、head / scope変更後のdecision、shadow出力に本文が出ないことを確認する。runnerの黒箱テストは、shadowが既定でoff、有効時にvaultが1byteも変わらないこと、legacy判定が変わらないこと、`claude-fable` のidle retryがrouteとmodelを保持し旧 `fable` のoverrideを受けないことを確認する。
