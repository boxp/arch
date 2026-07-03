# BOXP-13 plan

## Goal

`boxp/arch` の Renovate 依存更新 PR で繰り返し発生していた aqua checksum 更新失敗を再発防止し、Kubernetes バージョン更新を Renovate の自動 PR 対象から外す。

## Scope

- `renovate.json5` で Kubernetes 関連の custom regex package を `enabled: false` にする。
  - `kubernetes/kubernetes`
  - `cri-o/cri-o`
  - `kube-vip/kube-vip`
- `.github/workflows/wc-update-aqua-checksums.yaml` を外部 reusable workflow 呼び出しから repository 内の明示的な job に置き換える。
- aqua checksum 更新 job が GitHub App token で PR branch に直接 commit/push できるようにする。
- 原因と運用判断を `BOXP-13` の Notes に残す。

## Root Cause

`update-aqua-checksums` は `aquaproj/update-checksum-workflow` 経由で checksum を生成できていたが、後段の `suzuki-shunsuke/commit-action` が read-only `GITHUB_TOKEN` にフォールバックし、`POST /repos/boxp/arch/git/trees` で `Resource not accessible by integration` の 403 になっていた。

そのため `aqua/aqua-checksums.json` が PR branch に追加 commit されず、OPA 更新 PR では後続の `opa-fmt` も `checksum is required` で失敗していた。formatter 差分そのものが直接の失敗原因ではない。

## Implementation

- `wc-update-aqua-checksums.yaml` で `tibdex/github-app-token` により `contents: write` の GitHub App token を生成する。
- PR head SHA を checkout し、`aqua update-checksum -deep -prune` を実行する。
- `aqua/aqua-checksums.json` に差分がある場合、同じ token で head branch へ commit/push する。
- fork PR で checksum 差分が必要な場合は push せず明示的に fail する。
- Renovate の Kubernetes 関連 package rules は `enabled: false` とし、既存の自動 PR は close して手動 upgrade project に寄せる。

## Validation

- `npx --yes --package renovate renovate-config-validator renovate.json5`
- `/tmp/actionlint-boxp13/actionlint .github/workflows/wc-update-aqua-checksums.yaml .github/workflows/test.yaml`

## Follow-up

- この PR が merge された後、Renovate の残り aqua PR は checksum job の再実行または Renovate recreate で処理する。
- Kubernetes 1.36 以降の upgrade は Renovate PR ではなく、手動 upgrade ticket/project で扱う。
