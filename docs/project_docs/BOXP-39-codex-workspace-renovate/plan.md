# BOXP-39 codex-workspace Renovate coverage

## 目的

`docker/codex-workspace/Dockerfile` で固定している codex-workspace image のツール・ランタイムのバージョンを Renovate の監視対象として明確化し、新しい固定 ARG を追加するときに `renovate.json5` の custom manager も確認する運用を残す。

## 対象依存の棚卸し

| Dockerfile 固定値 | 現在値 | Renovate datasource | Renovate depName / package | 方針 |
| --- | --- | --- | --- | --- |
| `FROM ubuntu:26.04@sha256:...` | `26.04` + digest | Dockerfile manager | `ubuntu` | Renovate 標準 Dockerfile manager で tag/digest 更新対象 |
| `CODEX_VERSION` | `0.142.4` | `npm` | `@openai/codex` | custom manager で管理 |
| `EVEN_TERMINAL_VERSION` | `0.8.1` | `npm` | `@evenrealities/even-terminal` | custom manager で管理 |
| `PI_AGENT_VERSION` | `0.80.2` | `npm` | `@earendil-works/pi-coding-agent` | custom manager を追加 |
| `OBSIDIAN_HEADLESS_VERSION` | `0.0.12` | `npm` | `obsidian-headless` | custom manager で管理 |
| `GH_VERSION` | `2.95.0` | `github-releases` | `cli/cli` | custom manager で管理 |
| `GHQ_VERSION` | `1.10.1` | `github-releases` | `x-motemen/ghq` | custom manager で管理 |
| `GWQ_VERSION` | `0.1.1` | `github-releases` | `d-kuro/gwq` | custom manager で管理 |
| `CEEKER_VERSION` | `0.3.7` | `github-releases` | `boxp/ceeker` | custom manager で管理 |
| `BABASHKA_VERSION` | `1.12.218` | `github-releases` | `babashka/babashka` | custom manager で管理 |
| `LAZYGIT_VERSION` | `0.62.2` | `github-releases` | `jesseduffield/lazygit` | custom manager で管理 |
| `YAZI_VERSION` | `26.5.6` | `github-releases` | `sxyazi/yazi` | custom manager で管理 |
| `CURSOR_AGENT_VERSION` | `2026.06.12-19-59-36-f6aba9a` | `custom.cursor-agent` | `cursor-agent` | 既存 custom datasource で管理 |
| `KUBECTL_VERSION` | `1.36.1` | `github-releases` | `kubernetes/kubernetes` | custom manager を追加 |
| `KUSTOMIZE_VERSION` | `5.8.1` | `github-releases` | `kubernetes-sigs/kustomize` | `kustomize/v*` release tag を抽出する custom manager を追加 |
| `NODE_MAJOR` | `24` | `node-version` | `node` | custom manager で管理 |

## 対象外

- `apt-get install` の package 群は個別 version pin をしていないため、今回の Renovate custom manager 対象外。base image 更新時または Dockerfile 更新時に apt repository の最新解決に任せる。
- `terraform` の CLI version ARG は現行 Dockerfile には存在しないため、今回の追加対象外。将来 `TERRAFORM_VERSION` などを追加する場合は同じ ARG 棚卸しに含める。

## Renovate 設定方針

- npm で配布されるグローバル CLI は `npm` datasource の regex custom manager で `ARG *_VERSION` を検出する。
- GitHub Releases 由来の CLI は `github-releases` datasource の regex custom manager で `ARG *_VERSION` を検出する。
- `kubectl` は Kubernetes release に従うため `kubernetes/kubernetes` の `v*` tag から version を抽出する。
- `kustomize` は `kubernetes-sigs/kustomize` の `kustomize/v*` tag から version を抽出する。
- `NODE_MAJOR` は `node-version` datasource で major version を監視する。
- Dockerfile の base image tag/digest は Renovate 標準 Dockerfile manager で検出する。
- Dockerfile の ARG 群直前に「新しい固定 version を追加したら renovate.json5 customManagers も確認する」コメントを追加した。

## 検証

- `npx --yes --package renovate renovate-config-validator renovate.json5`
  - 成功。`Config validated successfully against 1 file(s)` を確認。
- `LOG_LEVEL=debug RENOVATE_PLATFORM=local npx --yes --package renovate renovate --dry-run=extract`
  - 成功。`docker/codex-workspace/Dockerfile` が Dockerfile manager で抽出され、`ubuntu:26.04@sha256:...` の tag/digest が dependency として出力された。
  - regex custom manager で `docker/codex-workspace/Dockerfile` が 15 件マッチした。
  - 抽出結果で `@openai/codex`, `@evenrealities/even-terminal`, `@earendil-works/pi-coding-agent`, `obsidian-headless`, `cli/cli`, `x-motemen/ghq`, `d-kuro/gwq`, `boxp/ceeker`, `babashka/babashka`, `jesseduffield/lazygit`, `sxyazi/yazi`, `kubernetes/kubernetes`, `kubernetes-sigs/kustomize`, `cursor-agent`, `node` が `packageFile: docker/codex-workspace/Dockerfile` として検出されることを確認。
  - local mode では GitHub token なしのため `GitHub token is required for some dependencies` warning が出るが、依存抽出自体は成功。

## 作業ログ

- 2026-07-03: per-run worktree が古い main を指していたため、`origin/main` へ fast-forward して `PI_AGENT_VERSION`, `CURSOR_AGENT_VERSION`, `KUBECTL_VERSION`, `KUSTOMIZE_VERSION` が入った現行 Dockerfile を基準にした。
- 2026-07-03: `PI_AGENT_VERSION`, `KUBECTL_VERSION`, `KUSTOMIZE_VERSION` の Renovate custom manager 漏れを追加した。
- 2026-07-03: Renovate config validator と local dry-run extract で検証した。
