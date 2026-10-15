# BOXP-234: workflow lockfile を test workflow へ限定導入し Renovate 整合を検証する

- チケット: BOXP-234（Obsidian `Tickets/BOXP-234`）
- 正本（設計・調査・検証結果）: Obsidian `Projects/BOXP-234/README.md`
- 本ファイルは PR に同梱する実装計画と再検証・撤回手順。

## 背景

GitHub Actions の workflow dependency lockfile（2026-10-14 public preview）を、
本番 Apply を伴わない workflow 1 つに限定して導入し、
実行時適用・lock 不足検知・Renovate との更新整合を実証する。
全 workflow / 全 repo への展開、Require lockfile policy の有効化は対象外。

## 選定

対象: `.github/workflows/test-codex-task-board-runner.yml`

- 依存 action は `actions/checkout` のみ。本番 mutation（Apply/deploy/push image）なし。
- トリガは `pull_request` / `push: main`（paths 限定）/ `workflow_dispatch`。
  fixture branch へ `workflow_dispatch` できるため、PR を汚さずに失敗系を試験できる。
- main への merge で起動する他 workflow: `apply.yaml`（tfaction、terraform 差分なしなら target 空で skip）、
  `gitleaks.yaml`（読み取り）。本 PR の変更範囲では本番 Apply は発火しない。

## 実装内容

1. `.github/workflows/actions.lock`（機械生成、`gh actions-lock v0.2.0`、lockfile version v0.0.3）。
   生成コマンド（path を明示し、既存 SHA pin を外さない）:

   ```sh
   gh actions-lock --no-interactive --no-narrow .github/workflows/test-codex-task-board-runner.yml
   ```

   `--no-narrow` を付けると CLI は既存の full SHA ref をそのまま lock に記録し、workflow 本文を書き換えない
   （付けない場合 `actions/checkout@3d3c…  # v7.0.1` → `actions/checkout@v7.0.1` に書き換えられ、
   ghalint の `action_ref_should_be_full_length_commit_sha` に違反する）。
2. `wc-actions-lock-verify.yaml` + `test.yaml` + `wc-path-filter.yaml`:
   `.github/workflows/**` 変更時に `gh actions-lock --verify --no-onboard` を読み取り専用で実行し、
   `status-check`（main ruleset の必須 check）に含める。token は `github.token` を `contents: read` に限定。
   PR 側コードは実行しない（YAML 解析と GitHub API 参照のみ）。
3. `renovate.json5`: onboard 済み workflow の github-actions 更新を別 branch に分け、
   `skipArtifactsUpdate: true` / `automerge: false`。

## Renovate 整合の判断

- Renovate（Mend hosted、44.x）は `actions.lock` があると、onboard 済み workflow の action 更新時に
  repo root で `gh actions-lock --no-interactive --no-narrow --no-migrate-local-actions` を実行する
  （renovatebot/renovate #45199、docs は experimental 扱い）。
- scratch copy で同コマンドを再現した結果、**未 onboard の 42 workflow まで一括 onboard** され、
  `build-orange-pi-images.yml` は local action 未移行のため verify が error になる。
  限定導入の境界を越えるため、Renovate の自動 lock 再生成はこの repo では使わない。
- 代わりの最小更新経路: Renovate が SHA を更新 → `actions-lock-verify` が失敗して automerge されない →
  その branch で下記を実行し diff をレビューして merge。

  ```sh
  gh actions-lock --no-interactive --no-onboard --no-narrow --no-migrate-local-actions
  ```

  他 42 workflow の `actions/checkout` 更新 PR は従来どおり（lock 対象外なので Renovate は lock に触れない）。

## 検証計画

- PR の `pull_request` 実行で対象 workflow が成功し、run の Set up job に lockfile 由来の解決が出ること。
- fixture branch（`workflow_dispatch`）で lock に無い ref へ変更 → 実行が lock 不足で失敗すること。
- fixture branch で action を別版へ更新 → 上記コマンドで lock 追従 → verify 成功 → 実行成功。
- `renovate-config-validator` / `ghalint` / `actionlint` が通ること。

## Preview 更新時の再検証

1. `gh extension upgrade gh-actions-lock` 後、`gh actions-lock --verify --no-onboard` を実行。
2. lockfile version が変わる場合は `gh actions-lock --no-interactive --no-onboard --no-narrow --no-migrate-local-actions` で再生成し diff をレビュー。
3. `wc-actions-lock-verify.yaml` の `GH_ACTIONS_LOCK_VERSION` を同じ版へ更新。

## 撤回手順（rollback）

1. `.github/workflows/actions.lock` を削除（対象 workflow は lock 無しの通常動作に戻る。workflow 本文は未変更）。
2. `test.yaml` / `wc-path-filter.yaml` から `actions-lock-verify` を外し、`wc-actions-lock-verify.yaml` を削除。
3. `renovate.json5` の BOXP-234 packageRule を削除。
4. いずれも通常 PR で行う。org/repo 設定・branch ruleset は触っていないため設定側の戻しは不要。

## 注意: `--no-onboard` だけでは local action 移行が走る

`gh actions-lock --no-onboard` は onboard を抑止するが、fix run である限り同 repo の `uses: ./…` を
`uses: $/…` へ書き換える（v0.2.0 で `build-orange-pi-images.yml` が書き換えられるのを fixture で確認）。
lock 追従コマンドには必ず `--no-migrate-local-actions` を付け、実行後は `git status` で
対象 workflow と `actions.lock` 以外に差分が無いことを確認する。
