# BOXP-235: Actions lockfile を全 workflow に展開し Renovate の自動再生成を成立させる

- チケット: BOXP-235（Obsidian `Tickets/BOXP-235`）
- 正本（調査・台帳・証拠・owner-summary）: Obsidian `Projects/BOXP-235/README.md`
- 前段: BOXP-234（`docs/project_docs/BOXP-234/plan.md`、1 workflow 限定導入）
- 本ファイルは PR に同梱する実装計画・運用手順・再検証・撤回手順。

## 背景と判断

BOXP-234 では `test-codex-task-board-runner.yml` 1 本だけを `.github/workflows/actions.lock` に onboard し、
Renovate 側の lockfile 再生成（artifacts update）は「未 onboard の全 workflow まで一括 onboard される」ため
`skipArtifactsUpdate: true` で止めていた。owner は boxp/arch の全 workflow への展開を承認したので、
「一部に限定できない」は停止理由ではなくなった。本票では次を行う。

1. 全 46 workflow を公式 CLI（`gh actions-lock` v0.2.0、lockfile v0.0.3）で onboard する。lock は手編集しない。
2. Renovate の自動再生成を有効化する（`skipArtifactsUpdate` を外し、`constraints.ghActionsLock: "v0.2.0"` で CLI 版を固定）。
3. `actions-lock-verify.yml` を全展開前提（未 onboard も失敗）に更新する。

## 隔離 fixture での比較（origin/main `efef827f2` の `.github/` を一時 git repo にコピー、remote なし）

| # | 条件 | 結果 |
|---|------|------|
| (a) | CLI v0.2.0 × Renovate 実引数 `--no-interactive --no-narrow --no-migrate-local-actions`（path なし） | 46/46 workflow が onboard。workflow 本文は無変更（full SHA 保持）。5 本は空 entry `[]`（下記）。`--verify` は `build-orange-pi-images.yml` の `local-action` error 1 件のみ |
| (e) | CLI v0.2.0 × `--no-interactive --no-narrow`（local action 移行あり） | (a) に加えて `build-orange-pi-images.yml` の `uses: ./.github/actions/build-orange-pi-image` が `uses: $/.github/actions/build-orange-pi-image` に書き換わり、composite action 内の `docker/setup-qemu-action` と `aws-actions/configure-aws-credentials` が lock に入る。他の差分なし |
| (d) | CLI v0.1.6 × Renovate 実引数 × 既存 lock v0.0.3 | exit 2 `lockfile version v0.0.3 is newer than this binary supports (v0.0.2)`。書き込みなし。Renovate ≤44.158.2（既定 pin v0.1.6）では再生成が失敗する、というコード上の期待を実測で確認 |
| 再現性 | 本 PR の lock は worktree で (e) と同じコマンドを再実行して生成 | fixture (e) の lock と byte 一致（`cmp`） |

空 entry `[]` になる 5 本の内訳（lock には onboard されるが直接の remote action が無い）:

- `test.yaml`, `wc-test.yaml`: 同 repo の reusable workflow（`uses: ./.github/workflows/wc-*.yaml`）のみ。呼ばれる側（`wc-*.yaml`）は各自の entry で依存を lock する。
- `wc-renovate-config-validator.yaml`, `wc-update-aqua-checksums.yaml`: 他 repo の reusable workflow を呼ぶ。公式 Docs「A reusable workflow is covered by the lockfile of the repository where it is defined」のとおり、呼び出し先の依存は定義側 repo の lock の管轄で、呼び出し側 lock には入らない（他 repo の変更は本票の対象外）。
- `build-orange-pi-images.yml`: (a) では local action 未移行のため空 entry + verify error。(e) の `$/` 移行で解消。

## 実装内容

1. `.github/workflows/actions.lock`: `gh actions-lock --no-interactive --no-narrow`（repo root、path なし）で再生成。
   46 workflow / 30 dependency（推移的依存を含む）。`--no-narrow` により既存の full SHA pin（ghalint
   `action_ref_should_be_full_length_commit_sha`）はそのまま。
2. `.github/workflows/build-orange-pi-images.yml`: CLI による `./` → `$/` の 1 行書き換えのみ。`$/…` は
   「常に running commit に解決され、inherently pinned で lock entry 不要」（GitHub Docs: Locking action
   dependencies）。同一 repo・同一 SHA の参照なので意味は変わらない。この workflow は `workflow_dispatch`
   のみで、実行すると Armbian image を build して S3 を更新する本番処理のため、runtime での `$/` 動作は
   本票では未確認（Docs 記載のみ）。
3. `.github/actionlint.yaml`: actionlint v1.7.12 は `uses: $/…` を「ref is missing」と誤検出するため、
   その message だけを `paths.ignore` で無視する（他の検査は維持）。ghalint v1.5.6 は `$/` を通す。
