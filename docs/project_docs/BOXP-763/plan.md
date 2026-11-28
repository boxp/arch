# BOXP-763: Hermes Agent の Renovate 非 major 更新を自動マージ対象にする

## 目的

`docker/hermes-agent/Dockerfile` の FROM（`docker.io/nousresearch/hermes-agent`）の Renovate 更新を、
major でなければ自動マージする。major は手動のまま。安定版 tag + digest 固定、候補 image の build・起動・
通知回帰の検証は維持し、それらが成功した時だけ merge される。失敗・未実行は通さない。

## 調査結果（変更前）

- main の必須 check は ruleset の `status-check`（test.yaml、pull_request_target）だけ。
- 候補 image の build は別 workflow（build-hermes-agent-image.yml の `build-and-push`）で、必須 check でも
  `status-check` の needs でもない。lolice の notify lab（BOXP-582）は手動実行だった。
- そのため rule を `automerge: true` にするだけでは、build が失敗・未実行でも merge される。

## 決まり（具体例）

| 更新 | 例 | automerge | merge される条件 |
|---|---|---|---|
| patch | v0.23.3 → v0.23.4 | する | 下の gate がすべて成功 |
| minor | v0.23.x → v0.24.0 | する | 同上 |
| digest | v0.23.3 の再 push | する | 同上 |
| major | v0.x → v1.0.0 | しない | 手動（`manual-review-required`）。なお allowedVersions が v0.x に限るため現状は候補に出ない |
| 日付 tag / rc | v2026.9.24, rc.1-v0.23.4 | 候補にしない | allowedVersions（従来どおり） |

gate（docker/hermes-agent/** を変える PR すべて）:

- job `hermes-agent-candidate`（test-hermes-agent-candidate.yml を test.yaml から呼ぶ。base branch の定義で動く）
  1. PR の候補 image を build（push なし・build cache の書き込みなし・secret なし）
  2. lolice main の notify lab stage2 をその image で実行（bootstrap init、gateway 起動、boxp-notify の回帰）
  3. `check-stage2.bb` で判定（NG があれば失敗）
- `status-check`: この job が failure か cancelled（timeout は cancelled になり failure() では拾えない）なら失敗。
- `enable-auto-merge`: hermes-agent-candidate の対象 PR では、この job の結果が success の時だけ auto-merge を有効にする
  （skipped・cancelled・failure は無効のまま）。

例外・注意:

- notify lab の A1（Alertmanager）は relay の静音時間（17-00 UTC）に落ちる。Hermes 本体の更新 PR は
  Renovate schedule で 00-16 UTC にだけ作成・更新する。同じ Dockerfile の他依存（obsidian-headless 等）の PR は
  rule を変えないため夜間に作られると gate が失敗し、auto-merge されない（fail-closed。日中に re-run）。
- Babashka（BOXP-681）の rule と他依存の rule は変更しない。
- test.yaml の変更後、GitHub の「悪意の可能性がある workflow」保護で run が止まることがある（BOXP-207 runbook）。
  merge 後に `scripts/list-blocked-workflow-runs.sh` で確認し、止まっていれば Owner の Web 承認が必要。

Lean モデル: 適用しない（Renovate 設定と CI 条件式の変更で、状態機械として述べる規則がない。期待値は上の表から確認する）。

## 検証

1. renovate-config-validator（strict）で設定を検証。
2. この PR で test-hermes-agent-candidate.yml の pull_request 実行が成功する（現行 FROM の候補で build + lab）。
3. merge 後、arch#15774（v0.23.3 → v0.23.4/5）が Renovate により automerge 設定に更新され、
   job hermes-agent-candidate 成功 → auto-merge → main build → GitOps（lolice は `:latest`）→ 稼働版・通知の健全性を確認する。
   実更新が起きない場合は「設定の検証済み・実績未確認」と区別して記録する。
