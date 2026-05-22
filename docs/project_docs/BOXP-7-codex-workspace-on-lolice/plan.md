# BOXP-7: lolice cluster 上に Codex workspace を作成する

## Goal

OpenClaw の代替として、`lolice` cluster 上に Codex と Even G2 Terminal Mode で作業できる常設 workspace を作成する。

## Design

- `ghcr.io/boxp/arch/codex-workspace` image を `ubuntu:26.04` から build する。
- Image build は amd64 worker 固定のため `linux/amd64` のみ。
- Image には `codex`, `@evenrealities/even-terminal`, `obsidian-headless`, `git`, `ghq`, `gwq`, `boxp/ceeker`, `bb`, `lazygit`, `yazi`, `vim`, `node`, `npm` を入れる。
- Ubuntu base image の UID/GID 1000 既存ユーザーを利用する場合も user/group を `boxp:boxp` に揃え、entrypoint の `/home/boxp` 初期化が失敗しないようにする。
- `boxp` user は SSH public key login 用に locked account にしない。`PasswordAuthentication no` のため password login は無効。
- `obsidian-headless` package は `ob` command として利用する。
- entrypoint は `/usr/sbin/runuser` で `even-terminal` を `boxp` user として起動する。
- `even-terminal` のログやユーザー設定が root filesystem 直下へ出ないよう、process cwd と `HOME` を `/home/boxp` に揃える。
- Dockerfile の pinned package versions は Renovate custom manager で更新対象にする。
- `terraform/cloudflare/b0xp.io/k8s` で既存 k8s tunnel に WARP private route `10.111.250.7/32` を追加する。
- `codex-workspace.b0xp.io` は Cloudflare Zero Trust private hostname route として k8s tunnel に紐づける。
  - WARP/Gateway DNS が hostname を Cloudflare の initially resolved IP に解決し、client が直接 `10.111.250.7` を route しなくて済むようにする。
  - DNS-only A record `codex-workspace -> 10.111.250.7` は、cloudflared/Gateway が hostname を private IP に解決するために残す。
  - private hostname route と DNS-only A record は Cloudflare provider v5 resource のため、`terraform/cloudflare/b0xp.io/codex-workspace` target を分けて provider v5 で管理する。
- `lolice` 側は fixed ClusterIP `10.111.250.7` の Service を作成し、SSH `2222` と Even Terminal `3456` を公開する。

## Tasks

- [x] チケットを起票する。
- [x] Even G2 Terminal Mode と `@evenrealities/even-terminal` の接続モデルを確認する。
- [x] 既存の bastion/Cloudflare/Longhorn PVC パターンを確認する。
- [x] workspace image build を追加する。
- [x] workspace image 内の `boxp` user/group 作成を修正する。
- [x] workspace image 内の `boxp` account lock を解除する。
- [x] workspace image entrypoint で `/usr/sbin/runuser` を使うように修正する。
- [x] workspace image entrypoint で `even-terminal` の cwd/HOME を `/home/boxp` に揃える。
- [x] Cloudflare WARP private route を追加する。
- [x] `codex-workspace.b0xp.io` を private hostname route へ切り替える Terraform target を追加する。
- [x] Terraform validate を通す。
- [ ] PR を作成する。

## Verification

- `terraform -chdir=terraform/cloudflare/b0xp.io/k8s fmt -check`
- `terraform -chdir=terraform/cloudflare/b0xp.io/k8s validate`
- `terraform -chdir=terraform/cloudflare/b0xp.io/codex-workspace fmt -check`
- `terraform -chdir=terraform/cloudflare/b0xp.io/codex-workspace validate`
- `bash -n docker/codex-workspace/entrypoint.sh`
- `docker build --no-cache -t codex-workspace:test docker/codex-workspace`
- `docker run --rm --entrypoint /bin/bash codex-workspace:test -lc '...'` で主要ツールの起動を確認。
- `npx --yes --package renovate renovate-config-validator renovate.json5`
