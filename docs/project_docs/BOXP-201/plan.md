# BOXP-201 実装計画（I3: writer・control store契約 / I2: execution intent）

## 目的と境界

設計正本はObsidian vaultの `Projects/codex-task-board-runner/autonomy-redesign/`（design / implementation-tickets）。I1（schema validator）はBOXP-203でmerge済み。ownerの「実装もやりましょう」を受け、依存順（I1 → I3 → I2 → I4）の次段であるI3をこのPRで実装する。

- v2は環境変数によらず常時offのまま。runnerの候補選択・起動・result marker・PR gateは変更しない。
- 追加するlibraryはrunnerの本番経路から呼ばない。temp vaultとsynthetic identityでのみ検証する。
- runner/helperの共通lockはopt-in（`TASK_BOARD_VAULT_WRITER_LOCK_DIR`）。未設定の配布環境では従来動作と同一。
- Deployment / Argo / cron / credential / 既存ticket・カードは変更しない。永続stateのmigrationもない。
- I2（execution intentとClaude route）、I4〜I7は各段階の別PRとし、このPRに含めない。

## 手順

1. `vault_writer.bb`: 共通vault writer lock、temp+fsync+atomic rename、checksum付きwrite-ahead transition journal、現在lane優先のrecover、writer世代照合。
2. `autonomy_control.bb`: control storeのlocal mock。credential登録からのactor解決、owner/runner別権限、revision CAS、hash-chainの追記専用event、writer_generationの単調発行、objective snapshotの版管理、budget epoch累積。
3. runner（`move-card!` / `sync-board-statuses!` / `update-frontmatter!` / `append-note!`）とhelperの書込commandをopt-inの共通lockで包む。
4. helperに `control-intent` のdry-run専用操作を追加する。表示する要求はcontrol storeがそのまま受理する形（ownerは `:update-control`、runnerは `:restrict-intent`）に限る。decision回答とretry変更はstoreのoperationが未定義のため、previewもI4 / I6でoperationと同時に追加する。
5. テスト: control契約、複数process＋helper＋runner syncの同時更新、journal各write間のkill、owner変更との回復競合、世代切替、lease喪失、dry-run不変。CIへ追加する。

契約の詳細は [i3-writer-control.md](i3-writer-control.md)。

## 配布とrollback

mainへのmergeで既存workflowがcodex-workspace imageをbuild・公開するが、追加libraryは未使用、lockは未opt-inのため動作は変わらない。helperは配布先（hermes-agent image、各agentのskill directory）へ別途同期されるまで旧版のまま動く。旧helperは新commandを持たないだけで、既存commandの互換性は維持する。

rollbackはこのPRのmerge commitをrevertする。journal・control storeは実環境に作成されないため、戻す永続stateはない。公開済みimageや稼働環境の切戻しはrevertでは自動的に行われない。

## I2: execution intent・停止優先・shadow比較（2026-10-02）

I3のmerge（PR #13122）後、依存順の次段としてI2を別PRで実装する。境界はI3と同じで、v2は常時off、Deployment / Argo / cron / credential / 既存ticket・カードは変更しない。

1. `autonomy_intent.bb`: control原本に基づく候補判定（`evaluate`）、route→起動方法（`launch-spec`）、lock後の再確認（`confirm-start`）、run終了時の投影可否（`finish-projection`）、decisionの有効性（`decision-current?`）、shadow比較。すべて純粋関数。
2. runner: opt-in（`CODEX_TASK_BOARD_AUTONOMY_SHADOW=true`）のshadow比較をtickに追加し、結果をrunner rootへ保存する。legacyの候補判定・起動・result marker・PR gateは変更しない。
3. テスト: mock control storeでの契約テスト、runner self-test、黒箱テスト（shadowのoff / on、`claude-fable` のretryでrouteを保持）。CIへ追加する。

契約の詳細と、設計からの差分（legacyの `claude-fable` の扱い）は [i2-execution-intent.md](i2-execution-intent.md)。

配布とrollback: mergeでcodex-workspace imageがbuild・公開されるが、shadowは未opt-inのため動作は変わらない。rollbackはmerge commitのrevert。shadowを有効にした環境があれば `autonomy-shadow/latest.edn` が残るだけで、戻す永続stateはない。
