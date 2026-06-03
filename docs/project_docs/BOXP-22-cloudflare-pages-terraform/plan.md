# BOXP-22: Cloudflare Pages hosting via Terraform

## Goal

`boxp/arch` の `apps/video-rotator` を Cloudflare Pages でホスティングするための infrastructure を `boxp/arch` の Terraform pipeline に載せる。

## Scope

- `terraform/cloudflare/b0xp.io/video-rotator` を新規作成する。
- Cloudflare Pages project `boxp-video-rotator` を Terraform 管理する。
- GitHub source は `boxp/arch`、production branch は `main` とする。
- Build command は `cd apps/video-rotator && npm ci && npm run build`。
- Output directory は `apps/video-rotator/dist`。
- Custom domain は `video-rotator.b0xp.io`。

## Notes

- Cloudflare Pages の GitHub integration は Cloudflare 側で `boxp/arch` に接続済みである必要がある。
- Cloudflare provider v4.52 の `cloudflare_pages_project` と `cloudflare_pages_domain` を使う。
- `terraform` と `aqua` がローカル環境にないため、ローカルで `terraform validate` は実行しない。CI/tfaction の plan で最終確認する。