4. `.github/workflows/actions-lock-verify.yml`: `--no-onboard` を外し `gh actions-lock --verify --no-interactive`。
   未 onboard の新規 workflow・lock 不足・ref 移動を PR で検出する。trigger paths に `.github/actions/**` を追加
   （composite action の依存変更も lock に影響するため）。status-check には引き続き入れない（BOXP-207）。
5. `renovate.json5`: BOXP-234 の `skipArtifactsUpdate: true` rule を削除し、top-level `constraints.ghActionsLock: "v0.2.0"`
   を追加。週次「GitHub Actions workflows」group（手動 merge）は変更なし。
6. `docs/project_docs/BOXP-207/runbook.md`: 週次 PR の手順を「Renovate が lock を再生成 → verify 成功を確認して merge」に更新。

## Renovate 自動再生成の成立条件（コード・実測の区別）

- 起動判定（コード、renovate `2076755` `artifacts.ts`）: onboard 済み workflow の `action|workflow|docker` dep が更新された branch で、
  `gh extension install github/gh-actions-lock --force --pin <constraints.ghActionsLock>` →
  `gh actions-lock --no-interactive --no-narrow --no-migrate-local-actions` を repo root で実行し、lock 差分を commit する。
  全 workflow が onboard 済みなので、`.github/workflows/**` の action 更新は常にこの経路に入る。
- 既存 SHA pin の扱い（コード、`lookup/digest.ts` L212）: 既存 digest（`@<sha> # vX`）がある dep は Renovate が引き続き
  inline で SHA を更新する。lock 管理下の workflow で抑止されるのは「未 pin ref への新規 digest pin 提案」だけ。
  週次 PR の見え方（SHA + コメント更新）は従来どおりで、`actions.lock` の `commit` 更新が同 PR に加わる。
- CLI 版（実測 (d)）: lock v0.0.3 は v0.1.6 で読めない。`constraints.ghActionsLock` で v0.2.0 を明示する。
  Renovate 44.158.3 以降は既定も v0.2.0 だが、hosted 版の追従時期に依存しないよう固定する。
- 混在条件（コード、`generate.ts` L521）: group 内に skip 対象 upgrade が混在しない限り artifacts update は走る。
  本 PR で skip rule を削除したので該当しない。
- hosted 実測: boxp/arch の Mend hosted Renovate が実際に `actions.lock` を再生成するかは、次回の週次 PR
  （日曜 17-23 UTC 作成）でしか観測できない。本票時点では **未確認**。確認観点は Obsidian README の owner-summary に記載。

## 検証計画と結果の区別

- ローカル: `actionlint -config-file .github/actionlint.yaml`、`ghalint run`、`renovate-config-validator --strict`、
  `gh actions-lock --verify --no-interactive`（exit 0、error 0 件）。
- PR の CI: `actionlint` / `actions-lock-verify` / `gitleaks` / `test.yaml`（pull_request_target: renovate-config-validator など）が
  onboard 済み workflow として lock 適用下で動くこと（= lock 適用の実動作確認）。
- lock 不足拒否（runner による job 開始拒否）は BOXP-234 fixture で確認済みの挙動で、merge 必須 check とは別物。
  本票では再生成後の lock でも `test-codex-task-board-runner.yml` が動くことを PR の run で確認する。
- Renovate update → lock 再生成 → verify のサイクルは隔離 fixture で CLI 部分を実測、hosted 側は次回週次 PR で観測。

## Preview / CLI 更新時の再検証

1. `gh extension install github/gh-actions-lock --pin <新版> --force` 後、`gh actions-lock --verify --no-interactive`。
2. lockfile version が変わる場合は `gh actions-lock --no-interactive --no-narrow --no-migrate-local-actions` で再生成し diff をレビュー。
3. `actions-lock-verify.yml` の `GH_ACTIONS_LOCK_VERSION` と `renovate.json5` の `constraints.ghActionsLock` を同じ版へ更新。
4. actionlint が `$/` に対応したら `.github/actionlint.yaml` の ignore を外す。

## 撤回手順（rollback）

- 全体: 本 PR を revert する。workflow 本文の変更は `build-orange-pi-images.yml` の 1 行だけで、lock を消せば全 workflow は lock 無しの通常動作に戻る。
- Renovate 側のみ戻す: `renovate.json5` に BOXP-234 の `{ matchManagers: ["github-actions"], skipArtifactsUpdate: true }` を戻し、
  週次 PR では手動で `gh actions-lock --no-interactive --no-narrow --no-migrate-local-actions` を実行する。
- 特定 workflow を lock から外す手段は CLI に無い（lock は手編集しない）。外したい場合は全体 rollback か、その workflow の依存を解消する。
- org/repo 設定・ruleset・Require lockfile policy は触っていないため、設定側の戻しは不要。

## 安全境界

- 対象は boxp/arch のみ。他 repo（reusable workflow 定義側）や org 設定は変更しない。
- 本番処理を伴う `workflow_dispatch` / rerun（apply / ansible / image build / deploy）は行わない。
- 既存の必須 check は弱めない。`actions-lock-verify` は非必須のまま。
